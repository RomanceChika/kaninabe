/**
 * 書く参照の列の**新しい親**と先掴みの順の照合(点検 fix26 3 回目 D26c-1・D26c-2)。**照らせない組は生成を断る。**
 *
 * 子の行を入れる・参照の列を書き換えると、DB は書き込みの中で新しい親の行を `for key share` で掴む(`for update` とだけ衝突する)。
 * 先掴みが**排他で掴んだ表より名前の順で前か同じ表**の親を、書き込みの中で後から掴むと、「親を排他で掴んでから自分の表の行を掴む」
 * 別の生成 RPC と 40P01 の輪になる(実測: 遷移が `records_actor` の引数の枝で別の実行者を書く形・自分の表を指す参照の列を 2 本が
 * 互い違いに書く形)。
 *
 * 照合は**掴みの計画のデータ**の上で行う(SQL の字面は比べない)。書く参照の列ごとに、その値が指す行の決まり方(`rpc-row-id.ts`)と、
 * 計画(`rpc-body-lock.ts` の `lockPlan`)の各行の決まり方・表・強さ・順番を突き合わせ、排他の行より前(同じ行を含む)に同じ行を
 * 共有以上で掴む行があれば覆いとする。無ければ断る(前の版はここで新しい親を先掴みに足したが、足す形の母集合を字面で決めて 2 回
 * 外したので、足さずに断る側へ倒した)。
 *
 * | 形 | 書く参照の列 | 値の行 |
 * |---|---|---|
 * | 作成 | 作成が入れる列(`insertColumns`) | 入れる値 |
 * | 編集 | 書き換えてよい列と `computes` の列 | 書いた後の値 |
 * | 遷移 | 引数で受ける列(`records_actor` の縛りの枝も含む) | 書いた後の値 |
 * | 削除 | 無い(子の行を消しても親は確かめない) | — |
 *
 * 作成の冪等キーの行だけの排他は数えない —— その行が既にあれば挿入の前の再送の枝で返り(確かめに進まない)、無ければ掴みは 0 行で
 * 何も持たない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';
import { lockPlan, type LockTarget } from './rpc-body-lock.js';
import type { RpcBodyFacts } from './rpc-facts.js';
import type { RpcBodyProblem } from './rpc-params.js';
import { sameRow, writtenRow, type RowId } from './rpc-row-id.js';

/** 照合の入力(関数名・形・自表)。 */
export interface FkCheckOrderInput {
  readonly name: string;
  readonly shape: 'create' | 'update' | 'delete' | 'transition';
  readonly table: DataTableSpec;
}

/** 書く参照の列 1 本(親の表と、書く値が指す行の決まり方)。 */
export interface WrittenRef {
  readonly column: string;
  readonly parent: string;
  readonly value: RowId;
}

/** 排他の行と書く参照の列の親の組(覆う行の別名。覆いが無ければ null)。 */
export interface FkCheckPair {
  readonly exclusive: string;
  readonly exclusiveAlias: string;
  readonly column: string;
  readonly parent: string;
  readonly coveredBy: string | null;
}

/**
 * 書く参照の列(外部キーの宣言がある列だけ。public の表を指すものだけ)。
 *
 * @param input 関数名・形・自表
 * @param facts 本文の事実(列の写像は本文と同じ 1 本)
 * @returns 書く参照の列の並び
 */
export function writtenRefs(input: FkCheckOrderInput, facts: RpcBodyFacts): readonly WrittenRef[] {
  const written: readonly { readonly column: string; readonly value: RowId }[] =
    input.shape === 'create'
      ? facts.insertColumns.map((column) => ({ column: column.name, value: writtenRow(column.name) }))
      : input.shape === 'update'
        ? [...facts.writeColumns.map((field) => field.name), ...facts.updateColumns.map((column) => column.name)].map((column) => ({ column, value: writtenRow(column) }))
        : input.shape === 'transition'
          ? facts.transitionColumns
              .filter((column) => facts.params.some((param) => param.role.kind === 'column' && param.role.field.name === column.name))
              .map((column) => ({ column: column.name, value: writtenRow(column.name) }))
          : [];
  return written.flatMap((entry) => {
    const key = input.table.foreignKeys.find((candidate) => candidate.column === entry.column);
    const parent = key === undefined ? null : publicTable(key.references);
    return parent === null ? [] : [{ column: entry.column, parent, value: entry.value }];
  });
}

/**
 * 排他の行(作成の冪等キーの行だけは除く)と、名前の順で前か同じ表の親の組を、覆う行と一緒に返す。
 *
 * 覆う行 = 親の表を、同じ値の行の決まり方で、共有以上の強さで、排他の行より前(その行自身を含む)に掴む計画の行。**親が排他の行と同じ表なら、
 * 覆いはその排他の文そのものだけ**(同じ表の 2 行を別の文で掴むと順が id で決まらず、文の順で互いの行を待つ。点検 fix26 4 回目 D26d-2)。
 *
 * @param refs 書く参照の列
 * @param plan 掴む順の計画
 * @returns 組の並び(計画の順・書く列の順)
 */
export function fkCheckPairs(refs: readonly WrittenRef[], plan: readonly LockTarget[]): readonly FkCheckPair[] {
  return plan.flatMap((lock, index): FkCheckPair[] => {
    if (lock.mode !== 'update' || lock.createKey === true) return [];
    return refs
      .filter((ref) => ref.parent <= lock.table)
      .map((ref) => {
        const candidates = ref.parent === lock.table ? [lock] : plan.slice(0, index + 1);
        const cover = candidates.find((held) => held.table === ref.parent && (held.mode === 'share' || held.mode === 'update') && held.ids.some((id) => sameRow(id, ref.value)));
        return { exclusive: lock.table, exclusiveAlias: lock.alias, column: ref.column, parent: ref.parent, coveredBy: cover?.alias ?? null };
      });
  });
}

/**
 * 覆いの無い組を理由つきで返す(生成器と T6 が同じ 1 本を呼ぶ)。
 *
 * @param input 関数名・形・自表
 * @param facts 本文の事実
 * @returns 断る理由(無ければ空)
 */
export function fkCheckOrderProblems(input: FkCheckOrderInput, facts: RpcBodyFacts): readonly RpcBodyProblem[] {
  const create = input.shape === 'create';
  const pairs = fkCheckPairs(writtenRefs(input, facts), lockPlan(facts, !create, create)).filter((pair) => pair.coveredBy === null);
  const seen = new Set<string>();
  return pairs.flatMap((pair) => {
    const key = `${pair.exclusive}|${pair.column}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const where = pair.parent === pair.exclusive ? '同じ表' : '名前の順で前の表';
    return [
      {
        message: `${input.name} は ${input.table.table}.${pair.column} に書く値が指す親 ${pair.parent}(排他で掴む ${pair.exclusive} と${where})の行を、先掴みが同じ値で先に掴んでいません。外部キーの確かめの for key share が排他の後ろに来て、親を先に掴む別の RPC と 40P01 の輪になりうるので、生成を断ります`,
        // 遷移は書いた後の値の掴みの語を持たず、掴みの宣言を足しても覆いにならないので勧めない(点検 fix26 5 回目 D26e-2)。自分の表を指す参照は、
        // 掴みの宣言を足せば同じ表の文が 1 文に id の順で畳まれて通る(6 回目 D26f-4)。
        suggestion:
          input.shape === 'transition'
            ? `shape を外した手書きの RPC にして、${pair.column} に書く値の親の行を、排他で掴む行と一緒に表名の順(同じ表なら 1 文に id の順)で先に掴む`
            : `書いた後の値の親を掴む宣言(${pair.column} の書き込みで発火するトリガの locks)を足す(同じ表なら 1 文に id の順で畳まれる)か、shape を外した手書きの RPC にして掴む順を書き下す`,
        counterexample: { function: input.name, table: input.table.table, column: pair.column, parent: pair.parent, exclusive: pair.exclusive },
      },
    ];
  });
}

/** public の表名(スキーマ修飾を落とす)。public 以外の参照先は null(順序の対象は public の表)。 */
function publicTable(reference: string): string | null {
  if (reference.startsWith('public.')) return reference.slice('public.'.length);
  return reference.includes('.') ? null : reference;
}
