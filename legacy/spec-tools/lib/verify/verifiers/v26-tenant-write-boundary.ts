/**
 * V26 テナント境界の宣言漏れ(書き込みの側)。
 *
 * V20 は**読み取り**の境界(`reads[].filters`)の書き忘れを止める。書き込みの側 —— `creates` / `writes` /
 * `deletes` の `when` —— にも同じ穴がある。作成は境界の列(例: 会社)を**入力で受ける**ことが多く、
 * `when` がそれを実行者の属性に結んでいなければ、**他のテナントの行を作れる**(題材 stores の商品の作成が
 * 実例: 会社管理者が他社の商品を作れた)。編集・削除も、`when` が対象の行の境界を実行者の属性に結んでいなければ
 * 他のテナントの行に届く。読み取りが閉じていても、書き込みが開いていれば境界は無いのと同じである。
 *
 * ## 何を見るか
 *
 * V20 と同じ目で境界を導く(`tenant-boundary-model.ts`): どこかで `actor.{欄}` として使われている欄を表す列を
 * 持つエンティティ、または自分は持たないが `context` で辿れる祖先が持つエンティティ。その書き込みの規則
 * (`creates` / `writes` / `deletes`)の `when` が、**トップレベルの `and` の項**として
 * 「境界の列 == actor.{欄}」を持っていなければ error。
 *
 *   - **入力から来る自分の列**は、その列そのものを結ぶ(祖先の列で結んでも、入力の列は別の値でありうる)。
 *   - **作成**では、**入力の参照の欄を経て届く祖先の境界の列も、欄ごとに結ぶ**(同じ欄を経て届く祖先はどれか 1 本でよい)。
 *     「どれか 1 本」が成り立つのは、ほかの祖先の参照が DB の写し(`supplied_by: db`)のときだけである —— 入力で受けた別の親を結ばなければ、
 *     結んだ親の会社の行が、結ばない親(別の会社)を指せてしまう。実行者に縛られる参照の欄(持ち主など)の先は実行者の集約そのものなので除く。
 *   - 作成では、DB が埋める**自分の**列は結んだことに数えない(まだ行が無いので、`when` が読めない)。
 *   - DB が埋める自分の列だけ・DB の写しの祖先だけを持つ編集・削除は、その列か祖先の列のどれかを結べばよい。
 *   - `or` / `not` の中の比較は数えない。`==` 以外も数えない。
 *
 * ## 受け入れ
 *
 * V20 と同じ `accept: [{ by, filter, reason }]`。ただし**書き込みは既定で受け入れない** —— 読み取りで跨がない理由は書き込みで
 * 跨がない理由とは限らないので、書き込みも受け入れる規則の種類を `on: [create, write, delete]` で名指す。
 *
 * ## 一意の範囲(A12-3)
 *
 * `uniqueness` / `exclusion` / `cardinality` の鍵が境界を落とし、鍵の欄を人の入力で書ける形は error(受け入れは `formal.global_key` と理由)。部品は `v26-unique-keys.ts`。
 *
 * ## 報告の重さ
 *
 *   - 実行者のいるロールの規則: **error**。
 *   - 実行者が供給されないロール(未ログイン・システム起点)の規則: **warning** —— 境界を結びようがないので error にはしないが、
 *     テナントを持つ集約へ書けるのに誰も理由を言っていない形を黙って通さない(受け入れは `on` つきの `accept`)。
 *   - 書き込みの規則はあるのに、境界の列を導けない集約(境界の欄がモデルにあるのに): **warning** —— V20 / V26 の死角。
 *
 * ## 編集で持ち主を動かす口(付け替え)
 *
 * `writes` の `fields` が自分の境界の列、または境界を持つ祖先への入力の参照の欄を含むと、`when`(今ある行を読む)だけでは
 * 書いたあとの行のテナントを保証できない。**執行点が実在する不変条件**(data_table の check / trigger が `invariant` で名指す・
 * 呼び出し口のある application)がその欄を**ちょうど**結ぶ(`check` の式の `and` の必須の項に、自分の境界の列と親の境界の列の等式がある。
 * 式に列が現れるだけの `!=`・`or`・`not` は結ばない。自分の境界の列と親の参照の欄を同じ編集で書けるときは、2 つを一緒に動かせるので結べない)か、
 * `accept`(`on: [write]` と理由)が無ければ error。部品は `v26-write-retarget.ts`。
 *
 * ## 状態遷移(A3-1)
 *
 * 遷移は境界の列を人の入力で書く口ではないが、**他のテナントの行を動かす**こと(取消・承認)そのものは書き込みである。
 * `by` に対象に依らず立つロール(既定のログインロール・`claim`)がある遷移は、`guard` のトップレベルの `and` の項に
 * 「境界の列 == actor.{欄}」を持たなければ error(binding のロール・システム起点は対象外。未ログインは warning(A4-3)。受け入れは
 * `on: [transition]` と、受け入れる遷移を名指す `events`(A4-4))。部品は `v26-transition-boundary.ts`。
 *
 * ## 境界の根と実行者の集約(A4-1 / A4-2)
 *
 * 境界の根(境界の欄の参照先。`ref(company)` なら `company`)は `id` を境界の列として扱う(`company.id == actor.company_id`)。
 * 実行者の集約を経た祖先の列(起案者の所属など)は境界にしない —— 人の今の所属であって、行のテナントではない。
 *
 * **この検査はテナントの語を 1 つも持たない。**
 */

import type { AccessSpec, CreateRule, EntitySpec, SourceLocation, SpecModel, WriteAcceptKind } from '../../model/types.js';
import { inputValue } from '../../kernel/input-state.js';
import { actorBoundFields, createInputFields, ruleBoundFields } from '../../usecase/actor-bound.js';
import type { GuardExpr } from '../../guard/ast.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';
import { ACTORLESS_ROLE_KINDS, boundaryFields, type BoundaryField } from './tenant-boundary-model.js';
import { writeCandidates, type WriteCandidate } from './v26-write-candidates.js';
import { retargetsOf, tiedByInvariant } from './v26-write-retarget.js';
import { checkTransitions } from './v26-transition-boundary.js';
import { checkUniqueKeys } from './v26-unique-keys.js';
import { blindSpot, retargetFinding, unbindableFinding } from './v26-write-findings.js';
import { tenantColumns } from './tenant-boundary-model.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'V26';

/** 書き込みの規則の種類(access_spec のキー)と、受け入れ(`on`)での名前。 */
const WRITE_KEYS = [
  { key: 'creates', accept: 'create' },
  { key: 'writes', accept: 'write' },
  { key: 'deletes', accept: 'delete' },
] as const satisfies readonly { readonly key: 'creates' | 'writes' | 'deletes'; readonly accept: WriteAcceptKind }[];
type WriteKey = (typeof WRITE_KEYS)[number]['key'];

/** 書き込みの規則 1 本のうち、この検査が読む部分。 */
interface WriteRule {
  readonly by: string;
  readonly when?: string;
  /** 編集する欄(`writes` だけ)。 */
  readonly fields?: readonly string[];
  readonly location: SourceLocation;
}

/** V26: 書き込みの規則の `when` が境界の列を実行者の属性に結んでいるかを見る。 */
export const tenantWriteBoundaryVerifier: Verifier = {
  id: VERIFIER_ID,
  title: 'テナント境界(書き込み) — creates / writes / deletes の when・遷移の guard が境界の列を実行者の属性に結んでいるか',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    const boundaries = boundaryFields(model, ctx);
    const keyFindings = checkUniqueKeys(model, boundaries, ctx);
    if (boundaries.length === 0) return keyFindings;
    const roleKinds = new Map(model.roles.roles.map((role) => [role.id, role.kind]));
    const findings: Finding[] = [...keyFindings];
    for (const specs of model.aggregates.values()) {
      const entity = specs.entity;
      const access = specs.access;
      if (entity === undefined || access === undefined) continue;
      const createAction = inputValue(ctx.actions)?.actions.find((action) => action.handles.raw === `${entity.entity}.create`);
      const createInputs = createAction === undefined ? null : createInputFields(inputValue(ctx.actions), entity.entity);
      const forCreate = writeCandidates(model, entity, boundaries, true, createInputs);
      const forOthers = writeCandidates(model, entity, boundaries, false);
      const events = specs.stateMachines.flatMap((machine) => machine.events);
      if (forOthers.length === 0) {
        // 書き込みも遷移も結ぶ候補が無い。死角は遷移も数えて名指す(A4-1: 以前は遷移だけの集約が警告すら出なかった)。
        findings.push(...blindSpot(access, events.length));
        continue;
      }
      const actorFields = actorBoundFields(model, entity.entity, createInputFields(inputValue(ctx.actions), entity.entity));
      for (const { key, accept } of WRITE_KEYS) {
        const candidates = key === 'creates' ? forCreate : forOthers;
        for (const rule of access[key] as readonly WriteRule[]) {
          const kind = roleKinds.get(rule.by);
          const actorless = kind !== undefined && ACTORLESS_ROLE_KINDS.has(kind);
          // 作成の規則が実行者に縛る参照の欄(持ち主など)の先は実行者の集約そのもの —— その会社を改めて結ぶ必要は無い。
          const pinned = key === 'creates' ? new Set(ruleBoundFields(rule as CreateRule, model.roles.roles, actorFields)) : new Set<string>();
          findings.push(...checkRule({ model, entity, access, boundaries }, key, accept, rule, applicable(candidates, key, rule, pinned), actorless, ctx));
          if (key === 'writes' && !actorless) findings.push(...checkRetargets(model, entity, access, rule, boundaries, ctx));
        }
      }
      findings.push(
        ...checkTransitions(
          { model, access, events, candidates: forOthers, ctx, conjunctsOf: (expression) => conjunctsOf(expression, ctx), binds },
          VERIFIER_ID,
        ),
      );
    }
    return findings;
  },
};

/**
 * 入力の参照の欄を経て届く候補は作成にだけ当てはめる(実行者に縛られる参照の欄の先は除く)。
 *
 * 編集・削除の `when` が読む親は**今ある行の親**であり、編集で付け替える新しい親ではない(新しい値は `when` から見えない)。
 * 付け替えた先の会社は `checkRetargets` が別に見る(境界の列・境界を持つ親への参照の欄を `fields` に含む編集は、
 * 実在する執行点を持つ不変条件か `accept` が無ければ error)。
 */
function applicable(
  candidates: readonly WriteCandidate[],
  key: WriteKey,
  rule: WriteRule,
  pinned: ReadonlySet<string>,
): readonly WriteCandidate[] {
  return candidates.filter((candidate) => {
    if (candidate.via === null) return true;
    if (pinned.has(candidate.via)) return false;
    return key === 'creates';
  });
}

/**
 * 編集が行の持ち主(境界の列・境界を持つ祖先への参照の欄)を書き換えられるとき、旧い値への `when` だけでは足りない。
 *
 * `when` は今ある行を読むので、書いたあとの行の境界は保証されない。塞ぐのは (a) 付け替えの口を結ぶ、執行点が実在する不変条件
 * (`v26-write-retarget.ts`)か (b) `accept`(`on: [write]` と理由)。どちらも無ければ error。編集で持ち主を動かす必要が
 * 無ければ、その欄を `fields` から外すのが定石である(作成のときにだけ入力で受ける)。
 */
function checkRetargets(
  model: SpecModel,
  entity: EntitySpec,
  access: AccessSpec,
  rule: WriteRule,
  boundaries: readonly BoundaryField[],
  ctx: VerifyContext,
): Finding[] {
  const findings: Finding[] = [];
  for (const retarget of retargetsOf(model, entity, boundaries, rule.fields ?? [])) {
    if (tiedByInvariant(model, entity, retarget, ctx)) continue;
    if (access.accepts.some((entry) => entry.by === rule.by && (entry.on ?? []).includes('write') && retarget.acceptFields.includes(entry.field))) continue;
    findings.push(retargetFinding(access, rule, retarget));
  }
  return findings;
}

/** 規則 1 本 × 境界の候補ごとに、`when` が結んでいるかを見る。 */
function checkRule(
  target: { readonly model: SpecModel; readonly entity: EntitySpec; readonly access: AccessSpec; readonly boundaries: readonly BoundaryField[] },
  key: WriteKey,
  accept: WriteAcceptKind,
  rule: WriteRule,
  candidates: readonly WriteCandidate[],
  actorless: boolean,
  ctx: VerifyContext,
): Finding[] {
  const { model, entity, access, boundaries } = target;
  const terms = conjunctsOf(rule.when, ctx);
  // 読めない式は V2 / V9 が error で報告する(ここで二重に言わない)。
  if (terms === null) return [];
  const findings: Finding[] = [];
  for (const candidate of actorless ? candidates.slice(0, 1) : candidates) {
    if (!actorless && binds(terms, candidate)) continue;
    if (accepted(access, rule.by, accept, candidate)) continue;
    if (!actorless && candidate.tiePaths !== undefined && tiedByInvariant(model, entity, { pairs: tiePairs(entity, boundaries, candidate) }, ctx)) continue;
    if (!actorless && candidate.bindPaths.length === 0) {
      findings.push(unbindableFinding(access, key, accept, rule, candidate));
      continue;
    }
    const column = candidate.acceptFields[0] ?? '';
    const path = candidate.bindPaths[0] ?? '';
    const acceptText =
      `access_spec に "accept: [{ by: ${rule.by}, filter: ${column}, on: [${accept}], reason: {なぜ跨がないか} }]" を足して受け入れてください` +
      '(受け入れは既定で読み取りだけに効く。書き込みは on で種類を名指す)';
    findings.push({
      verifier: VERIFIER_ID,
      severity: actorless ? 'warning' : 'error',
      message: actorless
        ? `${access.entity} の ${key}(by: ${rule.by})は、実行者の属性が供給されないロールで、実行者の属性を表す列 ${column} を持つ行を書けます —— ` +
          'テナントを跨ぐかどうかを誰も宣言していません'
        : `${access.entity} の ${key}(by: ${rule.by})は、実行者の属性を表す列 ${column} を ` +
          `actor.${candidate.boundary} に結ぶ when を持っていません —— 他のテナントの行を書ける形です`,
      location: rule.location,
      suggestion: actorless
        ? `内部実行・未ログインの書き込みがテナントを跨ぐ理由(または跨がない理由)を、${acceptText}`
        : `when に "${path} == actor.${candidate.boundary}" を and の項として足して境界を結ぶか` +
          (candidate.bindPaths.length > 1 ? `(結べる列: ${candidate.bindPaths.join(' / ')})` : '') +
          `、他のテナントに届かない理由が別にあるなら ${acceptText}`,
      counterexample: { entity: access.entity, key, by: rule.by, column, boundary: candidate.boundary },
    });
  }
  return findings;
}

/** `context` に無い入力の参照の欄を結ぶ不変条件の列の組(自分の境界の列 × 参照先の境界の列)。 */
function tiePairs(entity: EntitySpec, boundaries: readonly BoundaryField[], candidate: WriteCandidate): readonly (readonly [string, string])[] {
  const boundary = boundaries.filter((entry) => entry.name === candidate.boundary);
  return tenantColumns(entity, boundary).flatMap((column) =>
    (candidate.tiePaths ?? []).map((path): readonly [string, string] => [`${entity.entity}.${column}`, path]),
  );
}

/** その規則・列を名指し、この種類の書き込みを受け入れる `accept` があるか。 */
function accepted(access: AccessSpec, by: string, kind: WriteAcceptKind, candidate: WriteCandidate): boolean {
  return access.accepts.some(
    (entry) => entry.by === by && (entry.on ?? []).includes(kind) && candidate.acceptFields.includes(entry.field),
  );
}

/**
 * `when` のトップレベルの `and` の項(`or` / `not` の中は項に数えない)。
 *
 * @returns `when` が無ければ空(= 何も結んでいない)、読めなければ null
 */
function conjunctsOf(when: string | undefined, ctx: VerifyContext): readonly GuardExpr[] | null {
  if (when === undefined) return [];
  const parsed = ctx.guards.parse(when);
  if (!parsed.ok) return null;
  const terms: GuardExpr[] = [];
  const stack: GuardExpr[] = [parsed.expr];
  for (let expr = stack.pop(); expr !== undefined; expr = stack.pop()) {
    if (expr.kind === 'and') stack.push(expr.left, expr.right);
    else terms.push(expr);
  }
  return terms;
}

/** 項のどれかが「候補の列 == actor.{欄}」(どちらの辺でもよい)か。 */
function binds(terms: readonly GuardExpr[], candidate: WriteCandidate): boolean {
  return terms.some((term) => {
    if (term.kind !== 'compare' || term.op !== '==' || term.rhs.kind !== 'path') return false;
    const left = term.path.segments.join('.');
    const right = term.rhs.path.segments.join('.');
    const actor = `actor.${candidate.boundary}`;
    return (left === actor && candidate.bindPaths.includes(right)) || (right === actor && candidate.bindPaths.includes(left));
  });
}
