/**
 * V20 テナント境界の宣言漏れ(束 ⑲-2a。読み取りの側)。
 *
 * `reads[].filters`(実行者の属性で行を狭める宣言)は**書けば接地が見られる**が、
 * **書き忘れは誰も言わなかった** —— 境界を 1 本消しても error 0 / warning 0 で通る。
 * 語彙を買う前と違うのは「書けるようになった」ことだけで、「書き忘れ」は同じように黙る。
 *
 * この体系は Y10 の uncovered・Z2 の `planned`・W1 の unresolved で「狭めた母集合を黙って
 * 通さない」を一貫して選んでいる。ここも同じ構えにする。
 *
 * ## 何を見るか
 *
 * 1. **実行者の属性を表す欄**を集める(`actor.{欄}` として `filters` かガード式か binding の
 *    どこかで使われている欄。`id` は同一性であって境界ではないので除く)。
 * 2. その欄を表す列を持つエンティティ —— 欄と**同じ名前**の列か、その欄と**同じ `ref` 先**を
 *    指す列 —— を探す。
 * 3. そのエンティティの `reads` が `scope: all` / `scope: context(...)` を **`filters` 無しで**
 *    宣言していたら **error**(以前は warning。子表が境界を書き忘れると他テナントの行が全部返るので、
 *    警告のままでは商用の製品に当てられない)。
 * 4. **自分は境界の列を持たないが、祖先が持つ**エンティティ(予約 → 部屋 → 部門 で、部門だけが会社の列を
 *    持つ形)も候補にする。祖先は `context` で辿れる 2 段まで —— `filters` の左辺の語彙
 *    (`{集約}.{列}`)が届く範囲と同じである。その境界の欄で狭める `filters` が 1 本も無ければ、
 *    祖先の列を名指して error にする。子表が境界を持たないことは、境界を書けない理由ではない
 *    (以前は候補を自分の列だけから探していたので、他社の予約を全部返す子表が warning すら出さなかった)。
 *
 * 5. **境界の列を持つ表へ生の参照(`ref(...)`)では届くのに、`context` で辿れない**エンティティ(宣言が無い・経路が 2 通り以上・
 *    3 段以上)も黙らせない(A3-2(b))。左辺に書ける綴りが無い「境界を書けない形」として error にし、`context` を宣言するか
 *    写しの列を持たせるか、参照の欄を名指した `accept` を求める。以前は `context` を書き忘れると候補そのものが消え、黙っていた。
 * 6. 境界の欄は `actor.{欄}` の使用からだけでなく、**`session: true` の参照の欄**からも導く(A3-2(a))。使用からだけ導くと、
 *    境界を全部書き忘れた製品で検査がそろって黙る。
 * 7. それでも境界の欄が 0 本(テナントの欄に `session: true` も付けず、境界を 1 本も書かなかった)なら、**実行者の集約の参照の欄で、
 *    ほかの集約も同じ参照先を指すもの**(テナントの欄に見える形)を error で名指す(A5-4。fail-closed)。V26 も同じ境界の欄から
 *    始まるので、ここで 1 度だけ言う。テナントでないなら、その欄に `not_boundary: 理由` を書いて外す。
 * 8. `not_boundary` は実行者の集約の、境界でない参照の欄にだけ書ける(`session: true` の欄・`actor.{欄}` で結ぶ欄・ほかの集約の欄は error)。
 *    書けた宣言は**受け入れた危険**として毎回 warning で名指す(A6-3。`tenant-not-boundary.ts`)。
 *
 * 対象から外すのは 2 つだけである。
 *   - `scope: own` / `scope: none` …… 原理として実行者の行(または 0 行)しか返らない
 *   - セッションの profile を持たない種別のロール(ログインした人を表す種別以外)…… 実行者の
 *     属性がそもそも供給されないので、`filters` が書けない。ただし**未ログイン**が `scope: all` / `context` で開くときは
 *     warning で名指す(A3-3。未ログインの許可はログイン中の人にも当たり、ほかの規則の境界が実質消える。受け入れは `accept`)
 *
 * 受け入れは**対象を名指しする** `accept:`(`{ by, filter, reason }`)で消し込む。免除の一覧を
 * 作らないのは、1 件ずつ理由が読めることがこの器の目的だからである(usecase_spec と同じ流儀)。
 *
 * 書き込みの側(`creates` / `writes` / `deletes` の `when`)の境界は V26 が見る。境界の欄・列・祖先の導き方は
 * 2 つの検査で食い違わないよう `tenant-boundary-model.ts` の 1 本を共有する。
 *
 * **この検査はテナントの語を 1 つも持たない。** 何が境界かは仕様が `session: true` と
 * `actor.{欄}` の使用で宣言し、ここはその宣言の使われ方だけを見る。
 */

import type { AccessSpec, ReadFilter, ReadRule, RoleDef, SpecModel } from '../../model/types.js';
import { acceptsRead } from '../../model/types.js';
import { anonymousRoleId } from '../../model/role-hierarchy.js';
import { readFilterPath } from '../../model/read-filter-path.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';
import {
  ACTORLESS_ROLE_KINDS,
  boundaryFields,
  candidatesOf,
  reachedThroughActor,
  type BoundaryCandidate,
} from './tenant-boundary-model.js';
import { latentBoundaries } from './tenant-latent-boundary.js';
import type { LatentBoundary } from './tenant-latent-boundary.js';
import { notBoundaryFindings } from './tenant-not-boundary.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'V20';

/** V20: 実行者の属性で狭める宣言(テナント境界)の書き忘れを報告する。 */
export const tenantBoundaryVerifier: Verifier = {
  id: VERIFIER_ID,
  title: 'テナント境界 — 実行者の属性で狭める宣言(reads[].filters)の書き忘れ',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    const boundaries = boundaryFields(model, ctx);
    // `not_boundary` の置き場・矛盾は error、受け入れてよい宣言は受け入れた危険として毎回名指す(A6-3)。
    const declared = notBoundaryFindings(model, new Set(boundaries.map((boundary) => boundary.name)));
    // 境界の欄が 0 本でも黙らない(A5-4): テナントの欄に見える実行者の参照の欄があれば、宣言を求めて止める(fail-closed)。
    if (boundaries.length === 0) return [...declared, ...latentBoundaries(model).map(latentFinding)];
    const roles = new Map<string, RoleDef>(model.roles.roles.map((role) => [role.id, role]));
    const findings: Finding[] = [...declared];
    for (const specs of model.aggregates.values()) {
      const entity = specs.entity;
      const access = specs.access;
      if (entity === undefined || access === undefined) continue;
      // 実行者の集約を経た祖先の列(起案者の所属など)で狭めても、行のテナントで狭めたことにはならない(A4-2)。
      const viaActor = (filter: ReadFilter): boolean => filter.entity !== undefined && reachedThroughActor(model, entity.entity, filter.entity);
      for (const candidate of candidatesOf(model, entity, boundaries)) {
        for (const rule of access.reads) {
          findings.push(...checkRule(access, rule, candidate, roles, viaActor));
        }
      }
    }
    return findings;
  },
};

/**
 * 読み取り規則 1 本 × 境界の候補 1 つ を見る。
 *
 * @param access その集約の access_spec
 * @param rule 読み取り規則
 * @param candidate 境界の候補
 * @param roles ロール定義(実行者の属性が供給されるかの判定に使う)
 * @returns 違反のリスト(0 件または 1 件)
 */
function checkRule(
  access: AccessSpec,
  rule: ReadRule,
  candidate: BoundaryCandidate,
  roles: ReadonlyMap<string, RoleDef>,
  viaActor: (filter: ReadFilter) => boolean,
): Finding[] {
  if (rule.scope.kind !== 'all' && rule.scope.kind !== 'context') return [];
  const kind = roles.get(rule.by)?.kind;
  // `on` を書いた受け入れは書いた種類にだけ効く(読み取りは `read` を名指したときだけ。A3-4)。
  const names = [...candidate.paths, ...(candidate.unreachable ?? [])];
  const accepted = access.accepts.some((entry) => entry.by === rule.by && acceptsRead(entry) && names.includes(entry.field));
  const scope = rule.scope.kind === 'context' ? `context(${rule.scope.entity})` : rule.scope.kind;
  if (kind !== undefined && ACTORLESS_ROLE_KINDS.has(kind)) {
    // 未ログインのロールだけを名指す(A3-3)。システム起点の読み取りは RLS を通らないので対象外。
    return rule.by === anonymousRoleId([...roles.values()]) && !accepted ? [anonymousFinding(access, rule, candidate, scope)] : [];
  }
  if (narrows(rule, candidate, viaActor)) return [];
  if (accepted) return [];
  if (candidate.unreachable !== undefined) return [unreachableFinding(access, rule, candidate, scope, candidate.unreachable)];
  const column = candidate.paths[0] ?? '';
  return [
    {
      verifier: VERIFIER_ID,
      severity: 'error',
      message: candidate.inherited
        ? `${access.entity} の reads(by: ${rule.by})は scope: ${scope} ですが、` +
          `祖先が持つ実行者の属性を表す列(${candidate.paths.join(' / ')})で狭める filters がありません`
        : `${access.entity} の reads(by: ${rule.by})は scope: ${scope} ですが、` +
          `実行者の属性を表す列 ${column} で狭める filters がありません`,
      location: rule.location,
      suggestion:
        `その規則に "filters: { ${column}: actor.${candidate.boundary} }" を足して境界を宣言するか、` +
        `跨がない理由が別にあるなら access_spec に "accept: [{ by: ${rule.by}, filter: ${column}, ` +
        'reason: {なぜ跨がないか} }]" を足して受け入れてください' +
        (candidate.inherited
          ? '(自分は境界の列を持たなくても、context で辿れる祖先の列で狭められる。左辺は {集約}.{列})'
          : ''),
      counterexample: { entity: access.entity, by: rule.by, scope, column: candidate.paths.join(', ') },
    },
  ];
}

/**
 * 未ログインの読み取りが、テナントを持つ表を `scope: all` / `context` で開いている(A3-3。warning)。
 *
 * 実行者の属性が供給されないので境界は書きようが無い —— それ自体は error にしない(公開のカタログのような正しい形がある)。
 * しかし生成されるポリシーは未ログインとログイン中の両方に当たり(許可ポリシーは論理和)、**ログイン中の人の `filters` の境界まで
 * 実質消える**。誰も理由を言わないまま通さないよう、V26 が同じ場面の書き込みを warning にするのと揃えて名指す。
 */
function anonymousFinding(access: AccessSpec, rule: ReadRule, candidate: BoundaryCandidate, scope: string): Finding {
  const column = candidate.paths[0] ?? candidate.unreachable?.[0] ?? '';
  return {
    verifier: VERIFIER_ID,
    severity: 'warning',
    message:
      `${access.entity} の reads(by: ${rule.by})は未ログインのロールで scope: ${scope} を開いていますが、この表は実行者の属性を表す列 ` +
      `${[...candidate.paths, ...(candidate.unreachable ?? [])].join(' / ')} を持ちます —— 未ログインの許可はログイン中の人にも当たるので、` +
      'ほかの規則の filters の境界が実質効きません(テナントを跨いで見せてよいかを誰も宣言していません)',
    location: rule.location,
    suggestion:
      `跨いで見せてよい(公開のカタログなど)なら、access_spec に "accept: [{ by: ${rule.by}, filter: ${column}, reason: {なぜ跨いでよいか} }]" を足して受け入れる。` +
      '跨がせたくないなら scope: none にする',
    counterexample: { entity: access.entity, by: rule.by, scope, column, kind: 'actorless_open' },
  };
}

/**
 * 境界の列を持つ表へ生の参照では届くのに、`context` で辿れない(境界を書けない形)という指摘(A3-2(b))。
 *
 * 以前はここで黙っていた —— `context` を書き忘れた子表は、境界の候補そのものが無いことになっていた。
 */
function unreachableFinding(
  access: AccessSpec,
  rule: ReadRule,
  candidate: BoundaryCandidate,
  scope: string,
  columns: readonly string[],
): Finding {
  const column = columns[0] ?? '';
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message:
      `${access.entity} の reads(by: ${rule.by})は scope: ${scope} ですが、参照の欄 ${columns.join(' / ')} の先に実行者の属性(actor.${candidate.boundary})を表す列があるのに、` +
      'context で 2 段以内・1 通りに辿れないので境界を書けません(context の宣言が無い・経路が 2 通り以上・3 段以上・実行者の集約を経る道しか無い)',
    location: rule.location,
    suggestion:
      `entity_spec ${access.entity} の context に境界の列を持つ祖先への道を宣言して(2 段以内・1 通り)filters で狭めるか、` +
      `近い表に写しの列を持たせるか、跨がない理由が別にあるなら access_spec に "accept: [{ by: ${rule.by}, filter: ${column}, reason: {なぜ跨がないか} }]" を足してください`,
    counterexample: { entity: access.entity, by: rule.by, scope, column: columns.join(', '), kind: 'unreachable' },
  };
}

/**
 * その規則が候補の境界で狭めているか。
 *
 * 自分の列は**その列**で狭めていること(以前からの判定)。祖先の束は、束のどれかの列か、
 * 同じ境界の欄で狭めていること —— 束に入らない別の祖先の列(3 段目の写しなど)で同じ欄を
 * 比べていても、境界は閉じている。ただし実行者の集約を経た祖先の列は数えない(A4-2: 人の今の所属であって行のテナントではない)。
 */
function narrows(rule: ReadRule, candidate: BoundaryCandidate, viaActor: (filter: ReadFilter) => boolean): boolean {
  return (rule.filters ?? []).some(
    (filter) =>
      candidate.paths.includes(readFilterPath(filter)) ||
      (candidate.inherited && filter.actorField === candidate.boundary && !viaActor(filter)),
  );
}

/** 境界の欄が 0 本なのに、テナントの欄に見える実行者の参照の欄がある、という指摘 1 件(A5-4)。 */
function latentFinding(latent: LatentBoundary): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message:
      `境界の欄が 1 本もありません(actor.{欄} の使用も session: true の参照の欄も無い)が、実行者の集約 ${latent.aggregate} の参照の欄 ${latent.field.name}(ref(${latent.target}))は、` +
      `ほかの集約(${latent.sharedBy.join(' / ')})も同じ ${latent.target} を指すテナントの欄に見えます —— このままでは V20 / V26 は何も見ていません`,
    location: latent.field.location,
    suggestion:
      `${latent.target} がテナントなら ${latent.aggregate}.${latent.field.name} に session: true を付け、各表の reads の filters と書き込みの when で actor.${latent.field.name} に結ぶ。` +
      `テナントでないなら、その欄に "not_boundary: {なぜ見える行を狭めないか}" を書いて外す`,
    counterexample: { entity: latent.aggregate, field: latent.field.name, target: latent.target, kind: 'latent_boundary' },
  };
}
