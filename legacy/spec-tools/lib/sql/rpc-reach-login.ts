/**
 * 既定のログインロール(`kind: authenticated_default`)の、定型 RPC の本文での述語。
 *
 * `rpc-reach.ts`(RPC の本文の中でパスを SQL に届かせる写像)から分けた葉である。引数名は呼び側が渡す
 * (`rpc-reach.ts` が持つ定数を import すると循環するため)。純関数であり throw しない。
 */

import type { RoleDef, SpecModel } from '../model/types.js';
import { claimPartsOf } from '../model/role-claim.js';
import { actorEntity } from '../usecase/param-source-facts.js';
import { claimCondition } from './roles-to-sql.js';
import { sqlLiteral, totalPredicate } from './guard-to-sql.js';

/** 既定のログインロールの種別。 */
const AUTHENTICATED_DEFAULT = 'authenticated_default';

/** 実行者自身の行に付ける別名(`claim` の翻訳と同じ字面)。 */
const ACTOR_ROW_ALIAS = 'a';

/** 全テーブルが持つ主キー列(表の規約)。 */
const KEY_COLUMN = 'id';

/** 引数名(呼び側が持つ定数を渡す)。 */
export interface LoginParams {
  /** 実行者 id の引数名。 */
  readonly actorId: string;
  /** 実行者のグローバルロール配列の引数名。 */
  readonly actorRoles: string;
}

/**
 * 既定のログインロール(`kind: authenticated_default`)の述語。
 *
 * **根拠は「認証済みであること」ではなく「実行者の集約に行があること」である**。正は RLS の
 * 補助関数 `is_{role}()` の定義(`rls-migration.ts` の `buildHelperMigration`)であり、そちらは
 * 最初から実行者の集約の行を見ている。RPC の本文だけが配列(`p_actor_roles`)しか見ていなかった
 * ので、「ログインはできるが実行者の集約に行が無い人」(招待を受け取っただけの認証ユーザ)が
 * 権限の判定を素通りし、止めていたのは外部キーだけだった(束 ⑳-5a の所見 ①)。
 *
 * `claim` を併記した場合(例: 実行者の行の状態が有効であること)は、行の実在に**その欄の条件**を足す
 * (ADR-0018 の E1)。配列の照合も残す —— システム経路(`from_runtime`)や渡さない呼び出しに既定ロールを立てない
 * のは配列の側の仕事であり、行の実在だけでは区別できない。
 *
 * @param role ロール定義(`binding` を持たないものだけが渡る)
 * @param domain ドメイン仕様
 * @param tableOf 集約名 → 物理テーブル名
 * @param params 引数名
 * @returns 述語。既定のログインロールでなければ `null`(既定の写し方に任せる)
 */
export function authenticatedDefaultSql(
  role: RoleDef,
  domain: SpecModel,
  tableOf: (entity: string) => string | null,
  params: LoginParams,
): string | null {
  if (role.kind !== AUTHENTICATED_DEFAULT) return null;
  // `claim` を併記したロールは、行の実在に加えてその欄の条件も課す(行の読み先は claim の集約。
  // V11 が「実行者の集約の欄」であることを見ている)。
  const claim = claimPartsOf(role);
  const entity = claim === null ? actorEntity(domain) : claim.entity;
  const table = entity === null ? null : tableOf(entity);
  if (table === null) return null;
  const named = totalPredicate(`${sqlLiteral(role.id)} = any(${params.actorRoles})`);
  const condition =
    claim === null ? '' : ` and ${claimCondition(ACTOR_ROW_ALIAS, claim.field, claim.values)}`;
  return (
    `(${named} and exists (select 1 from public.${table} ${ACTOR_ROW_ALIAS} ` +
    `where ${ACTOR_ROW_ALIAS}.${KEY_COLUMN} = ${params.actorId}${condition}))`
  );
}
