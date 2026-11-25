/**
 * ロール(`by: [...]`)→ SQL 述語への翻訳(純関数)。
 *
 * `by` は「この操作を実行してよいロール」の列であり、SQL では**そのどれか 1 つでも立てば真**
 * の論理和になる。根拠は role_spec が 3 種に分けている(domain-spec-writing.md §role_spec):
 *
 * | 根拠 | role_spec の語 | SQL |
 * |---|---|---|
 * | セッション(未ログイン / 既定 / システム) | `kind`(どれも書かない素のロールも同じ) | `'{role}' = any(p_actor_roles)` |
 * | 実行者自身の行の欄 | `claim: {entity}.{field}` | `exists (select 1 from {表} a where a.id = p_actor_id and a.{field})` |
 * | 〃(state / enum の値) | `claim: {entity}.{field} == {値}` / `in [{値}, ...]` | `… and a.{field} in ('{値}', ...)` |
 * | 対象の行との関係 | `binding: {entity}.{field} == actor.id` | 1 段は列比較、2 段は EXISTS で辿る |
 *
 * ## 含意の行の条件(E2。ADR-0018)
 *
 * `implies` の先に `claim` を持つロール(行の条件を持つロール)があるとき、**元のロールの述語は
 * 自分の根拠 AND 含意の先の行の条件**になる —— 「A は必ず B である」と宣言したロール A は、
 * B の条件(例: 実行者の行の状態が有効)を満たさない実行者には立たない。足すのは**行の条件だけ**で、
 * 配列(`p_actor_roles`)の照合は足さない。含意の先に `claim` が無ければ何も足さない(宣言しなければ
 * 生成される SQL は 1 バイトも変わらない)。足し方は `impliedGate` が文脈ごとに決める。
 *
 * ## `p_actor_roles` に入る集合の契約
 *
 * `implies`(ロール階層)も `claim` もここでは展開しない —— **`p_actor_roles` に渡す集合は、
 * `claim` で立つロールを含み、`implies` の推移閉包で閉じていなければならない**。`by: [B]` に対して
 * DB が見るのは `'B' = any(p_actor_roles)` だけなので、「A は必ず B である」と宣言されたロール A の
 * 実行者が B を持たずに来ると**DB だけが落とす**(束 ⑳-1b のレビューが名指しした割れ)。
 *
 * 閉包を取るのは `lib/model/role-hierarchy.ts` の 1 か所であり、その結果は生成物
 * `app/src/domain/generated/roles.ts` の `ROLE_IMPLICATIONS` に出る。app の `resolveActorRoles`
 * はその表を読む(同じ導出を 2 度書かない)。契約の正は domain-spec-writing.md §role_spec。
 *
 * ガード式と同じく**意味の正は TS 側**(engine が `by` と解決済みロールを突き合わせる)であり、
 * 一致は差分テスト(`legacy/spec-tools/__tests__/guarantees/guard-sql-parity.integration.test.ts`)が見る。
 */

import type { PathRef } from '../guard/ast.js';
import type { RoleDef } from '../model/types.js';
import type { ValueKind } from '../model/field-values.js';
import { claimPartsOf } from '../model/role-claim.js';
import { rowConditionRoles } from '../model/role-hierarchy.js';
import { sqlLiteral, totalPredicate, type SqlTranslationFailure } from './guard-to-sql.js';
import { bindingSql } from './roles-binding.js';

/**
 * 実行者自身の行を引くときの主キー列。
 *
 * 全テーブルが `id` を主キーに持つのはこのフレームワークの表の規約であり(data_table)、
 * 集約ごとに変わる値ではない。
 */
const ACTOR_KEY_COLUMN = 'id';

/** 実行者自身の行に付ける別名(既存の手書き RLS と同じ字面)。 */
const ACTOR_ROW_ALIAS = 'a';

/**
 * `binding` が指すエンティティへの**届き方**。
 *
 * 1 段(対象の行そのもの)は列比較で足り、2 段(対象から参照を 1 つ辿る)は EXISTS で辿る。
 * どちらになるかは呼ぶ文脈が決めるので、判定はここではなく呼び側が渡す。
 */
export type EntityReach =
  /** 対象の行そのもの。`alias` はその行の別名(RLS なら表名、RPC 本文なら行変数)。 */
  | { readonly kind: 'row'; readonly alias: string }
  /** 参照を辿った先の行。EXISTS の中で `table alias` を開き、`on` で対象の行と結ぶ。 */
  | {
      readonly kind: 'join';
      readonly table: string;
      readonly alias: string;
      readonly on: string;
    };

/** 実行者自身の行(claim の解決先)。 */
export interface ActorRowSource {
  readonly table: string;
  readonly alias?: string;
}

/** ロールの翻訳が要求する外部の解決。 */
export interface RoleSqlBindings {
  /** 実行者 id の SQL(引数名。例: `p_actor_id`)。 */
  readonly actorId: string;
  /**
   * 実行者のグローバルロール配列の SQL(引数名。例: `p_actor_roles`)。
   *
   * **配列を運べる文脈だけが宣言する。** RLS のポリシーには「実行者が渡すロールの配列」に
   * 相当するものが無く(立っているかは補助関数が DB 側で判定する)、そこでは `globalRole` が
   * 写し方を与える。どちらも無いまま `kind` のロールが来たら、翻訳は「写せない」と報告する。
   */
  readonly actorRoles?: string;
  /**
   * `binding` が指すエンティティへの届き方。
   *
   * @param entity エンティティ名
   * @returns 届き方。写せなければ `null`
   */
  reach(entity: string): EntityReach | null;
  /**
   * `claim` が指すエンティティ(= 実行者自身の行がある表)。
   *
   * @param entity エンティティ名
   * @returns 表と別名。写せなければ `null`
   */
  actorRow(entity: string): ActorRowSource | null;
  /**
   * **グローバルに立つロールの根拠の写し方**(省略時は下の既定)。
   *
   * `binding` を持たないロール —— セッションから立つロール(`kind`)と実行者自身の行の欄で立つ
   * ロール(`claim`)—— の根拠は、呼ぶ文脈ごとに別のものになる。RPC の本文は実行者が渡す
   * 配列(`p_actor_roles`)と実行者の行を見るが、RLS のポリシーは**Postgres のロールと
   * security definer の補助関数**を見る(ポリシーの中から実行者の集約を直に読むと、その集約
   * 自身のポリシーで再帰する)。
   *
   * 写し方を差し替えられる口をここに 1 つ開けることで、**翻訳器は 1 つのまま**でよい ——
   * 束縛(`binding`)の翻訳は両方の文脈でまったく同じものが要るので、2 本目を書くと
   * 「2 段を辿れるのは片方だけ」のような食い違いが静かに入る。
   *
   * @param role ロール定義(`binding` を持たないものだけが渡る)
   * @returns 全域(NULL を返さない)な SQL 述語。既定に任せるなら `null`
   */
  globalRole?(role: RoleDef): string | null;
  /**
   * **含意の先の行の条件**の写し方(`implies` の先で `claim` を持つロールを、元のロールの述語に
   * 論理積で足すときの 1 項。省略時は `claim` を実行者の行(`actorRow`)で写す)。
   *
   * `globalRole` と別の口なのは、ここで要るのが**行の条件だけ**だからである —— `globalRole` が返す
   * 述語は「そのロールが立つ」全体(RPC の既定ロールなら配列の照合も含む)であり、含意の先の
   * 配列の照合は足さない。RLS のポリシーは補助関数 `is_{role}()` がその行の条件そのものなので、
   * そちらを返す。
   *
   * @param role 含意の先のロール(`claim` を持つものだけが渡る)
   * @returns 全域な SQL 述語。既定に任せるなら `null`
   */
  impliedGate?(role: RoleDef): string | null;
  /**
   * `binding` の式に現れるパス → その欄の**値の種別**(ガード式の翻訳器に素通しする)。
   *
   * `actor.id` はここに来ない —— 実行者の同一性であることが V11 で決まっているので、
   * その 1 本だけはこのモジュールが `opaque` として解決する。
   *
   * @param path `{entity}.{field}` のパス
   * @returns 値の種別。分からなければ `null`
   */
  valueKind(path: PathRef): ValueKind | null;
}

/** 翻訳の結果。写せなかったロール・パスは名前で返す(生成器は throw しない)。 */
export type RolesSqlResult = { readonly ok: true; readonly sql: string } | SqlTranslationFailure;

/** 翻訳の途中で積む失敗(ガード式の翻訳器と同じ 2 本立て)。 */
export interface RoleFailures {
  readonly unresolved: string[];
  readonly rejected: string[];
}

/**
 * `by` のロール列を SQL の述語に翻訳する。
 *
 * @param by 実行してよいロール ID(宣言順)
 * @param roles role_spec の全ロール定義
 * @param bindings 実行者の引数名とエンティティの届き方
 * @returns 全域(NULL を返さない)な SQL 述語。空の `by` は `false`
 */
export function rolesToSql(
  by: readonly string[],
  roles: readonly RoleDef[],
  bindings: RoleSqlBindings,
): RolesSqlResult {
  if (by.length === 0) return { ok: true, sql: 'false' };
  const failures: RoleFailures = { unresolved: [], rejected: [] };
  const terms: string[] = [];
  for (const id of by) {
    const role = roles.find((candidate) => candidate.id === id);
    if (role === undefined) {
      failures.unresolved.push(`role:${id}`);
      continue;
    }
    terms.push(roleSql(role, roles, bindings, failures));
  }
  const { unresolved, rejected } = failures;
  if (unresolved.length > 0 || rejected.length > 0) return { ok: false, unresolved, rejected };
  return { ok: true, sql: terms.length === 1 ? (terms[0] ?? 'false') : `(${terms.join(' or ')})` };
}

/**
 * ロール 1 つの述語(3 種の根拠のうち宣言されているもの)に、含意の先の行の条件を足したもの。
 *
 * 足す項が無ければ(= 含意の先に `claim` が無ければ)根拠の述語をそのまま返す。
 */
function roleSql(
  role: RoleDef,
  roles: readonly RoleDef[],
  bindings: RoleSqlBindings,
  failures: RoleFailures,
): string {
  const own = groundSql(role, bindings, failures);
  const gates = rowConditionRoles(roles, role.id).map(
    (gate) => bindings.impliedGate?.(gate) ?? claimSql(gate, bindings, failures.unresolved),
  );
  return gates.length === 0 ? own : `(${[own, ...gates].join(' and ')})`;
}

/** ロール自身の根拠の述語(3 種のうち宣言されているもの)。 */
function groundSql(role: RoleDef, bindings: RoleSqlBindings, failures: RoleFailures): string {
  // 対象の行との関係で立つロールは、どの文脈でも同じ写し(列比較 / EXISTS)になる。
  if (role.binding !== undefined) return bindingSql(role, role.binding, bindings, failures);
  const override = bindings.globalRole?.(role) ?? null;
  if (override !== null) return override;
  if (role.claim !== undefined) return claimSql(role, bindings, failures.unresolved);
  return globalSql(role.id, bindings, failures.unresolved);
}

/**
 * セッションから立つロール。実行者が渡すロール配列に入っているかだけを見る。
 * 配列自体が NULL のときに不明を返さないよう、ここで 2 値に閉じる。
 *
 * @param id ロール ID
 * @param bindings 解決器(配列の SQL を持っているか)
 * @param unresolved 写せなかったものの記録先
 * @returns 全域な SQL 述語
 */
function globalSql(id: string, bindings: RoleSqlBindings, unresolved: string[]): string {
  const roles = bindings.actorRoles;
  if (roles === undefined) {
    unresolved.push(`role:${id}`);
    return 'false';
  }
  return totalPredicate(`${sqlLiteral(id)} = any(${roles})`);
}

/**
 * 実行者自身の行の欄が根拠のロール。EXISTS は NULL を返さないので追加の畳み込みは要らない。
 *
 * @param role `claim` を持つロール
 * @param bindings 実行者 id の引数名と実行者の行の表
 * @param unresolved 写せなかったものの記録先
 * @returns 全域な SQL 述語
 */
function claimSql(role: RoleDef, bindings: RoleSqlBindings, unresolved: string[]): string {
  const parts = claimPartsOf(role);
  const source = parts === null ? null : bindings.actorRow(parts.entity);
  if (parts === null || source === null) {
    unresolved.push(`claim:${role.id}`);
    return 'false';
  }
  const alias = source.alias ?? ACTOR_ROW_ALIAS;
  return (
    `exists (select 1 from ${source.table} ${alias} ` +
    `where ${alias}.${ACTOR_KEY_COLUMN} = ${bindings.actorId} and ${claimCondition(alias, parts.field, parts.values)})`
  );
}

/**
 * `claim` の欄の条件(実行者の行の別名に対する述語)。
 *
 * boolean の欄は欄そのもの、state / enum の欄は値の集合に含まれること。RPC の述語と RLS の補助関数が
 * **同じ 1 本**を使う(2 本書くと、片方の綴りだけが直る)。
 *
 * @param alias 実行者の行の別名
 * @param field 欄名
 * @param values 値の集合(boolean の欄なら `null`)
 * @returns SQL の条件式
 */
export function claimCondition(alias: string, field: string, values: readonly string[] | null): string {
  if (values === null) return `${alias}.${field}`;
  return `${alias}.${field} in (${values.map(sqlLiteral).join(', ')})`;
}
