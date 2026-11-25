/**
 * テナント境界の**モデル**(V20 の読み取りと V26 の書き込みが同じ目で見るための共有部)。
 *
 * 「何が境界の欄か」「どの列がその境界を表すか」「子表が境界の列を持たないとき祖先のどの列で狭められるか」
 * は、読む側(V20)と書く側(V26)で食い違ってはならない —— 片方だけが「祖先の列も境界に数える」ような
 * 食い違いは、読み取りは閉じているのに書き込みが開いている(またはその逆)穴になる。
 * そこで境界の欄・列・候補の導き方は、ここの 1 本にした。
 *
 * **この検査はテナントの語を 1 つも持たない。** 何が境界かは仕様が `session: true` と
 * `actor.{欄}` の使用で宣言し、ここはその宣言の使われ方だけを見る。
 */

import type { EntitySpec, FieldDef, SpecModel } from '../../model/types.js';
import { refColumn, refPathTo } from '../../model/ref-path.js';
import { ROLE_KINDS } from '../../model/types.js';
import type { VerifyContext } from '../../check-api/contract.js';

/** 予約語 `actor` と、境界ではない 1 語(同一性)。 */
const ACTOR_ROOT = 'actor';
const ACTOR_ID_FIELD = 'id';

/**
 * ログインした人を表すグローバルロールの種別。
 *
 * これ以外の種別(未ログイン・システム起点)にはセッションの profile が無く、
 * `actor.{欄}` を供給できない —— つまり境界を書きようがない。
 */
const SESSION_ROLE_KIND = 'authenticated_default';

/** 実行者の属性が供給されないロールの種別(= セッションを持たない種別の全体)。 */
export const ACTORLESS_ROLE_KINDS: ReadonlySet<string> = new Set(
  ROLE_KINDS.filter((kind) => kind !== SESSION_ROLE_KIND),
);

/** 実行者の属性として使われている欄 1 つ(名前と、参照の欄ならその参照先)。 */
export interface BoundaryField {
  readonly name: string;
  /** その欄が `ref({entity})` なら参照先(そうでなければ null)。 */
  readonly refEntity: string | null;
}

/**
 * 境界の候補 1 つ(自分の列 1 本、または祖先の列の束)。
 *
 * 自分の列は列ごとに見る(同じ境界を表す列が 2 本あれば、どちらも狭める —— 以前からの判定)。
 * 祖先の列は**境界の欄ごとに束ねる** —— 予約 → 部屋 → 部門 のどちらの段も会社の列を持つとき、
 * どちらか 1 本で狭めれば境界は閉じる(両方を要求すると、写しの列を持つ製品ほど warning が増える)。
 */
export interface BoundaryCandidate {
  /** 境界の欄(`actor.{欄}` の `{欄}`)。 */
  readonly boundary: string;
  /** 狭めるのに使える左辺(自分の列なら 1 本、祖先なら近い順の `{集約}.{列}`)。 */
  readonly paths: readonly string[];
  /** 祖先の列の束か。 */
  readonly inherited: boolean;
  /**
   * 境界の列を持つ表へ**生の参照では届くのに、`context` では辿れない**(または実行者の集約を経てしか届かない。A4-2)とき、その参照の欄
   * (自分の列。A3-2(b))。`paths` は空で左辺に書ける綴りが無い ——「境界を書けない形」であり、道を宣言する・写しの列を持たせる・
   * `accept` で名指す、のどれかまで消えない(以前は `context` を書き忘れると V20 / V26 がそろって沈黙した)。
   */
  readonly unreachable?: readonly string[];
}

/**
 * そのエンティティの境界の候補(自分の列 → 祖先の列の束の順)。
 *
 * 祖先の束は、**自分がその境界の列を 1 本も持たない**ときだけ作る —— 自分の列があれば
 * それで狭めるのが最短であり、祖先まで要求すると同じ境界を 2 度書かせることになる。
 */
export function candidatesOf(
  model: SpecModel,
  entity: EntitySpec,
  boundaries: readonly BoundaryField[],
): readonly BoundaryCandidate[] {
  const own = tenantColumns(entity, boundaries).map((column) => ({
    boundary: boundaryOf(entity.fields.find((field) => field.name === column), boundaries, entity.entity),
    paths: [column],
    inherited: false,
  }));
  const ancestors = ancestorsOf(model, entity);
  const inherited = boundaries.flatMap((boundary): BoundaryCandidate[] => {
    if (entity.fields.some((field) => ownMatches(field, boundary, entity.entity))) return [];
    const paths = ancestors.flatMap((ancestor) =>
      ancestor.fields.filter((field) => matches(field, boundary)).map((field) => `${ancestor.entity}.${field.name}`),
    );
    if (paths.length > 0) return [{ boundary: boundary.name, paths, inherited: true }];
    const reach = rawReach(model, entity, boundary);
    return reach.length === 0 ? [] : [{ boundary: boundary.name, paths: [], inherited: true, unreachable: reach }];
  });
  return [...own, ...inherited];
}

/** 生の参照を辿る深さの上限(循環は `seen` が止める)。**超えた道は「届く」とみなす**(fail-closed。以前は黙って外れた。7 回目 A7-5)。 */
export const MAX_RAW_DEPTH = 8;

/**
 * **生の参照の閉包**で、境界の列を持つ表へ届く自分の参照の欄(宣言順・重複なし。A3-2(b))。
 *
 * `context` の宣言ではなく `ref({entity})` の欄そのものを辿る —— `context` は書き手が「どの道で届くか」を名指す宣言であり、
 * 書き忘れたときに検査の目からも消えてはならない。境界の列を持つ表に着いたら、その先は辿らない(境界はそこで運ばれている)。
 * 自分自身へ戻る参照は辿らない。
 *
 * @param model ドメイン仕様
 * @param entity 出発するエンティティ
 * @param boundary 境界の欄
 * @returns 届く道の 1 段目になる自分の参照の欄
 */
export function rawReach(model: SpecModel, entity: EntitySpec, boundary: BoundaryField): readonly string[] {
  const out: string[] = [];
  for (const field of entity.fields) {
    if (field.type.kind !== 'ref' || field.type.entity === entity.entity) continue;
    if (reachesBoundary(model, field.type.entity, boundary, new Set([entity.entity]), 1)) out.push(field.name);
  }
  return out;
}

/** その表から(その表を含めて)生の参照で境界の列を持つ表へ届くか。 */
function reachesBoundary(model: SpecModel, name: string, boundary: BoundaryField, seen: Set<string>, depth: number): boolean {
  if (seen.has(name) || depth > MAX_RAW_DEPTH) return !seen.has(name); // 上限を超えた道は「届く」に倒す(A7-5)
  const spec = entityByName(model, name);
  if (spec === undefined) return false;
  if (spec.fields.some((field) => matches(field, boundary))) return true;
  const next = new Set([...seen, name]);
  return spec.fields.some(
    (field) => field.type.kind === 'ref' && reachesBoundary(model, field.type.entity, boundary, next, depth + 1),
  );
}

/** エンティティ名(または集約名)から entity_spec を引く。 */
function entityByName(model: SpecModel, name: string): EntitySpec | undefined {
  const direct = model.aggregates.get(name)?.entity;
  if (direct !== undefined) return direct;
  for (const specs of model.aggregates.values()) {
    if (specs.entity?.entity === name) return specs.entity;
  }
  return undefined;
}

/**
 * 自分の参照の欄が**直に**指す表が持つ境界の列(参照の欄 → `{表}.{列}`。A3-2(c))。
 *
 * `context` に宣言の無い参照の欄も拾う —— 入力で受ける参照の欄の先が他のテナントの行でないことは、`context` を書いたかどうかに
 * 依らず求める(他社の商品を指す注文を作れた形)。`context` で同じ表へ**その欄を通って**届くときだけ、`{表}.{列}` は
 * `when` の左辺に書ける(`bindable`)。
 *
 * @param model ドメイン仕様
 * @param entity 参照を持つエンティティ
 * @param boundary 境界の欄
 * @returns 参照の欄ごとの、指す表の境界の列と、`when` で結べるか
 */
export function directRefColumns(
  model: SpecModel,
  entity: EntitySpec,
  boundary: BoundaryField,
): readonly { readonly column: string; readonly paths: readonly string[]; readonly bindable: boolean }[] {
  const out: { column: string; paths: string[]; bindable: boolean }[] = [];
  for (const field of entity.fields) {
    if (field.type.kind !== 'ref' || field.type.entity === entity.entity) continue;
    if (matches(field, boundary)) continue;
    const target = entityByName(model, field.type.entity);
    if (target === undefined) continue;
    const paths = target.fields.filter((candidate) => matches(candidate, boundary)).map((candidate) => `${target.entity}.${candidate.name}`);
    if (paths.length === 0) continue;
    const route = refPathTo(model, entity.entity, target.entity);
    const bindable = route !== null && route.length === 1 && refColumn(model, entity.entity, target.entity) === field.name;
    out.push({ column: field.name, paths, bindable });
  }
  return out;
}

/** その列が表す境界の欄の名前(同じ名前を優先し、無ければ同じ参照先の欄・根の `id` ならその根を指す欄)。 */
export function boundaryOf(field: FieldDef | undefined, boundaries: readonly BoundaryField[], owner: string): string {
  if (field === undefined) return '';
  const named = boundaries.find((boundary) => boundary.name === field.name);
  return (named ?? boundaries.find((boundary) => ownMatches(field, boundary, owner)))?.name ?? field.name;
}

/**
 * `context` で辿れる祖先(近い順。2 段まで・経路が 2 通りある祖先は除く)。
 *
 * 道の探索は `filters` の左辺・`binding`・`when` と同じ `refPathTo` に任せる —— 検査が「届く」と
 * 言う祖先と、書いた左辺を生成器が辿れる祖先が食い違わないためである。
 */
export function ancestorsOf(model: SpecModel, entity: EntitySpec): readonly EntitySpec[] {
  const actors = actorEntities(model);
  const found: { readonly spec: EntitySpec; readonly hops: number }[] = [];
  for (const specs of model.aggregates.values()) {
    const candidate = specs.entity;
    if (candidate === undefined || candidate.entity === entity.entity) continue;
    const route = refPathTo(model, entity.entity, candidate.entity);
    // 実行者の集約を経た祖先は境界にしない(A4-2)。起案者の先の列は人の今の所属で、行のテナントではない(異動で過去の行が移る)。
    if (route !== null && !route.some((step) => actors.has(step))) found.push({ spec: candidate, hops: route.length });
  }
  return found.sort((a, b) => a.hops - b.hops).map((entry) => entry.spec);
}

/** `from` から `to` への `context` の道が実行者の集約を経るか(V20 の祖先の列の `filters` の判定に使う。A4-2)。 */
export function reachedThroughActor(model: SpecModel, from: string, to: string): boolean {
  return refPathTo(model, from, to)?.some((step) => actorEntities(model).has(step)) ?? false;
}

/** 実行者の集約(`session: true` の欄を持つエンティティ)の名前。 */
function actorEntities(model: SpecModel): ReadonlySet<string> {
  const out = new Set<string>();
  for (const specs of model.aggregates.values()) {
    const spec = specs.entity;
    if (spec !== undefined && spec.fields.some((field) => field.session === true)) out.add(spec.entity);
  }
  return out;
}

/**
 * そのエンティティの「実行者の属性を表す列」(重複なし・宣言順)。
 *
 * 名前が一致する列と、同じ `ref` 先を指す列の 2 つを見る —— 列名を変えただけで境界の宣言が
 * 視界から外れる、という逃げ道を作らないためである。
 */
export function tenantColumns(entity: EntitySpec, boundaries: readonly BoundaryField[]): readonly string[] {
  const columns: string[] = [];
  for (const field of entity.fields) {
    if (!boundaries.some((boundary) => ownMatches(field, boundary, entity.entity))) continue;
    if (!columns.includes(field.name)) columns.push(field.name);
  }
  return columns;
}

/** その列が境界の欄を宣言しているか(同じ名前か、同じ参照先か)。祖先・参照先の表の列はこれで見る。 */
export function matches(field: FieldDef, boundary: BoundaryField): boolean {
  if (field.name === boundary.name) return true;
  return (
    boundary.refEntity !== null && field.type.kind === 'ref' && field.type.entity === boundary.refEntity
  );
}

/**
 * **自分の**列が境界の欄を宣言しているか(`matches` に加えて**境界の根の `id`**。A4-1)。根(境界の欄の参照先。`ref(company)` なら
 * `company`)は自分を指す参照の列を持たず、行のテナントは行そのもの —— 以前は根の候補が 0 件で、根の `filters` を消しても・`when` なしの
 * `writes` も・guard なしの遷移も V20 / V26 が黙っていた。結ぶ項は `{根}.id == actor.{欄}`(読み取りは `filters: { id: actor.{欄} }`)。
 * 祖先・参照先の根の `id` は数えない(根の 1 段手前の表は根を指す参照の列を必ず持ち、境界はそこで運ばれている)。
 */
export function ownMatches(field: FieldDef, boundary: BoundaryField, owner: string): boolean {
  if (matches(field, boundary)) return true;
  return boundary.refEntity !== null && field.name === ACTOR_ID_FIELD && owner === boundary.refEntity;
}

/**
 * 仕様のどこかで `actor.{欄}` として使われている欄と、`session: true` の参照の欄(`id` を除く)。
 *
 * 使い道は `reads[].filters` の右辺・`reads[].when`(RLS の `using` に入る。7 回目 A7-5)・作成 / 編集 / 削除の `when`・遷移の `guard`。
 * ロールの `binding` は `actor.id` しか書けない(V11)ので現れないが、同じ規則で拾う(書ける面が増えたときに落ちないため)。
 */
export function boundaryFields(model: SpecModel, ctx: VerifyContext): readonly BoundaryField[] {
  const names = new Set<string>();
  for (const specs of model.aggregates.values()) {
    for (const rule of specs.access?.reads ?? []) {
      for (const filter of rule.filters ?? []) names.add(filter.actorField);
    }
    const expressions = [
      ...(specs.access?.reads ?? []).map((rule) => rule.when),
      ...(specs.access?.creates ?? []).map((rule) => rule.when),
      ...(specs.access?.writes ?? []).map((rule) => rule.when),
      ...(specs.access?.deletes ?? []).map((rule) => rule.when),
      ...specs.stateMachines.flatMap((machine) => machine.events.map((event) => event.guard)),
    ];
    for (const expression of expressions) addActorFields(names, expression, ctx);
  }
  for (const role of model.roles.roles) addActorFields(names, role.binding, ctx);
  // 実行者のテナントを指す欄(`session: true` の参照の欄)は、使われていなくても境界である(A3-2(a))。
  // 使用からだけ導くと、境界を**全部**書き忘れた製品で V20 / V26 がそろって黙る(全部か無か)。
  for (const specs of model.aggregates.values()) {
    for (const field of specs.entity?.fields ?? []) {
      if (field.session === true && field.type.kind === 'ref') names.add(field.name);
    }
  }
  names.delete(ACTOR_ID_FIELD);
  return [...names].map((name) => ({ name, refEntity: refEntityOf(model, name) }));
}

/** 式 1 本に現れる `actor.{欄}` の欄名を集める(読めない式は V2 / V9 の担当なので黙って飛ばす)。 */
function addActorFields(names: Set<string>, expression: string | undefined, ctx: VerifyContext): void {
  if (expression === undefined) return;
  const parsed = ctx.guards.parse(expression);
  if (!parsed.ok) return;
  for (const path of ctx.guards.collectPaths(parsed.expr)) {
    const [head, field] = path.segments;
    if (head !== ACTOR_ROOT || field === undefined) continue;
    names.add(field);
  }
}

/** その欄を宣言している集約(`session: true` の集約)での参照先(参照の欄でなければ null)。 */
function refEntityOf(model: SpecModel, name: string): string | null {
  for (const specs of model.aggregates.values()) {
    for (const field of specs.entity?.fields ?? []) {
      if (field.name !== name || !field.session) continue;
      return field.type.kind === 'ref' ? field.type.entity : null;
    }
  }
  return null;
}
