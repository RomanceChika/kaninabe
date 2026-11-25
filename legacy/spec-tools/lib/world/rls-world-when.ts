/**
 * `reads[].when` の**反例の行**(見えてはならない行)を宣言から決める写像(束 §14)。
 *
 * ## なぜ行を 1 つ足すのか
 *
 * world の行は状態の列に値を置かないので、どの系統の的も**初期状態**の行である。可視性に状態の
 * 条件を書いても、その条件が初期状態を通すものなら(「保管でなければ見える」)**world の中に
 * 見えない行が 1 つも無い** —— 条件を丸ごと落としたポリシーでも挙動テストが緑になる。
 * `filters` に「別のテナントの実行者」をもう 1 人足したのと同じ理由で、ここでは
 * **その条件を偽にする状態の行**を足す。
 *
 * ## どう決めるか(読む深さは `rls-world-empty.ts` と同じ)
 *
 * 1. `when` に現れる**自集約の状態の欄**を探す(無ければ決められない)。
 * 2. その機械の状態を宣言順に試し、`when` が**偽になる**最初の状態を採る。
 *    真理値は `truthUnder` —— 状態の欄だけを確定値とし、それ以外は `unknown` に倒す写像である。
 *    `unknown` は採らない(偽だと言い切れないものを「見えない行」として置くと、期待が嘘になる)。
 * 3. その状態のもとで不変条件が要求する欄の埋め方(`fieldPresenceOf`)を連れてくる ——
 *    状態を変えたぶん、一緒に埋めなければ執行点が拒否する欄があるからである。
 *
 * **決められなければ「world を作れない」と報告する**(T8 が warning にする)。黙って反例の行を
 * 置かないと、条件が執行されていない表の挙動テストが緑のまま並ぶ —— それは免除リストを
 * 検査器の中に隠すのと同じことである。
 *
 * **ここへ来る前に V2 が閉じている。** 「自集約の状態の欄を比べていない条件」(時刻の比較・
 * enum や親の欄だけの条件)は仕様の段で error になるので(`v2-access-reads.ts` の
 * `checkReadWhenShape`)、この写像が「決められない」を返すのは**どの状態でも偽にならない条件**
 * (恒真)か、生成だけを回した場合の二重の備えである。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { parseGuard } from '../guard/parser.js';
import type { AccessSpec, SpecModel } from '../model/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { FieldPresence } from './rls-world-empty.js';
import { fieldPresenceOf, initialStatesOf, stateFieldsOf, truthUnder } from './rls-world-empty.js';
import type { RlsWorldRow } from './rls-world-rows.js';
import type { RlsValue } from './rls-world-values.js';
import { valueOfField } from './rls-world-values.js';

/** 反例の行 1 つ(その状態を置けば、その読み取り規則は通らない)。 */
export interface WhenCounterexample {
  /** world の中で行を分ける名前に使う印(状態の欄と状態から機械的に決まる)。 */
  readonly slot: string;
  /** 置く状態(状態の欄 → 状態)。 */
  readonly states: Readonly<Record<string, string>>;
  /** その状態で不変条件が要求する欄の埋め方。 */
  readonly presence: FieldPresence;
  /** その状態で通らなくなる読み取り規則のロール(報告のため。宣言順)。 */
  readonly blocks: readonly string[];
}

/** 反例の行を決めた結果(決められなければ理由を報告する)。 */
export type WhenCounterexampleResult =
  | { readonly ok: true; readonly rows: readonly WhenCounterexample[] }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * その集約の `reads[].when` すべてについて、反例の行を決める。
 *
 * 同じ状態の割り当てに落ちる `when` は 1 行に畳む —— 同じ行を 2 つ置いても、確かめられるのは
 * 同じことである。
 *
 * @param domain ドメイン仕様
 * @param access その集約のアクセス宣言
 * @returns 置く行(`when` が 1 つも無ければ空)、または決められない理由
 */
export function whenCounterexamples(
  domain: SpecModel,
  access: AccessSpec,
): WhenCounterexampleResult {
  const rules = access.reads.filter((rule) => rule.when !== undefined);
  if (rules.length === 0) return { ok: true, rows: [] };
  const initial = initialStatesOf(domain, access.entity);
  const stateFields = stateFieldsOf(domain, access.entity);
  const rows = new Map<string, { states: Map<string, string>; blocks: string[] }>();
  const reasons: string[] = [];
  for (const rule of rules) {
    const when = rule.when ?? '';
    const found = falsifyingState(when, access.entity, initial, stateFields);
    if (found === null) {
      reasons.push(`by: ${rule.by} の when "${when}"`);
      continue;
    }
    const slot = `${found.field}-${found.state}`;
    const entry = rows.get(slot) ?? { states: new Map(initial), blocks: [] };
    entry.states.set(found.field, found.state);
    entry.blocks.push(rule.by);
    rows.set(slot, entry);
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    rows: [...rows.entries()].map(([slot, entry]) => ({
      slot,
      states: Object.fromEntries(entry.states),
      presence: fieldPresenceOf(domain, access.entity, entry.states),
      blocks: entry.blocks,
    })),
  };
}

/** その条件を偽にする状態(状態の欄と状態)。見つからなければ `null`。 */
function falsifyingState(
  when: string,
  entity: string,
  initial: ReadonlyMap<string, string>,
  stateFields: readonly { readonly field: string; readonly states: readonly string[] }[],
): { readonly field: string; readonly state: string } | null {
  const parsed = parseGuard(when);
  if (!parsed.ok) return null;
  for (const stateField of stateFields) {
    for (const state of stateField.states) {
      const assignment = new Map(initial);
      assignment.set(stateField.field, state);
      if (truthUnder(parsed.expr, entity, assignment) === false) {
        return { field: stateField.field, state };
      }
    }
  }
  return null;
}

/** 反例の行を組み立てるのに要るもの。 */
export interface WhenRowInput {
  readonly domain: SpecModel;
  /** 対象の集約。 */
  readonly entity: string;
  /** world 全体で一意な連番を 1 つ取る。 */
  readonly next: () => number;
  /** 欄名 → 日時・数値の順位(`fieldOrder` の結果)。 */
  readonly order: ReadonlyMap<string, number>;
}

/** 反例の行の組み立ての結果(置けない欄があれば報告する)。 */
export type WhenRowResult =
  | { readonly ok: true; readonly row: RlsWorldRow }
  | { readonly ok: false; readonly unplaceable: readonly string[] };

/**
 * 的の行から**反例の行**を作る(状態だけを差し替えた同じ系統の行)。
 *
 * 参照も境界の列も**的の行から写す** —— 系統が違えば見え方も違ってしまうので、反例の行は
 * 「同じ人の、同じ部署の、状態だけが違う行」でなければならない。
 *
 * @param target その系統の的の行(境界の列を差し込んだあとのもの)
 * @param row 反例の宣言(状態と、その状態で要る欄の埋め方)
 * @param input 対象の集約・連番・欄の順位
 * @returns 反例の行、または置けない欄の名前
 */
export function whenRowOf(
  target: RlsWorldRow,
  row: WhenCounterexample,
  input: WhenRowInput,
): WhenRowResult {
  const spec = findEntitySpec(input.domain, input.entity);
  if (spec === null) return { ok: false, unplaceable: [input.entity] };
  const values: Record<string, RlsValue> = { ...target.values, ...row.states };
  const refs: Record<string, string> = { ...target.refs };
  const unplaceable: string[] = [];
  for (const name of row.presence.filled) {
    const field = spec.fields.find((candidate) => candidate.name === name);
    if (field === undefined) {
      unplaceable.push(name);
      continue;
    }
    if (field.type.kind === 'ref') {
      const referenced = target.ancestry[field.type.entity];
      if (referenced === undefined) unplaceable.push(name);
      else refs[name] = referenced;
      continue;
    }
    values[name] = valueOfField(field, { rowIndex: input.next(), next: input.next, order: input.order });
  }
  for (const name of row.presence.empty) {
    delete values[name];
    delete refs[name];
  }
  if (unplaceable.length > 0) return { ok: false, unplaceable };
  const key = `${target.key}#when-${row.slot}`;
  return {
    ok: true,
    row: {
      key,
      table: target.table,
      entity: target.entity,
      values,
      refs,
      // 反例の行は実行者自身の行ではない(状態を差し替えた別の行である)。
      actor: null,
      ancestry: { ...target.ancestry, [target.entity]: key },
    },
  };
}
