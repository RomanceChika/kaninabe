/**
 * ロール階層(`roles[].implies`)を辿る純粋モジュール。
 *
 * `implies` は「このロールを持つ主体は、列挙されたロールも**必ず**持つ」という宣言であり
 * (RBAC のロール階層)、権限の包含関係を機械が推論するために使う。
 * 現在の用途は期待 RLS ポリシー表の刈り込み(`scope: all` のロールに含意されるロールの
 * own / context ポリシーは、行集合として包含されるので作らない)。
 *
 * 宣言の妥当性(参照先の実在・循環の禁止)はパーサー(parse-role.ts)が検査する。
 * ここは循環があっても停止するよう訪問済み集合で守る(検証の前に呼ばれ得るため)。
 */

import type { RoleDef, RoleKind } from './types.js';
import type { RowCondition } from './role-claim.js';
import { addCondition, rowConditionOf } from './role-claim.js';

/** ロール ID → その宣言。 */
function indexRoles(roles: readonly RoleDef[]): ReadonlyMap<string, RoleDef> {
  return new Map(roles.map((role) => [role.id, role]));
}

/**
 * あるロールが(推移的に)含意するロールをすべて集める。
 *
 * @param roles roles.md の全ロール定義
 * @param id 起点のロール ID
 * @returns 含意されるロール ID の集合(起点自身は含まない)
 */
export function impliedRoles(roles: readonly RoleDef[], id: string): ReadonlySet<string> {
  const byId = indexRoles(roles);
  const found = new Set<string>();
  const walk = (current: string): void => {
    for (const next of byId.get(current)?.implies ?? []) {
      if (next === id || found.has(next)) continue;
      found.add(next);
      walk(next);
    }
  };
  walk(id);
  return found;
}

/**
 * あるロールが立つために**併せて満たさなければならない行の条件**を持つロール(含意の先で `claim` を持つもの)。
 *
 * ロール階層は「A は必ず B でもある」の宣言であり、B が行の条件(`claim`。実行者自身の行の欄)を
 * 持つなら、A が立つのは**その条件を満たすときだけ**でなければならない(ADR-0018 の E2)。
 * 条件を持たない含意(`claim` の無いロール)は何も足さない —— 宣言しなければ生成物は変わらない。
 * 順序は含意を辿った順(宣言順に深さ優先)で、同じ入力からは同じ並びになる。
 *
 * @param roles roles.md の全ロール定義
 * @param id 起点のロール ID
 * @returns 行の条件を持つ、含意されるロール(起点自身は含まない)
 */
export function rowConditionRoles(roles: readonly RoleDef[], id: string): readonly RoleDef[] {
  const byId = indexRoles(roles);
  const found: RoleDef[] = [];
  for (const implied of impliedRoles(roles, id)) {
    const role = byId.get(implied);
    if (role?.claim !== undefined) found.push(role);
  }
  return found;
}

/**
 * `implies` が循環しているロールを 1 つ見つける。
 *
 * 循環は「A は必ず B であり、B は必ず A である」= 2 つが同じロールという意味になり、
 * 包含関係の推論が成り立たなくなるので宣言として認めない。
 *
 * @param roles roles.md の全ロール定義
 * @returns 循環に含まれるロール ID の並び(見つかった経路)。循環が無ければ null
 */
/**
 * `kind`(グローバルロールの種別)を持つロールの ID を引く。
 *
 * パーサー(parse-role.ts の checkKinds)が「3 種はちょうど 1 つずつ」を検査済みの
 * モデルでは必ず見つかる。壊れたモデル(検証前・テストのフィクスチャ)を渡された場合は
 * `undefined` を返し、呼び出し側の安全側の既定値(見つからなければ特権扱いにしない等)に委ねる
 * — ここでロール名を決め打ちしない(それ自体が塞ぎたい漏れである)。
 *
 * @param roles roles.md の全ロール定義
 * @param kind 引きたい種別
 * @returns 対応するロール ID。無ければ `undefined`
 */
export function globalRoleId(roles: readonly RoleDef[], kind: RoleKind): string | undefined {
  return roles.find((role) => role.kind === kind)?.id;
}

/**
 * 内部実行(Webhook / Cron)に対応するロール ID(role_spec の `kind: system`)。
 *
 * `globalRoleId(roles, 'system')` の薄いラッパーだが、これを直接あちこちで呼ぶと
 * `'system'` という文字列リテラルが呼び出し箇所の数だけ複製される(W1 が見る「仕組み側の
 * コードに仕様の id を書かない」という原則そのものに反する)。**この関数の中だけ**に
 * その文字列を書き、呼び出し側は関数名(識別子)を経由する。
 */
export function systemRoleId(roles: readonly RoleDef[]): string | undefined {
  return globalRoleId(roles, 'system');
}

/**
 * 未ログインの実行者に対応するロール ID(role_spec の `kind: anonymous`)。
 *
 * `systemRoleId` と同じ理由(W1「仕組み側のコードに仕様の id を書かない」)で、
 * `'anonymous'` という `RoleKind` の値を渡す呼び出しをこの関数の中だけに閉じる。
 * `requires_auth: true` の画面にその実行者が入れないかを判定する側(S13 / S15)が使う。
 */
export function anonymousRoleId(roles: readonly RoleDef[]): string | undefined {
  return globalRoleId(roles, 'anonymous');
}

/**
 * ポリシー(RLS)の宛先になる**役割**(`role_spec` の `kind` の語)。
 *
 * 内部実行(`kind: system`)は RLS をバイパスするので宛先にならない。DB のロール名ではない —— 名前への写像は
 * SQL を書く側がプラットフォームの設定(`PlatformProfile.roles`)を通して引く。W1 の理由と同じく、
 * 役割の語(`'anonymous'`)を綴る場所をこのファイルに閉じる。
 */
export type PolicyGrantee = Extract<RoleKind, 'anonymous' | 'authenticated_default'>;

/**
 * そのロールのポリシーを与える役割(未ログインのロールだけが `anonymous`、ほかはすべて `authenticated_default`)。
 *
 * @param roles roles.md の全ロール定義
 * @param roleId ポリシーを与えるロールの ID
 * @returns 宛先の役割
 */
export function policyGranteeOf(roles: readonly RoleDef[], roleId: string): PolicyGrantee {
  return roleId === anonymousRoleId(roles) ? 'anonymous' : 'authenticated_default';
}

/**
 * ポリシーの宛先の役割が、実際に `create policy … to` に並べる役割の一覧。
 *
 * 未ログインのロールに与えるポリシーは、ログイン中の人にも**同じ見え方**で効く —— ログインした人は
 * 未ログインの人が見られるものを見られなくなってはならない(含意: ログインのロールは未ログインのロールを含意する。
 * 有効メンバーでない人もここに入る)。だから宛先は未ログインの役割とログインの役割の両方になる。それ以外のロールの
 * ポリシーはログインの役割だけに与える。条件(`filters` / `when`)は行や実行者の属性を読むだけで、どちらの役割でも
 * 同じ式で評価される。
 *
 * @param grantee `policyGranteeOf` が返した役割
 * @returns 宛先の役割(重複なし・並びは安定)
 */
export function policyGranteeRoles(grantee: PolicyGrantee): readonly PolicyGrantee[] {
  return grantee === 'anonymous' ? ['anonymous', 'authenticated_default'] : [grantee];
}

export function findImplyCycle(roles: readonly RoleDef[]): readonly string[] | null {
  const byId = indexRoles(roles);
  const done = new Set<string>();

  const visit = (id: string, path: string[]): readonly string[] | null => {
    const at = path.indexOf(id);
    if (at >= 0) return [...path.slice(at), id];
    if (done.has(id)) return null;
    for (const next of byId.get(id)?.implies ?? []) {
      const cycle = visit(next, [...path, id]);
      if (cycle !== null) return cycle;
    }
    done.add(id);
    return null;
  };

  for (const role of roles) {
    const cycle = visit(role.id, []);
    if (cycle !== null) return cycle;
  }
  return null;
}

/**
 * ロール ID → そのロールが**必ず併せ持つ**ロール(`implies` の推移閉包)。
 *
 * 何も含意しないロールはキーを持たない —— 生成物 `ROLE_IMPLICATIONS` はこの結果そのもので
 * あり、結果表もハンドブックも同じ 1 本から引く(束 ⑳-5b-b)。
 *
 * @param roles 全ロール宣言
 * @returns ロール ID → 含意されるロール(宣言順)
 */
export function roleImplicationTable(roles: readonly RoleDef[]): Readonly<Record<string, readonly string[]>> {
  const table: Record<string, readonly string[]> = {};
  for (const role of roles) {
    const implied = [...impliedRoles(roles, role.id)];
    if (implied.length > 0) table[role.id] = implied;
  }
  return table;
}

/**
 * ロールが立つために**併せて満たす行の条件**(E2。ADR-0018)。含意の先の `claim` の条件を、含意を辿った順に集める。
 *
 * 既定のログインロール自身の条件(`kind: authenticated_default` に併記した `claim`)は含まない
 * —— それは `loginCondition` が持つ(そのロールが立つ根拠そのものであり、含意の先ではない)。
 *
 * @param roles 全ロール宣言
 * @param id 起点のロール ID
 * @returns 含意の先の行の条件(重複なし。無ければ空)
 */
export function impliedConditions(roles: readonly RoleDef[], id: string): readonly RowCondition[] {
  const found: RowCondition[] = [];
  for (const gate of rowConditionRoles(roles, id)) {
    const condition = rowConditionOf(gate);
    if (condition !== null) addCondition(found, condition);
  }
  return found;
}

/**
 * 既定のログインロールが立つ行の条件(`kind: authenticated_default` に併記した `claim`)。
 *
 * @param roles 全ロール宣言
 * @returns 条件。併記が無ければ `null`(「行がある」だけで立つ)
 */
export function loginCondition(roles: readonly RoleDef[]): RowCondition | null {
  const login = roles.find((role) => role.kind === 'authenticated_default');
  return login === undefined ? null : rowConditionOf(login);
}

/**
 * ロール ID → そのロールが立つために併せて満たす行の条件(含意の先。E2)。
 *
 * 実行時のロール解決の表(`RoleTables.gates`)の元である。条件を持たないロールはキーを持たない。
 *
 * @param roles 全ロール宣言
 * @returns ロール ID → 行の条件(宣言順)
 */
export function roleGateTable(roles: readonly RoleDef[]): Readonly<Record<string, readonly RowCondition[]>> {
  const table: Record<string, readonly RowCondition[]> = {};
  for (const role of roles) {
    const gates = impliedConditions(roles, role.id);
    if (gates.length > 0) table[role.id] = gates;
  }
  return table;
}

/**
 * ロールが DB の述語で併せて課される行の条件(**ロール配列から立つ形の写し**)。
 *
 * 既定のログインロールなら自分の条件(`ARRAY AND 行の条件`)、それ以外は含意の先の条件(E2)。
 * 一致の証明がロール配列を出発点にするとき、DB の述語と同じに配列から来たロールを落とすのに使う。
 *
 * @param roles 全ロール宣言
 * @param id 起点のロール ID
 * @returns 行の条件(重複なし。無ければ空)
 */
export function groundedConditions(roles: readonly RoleDef[], id: string): readonly RowCondition[] {
  const found: RowCondition[] = [];
  const own = roles.find((role) => role.id === id && role.kind === 'authenticated_default');
  const ownCondition = own === undefined ? null : rowConditionOf(own);
  if (ownCondition !== null) found.push(ownCondition);
  for (const condition of impliedConditions(roles, id)) addCondition(found, condition);
  return found;
}
