/**
 * ポリシーの述語を組み立てる**文脈**(入力の型と、ロールの根拠 / 参照の鎖の写し方)。
 *
 * `rls-predicate.ts` が使う文脈である。ここが持つのは「ポリシーの中から見た world の形」——
 * 実行者 id は何で、グローバルロールの根拠はどこにあり、親の行へはどう届くか —— であり、
 * `reads` の 3 つの軸(`scope` / `filters` / `when`)を写す側はどれもこの文脈を使う。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { PathRef } from '../guard/ast.js';
import type { RoleDef, SpecModel } from '../model/types.js';
import type { ValueKind } from '../model/field-values.js';
import { valueKindOfFieldType } from '../model/field-values.js';
import { anonymousRoleId } from '../model/role-hierarchy.js';
import { refColumn, refPathTo } from '../model/ref-path.js';
import { findField } from '../semantics/domain-index.js';
import type { EntityReach, RoleSqlBindings } from './roles-to-sql.js';
import { helperName, needsHelper } from '../world/index.js';
import { entityOf } from '../usecase/param-source-facts.js';
import { actorIdSql } from './platform-sql.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';

/** 束縛が辿った先の行に付ける別名。 */
const ROLE_ALIAS = 'b';

/** 参照の鎖を辿る途中の行に付ける別名の前置。 */
const REACH_ALIAS_PREFIX = 'r';

/** 全テーブルが持つ主キー列(表の規約)。 */
const KEY_COLUMN = 'id';

/** ポリシー 1 本の述語を組み立てるのに要る入力。 */
export interface PolicyPredicateInput {
  /** 対象の集約。 */
  readonly entity: string;
  /** 対象の物理テーブル名(ポリシーの中で対象の行を指す名前になる)。 */
  readonly table: string;
  readonly domain: SpecModel;
  /** 集約名 → 物理テーブル名。 */
  readonly tableOf: (entity: string) => string | null;
  /** role_spec の全ロール定義。 */
  readonly roles: readonly RoleDef[];
  /** プラットフォームの設定(現在の実行者の式・セッション属性の枝)。 */
  readonly platform: PlatformProfile;
  /**
   * 実行者 id を与える式(省略時はポリシーの文脈の式 = 設定の現在の実行者を `(select …)` で包んだもの)。
   *
   * 同じ述語を**ポリシーの外**で組み立てる呼び側があるので口を 1 つ開けてある ——
   * 隠し列のマスク(`api.can_see_{表}_{列}`)は `api` スキーマの security definer 関数であり、
   * 実行者 id を土台の関数(`api.actor_id()`)から取る。翻訳器を 2 本書くと、束縛の 2 段を
   * 辿れるのは片方だけ、のような食い違いが静かに入る。
   */
  readonly actorId?: string;
}

/** 写せなかったときの理由(生成器は throw せず、示した検査器の Finding にする)。 */
export interface PolicyProblem {
  readonly message: string;
  readonly suggestion: string;
  readonly counterexample: Readonly<Record<string, string>>;
}

/** ロールの翻訳器に渡す解決器(RLS の文脈)。 */
export function policyRoleBindings(input: PolicyPredicateInput): RoleSqlBindings {
  return {
    actorId: input.actorId ?? actorIdSql(input.platform),
    globalRole: (role) => globalRoleSql(role, anonymousRoleId(input.roles)),
    // 含意の先の行の条件も同じ補助関数が持つ(本体が `claim` の欄の条件そのもの。ADR-0018)。
    impliedGate: (role) => (needsHelper(role, anonymousRoleId(input.roles)) ? helperCall(role.id) : null),
    reach: (entity) => reachOf(entity, input),
    // `claim` の根拠も補助関数に写すので、実行者自身の行をポリシーから直に読むことはない。
    actorRow: () => null,
    valueKind: (path) => valueKindOf(path, input),
  };
}

/**
 * グローバルに立つロールの根拠。
 *
 * 未ログインのロールは `to anon` が根拠そのもの(そこに来ている = 未ログイン)なので、
 * 述語としては常に真になる。それ以外は security definer の補助関数に委ねる ——
 * 実行者の集約をポリシーの中から直に読むと、その集約自身のポリシーで再帰する。
 *
 * @param role ロール定義
 * @param anonymous 未ログインのロール ID
 * @returns 全域な SQL 述語
 */
function globalRoleSql(role: RoleDef, anonymous: string | undefined): string {
  return needsHelper(role, anonymous) ? helperCall(role.id) : 'true';
}

/** 補助関数の呼び出し(スキーマ修飾つき)。 */
function helperCall(role: string): string {
  return `public.${helperName(role)}()`;
}

/**
 * 束縛が指す集約への届き方。
 *
 * 対象の集約そのものなら対象の行(別名は表名)、それ以外は参照の鎖で結ぶ 1 段の EXISTS に
 * 畳む —— 結合条件の側に鎖を入れれば 2 段以上も 1 段で書ける(`rpc-reach.ts` と同じ手)。
 */
function reachOf(entity: string, input: PolicyPredicateInput): EntityReach | null {
  if (entity === input.entity) return { kind: 'row', alias: input.table };
  const table = input.tableOf(entity);
  const id = policyIdExpression(entity, input);
  if (table === null || id === null) return null;
  return {
    kind: 'join',
    table: `public.${table}`,
    alias: ROLE_ALIAS,
    on: `${ROLE_ALIAS}.${KEY_COLUMN} = ${id}`,
  };
}

/**
 * その集約の行の id を与える式(参照の鎖を 1 段ずつ入れ子にする)。
 *
 * @param entity 辿り着きたい集約
 * @param input 対象の集約・表名の引き当て
 * @returns id を与える SQL の式。辿れなければ `null`
 */
export function policyIdExpression(entity: string, input: PolicyPredicateInput): string | null {
  const path = refPathTo(input.domain, input.entity, entity);
  const root = path === null ? null : refColumn(input.domain, input.entity, path[0] ?? '');
  if (path === null || root === null) return null;
  let current = `${input.table}.${root}`;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1] ?? '';
    const column = refColumn(input.domain, from, path[index] ?? '');
    const table = input.tableOf(from);
    if (column === null || table === null) return null;
    const alias = `${REACH_ALIAS_PREFIX}${index}`;
    current = `(select ${alias}.${column} from public.${table} ${alias} where ${alias}.${KEY_COLUMN} = ${current})`;
  }
  return current;
}

/**
 * 束縛の式に現れるパスの値の種別(`{集約}.{欄}` は届いた先の欄)。
 *
 * `actor.id` はここに来ない —— 実行者の同一性であることは翻訳器の側で決まっている。
 *
 * @param path 束縛の式に現れたパス
 * @param input 対象の集約とドメイン仕様
 * @returns 値の種別。分からなければ `null`
 */
function valueKindOf(path: PathRef, input: PolicyPredicateInput): ValueKind | null {
  const segments = path.segments;
  if (segments.length !== 2) return null;
  const [head, name] = segments;
  if (head === undefined || name === undefined) return null;
  const entity = entityOf(input.domain, head);
  const field = entity === null ? null : findField(input.domain, entity, name);
  return field === null ? null : valueKindOfFieldType(field.type);
}
