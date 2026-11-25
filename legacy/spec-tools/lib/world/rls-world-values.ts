/**
 * RLS の挙動テストが置く**行の値**を、entity_spec の型から機械的に決める写像(束 ⑳-4b)。
 *
 * world(world)は「見えるべき行 / 見えてはならない行」を並べるためだけに存在するので、値は
 * **業務上の意味を持たない**。ただし DB に入らなければ話にならないので、宣言から読める制約は
 * 満たさなければならない。この写像が守るのは 3 つである。
 *
 * | 宣言 | 値の決め方 |
 * |---|---|
 * | 型(`FieldType`) | string / text → `{欄}-{連番}` / integer・decimal → 連番 / boolean → false / enum → 先頭 / date・datetime → 固定の基準から連番の刻み / uuid → 連番から作る固定形 |
 * | 一意性(`formal.type: uniqueness`) | **値は world の中で重複しない**(連番を全行・全欄で共有する)ので、鍵が何であっても当たらない |
 * | 行内比較(`formal.type: check` の `{集約}.{a} < {集約}.{b}`) | 日時・数値の欄に**宣言された順序**で刻みを割り当てる(`fieldOrder`) |
 * | `max_length` / `min` / `max` | 文字列は超えないところで切り、数値は宣言された範囲で折り返す |
 *
 * **値を入れない欄**もここが決める —— `auto` / `state(...)` / `supplied_by: db` / data_table が
 * `defaults` を宣言した欄は、DB(採番・列の既定値・トリガ)が決める値であり、テストが書き写すと
 * 「仕様の既定値」と「テストの既定値」が 2 か所になる(V17 が閉じた宣言の裏返し)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, SpecModel } from '../model/types.js';
import { parseFormalGuard } from '../guard/parser.js';
import { textValue } from './rls-world-text.js';
import type { CompareOp, GuardExpr, PathRef } from '../guard/ast.js';

/** 欄の制約として効く正規表現(宣言した `pattern` か `format` から導いたもの。world の値の検算が使う)。 */
export { effectivePattern } from '../kernel/url-format.js';

/** 行に入れられる値(生成物のリテラルに出る形)。 */
export type RlsValue = string | number | boolean;

/** 日時の基準(固定。生成物が実行時刻に依らないため)。 */
const DATETIME_BASE = Date.UTC(2030, 0, 1);

/** 日時の 1 刻み(1 日)。 */
const DATETIME_STEP_MS = 24 * 60 * 60 * 1000;

/** 1 行が使える日時の刻みの幅(行どうしの値が混ざらないだけの間隔を空ける)。 */
const DATETIME_ROW_SPAN = 64;

/** 順序の宣言に現れうる比較演算子(左辺が先に来るもの / 後に来るもの)。 */
const BEFORE_OPS: readonly CompareOp[] = ['<', '<='];

/** 順序の宣言に現れうる比較演算子(左辺が後に来るもの)。 */
const AFTER_OPS: readonly CompareOp[] = ['>', '>='];

/** 値を決めるときの文脈(world 全体で共有する連番と、その欄の順位)。 */
export interface RlsValueContext {
  /** その行の番号(0 始まり。日時の刻みを行ごとにずらすのに使う)。 */
  readonly rowIndex: number;
  /** world 全体で一意な連番を 1 つ取る。 */
  readonly next: () => number;
  /** 欄名 → 日時・数値の順位(`fieldOrder` の結果)。 */
  readonly order: ReadonlyMap<string, number>;
}

/**
 * その欄に値を置くか(置かないのは「DB が決める値」だけである)。
 *
 * @param field 欄の宣言
 * @param defaults data_table が宣言した列の既定値
 * @returns テストが値を置く欄なら true
 */
export function isValueSupplied(field: FieldDef, defaults: Readonly<Record<string, string>>): boolean {
  if (field.auto || field.type.kind === 'state') return false;
  if (field.suppliedBy === 'db') return false;
  return defaults[field.name] === undefined;
}

/**
 * 欄 1 つの値(型から機械的に決まる)。
 *
 * @param field 欄の宣言
 * @param ctx 連番と順位
 * @returns 行に入れる値
 */
export function valueOfField(field: FieldDef, ctx: RlsValueContext): RlsValue {
  const seq = ctx.next();
  switch (field.type.kind) {
    case 'boolean':
      return false;
    case 'integer':
    case 'decimal':
      return numberValue(field, seq);
    case 'enum':
      return field.type.values[0] ?? '';
    case 'date':
      return isoOf(field, ctx).slice(0, 10);
    case 'datetime':
      return isoOf(field, ctx);
    case 'uuid':
    case 'ref':
      return uuidOf(seq);
    default:
      return textValue(field, seq);
  }
}

/**
 * 数値の欄(宣言された範囲の中で、連番だけ動かす)。
 *
 * 下限が宣言されていればそこから数え、上限も宣言されていればその範囲で折り返す —— 範囲は
 * entity_spec から CHECK 制約に写っているので、はみ出した値はそこで落ちる。範囲が無ければ
 * 連番そのままで、一意の宣言があっても当たらない。
 */
function numberValue(field: FieldDef, seq: number): number {
  const base = field.min ?? 1;
  const max = field.max;
  if (max === undefined || max <= base) return base + seq;
  return base + (seq % (max - base + 1));
}

/** 日時の欄(行ごとにずらした区画の中で、宣言された順位のぶんだけ後ろへ)。 */
function isoOf(field: FieldDef, ctx: RlsValueContext): string {
  const rank = ctx.order.get(field.name) ?? 0;
  const steps = ctx.rowIndex * DATETIME_ROW_SPAN + rank;
  return new Date(DATETIME_BASE + steps * DATETIME_STEP_MS).toISOString();
}

/** 連番から作る固定形の uuid(行の参照先を入れない欄のため)。 */
function uuidOf(seq: number): string {
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

/**
 * その集約の `check` 不変条件が宣言する**欄どうしの順序**(欄名 → 順位)。
 *
 * `workshop.entry_deadline < workshop.starts_at` のような行内比較は、値を機械的に置くだけでは
 * 満たせない —— 同じ型の欄に同じ値を置けば、その CHECK は必ず落ちる。宣言を読んで順位を付け、
 * 値の側でその順に並べる(条件の正は invariant_spec であり、ここはその写像にすぎない)。
 *
 * @param domain ドメイン仕様
 * @param entity 対象の集約
 * @returns 欄名 → 順位。順序が循環していて決められないときは `null`
 */
export function fieldOrder(domain: SpecModel, entity: string): ReadonlyMap<string, number> | null {
  const edges = orderEdges(domain, entity);
  if (edges.length === 0) return new Map();
  const nodes = [...new Set(edges.flatMap((edge) => [edge.before, edge.after]))].sort();
  const ranks = new Map<string, number>();
  const remaining = new Set(nodes);
  for (let rank = 0; remaining.size > 0; rank += 1) {
    const ready = [...remaining].filter(
      (node) => !edges.some((edge) => edge.after === node && remaining.has(edge.before)),
    );
    if (ready.length === 0) return null;
    for (const node of ready) {
      ranks.set(node, rank);
      remaining.delete(node);
    }
  }
  return ranks;
}

/** 順序の辺 1 本(`before` の欄の値が `after` の欄の値より前になる)。 */
interface OrderEdge {
  readonly before: string;
  readonly after: string;
}

/** その集約の `check` 不変条件から、同じ集約の欄どうしの順序の辺を集める。 */
function orderEdges(domain: SpecModel, entity: string): readonly OrderEdge[] {
  const edges: OrderEdge[] = [];
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      if (invariant.formal?.kind !== 'check') continue;
      const parsed = parseFormalGuard(invariant.formal.expr);
      if (!parsed.ok) continue;
      edges.push(...comparisons(parsed.expr).flatMap((node) => edgeOf(node, entity)));
    }
  }
  return edges;
}

/** 比較 1 つを順序の辺に写す(同じ集約の 2 つの欄を順序で比べているものだけ)。 */
function edgeOf(node: Comparison, entity: string): readonly OrderEdge[] {
  const left = fieldOf(node.left, entity);
  const right = fieldOf(node.right, entity);
  if (left === null || right === null || left === right) return [];
  if (BEFORE_OPS.includes(node.op)) return [{ before: left, after: right }];
  if (AFTER_OPS.includes(node.op)) return [{ before: right, after: left }];
  return [];
}

/**
 * `{集約}.{欄}` のパスなら欄名(別の集約や 1 段のパスは対象外)。
 *
 * @param path 比較の片側のパス
 * @param entity 自分の集約
 * @returns その集約の欄名。別の集約なら `null`
 */
export function fieldOf(path: PathRef | null, entity: string): string | null {
  if (path === null || path.segments.length !== 2) return null;
  const [head, name] = path.segments;
  return head === entity && name !== undefined ? name : null;
}

/** 読み取る対象になる比較 1 つ(右辺がパスでなければ `right` は `null`)。 */
export interface Comparison {
  readonly left: PathRef;
  readonly op: CompareOp;
  readonly right: PathRef | null;
}

/**
 * 形式定義の式に現れる比較を集める(パースできなければ空)。式を読む口はここ 1 つである ——
 * 同じ比較を別の場所でもう 1 度パースすると、`or` の中を覗けるかどうかが静かに食い違う。
 *
 * @param expr 形式定義の式
 * @returns 現れた比較(宣言順)
 */
export function comparisonsOf(expr: string): readonly Comparison[] {
  const parsed = parseFormalGuard(expr);
  return parsed.ok ? comparisons(parsed.expr) : [];
}

/** ガード式に現れる比較を集める(右辺がパスでなければ `right` は `null`)。 */
function comparisons(expr: GuardExpr): readonly Comparison[] {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return [...comparisons(expr.left), ...comparisons(expr.right)];
    case 'not':
      return comparisons(expr.operand);
    case 'compare':
      return [
        { left: expr.path, op: expr.op, right: expr.rhs.kind === 'path' ? expr.rhs.path : null },
      ];
    default:
      return [];
  }
}

/**
 * `claim` の欄を真にしたときに**一緒に満たさなければならない値**(行内比較の含意の側)。
 *
 * `claim` のロールの実行者は、その欄が真である行でなければ立たない。ところが行内比較の不変条件は
 * しばしば「その欄が真なら、別の欄はこうでなければならない」という形をしている
 * (`{欄} == false or {別の欄} == {値}`)—— 欄を真にしただけの行は、その CHECK に当たって
 * DB に入らない。
 *
 * そこで宣言を読んで、含意の側の欄に必要な値を置く。読むのは**`or` で並んだ等値比較だけ**で
 * ある —— それが「〜なら〜である」を行内比較で書いたときの形であり、それ以上を解こうとすると
 * ここが小さな充足ソルバになる(宣言から決まらない形は world を作れないと判定する側の仕事である)。
 *
 * @param domain ドメイン仕様
 * @param entity 実行者の集約
 * @param field `claim` の根拠になる欄
 * @returns 一緒に置く欄 → 値(無ければ空)
 */
export function claimImplications(
  domain: SpecModel,
  entity: string,
  field: string,
): Readonly<Record<string, RlsValue>> {
  const found: Record<string, RlsValue> = {};
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      if (invariant.formal?.kind !== 'check') continue;
      const parsed = parseFormalGuard(invariant.formal.expr);
      if (!parsed.ok) continue;
      const atoms = disjuncts(parsed.expr);
      if (!atoms.some((atom) => isFalseTest(atom, entity, field))) continue;
      for (const atom of atoms) Object.assign(found, equalityOf(atom, entity, field));
    }
  }
  return found;
}

/** `or` で並んだ項に開く(`or` 以外はそれ自身 1 項)。 */
function disjuncts(expr: GuardExpr): readonly GuardExpr[] {
  return expr.kind === 'or' ? [...disjuncts(expr.left), ...disjuncts(expr.right)] : [expr];
}

/** その項が「その欄が偽である」を言っているか(含意の前提側)。 */
function isFalseTest(expr: GuardExpr, entity: string, field: string): boolean {
  if (expr.kind !== 'compare' || expr.op !== '==' || expr.rhs.kind !== 'symbol') return false;
  return fieldOf(expr.path, entity) === field && expr.rhs.value === 'false';
}

/** その項が要求する「別の欄 = この値」(前提側の欄と、リテラルでない右辺は除く)。 */
function equalityOf(
  expr: GuardExpr,
  entity: string,
  field: string,
): Readonly<Record<string, RlsValue>> {
  if (expr.kind !== 'compare' || expr.op !== '==') return {};
  const name = fieldOf(expr.path, entity);
  if (name === null || name === field) return {};
  if (expr.rhs.kind === 'number') return { [name]: expr.rhs.value };
  if (expr.rhs.kind !== 'symbol') return {};
  if (expr.rhs.value === 'true' || expr.rhs.value === 'false') {
    return { [name]: expr.rhs.value === 'true' };
  }
  return { [name]: expr.rhs.value };
}
