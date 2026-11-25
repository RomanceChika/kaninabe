/**
 * 導出の宣言のうち**親の下の末尾の番号**の形(`derives.{列}: { append_within: {親を指す列}, mode: initial | insert_at }`。点検 24 回目 B24-1・fix25s)が
 * 本文を生成できる形かの判定。両方の形に共通の判定(供給元・型・重複)と幅の形は `derive-problems.ts` が持ち、ここはその呼ぶ先の 1 つである。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, SpecModel } from '../model/types.js';
import { findAccessSpec } from '../semantics/domain-lookup.js';
import type { AppendDerivation, DataTableSpec, DataTriggerDecl } from '../model/data/types.js';
import { APPEND_MODES } from '../model/data/types.js';
import type { DerivationProblem } from './derive-problems.js';

/** 問題 1 件を組み立てる。 */
function problem(path: string, reason: string, suggestion: string, example: Readonly<Record<string, string>>): DerivationProblem {
  return { path, reason, suggestion, example };
}

/**
 * 親を指す外部キーの参照先の表名(スキーマ修飾を落とす)。
 *
 * @param references 外部キーの参照先
 * @returns 表名
 */
export function bareParent(references: string): string {
  return references.startsWith('public.') ? references.slice('public.'.length) : references;
}

/**
 * 末尾の番号の形の問題の全部: 方式は `initial` か `insert_at`(fix25s)・数える範囲は親を直の外部キーで指す自表の列・その親を
 * `locks` で排他に掴む・範囲の列を別のトリガが埋めるならそのトリガが先に発火する(BEFORE トリガは名前の順)・
 * 列の範囲(上端 `max` があり、下端 `min` は 1 以下。点検 25 回目 B25-1)・(範囲, 番号)の部分でない一意の索引がある(点検 25 回目 A25-2)。
 *
 * @param derivation 末尾の番号の導出
 * @param fields 自表の欄(名前 → 宣言)
 * @param trigger そのトリガの宣言
 * @param table テーブル仕様
 * @param domain ドメイン仕様(access_spec の `writes` を引く)
 * @returns 通らない理由(宣言順)
 */
export function appendProblems(
  derivation: AppendDerivation,
  fields: ReadonlyMap<string, FieldDef>,
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  domain: SpecModel,
): readonly DerivationProblem[] {
  const { column, within, mode } = derivation;
  const base = `derives.${column}`;
  const found: DerivationProblem[] = [...rangeProblems(derivation, fields.get(column), table, domain)];
  if (!(APPEND_MODES as readonly string[]).includes(mode)) {
    found.push(
      problem(
        `${base}.mode`,
        `${column} は末尾の番号ですが、方式(mode)が "${mode}" です`,
        'mode: initial(空のときだけ末尾に振る)か insert_at(入れてきた値を位置と読んで後ろをずらして差し込み、空なら末尾)にする(番号は作るときに 1 度だけ決める。後の並べ替えは編集の口が持つ)',
        { column, mode },
      ),
    );
  }
  const key = within === column || !fields.has(within) ? undefined : table.foreignKeys.find((candidate) => candidate.column === within);
  if (key === undefined) {
    found.push(
      problem(
        `${base}.append_within`,
        `${column} の数える範囲(append_within)${within} が、親を直の外部キーで指す自表の欄ではありません`,
        'append_within には、この表の foreign_keys に宣言した列(親を指す欄)を書く。番号は親の行を排他で掴んでから数える',
        { column, within },
      ),
    );
    return found;
  }
  if (!table.indexes.some((index) => index.unique && index.where === undefined && index.on.length === 2 && index.on.includes(within) && index.on.includes(column))) {
    // 番号の一意は、並べ替えの口(人が書く)も隔離の水準の拒否を通らない経路も含めて、DB が最後に守る線(点検 25 回目 A25-2)。
    found.push(
      problem(
        'indexes',
        `${column} は ${within} の下の末尾の番号ですが、(${within}, ${column}) の一意の索引が宣言されていません(並べ替えの口や隔離の水準の外の経路で番号が黙って重なります)`,
        `indexes に { on: [${within}, ${column}], unique: true } を書く(部分の索引(where)にしない。由来の不変条件があれば invariant に名指す)`,
        { column, within },
      ),
    );
  }
  const parent = bareParent(key.references);
  if (trigger.locks?.[parent] !== 'update') {
    found.push(
      problem(
        'locks',
        `${column} は ${parent} の下の末尾の番号ですが、トリガが ${parent} を排他で掴むと宣言していません(同じ親への同時の作成が同じ番号を数えます)`,
        `locks: { ${parent}: update } を書く(本文は数える前にその行を掴み、書き込む RPC はそれを表名の順の先掴みに入れる)`,
        { column, within, parent },
      ),
    );
  }
  const supplier = table.triggers.find((candidate) => candidate.name !== trigger.name && candidate.supplies.includes(within));
  if (supplier !== undefined && !(supplier.name < trigger.name)) {
    found.push(
      problem(
        'name',
        `${column} の数える範囲 ${within} はトリガ ${supplier.name} が埋めますが、${trigger.name} の方が名前の順で先に発火します(埋まる前の空の範囲で数えます)`,
        `トリガの名前を ${supplier.name} より後に並ぶものにする(BEFORE トリガは名前のバイト順に発火する)`,
        { column, within, supplier: supplier.name },
      ),
    );
  }
  return found;
}

/**
 * 末尾の番号の列の範囲(点検 25 回目 B25-1)。本文は `max + 1` を振り、上端を越えたら閉じた語 `append_full` で断る —— その上端は
 * entity_spec の `max` で、無ければ断る語を出せない(型の上限で 22003 の想定外の失敗になる)。並べ替えの口(access_spec の `writes`)に
 * 載る列は、人が最後の番号を上端にできるので件数より早く上端に届く(そのときの断りが `append_full`)。番号は 1 から始まるので、
 * 下端が 1 より大きい列には最初の 1 本が入らない。
 */
function rangeProblems(derivation: AppendDerivation, target: FieldDef | undefined, table: DataTableSpec, domain: SpecModel): readonly DerivationProblem[] {
  if (target === undefined) return [];
  const { column } = derivation;
  const base = `derives.${column}`;
  const writable = table.entity !== undefined && (findAccessSpec(domain, table.entity)?.writes ?? []).some((rule) => rule.fields.includes(column));
  const found: DerivationProblem[] = [];
  if (target.max === undefined) {
    found.push(
      problem(
        base,
        `${column} は末尾の番号ですが、範囲の上端(max)が宣言されていません(上端を越えた作成を append_full で断れず、型の上限で想定外の失敗になります` +
          (writable ? '。access_spec の writes で人が書き換えられる列なので、件数より早く上端に届きます)' : ')'),
        `${column} の entity_spec に max を書く(上端に届いた親への作成は append_full で断られ、画面は並び順の見直しを案内する)`,
        { column, writable: String(writable) },
      ),
    );
  }
  if (target.min !== undefined && target.min > 1) {
    found.push(
      problem(
        base,
        `${column} は末尾の番号ですが、範囲の下端(min)${target.min} が 1 より大きいです(番号は 1 から振るので、最初の 1 本が範囲の CHECK に当たります)`,
        `${column} の min を 1 以下にする`,
        { column, min: String(target.min) },
      ),
    );
  }
  return found;
}
