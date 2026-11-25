/**
 * ハンドブックの「決めごと」の節の事実 — 不変条件を、ふれる欄・執行点・**決めごとの種類**つきの値にする。
 *
 * 設計メモ `docs/design/book-as-spec/plan-generator.md` §3(大事な種類は既存の軸から導く)。試作は種類の一部を
 * 業務の語(料金・円 …)で拾っていた。ここは**仕様の構造だけ**で決め、語は 1 つも見ない:
 *
 * | 種類 | 当たる条件 |
 * |---|---|
 * | 計算・確定(`settle-compute`) | 執行点の遷移が `settles` を持つ状態へ入る / ふれる欄が action_spec の `computes` の書き先 / 執行点の `application` が `computes` の関数 |
 * | 終点へ入る(`into-final`) | 執行点の遷移が終点(`final`)へ入る |
 * | 非表示・写し先(`hidden-snapshot`) | ふれる欄が `fields_hidden` に載る / ふれる集約が状態の仕様の `snapshot` の写し先 |
 *
 * 1 つの不変条件が複数の種類に当たってよい(並びは上の表の順)。どれにも当たらない大事な条件を取りこぼしうる
 * (外部レビュー の問い 1)ので、また当たっても意味の証明ではない(11/52 や 0 件は不在の証明でもない)ので、種類は「全体像に上げる候補」であって、ほかの不変条件を隠す理由にはしない。
 * ふれる欄は形式定義(`formal`)の式と鍵から集め、裸の欄は自分の集約のエンティティの欄として読む。形式定義も遷移の執行点も無い
 * 文だけの決めごと(例: 別の集約の件数を数え、手書きの trigger と application で守るもの)は、構造からは種類を決められない。
 *
 * 並びは仕様の宣言順。純粋関数だけ。**アプリの語彙は 1 語も持たない。**
 */

import { collectPaths } from '../../guard/services.js';
import { parseGuard } from '../../guard/parser.js';
import type { SourceLocation } from '../../kernel/source-location.js';
import type { ActionSpec } from '../../model/trace/types.js';
import type { InvariantDef, InvariantFormal } from '../../model/types-invariant.js';
import type { SpecModel } from '../../model/types.js';

/** 決めごとの種類(印の色と同じ区分。表示の語は words の側が持つ)。 */
/**
 * 種類の名前は**構造の名前**にする(外部レビュー の P3: 「お金」「見える範囲」と言い切ると、名前の正規化や件数の計算も
 * 同じ構造なら当たってしまう)。`settle-compute` = 計算・確定に関係 / `into-final` = 終点へ入る遷移に関係 /
 * `hidden-snapshot` = 非表示の欄・写し先に関係。業務の意味(お金・取り消せない・見える範囲)は表示側でも言い切らない。
 */
export type InvariantCategory = 'settle-compute' | 'into-final' | 'hidden-snapshot';

/** 不変条件 1 つの事実。 */
export interface InvariantFact {
  readonly id: string;
  readonly aggregate: string;
  /** 人が書いた文(`statement`)。 */
  readonly statement: string;
  /** 形式定義の種類(無ければ無い = 文だけの決めごと)。 */
  readonly formal?: InvariantFormal['kind'];
  /** ふれる欄(`{エンティティ}.{欄}`。出現順・重複なし)。 */
  readonly fields: readonly string[];
  /** 執行点(宣言順)。 */
  readonly enforcedBy: readonly { readonly kind: string; readonly ref: string }[];
  readonly categories: readonly InvariantCategory[];
  readonly source: SourceLocation;
}

/** action_spec の `computes` の書き先(`{エンティティ}.{欄}`)と、値を決める関数の名前。 */
export interface ComputeIndex {
  readonly fields: ReadonlySet<string>;
  readonly refs: ReadonlySet<string>;
}

/** action_spec の `computes` から索引を作る(action_spec を採っていなければ空の配列を渡す)。 */
export function computeIndexOf(actions: readonly ActionSpec[]): ComputeIndex {
  const computes = actions.flatMap((action) => action.computes);
  return {
    fields: new Set(computes.map((compute) => `${compute.entity}.${compute.field}`)),
    refs: new Set(computes.map((compute) => compute.ref)),
  };
}

const NO_COMPUTES: ComputeIndex = { fields: new Set(), refs: new Set() };

function pathsOf(source: string | undefined): string[][] {
  if (source === undefined) return [];
  const parsed = parseGuard(source);
  return parsed.ok ? collectPaths(parsed.expr).map((path) => [...path.segments]) : [];
}

/** 形式定義がふれる欄。裸の欄は自分のエンティティの欄。`now` と `actor.*` は欄ではない。 */
function fieldsOf(formal: InvariantFormal | undefined, own: string): readonly string[] {
  if (formal === undefined) return [];
  const exprs: (string | undefined)[] = [];
  const bare: string[] = [];
  switch (formal.kind) {
    case 'check':
      exprs.push(formal.expr);
      break;
    case 'uniqueness':
      bare.push(...formal.keys);
      exprs.push(formal.where);
      break;
    case 'exclusion':
      bare.push(...formal.keys, ...formal.range);
      exprs.push(formal.where);
      break;
    case 'cardinality':
      bare.push(...formal.keys);
      exprs.push(formal.where, typeof formal.max === 'string' ? formal.max : undefined);
      break;
    case 'state_dependency':
      exprs.push(formal.if, formal.then);
      break;
  }
  const found = new Set<string>();
  for (const segments of [...bare.map((key) => key.split('.')), ...exprs.flatMap(pathsOf)]) {
    const [first, second] = segments;
    if (first === undefined || first === 'now' || first === 'actor') continue;
    found.add(second === undefined ? `${own}.${first}` : `${first}.${second}`);
  }
  return [...found];
}

/** 製品全体の、種類の判定に使う構造の索引。 */
interface CategoryIndex {
  /** 遷移のキー → 入る状態が settles を持つか・終点か。 */
  readonly events: ReadonlyMap<string, { readonly settles: boolean; readonly final: boolean }>;
  readonly hidden: ReadonlySet<string>;
  readonly snapshotTargets: ReadonlySet<string>;
  readonly computes: ComputeIndex;
}

function indexOf(model: SpecModel, computes: ComputeIndex): CategoryIndex {
  const events = new Map<string, { settles: boolean; final: boolean }>();
  const hidden = new Set<string>();
  const snapshotTargets = new Set<string>();
  for (const specs of model.aggregates.values()) {
    const entity = specs.entity?.entity ?? specs.name;
    for (const rule of specs.access?.fieldsHidden ?? []) hidden.add(`${entity}.${rule.field}`);
    for (const machine of specs.stateMachines) {
      for (const event of machine.events) {
        events.set(`${machine.machine}.${event.id}`, {
          settles: (machine.stateSettles[event.to] ?? []).length > 0,
          final: machine.final.includes(event.to),
        });
      }
      for (const effect of machine.effects) if (effect.snapshot !== undefined) snapshotTargets.add(effect.snapshot.to);
    }
  }
  return { events, hidden, snapshotTargets, computes };
}

function categoriesOf(invariant: InvariantDef, fields: readonly string[], index: CategoryIndex): readonly InvariantCategory[] {
  const guarded = invariant.enforcedBy.filter((point) => point.kind === 'guard').map((point) => index.events.get(point.ref));
  const touched = new Set(fields.map((field) => field.split('.')[0] ?? ''));
  const result: InvariantCategory[] = [];
  const computesApply = invariant.enforcedBy.some((point) => point.kind === 'application' && index.computes.refs.has(point.ref));
  if (guarded.some((event) => event?.settles === true) || fields.some((field) => index.computes.fields.has(field)) || computesApply) result.push('settle-compute');
  if (guarded.some((event) => event?.final === true)) result.push('into-final');
  if (fields.some((field) => index.hidden.has(field)) || [...touched].some((entity) => index.snapshotTargets.has(entity))) result.push('hidden-snapshot');
  return result;
}

/** 集約 1 つの不変条件の事実。`computes` は `computeIndexOf` の結果。 */
export function invariantFacts(model: SpecModel, aggregate: string, computes: ComputeIndex = NO_COMPUTES): readonly InvariantFact[] {
  const specs = model.aggregates.get(aggregate);
  const own = specs?.entity?.entity ?? aggregate;
  const index = indexOf(model, computes);
  return (specs?.invariants?.invariants ?? []).map((invariant): InvariantFact => {
    const fields = fieldsOf(invariant.formal, own);
    return {
      id: invariant.id,
      aggregate,
      statement: invariant.statement,
      ...(invariant.formal === undefined ? {} : { formal: invariant.formal.kind }),
      fields,
      enforcedBy: invariant.enforcedBy.map((point) => ({ kind: point.kind, ref: point.ref })),
      categories: categoriesOf(invariant, fields, index),
      source: invariant.location,
    };
  });
}
