/**
 * access_spec の `reads` → **RLS ポリシーの計画**(名前・宛先ロール・スコープ・境界)。
 *
 * 期待ポリシー名の表(`code-rls-expectations`)と**ポリシー本文**(`code-rls-policies`)は、
 * どちらもここが返す 1 つの計画から出る。束 ⑳-4a までは名前だけを別の関数が作っていたので、
 * 「名前は出るが本文は出ない」「刈り込みの規則が名前と本文で違う」という割れ方がありえた ——
 * 同じ計画を 2 度導出しないことで、その形を構造的に無くす。
 *
 * 名前の規約と刈り込みの規則の正は ARCH-SP-BE-0001 §RLS の仕様をどこに置くか。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, ReadFilter, ReadRule, ReadScope, RoleDef } from '../model/types.js';
import {
  anonymousRoleId,
  impliedRoles,
  policyGranteeOf,
  rowConditionRoles,
  systemRoleId,
  type PolicyGrantee,
} from '../model/role-hierarchy.js';

export type { PolicyGrantee };

/** ポリシー 1 本の計画。 */
export interface PolicyPlan {
  /** ポリシー名(`{table}_select_{role}_{scope}[_within_{列}…]`)。 */
  readonly name: string;
  /** そのポリシーを与えるドメインのロール。 */
  readonly by: string;
  /** `create policy … to {ここ}`(役割。DB のロール名は SQL を書く側が設定から引く)。 */
  readonly to: PolicyGrantee;
  /** 原理としての行集合。 */
  readonly scope: ReadScope;
  /** 実行者の属性で狭める境界(宣言順)。 */
  readonly filters: readonly ReadFilter[];
  /**
   * 対象の行の状態で絞る条件(ガード式の生文字列。無ければ `null`。束 §14)。
   *
   * `filters` と同じく述語の論理積に入るが、見ている側が逆である —— `filters` は実行者の
   * 属性、こちらは対象の行の欄である。**ポリシー名には出ない** —— 名前に出せるのは列の名前の
   * ような短い語であって式ではなく、字面を名前に畳むと「同じ意味の別の書き方」で名前が割れる。
   * 条件が変わったことは、ポリシーを生成した migration の名前が変わることで出る(C23)。
   */
  readonly when: string | null;
}

/**
 * ログインセッションの生死を要求する**制限ポリシー**の名前(表ごとに 1 本。許可ポリシーの名前 `{table}_select_…` とは別の綴り)。
 *
 * @param table そのエンティティのテーブル名
 * @returns ポリシー名
 */
export function sessionPolicyName(table: string): string {
  return `${table}_session_alive`;
}

/**
 * 1 つの access_spec から、存在すべき select ポリシーの計画を宣言順に並べる。
 *
 * @param access その集約のアクセス宣言
 * @param table そのエンティティのテーブル名(ポリシー名の接頭辞になる)
 * @param roles role_spec の全ロール定義(階層と根拠を引く)
 * @returns ポリシーの計画(宣言順)
 */
export function policyPlans(
  access: AccessSpec,
  table: string,
  roles: readonly RoleDef[],
): readonly PolicyPlan[] {
  return readPlans(access, table, roles).filter(
    (plan) =>
      !isCoveredByAll({ by: plan.by, scope: plan.scope }, unconditionalAllRoles(access, roles), roles),
  );
}

/**
 * 刈り込みの根拠になるロール —— **境界も状態の条件も持たない** `scope: all` だけである。
 *
 * `filters` / `when` を持つ行は狭いので、他の行を包含しない(包含したことにすると
 * **本人にも見えない行**が生まれる)。刈り込む側とその是非を見る側(`deadConditions`)が
 * 同じ 1 つの定義を読む。
 *
 * @param access その集約のアクセス宣言
 * @param roles role_spec の全ロール定義
 * @returns 無条件に全件読めるロール(宣言順)
 */
function unconditionalAllRoles(access: AccessSpec, roles: readonly RoleDef[]): readonly string[] {
  return access.reads
    .filter(
      (rule) =>
        rule.by !== systemRoleId(roles) &&
        rule.scope.kind === 'all' &&
        (rule.filters ?? []).length === 0 &&
        rule.when === undefined,
    )
    .map((rule) => rule.by);
}

/**
 * **刈り込む前**の、その行を読めるロールごとの計画(宣言順)。
 *
 * ポリシーは「同じ表を `scope: all` で読めるロールに包含される規則」を刈り込む —— 行の
 * 可視性としてはそれで正しいが、**列のマスク**(`fields_hidden`)はその刈り込みを使えない。
 * `from: [member]` は「`member` として読んでいる人には見せない」であり、`member: scope: all`
 * に包含されていた `organizer` の根拠こそがマスクを解く鍵だからである
 * (docs/design/api-views-generation.md §1-a)。
 *
 * @param access その集約のアクセス宣言
 * @param table そのエンティティのテーブル名(ポリシー名の接頭辞になる)
 * @param roles role_spec の全ロール定義
 * @returns 刈り込み前の計画(宣言順)
 */
export function readPlans(
  access: AccessSpec,
  table: string,
  roles: readonly RoleDef[],
): readonly PolicyPlan[] {
  // RLS をバイパスする内部実行ロール(role_spec の `kind: system`)。ポリシーを持たない。
  const bypassRole = systemRoleId(roles);
  return access.reads
    .filter((rule) => rule.by !== bypassRole && rule.scope.kind !== 'none')
    .map((rule) => ({
      name: `${table}_select_${rule.by}_${scopeSuffix(rule)}`,
      by: rule.by,
      to: policyGranteeOf(roles, rule.by),
      scope: rule.scope,
      filters: rule.filters ?? [],
      when: rule.when ?? null,
    }));
}

/** 効かない場所に書かれた状態の条件 1 件(束 §14 / 独立レビュー観点 1)。 */
export interface DeadCondition {
  /** その条件を書いた読み取り規則のロール。 */
  readonly by: string;
  /** 書かれた条件。 */
  readonly when: string;
  /**
   * なぜ効かないか。
   *
   * - `pruned`: 上界の規則(無条件の `scope: all`)に包含されてポリシーが出ない
   * - `invisible`: `scope: none` なのでそのロールのポリシーがそもそも無い
   * - `bypass`: RLS をバイパスする内部実行ロール(ポリシーを持たない)
   */
  readonly reason: 'pruned' | 'invisible' | 'bypass';
  /** 包含している上界の規則のロール(`pruned` のときだけ)。 */
  readonly coveredBy?: string;
}

/**
 * **書いても効かない `when`** を集める(ポリシーが 1 本も出ない読み取り規則の条件)。
 *
 * 可視性としては安全側である —— 包含する広い規則が既にその行を通しているので、隠せるものは
 * 何も無い。問題は**宣言が効いていないことが誰にも見えない**ことである: 刈り込まれた規則は
 * 期待ポリシー表にも `rlsPolicyConditions` にも出ないので `spec:diff` も黙り、world の側は
 * 反例の行を置くので挙動テストも緑になる。**`when` を買った目的そのもの**(「書いたのに効いて
 * いない宣言」を無くす)に反するので、T7 が error で報告する。
 *
 * 直し方は 1 つである —— **条件は上界の規則に書く**。`entry_owner: own` に書いても
 * `member: all` が無条件で同じ行を見せているなら 1 文字も効かない。
 *
 * @param access その集約のアクセス宣言
 * @param table そのエンティティのテーブル名
 * @param roles role_spec の全ロール定義
 * @returns 効かない条件(宣言順。無ければ空)
 */
export function deadConditions(
  access: AccessSpec,
  table: string,
  roles: readonly RoleDef[],
): readonly DeadCondition[] {
  const kept = new Set(policyPlans(access, table, roles).map((plan) => plan.by));
  const readsAll = unconditionalAllRoles(access, roles);
  const system = systemRoleId(roles);
  const found: DeadCondition[] = [];
  for (const rule of access.reads) {
    if (rule.when === undefined || kept.has(rule.by)) continue;
    const coveredBy = rule.by === system ? undefined : readsAll.find((role) => impliedRoles(roles, rule.by).has(role));
    found.push({
      by: rule.by,
      when: rule.when,
      reason: rule.by === system ? 'bypass' : coveredBy === undefined ? 'invisible' : 'pruned',
      ...(coveredBy === undefined ? {} : { coveredBy }),
    });
  }
  return found;
}

/**
 * その計画たちが要求する **RLS 補助関数のロール**(宣言順・重複なし)。
 *
 * 補助関数が要るのは「グローバルに立つロール」のうち未ログイン以外である ——
 * 未ログインの根拠は Postgres ロール `anon` そのもの(`to anon`)であって、関数で判定する
 * ものが 1 つも無い。対象の行との関係で立つロール(`binding`)は列比較 / EXISTS で書ける。
 * ただし、そのロールが `implies` する先に行の条件(`claim`)を持つロールがあれば、その補助関数も要る
 * (ポリシーの述語は自分の根拠 AND 含意の先の行の条件になる。ADR-0018)。
 *
 * @param plans ポリシーの計画
 * @param roles role_spec の全ロール定義
 * @returns 補助関数が要るロール ID
 */
export function helperRoles(plans: readonly PolicyPlan[], roles: readonly RoleDef[]): readonly string[] {
  const anonymous = anonymousRoleId(roles);
  const needed: string[] = [];
  for (const plan of plans) {
    const role = roles.find((candidate) => candidate.id === plan.by);
    if (role === undefined) continue;
    // 自分の根拠と、含意の先の行の条件(`claim`。ポリシーが論理積で足す。ADR-0018)。
    for (const wanted of [role, ...rowConditionRoles(roles, role.id)]) {
      if (needsHelper(wanted, anonymous) && !needed.includes(wanted.id)) needed.push(wanted.id);
    }
  }
  return needed;
}

/**
 * そのロールの根拠を**補助関数**に写すか。
 *
 * @param role ロール定義
 * @param anonymousRole 未ログインのロール ID(`anonymousRoleId` で引いたもの)
 * @returns 補助関数が要るなら true
 */
export function needsHelper(role: RoleDef, anonymousRole: string | undefined): boolean {
  return role.binding === undefined && role.id !== anonymousRole;
}

/**
 * 補助関数の名前(ロール ID から機械的に決まる)。
 *
 * @param role ロール ID
 * @returns 関数名(スキーマ修飾なし)
 */
export function helperName(role: string): string {
  return `is_${role}`;
}


/**
 * その読み取り規則が、同じテーブルの `scope: all` の行に包含されるか。
 *
 * @param rule 判定する読み取り規則
 * @param readsAll そのテーブルを全件読めるロール
 * @param roles ロール階層(implies)を引くための全ロール定義
 * @returns 包含されるなら true
 */
function isCoveredByAll(
  rule: { readonly by: string; readonly scope: ReadScope },
  readsAll: readonly string[],
  roles: readonly RoleDef[],
): boolean {
  if (rule.scope.kind === 'all') return false;
  const implied = impliedRoles(roles, rule.by);
  return readsAll.some((role) => implied.has(role));
}

/**
 * ポリシー名の末尾に使うスコープ表記(context(entity) は対象を落として context にする)。
 *
 * `filters` があれば `_within_{列}`(親の列なら `_within_{集約}_{列}`)を宣言順に足す。境界を名前に出すのは、名前の突合だけを
 * 見る読み手にも「その列で狭めているはず」が読めるようにするためである(本文の突合は
 * `policy-parity` が別に持つ)。
 */
function scopeSuffix(rule: ReadRule): string {
  const base = rule.scope.kind === 'context' ? 'context' : rule.scope.kind;
  // 親の列で狭める境界は集約の名前も付ける(同じ名前の列が自集約と親の両方にあっても名前が割れる)。
  const within = (rule.filters ?? [])
    .map((filter) => `_within_${filter.entity === undefined ? '' : `${filter.entity}_`}${filter.field}`)
    .join('');
  return `${base}${within}`;
}
