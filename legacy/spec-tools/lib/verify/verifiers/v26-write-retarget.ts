/**
 * V26 の**付け替えの検査**の部品 —— 編集(`writes`)が、行の持ち主(テナント)そのものを書き換えられる口。
 *
 * `when` は**今ある行**を読む(編集の入力の新しい値は `when` から見えない)。だから編集の `fields` が
 *   - 自分の境界の列(例: `company_id`)、または
 *   - 境界の列を持つ祖先へ届く入力の参照の欄(例: `store_id` → 店舗 → 会社)
 * を含むとき、旧い値に対する `store.company_id == actor.company_id` は**書いたあとの行**の境界を何も保証しない
 * (自社の行を他社へ移せる / 他社の親を指す行を自社の親へ付け替える。外部レビュー の P2-2)。
 * ここは、そういう**付け替えの口**を列挙し、それを塞ぐ**実在する不変条件**(執行点が実際にある)があるかを答える。
 *
 * 不変条件が数えられる条件(宣言されているだけの不変条件は数えない):
 *   1. 執行点が実在する: `db_constraint` / `trigger` は data_table が `invariant` で名指している(T16 が宣言を見るだけの
 *      ものは数えない)、`application` は アプリの実装に export され呼び出し口がある。`guard` は編集の経路を通らないので数えない。
 *   2. formal の式が付け替えの口を**ちょうど**結ぶ: 式のトップレベルの `and` の項に、その 2 つの列の**等式**がある
 *      (辺の向きは問わない。`!=`・`or` の片側・`not (…)`・別々の無関係な比較・違う列の等式は結んだことにならない)。
 *      自分の境界の列を書き換える口なら、その列と、**その編集が書けない**参照の欄の先の祖先の境界の列の等式。
 *      祖先への参照の欄を書き換える口なら、**自分の境界の列と、その参照の先の祖先の境界の列**の等式(新しい親の会社が
 *      行の会社と一致する)—— ただしその編集が**自分の境界の列を書けない**ときだけ。両方を同じ編集で書けると、等式は
 *      「2 つを一緒に別のテナントへ動かす」ことで満たせてしまうので、旧いテナントに留める保証にならない
 *      (外部レビュー の P2-2)。自分の境界の列を持たない集約の参照の付け替えは、行に会社が無いので不変条件では
 *      結べない(`accept` だけが消す)。
 *
 * **この部品はテナントの語を 1 つも持たない。**
 */

import type { EntitySpec, InvariantDef, SpecModel } from '../../model/types.js';
import { FORMAL_PARSE } from '../../guard/ast.js';
import { equatesPaths } from '../../guard/required-equalities.js';
import { inputValue } from '../../kernel/input-state.js';
import type { VerifyContext } from '../../check-api/contract.js';
import { refColumn, refPathTo } from '../../model/ref-path.js';
import { ancestorsOf, boundaryOf, directRefColumns, matches, ownMatches, tenantColumns, type BoundaryField } from './tenant-boundary-model.js';

/** 付け替えの口 1 つ(編集の `fields` の 1 欄)。 */
export interface Retarget {
  /** 書き換える欄。 */
  readonly field: string;
  /** 自分の境界の列そのものか、祖先へ届く入力の参照の欄か。 */
  readonly kind: 'own' | 'ref';
  /** 境界の欄(`actor.{欄}` の `{欄}`)。 */
  readonly boundary: string;
  /** 不変条件が結ぶべき自分の境界の列(`{集約}.{列}`)。参照の欄の付け替えで、自分の列が無ければ空。 */
  readonly ownPaths: readonly string[];
  /** 不変条件が結ぶべき祖先の境界の列(`{集約}.{列}`。参照の欄の付け替えだけ)。 */
  readonly ancestorPaths: readonly string[];
  /** `accept[].filter` が名指しできる綴り。 */
  readonly acceptFields: readonly string[];
  /**
   * 不変条件が必須の等式として持てば、この口を塞ぐ列の組(`{集約}.{列}` 2 本)。
   * 空なら、この編集のもとでは不変条件では塞げない(`unlinkable` が理由)。
   */
  readonly pairs: readonly (readonly [string, string])[];
  /**
   * `pairs` が空である理由(空でなければ null)。`both` = 自分の境界の列と祖先への参照の欄を**同じ編集で書ける**
   * (等式を保ったまま 2 つとも他のテナントへ動かせる)、`none` = 結ぶ相手が無い(自分の境界の列か、境界を持つ祖先が無い)。
   */
  readonly unlinkable: 'both' | 'none' | null;
}

/** 祖先への参照の欄(`context` の最初の 1 段)ごとの、その先の祖先が持つ境界の列(`{集約}.{列}`)。 */
function ancestorColumnsByRef(model: SpecModel, entity: EntitySpec, boundary: BoundaryField): ReadonlyMap<string, readonly string[]> {
  const byColumn = new Map<string, string[]>();
  for (const ancestor of ancestorsOf(model, entity)) {
    const route = refPathTo(model, entity.entity, ancestor.entity);
    const first = route?.[0];
    const column = first === undefined ? null : refColumn(model, entity.entity, first);
    if (column === null) continue;
    const paths = ancestor.fields.filter((candidate) => matches(candidate, boundary)).map((candidate) => `${ancestor.entity}.${candidate.name}`);
    if (paths.length > 0) byColumn.set(column, [...(byColumn.get(column) ?? []), ...paths]);
  }
  // `context` に無い参照の欄でも、境界の列を持つ表を直に指すなら付け替えの口である(A3-2(c))。
  for (const direct of directRefColumns(model, entity, boundary)) {
    if (!byColumn.has(direct.column)) byColumn.set(direct.column, [...direct.paths]);
  }
  return byColumn;
}

/** 編集の `fields` のうち、行の持ち主を付け替えられる欄を口ごとに列挙する。 */
export function retargetsOf(
  model: SpecModel,
  entity: EntitySpec,
  boundaries: readonly BoundaryField[],
  fields: readonly string[],
): readonly Retarget[] {
  const out: Retarget[] = [];
  const ownColumns = tenantColumns(entity, boundaries);
  for (const column of ownColumns) {
    if (!fields.includes(column)) continue;
    const field = entity.fields.find((candidate) => candidate.name === column);
    const boundary = boundaries.find((candidate) => candidate.name === boundaryOf(field, boundaries, entity.entity));
    const own = `${entity.entity}.${column}`;
    // 結べる相手は、**この編集が書けない**参照の欄の先の祖先の列だけ(同じ編集が参照の欄も書くなら、2 つを一緒に動かせる)。
    const peers = boundary === undefined ? [] : [...ancestorColumnsByRef(model, entity, boundary)].filter(([ref]) => !fields.includes(ref));
    const pairs = peers.flatMap(([, paths]) => paths.map((path): readonly [string, string] => [own, path]));
    const bothMovable = boundary !== undefined && [...ancestorColumnsByRef(model, entity, boundary).keys()].some((ref) => fields.includes(ref));
    out.push({
      field: column,
      kind: 'own',
      boundary: boundaryOf(field, boundaries, entity.entity),
      ownPaths: [own],
      ancestorPaths: [],
      acceptFields: [column],
      pairs,
      unlinkable: pairs.length > 0 ? null : bothMovable ? 'both' : 'none',
    });
  }
  for (const boundary of boundaries) {
    const ownPaths = entity.fields
      .filter((field) => ownColumns.includes(field.name) && ownMatches(field, boundary, entity.entity))
      .map((field) => `${entity.entity}.${field.name}`);
    // 自分の境界の列を同じ編集が書けるなら、等式を保ったまま 2 つとも他のテナントへ動かせる。
    const ownWritable = ownColumns.some((column) => fields.includes(column) && entity.fields.some((field) => field.name === column && ownMatches(field, boundary, entity.entity)));
    for (const [column, ancestorPaths] of ancestorColumnsByRef(model, entity, boundary)) {
      if (!fields.includes(column)) continue;
      const pairs = ownWritable ? [] : ownPaths.flatMap((own) => ancestorPaths.map((path): readonly [string, string] => [own, path]));
      out.push({
        field: column,
        kind: 'ref',
        boundary: boundary.name,
        ownPaths,
        ancestorPaths,
        acceptFields: [column, ...ancestorPaths],
        pairs,
        unlinkable: pairs.length > 0 ? null : ownWritable && ownPaths.length > 0 ? 'both' : 'none',
      });
    }
  }
  return out;
}

/** その付け替えの口(または作成の入力の参照の欄)を、実在する執行点を持つ不変条件が塞いでいるか。 */
export function tiedByInvariant(model: SpecModel, entity: EntitySpec, retarget: Pick<Retarget, 'pairs'>, ctx: VerifyContext): boolean {
  const carried = carriedInvariantIds(ctx);
  for (const specs of model.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      if (!invariant.entities.includes(entity.entity) && specs.entity?.entity !== entity.entity) continue;
      if (!enforced(invariant, carried, ctx)) continue;
      if (ties(invariant, retarget, ctx)) return true;
    }
  }
  return false;
}

/** data_table が `invariant` で名指している不変条件 ID(執行点の実体がある)。 */
function carriedInvariantIds(ctx: VerifyContext): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const table of inputValue(ctx.dataTables)?.tables ?? []) {
    for (const decl of [...table.checks, ...table.indexes, ...table.exclusions, ...table.triggers]) {
      if (decl.invariant !== undefined) ids.add(decl.invariant);
    }
  }
  return ids;
}

/** 執行点が実在するか(宣言されているだけ・編集の経路を通らない guard は数えない)。 */
function enforced(invariant: InvariantDef, carried: ReadonlySet<string>, ctx: VerifyContext): boolean {
  return invariant.enforcedBy.some((point) => {
    if (point.kind === 'db_constraint' || point.kind === 'trigger') return carried.has(invariant.id);
    if (point.kind === 'application') {
      const refs = ctx.applicationRefs;
      return refs !== undefined && refs.exportedNames.has(point.ref) && refs.referencedNames.has(point.ref);
    }
    return false;
  });
}

/**
 * formal の式が、付け替えの口を**ちょうど**結んでいるか(読めない式・`check` でない式は結ばない)。
 *
 * 式のうち `and` の必須の項になっている等式が、口の列の組(`pairs`)のどれかと一致するときだけ。式に 2 つの列が
 * 現れるだけ(`!=`・`or`・`not`・別々の比較)では結ばない。
 */
function ties(invariant: InvariantDef, retarget: Pick<Retarget, 'pairs'>, ctx: VerifyContext): boolean {
  // 常に成り立つと宣言された式(check)だけ。cardinality の where・state_dependency の if/then は条件つきの式で、等式があっても無条件には成り立たない。
  const formal = invariant.formal;
  if (formal === undefined || formal.kind !== 'check') return false;
  const parsed = ctx.guards.parse(formal.expr, FORMAL_PARSE);
  if (!parsed.ok) return false;
  return retarget.pairs.some(([first, second]) => equatesPaths(parsed.expr, first, second));
}
