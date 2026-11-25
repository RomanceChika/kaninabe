/**
 * **ガード式が参照する親集約**の引き当て(行ロックの対象を決める 1 か所)。
 *
 * ガードが他の集約の欄を読む経路は 2 本ある。
 *
 * | 経路 | 出どころ | 本文での形 |
 * |---|---|---|
 * | 楽観的並行制御の条件(`p_expected_{集約}_{列}`) | `rpc-parts.ts` の `buildGuardRows` | `from` / `using` に join した行 |
 * | **ガード式そのもの**(`{集約}.{欄}`) | ここ | スカラー副問い合わせ(`rpc-reach.ts` の `externalSql`) |
 *
 * どちらも「子がコミットする時点で成り立っていてほしい事実」を親の行から読むので、
 * **両方とも書き込みの前に共有ロックで掴む**(TLA+ の `Occ` が S9 の反例を出した時間帯)。
 * 期待状態の引数を持たない遷移(ガードが親の状態をスカラー副問い合わせでだけ読む形)は
 * 2 本目の経路にしか現れないため、1 本目だけを掴んでも競合の時間帯は閉じない。
 *
 * 掴む先は**読む先と同じ鎖**(`idExpression`)から作る —— ずれたら、掴んでいない行の状態で
 * ガードを判定することになる。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { parseGuard } from '../guard/parser.js';
import { forEachAtom } from '../guard/atoms.js';
import { findAccessSpec } from '../semantics/domain-lookup.js';
import { entityOf } from '../usecase/param-source-facts.js';
import { refPathTo } from '../model/ref-path.js';
import { machineOf } from './rpc-transition-columns.js';
import type { RpcFactsInput } from './rpc-facts.js';
import type { RpcBodyProblem } from './rpc-params.js';
import type { ReachInput } from './rpc-reach.js';
import { idExpression } from './rpc-reach.js';

/** 実行者を指す予約語のルート(`rpc-reach.ts` と同じ字面)。 */
const ACTOR_ROOT = 'actor';

/** 行ロックで掴む 1 集約(スキーマ修飾した表名と、その行の id を与える式)。 */
export interface GuardLockRow {
  readonly table: string;
  readonly id: string;
}

/** 引き当ての結果(写せないパスがあれば理由つきで返す。生成器は throw しない)。 */
export type GuardLockResult =
  | { readonly ok: true; readonly rows: readonly GuardLockRow[] }
  | { readonly ok: false; readonly problems: readonly RpcBodyProblem[] };

/**
 * ガード式が読む親集約の行を、掴める形(表 + id の式)にして返す。
 *
 * **鎖の終点だけでなく、途中の集約も全部掴む** —— 終点の id は途中の行の参照列を読んで
 * 求めるので(`program_item → entry → workshop` なら `entry.workshop_id`)、途中が動けば
 * 掴んだ行と読んだ行がずれる。掴む順は呼ぶ側(`rpc-body-lock.ts`)が表名の昇順に固定する。
 *
 * @param input 関数の宣言・表・ドメイン仕様
 * @param entity 自集約
 * @param reach 参照の鎖を辿る文脈(ガードの翻訳に渡すものと同じ)
 * @returns 掴む行の並び(集約ごとに 1 本。重複は畳む)、または理由つきの失敗
 */
export function guardLockRows(input: RpcFactsInput, entity: string, reach: ReachInput): GuardLockResult {
  const rows: GuardLockRow[] = [];
  const problems: RpcBodyProblem[] = [];
  const seen = new Set<string>();
  const found = referencedEntities(input, entity, reach);
  problems.push(...found.problems);
  for (const target of found.entities) {
    if (seen.has(target)) continue;
    seen.add(target);
    const table = input.tableOf(target);
    const id = idExpression(target, reach);
    if (table === null || id === null) {
      problems.push(unreachable(input, entity, target, table === null));
      continue;
    }
    rows.push({ table: `public.${table}`, id });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, rows };
}

/** 条件式が読めない Finding(ガードの翻訳も同じ式で落ちるので、生成はここで止まる)。 */
function unparsable(input: RpcFactsInput, entity: string, source: string): RpcBodyProblem {
  return {
    message: `${input.name} の条件式を読めないので、その式が読む行を掴めません(${source})`,
    suggestion:
      '条件式の文法を domain-spec-writing.md §ガード式の文法 に合わせる' +
      '(同じ式はガードの翻訳でも落ちるが、掴む相手を黙って落とさないためにここでも報告する)',
    counterexample: { function: input.name, entity, guard: source },
  };
}

/** 掴めない相手の Finding(ガード式が読めているのに掴めない = 検査の穴)。 */
function unreachable(
  input: RpcFactsInput,
  entity: string,
  target: string,
  missingTable: boolean,
): RpcBodyProblem {
  return {
    message: `${input.name} のガードが読む ${target} の行を掴めません(${missingTable ? 'data_table が無い' : '参照が辿れない'})`,
    suggestion: missingTable
      ? `${target} の data_table を書く(掴む相手の表名は宣言からしか引けない)`
      : `${entity} から ${target} へ届く ref(...) の列を entity_spec の context に宣言する` +
        '(読めるのに掴めない条件は、交錯したときコミット時に成り立たない)',
    counterexample: { function: input.name, from: entity, to: target },
  };
}

/**
 * ガード式に現れる他集約と、**そこへ届く鎖の途中の集約**(出現順。自集約と実行者は含まない)。
 *
 * **読めない式は黙って落とさない。** 同じ式はガードの翻訳(`guardToSql`)でも落ちるので
 * 生成はどのみち止まるが、「掴む相手が 1 つ減った」ことを報告しないと、止まった理由が
 * 「翻訳できない」だけになり、**掴みが欠けていたこと**が読めない(独立レビュー 2 回目 F5')。
 */
function referencedEntities(
  input: RpcFactsInput,
  entity: string,
  reach: ReachInput,
): { readonly entities: readonly string[]; readonly problems: readonly RpcBodyProblem[] } {
  const entities: string[] = [];
  const problems: RpcBodyProblem[] = [];
  const add = (key: string): void => {
    const resolved = referencedEntity(key, input, entity);
    if (resolved === null) return;
    // 鎖の途中の行も掴む(届かなければ終点だけ積み、`guardLockRows` が理由を報告する)。
    const path = refPathTo(input.domain, entity, resolved, (field) => reach.ownRefs.has(field.name));
    entities.push(...(path ?? [resolved]));
  };
  for (const source of guardSources(input, entity)) {
    const parsed = parseGuard(source);
    if (!parsed.ok) {
      problems.push(unparsable(input, entity, source));
      continue;
    }
    forEachAtom(parsed.expr, (atom) => {
      add(atom.varKey);
      if (atom.kind === 'compare' && atom.rhsVar !== null) add(atom.rhsVar);
    });
  }
  return { entities, problems };
}

/**
 * パスの正規化キー(`{頭}.{欄}`)が指す他集約。
 *
 * 1 語のキー(自集約の欄・予約語 `now`)・実行者のキー(`actor.{欄}`)・自集約のキーは
 * 親集約ではないので落とす —— 前 2 つは親の行を持たず、自集約の行は書き込みの 1 文が掴む。
 */
function referencedEntity(key: string, input: RpcFactsInput, entity: string): string | null {
  const segments = key.split('.');
  if (segments.length !== 2) return null;
  const head = segments[0] ?? '';
  if (head === ACTOR_ROOT) return null;
  const resolved = entityOf(input.domain, head);
  return resolved === null || resolved === entity ? null : resolved;
}

/**
 * この RPC の本文に入るガード式の全部。
 *
 * **どの規則のガードが入るかの正は `rpc-authz-build.ts` の `byShape`** であり、ここはその
 * 写しである(形ごとの分岐が同じものを選ぶ)。編集は `writes` の全規則を見る ——
 * `writeColumns` は `writes` に現れる列の和なので、どの規則も必ず 1 列は覆う。
 */
function guardSources(input: RpcFactsInput, entity: string): readonly string[] {
  const access = findAccessSpec(input.domain, entity);
  switch (input.shape) {
    case 'create':
      return whenOf(access?.creates ?? []);
    case 'delete':
      return whenOf(access?.deletes ?? []);
    case 'update':
      return whenOf(access?.writes ?? []);
    default:
      return (machineOf(input, entity)?.events ?? []).flatMap((event) =>
        event.guard === undefined ? [] : [event.guard],
      );
  }
}

/** 規則の並びから条件式だけを取り出す。 */
function whenOf(rules: readonly { readonly when?: string | undefined }[]): readonly string[] {
  return rules.flatMap((rule) => (rule.when === undefined ? [] : [rule.when]));
}
