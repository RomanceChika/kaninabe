/**
 * V11 ロール接地チェック。
 *
 * domain-spec-writing.md の V11:「by / reads / creates / writes / deletes / fields_hidden.from に出るロールが
 * roles.md に定義され、文脈依存ロールの binding がそのエンティティから解決可能」。
 * `fields_hidden.from` はさらに、その access_spec の reads に現れ、内部実行のロールでないこと
 * (`v11-hidden-from.ts`。綴り違いのロールはどの読み取り規則も外さず、隠したつもりの列が素で出る)。
 *
 * 3 つの独立した観点を見る。
 * 1. 未定義ロールの使用(タイプミス・roles.md への追加漏れ)。
 * 2. 文脈依存ロール(binding を持つロール)を使う集約から、binding が参照するエンティティへ
 *    **`context` の連鎖で 2 段までに届くか**。届かなければ、実行時に「誰がそのロールか」を
 *    判定できない。直接の宣言だけを見ていたあいだ、木の各段に写しの列(`{起点}.{相手}_id`)と
 *    それを埋めるトリガと一致を守る不変条件が要っていた(束 ⑱ の実測 → 束 ⑲-2a)。
 * 3. **文脈依存ロールの binding が実行者の同一性と比べているか**(束 ⑲-2a)。`actor.{欄}`
 *    (セッションに載る欄)は式の語彙として開いたが、**ロールの binding では使えない** ——
 *    スコープ条件の生成(`code-query-windows.ts`)と保存点の `permit` はどちらも「その列を実行者の id と
 *    比べる」形に落ちており、別の値と比べる binding は**黙ってスコープ条件が生成されない**(宣言より
 *    広い集合が返る)か Y10 で止まる。テナントの境界のような「実行者の属性で絞る」宣言は
 *    ロールではなく **access_spec の `reads[].filters`**(可視性)と **`when` のガード**
 *    (書き込み)で書く —— そちらは実行器の枝を増やさずに写せる。
 * 4. **実行者自身の行の欄が根拠のロール(`claim`)が指す欄が接地しているか**(束 ⑰)。
 *    指せるのは `session: true` を宣言した boolean / enum / state の欄だけである —— セッションに
 *    載る値でなければ「DB を読まずに解決できる」が成り立たず、他の型では「立つ / 立たない」を
 *    仕組み側が推測で決めることになる(dsl-extension-triage.md §軸と語)。enum / state の欄は
 *    立つ値(`== {値}` / `in [{値}, ...]`)を添え、その値が欄の値域にあること(ADR-0018)。
 * 5. **`binding` / `claim` を持つロールが含意できるのは `kind` を持つロールだけ**(束 ⑳-3b)。
 *    DB が `by` を照合するとき、対象の行から立つロール(`binding` / `claim`)は行を見て評価するが、
 *    それ以外は**実行者が渡すロール配列**(`p_actor_roles`)の中身しか見ない。保存点は手順ごとに
 *    立ったロールの**和**を 1 つの配列にして全手順へ渡すので、対象の行から立ったロールが素の
 *    特権ロールを含意すると、**後段の手順で成立した束縛が前段の手順のロール判定を通す**
 *    (⑳-3 の独立レビュー 2-A)。`kind` のロール(未ログイン / 認証済みの既定 / システム)は
 *    実行者そのものの属性なので、含意しても同じ問題を起こさない。
 *
 * reads は全ロールについて明示が必須(V4)なので、`scope: none`(何も許可していない)の
 * 宣言は context 解決を要求しない。権限を与えている使用箇所だけを接地の対象とする。
 */

import type { SpecModel, AggregateSpecs, RoleDef } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { Verifier, VerifyContext } from '../../check-api/contract.js';
import { impliedRoles } from '../../model/role-hierarchy.js';
import { checkClaim, checkClaimConflict } from './v11-claim-grounding.js';
import { checkHiddenFrom } from './v11-hidden-from.js';
import { contextRoutesTo } from './v11-reachability.js';
import type { RoleUsage } from './v11-findings.js';
import { ambiguousContextFinding, missingContextFinding, undefinedRoleFinding } from './v11-findings.js';

/** 1 集約の中でロールが使われている箇所をすべて列挙する。 */
function collectUsages(aggregate: string, specs: AggregateSpecs): RoleUsage[] {
  const usages: RoleUsage[] = [];
  for (const machine of specs.stateMachines) {
    for (const event of machine.events) {
      for (const roleId of event.by) {
        usages.push({
          roleId,
          where: `${machine.machine}.${event.id} の by`,
          location: event.location,
          grantsAccess: true,
        });
      }
    }
  }
  for (const read of specs.access?.reads ?? []) {
    usages.push({
      roleId: read.by,
      where: `${aggregate} の reads`,
      location: read.location,
      grantsAccess: read.scope.kind !== 'none',
    });
  }
  for (const create of specs.access?.creates ?? []) {
    usages.push({
      roleId: create.by,
      where: `${aggregate} の creates`,
      location: create.location,
      grantsAccess: true,
    });
  }
  for (const write of specs.access?.writes ?? []) {
    usages.push({
      roleId: write.by,
      where: `${aggregate} の writes`,
      location: write.location,
      grantsAccess: true,
    });
  }
  for (const del of specs.access?.deletes ?? []) {
    usages.push({
      roleId: del.by,
      where: `${aggregate} の deletes`,
      location: del.location,
      grantsAccess: true,
    });
  }
  // 隠し列の相手は権限を与えない(取り上げる側)。未定義のロールは誰からも隠さないので、実在だけを見る。
  for (const hidden of specs.access?.fieldsHidden ?? []) {
    for (const roleId of hidden.from) {
      usages.push({
        roleId,
        where: `${aggregate} の fields_hidden(${hidden.field})の from`,
        location: hidden.location,
        grantsAccess: false,
      });
    }
  }
  return usages;
}

/**
 * binding 式が参照する「自エンティティ以外のエンティティ名」を取り出す。
 *
 * `actor` は実行者そのものを指す予約パス、単一セグメントのパスは自エンティティのフィールドと見なし、
 * どちらも context 解決の対象外とする。パースできない binding は空配列を返す(V9/V2 の担当)。
 *
 * @param role 対象の文脈依存ロール
 * @param ownNames 自集約を指す名前(エンティティ名・集約名)
 * @param ctx ガードサービス(パースとパス収集に使う)
 * @returns context に解決パスが必要なエンティティ名(重複排除・出現順)
 */
function requiredContextEntities(role: RoleDef, ownNames: ReadonlySet<string>, ctx: VerifyContext): string[] {
  if (role.binding === undefined) return [];
  const parsed = ctx.guards.parse(role.binding);
  if (!parsed.ok) return [];
  const required = new Set<string>();
  for (const path of ctx.guards.collectPaths(parsed.expr)) {
    const head = path.segments[0];
    if (head === undefined || path.segments.length < 2) continue;
    if (head === 'actor' || head === 'now' || ownNames.has(head)) continue;
    required.add(head);
  }
  return [...required];
}

/** 1 集約分のロール使用を検証する。 */
function checkAggregate(
  model: SpecModel,
  aggregate: string,
  specs: AggregateSpecs,
  roles: ReadonlyMap<string, RoleDef>,
  ctx: VerifyContext,
): Finding[] {
  const knownRoles = [...roles.keys()];
  const entity = specs.entity;
  const ownNames = new Set<string>([aggregate, ...(entity === undefined ? [] : [entity.entity])]);
  const findings: Finding[] = [];

  for (const usage of collectUsages(aggregate, specs)) {
    const role = roles.get(usage.roleId);
    if (role === undefined) {
      findings.push(undefinedRoleFinding(usage, knownRoles));
      continue;
    }
    if (!usage.grantsAccess) continue;
    for (const required of requiredContextEntities(role, ownNames, ctx)) {
      const routes = contextRoutesTo(model, aggregate, required);
      if (routes.length === 0) {
        findings.push(missingContextFinding(usage, aggregate, role, required));
        continue;
      }
      // 届くことと「どこへ届くかが決まること」は別である(束 ⑲-2a)。
      if (routes.length > 1) findings.push(ambiguousContextFinding(usage, aggregate, role, required, routes));
    }
  }
  if (specs.access !== undefined) findings.push(...checkHiddenFrom(specs.access, roles));
  return findings;
}

/**
 * 文脈依存ロールの `binding` が `actor.id`(実行者の同一性)と比べていること。
 *
 * 右辺が `actor.{欄}`(セッションに載る欄)だと、スコープ条件の生成も保存点の `permit` も写せない。
 * 「実行者の属性で絞る」のは可視性(`reads[].filters`)と書き込みの条件(`when`)の仕事である。
 */
function checkBindingActor(role: RoleDef, ctx: VerifyContext): Finding[] {
  const binding = role.binding;
  if (binding === undefined) return [];
  const parsed = ctx.guards.parse(binding);
  if (!parsed.ok) return [];
  const paths = ctx.guards.collectPaths(parsed.expr);
  const bad = paths
    .filter((path) => path.segments[0] === ACTOR_ROOT && path.segments[1] !== ACTOR_ID_FIELD)
    .map((path) => path.segments.join('.'));
  if (bad.length === 0) return [];
  // 対処の例は**この binding の名前**から組む(仕組み側が具体のアプリの語を持たないため)。
  const actorField = bad[0]?.split('.')[1] ?? '{欄}';
  const target = paths.find((path) => path.segments[0] !== ACTOR_ROOT && path.segments.length >= 2);
  const targetEntity = target?.segments[0] ?? '{対象}';
  const targetColumn = target?.segments[target.segments.length - 1] ?? '{列}';
  return [
    {
      verifier: 'V11',
      severity: 'error',
      message: `ロール ${role.id} の binding が ${bad.join(' / ')} を参照しています(binding が見られるのは actor.id だけです)`,
      location: role.location,
      suggestion:
        '実行者の属性で絞りたいなら、ロールではなく access_spec に書く —— 可視性なら ' +
        `reads[].filters(例: filters: { ${targetColumn}: actor.${actorField} })、書き込みなら ` +
        `creates / writes / deletes の when(例: when: "${targetEntity}.${targetColumn} == actor.${actorField}")。` +
        'binding は「この対象に対して誰がそのロールか」を実行者の同一性で答える宣言であり、' +
        'スコープ条件の生成と保存点の `permit` はどちらもその形を前提にしている',
      counterexample: { role: role.id, binding, paths: bad.join(', ') },
    },
  ];
}

/** 予約語 `actor` と、binding が比べてよい 1 語。 */
const ACTOR_ROOT = 'actor';
const ACTOR_ID_FIELD = 'id';

/**
 * 対象の行から立つロールが、素の特権ロールを含意していないこと(束 ⑳-3b)。
 *
 * 見るのは**推移閉包**である —— 実行者が渡すロール配列は `implies` で閉じた集合なので(`actor.ts` の
 * `resolveActorRoles`)、2 段先で素のロールに届く宣言でも同じ穴が開く。
 */
function checkImpliesKind(roles: readonly RoleDef[], role: RoleDef): Finding[] {
  if (role.binding === undefined && role.claim === undefined) return [];
  const byId = new Map(roles.map((candidate) => [candidate.id, candidate]));
  const plain = [...impliedRoles(roles, role.id)].filter((id) => byId.get(id)?.kind === undefined);
  if (plain.length === 0) return [];
  return [
    {
      verifier: 'V11',
      severity: 'error',
      message:
        `ロール ${role.id}(対象の行から立つロール)が ${plain.join(' / ')} を含意しています` +
        '(含意できるのは kind を持つロールだけです)',
      location: role.location,
      suggestion:
        'DB が見るのは「実行者が渡すロールの配列」だけであり、その配列は保存点では手順ごとの' +
        '和になる —— 対象の行から立ったロールが素のロールを含意すると、後段の手順で成立した' +
        '束縛が前段の手順のロール判定を通す。含意ではなく、そのロールを許したい宣言の by に' +
        '並べる(access_spec / state_spec)か、条件は when に書く',
      counterexample: { role: role.id, implies: plain.join(', ') },
    },
  ];
}

/** V11: ロールが定義済みで、文脈依存ロール・claim ロールが解決可能かを検証する。 */
export const roleGroundingVerifier: Verifier = {
  id: 'V11',
  title: 'ロール接地 — 使用ロールの定義と、文脈依存ロール / claim ロールの解決可能性・含意先',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    const roles = new Map<string, RoleDef>(model.roles.roles.map((role) => [role.id, role]));
    const findings: Finding[] = [];
    for (const [aggregate, specs] of model.aggregates) {
      findings.push(...checkAggregate(model, aggregate, specs, roles, ctx));
    }
    for (const role of model.roles.roles) {
      findings.push(
        ...checkClaim(model, role),
        ...checkClaimConflict(model.roles.roles, role),
        ...checkBindingActor(role, ctx),
        ...checkImpliesKind(model.roles.roles, role),
      );
    }
    return findings;
  },
};
