/**
 * ガード変数の軸の**値の置き方**(束 ⑳-5a)。
 *
 * 軸の値 1 つが運ぶのは単独の値ではなく、**置き直す値の並び**である。理由は 2 つある。
 *
 * - **日時は行ぜんたいで置き直す。** 「締切の前 / 後」に 1 列だけ動かすと、宣言された欄どうしの
 *   順序(`{集約}.{a} < {集約}.{b}` の行内比較)が落ちて行そのものが DB に入らない。順序の正は
 *   invariant_spec であり、ここはその写像(`fieldOrder`)を使うだけである。
 * - **`claim` の含意を緩める。** 「その欄が真なら、別の欄はこうでなければならない」という
 *   行内比較がある欄を、軸が違う値にしようとしたら、前提の側(`claim` の欄)を偽にする ——
 *   役が立たなくなるのは正しい(立てない状態にその人を置いているのだから)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, SpecModel } from '../model/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { ScenarioContext, ScenarioVariableRef } from '../usecase/plan-scenario-rows.js';
import type { ScenarioValue } from '../usecase/plan-scenario-values.js';
import { candidatesOf, seedsOf } from '../usecase/plan-scenario-values.js';
import { claimImplications, fieldOrder } from './rls-world-values.js';
import { rlsWorldRoles } from './rls-world-roles.js';
import type { EqAxis, EqPlacement } from './eq-cases.js';

/** 過去の錨(実行時刻より前)。 */
const PAST_ANCHOR = Date.UTC(2020, 0, 1);

/** 未来の錨(実行時刻より後)。 */
const FUTURE_ANCHOR = Date.UTC(2099, 0, 1);

/** 日時の 1 刻み(1 日)。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ガード変数の軸を組むのに要るもの(単発の操作と保存点が共有する)。
 *
 * 単発の操作は `ScenarioContext` から、保存点は実行計画の手順の和から組む —— 軸の作り方は
 * どちらも同じなので、写しを 2 つ持たない(片方だけが日時の置き直しを忘れる形を塞ぐ)。
 */
export interface GuardAxesInput {
  readonly domain: SpecModel;
  readonly variables: readonly ScenarioVariableRef[];
  /** 状態の軸が受け持つ変数の参照(`{集約}.{欄}`。ここは飛ばす)。 */
  readonly excluded: readonly string[];
  /** 作成が「行ではなく入力を見る」集約(無ければ null)。 */
  readonly inputEntity: string | null;
  /** ガード式に現れた数値リテラルの種。 */
  readonly seeds: readonly number[];
}

/**
 * ガード変数の軸(対象の状態の列は状態の軸が受け持つので除く)。
 *
 * @param input 変数の並びと、置き方を決める文脈
 * @returns 変数 1 本ごとの軸(宣言順)
 */
export function guardAxes(input: GuardAxesInput): readonly EqAxis[] {
  const axes: EqAxis[] = [];
  for (const variable of input.variables) {
    if (input.excluded.includes(variable.ref)) continue;
    const [entity, column] = variable.ref.split('.');
    if (entity === undefined || column === undefined) continue;
    const into: EqPlacement['into'] = entity === input.inputEntity ? 'input' : 'row';
    // 参照・uuid の列は、行には軸の候補を置かない。候補の記号('a' / 'b')は uuid の列に入らず、
    // 行の参照の先は world の木(`refs`)が決めている —— 「実行者と同じ会社の行」「別の会社の行」は
    // 実行者の系統とその的の組み合わせで既に作り分けられる(実行者の属性と結ぶ境界の `when` が、既存の行の列や
    // 親の行の列を読むとき)。置こうとすると置き直しの `update` が型で落ちて、証明が全部赤になる。
    if (into === 'row' && isIdentityType(variable.type)) continue;
    const candidates = candidatesOf(variable.type, variable.states, input.seeds, variable.bounds);
    if (candidates.length === 0) continue;
    const timed = variable.type?.kind === 'datetime' || variable.type?.kind === 'date';
    axes.push({
      key: variable.key,
      values: candidates.map((value) => {
        const placements = [
          ...(timed
            ? timedPlacements(input.domain, entity, column, value, into)
            : [{ entity, column, value, into }]),
          ...implicationRelief(input.domain, entity, column, value, into),
        ];
        return { label: labelOf(placements, entity, column, value), placements };
      }),
    });
  }
  return axes;
}

/** 行を指す型(参照・uuid)か。値は記号ではなく、実在する行の id でなければならない。 */
function isIdentityType(type: FieldDef['type'] | null): boolean {
  return type?.kind === 'ref' || type?.kind === 'uuid';
}

/** ガード変数の軸(単発の操作の場面から組む)。 */
export function guardAxesOf(ctx: ScenarioContext, parsed: Parameters<typeof seedsOf>[0]): readonly EqAxis[] {
  return guardAxes({
    domain: ctx.domain,
    variables: ctx.variables,
    excluded: ctx.stateVariable === null ? [] : [ctx.stateVariable.ref],
    inputEntity: ctx.kind === 'create' ? ctx.entity : null,
    seeds: seedsOf(parsed),
  });
}

/**
 * 軸の値 1 つの字面(**実際にその欄へ置く値**)。
 *
 * 候補の値をそのまま使ってはならない —— 日時は行ぜんたいを錨から置き直すので、候補
 * (「実行時刻の前」を表す目印の日時)と実際に入る値は違う。食い違いの報告はこの字面を
 * そのまま出すので、ずれていると「2026 を置いた」と読める行が実際は 2020 になる
 * (独立レビュー 9-b)。
 *
 * @param placements その値にするために置き直すもの
 * @param entity 軸の変数が載る集約
 * @param column 軸の変数が載る列
 * @param fallback 置き直しにその列が現れないときの値(候補そのもの)
 * @returns 実際に置く値の字面
 */
function labelOf(
  placements: readonly EqPlacement[],
  entity: string,
  column: string,
  fallback: ScenarioValue,
): string {
  const placed = placements.find((p) => p.entity === entity && p.column === column);
  return String(placed?.value ?? fallback);
}

/**
 * 含意を緩める置き直し(`claim` の欄を偽にする)。
 *
 * 行内比較の不変条件はしばしば「その欄が真なら、別の欄はこうでなければならない」という形を
 * している(`{欄} == false or {別の欄} == {値}`)。world はその含意を**満たす側**に置いている
 * (`claim` の役の人の行)が、軸がその「別の欄」を違う値にしようとすると行が CHECK に当たる。
 *
 * そこで前提の側を外す —— その欄を偽にすれば含意は成り立つ。**役が立たなくなるのは正しい**
 * (立てない状態にその人を置いているのだから)。期待の側も同じ行を読むので、engine は役が
 * 立たないものとして判定する。
 *
 * @returns 一緒に置き直す値(無ければ空)
 */
function implicationRelief(
  domain: SpecModel,
  entity: string,
  column: string,
  value: ScenarioValue,
  into: 'row' | 'input',
): readonly EqPlacement[] {
  const placements: EqPlacement[] = [];
  for (const role of rlsWorldRoles(domain)) {
    const field = role.claimField;
    if (field === null) continue;
    const implied = claimImplications(domain, entity, field);
    const required = implied[column];
    if (required === undefined || required === value) continue;
    placements.push({ entity, column: field, value: false, into });
  }
  return placements;
}

/**
 * その集約の日時・日付の欄を、宣言された順序を保ったまま置き直す。
 *
 * 望まれた欄はその側(過去 / 未来)の錨から、ほかの欄は直前の欄の次の刻みから置く。
 * 順序の宣言(`fieldOrder`)が読めない集約では望まれた欄だけを置く —— 順序の条件が無いことは
 * 宣言から言えないので、行が入らなければ実行する側が報告する。
 */
function timedPlacements(
  domain: SpecModel,
  entity: string,
  column: string,
  wanted: ScenarioValue,
  into: 'row' | 'input',
): readonly EqPlacement[] {
  const order = fieldOrder(domain, entity);
  const fields = (findEntitySpec(domain, entity)?.fields ?? []).filter(isTimed);
  if (order === null || fields.length === 0) return [{ entity, column, value: wanted, into }];
  const sorted = [...fields].sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
  const placements: EqPlacement[] = [];
  let cursor = PAST_ANCHOR - DAY_MS;
  for (const field of sorted) {
    const anchor = field.name === column ? sideAnchor(wanted) : cursor + DAY_MS;
    cursor = Math.max(cursor + DAY_MS, anchor);
    placements.push({ entity, column: field.name, value: textOf(field, cursor), into });
  }
  return placements;
}

/** その欄が日時・日付か。 */
function isTimed(field: FieldDef): boolean {
  return field.type.kind === 'datetime' || field.type.kind === 'date';
}

/** 望まれた側の錨(候補の値が実行時刻より前なら過去の錨)。 */
function sideAnchor(value: ScenarioValue): number {
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return PAST_ANCHOR;
  return parsed < Date.now() ? PAST_ANCHOR : FUTURE_ANCHOR;
}

/** 刻みを欄の型に合う字面にする。 */
function textOf(field: FieldDef, at: number): string {
  const iso = new Date(at).toISOString();
  return field.type.kind === 'date' ? iso.slice(0, 10) : iso;
}
