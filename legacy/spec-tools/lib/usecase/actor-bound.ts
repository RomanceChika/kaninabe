/**
 * 作成の**実行者の参照の欄**と、その欄を**どの規則が実行者に縛るか**の導出(1 か所)。
 *
 * 読む相手は 3 つあり、どれもこの 1 本を呼ぶ —— 同じ規則を 2 か所で別々に書くと、
 * engine(意味の正)と DB(写し)が別の判定を下す(実測: 一致の証明 loan.create の 9 通り)。
 *
 *   1. engine の作成規則表(`results/engine-tables.ts`)—— 規則ごとの `self`(実行者と一致すべき変数)
 *   2. 実行計画の事実(`plan-facts-parts.ts`)—— `self` の変数を環境に載せる
 *   3. 生成する作成 RPC(`sql/rpc-actor-binding.ts`)—— 規則ごとのロールの述語に同じ条件を足す
 *
 * **実行者の参照の欄** = 型が実行者の集約への `ref` の欄のうち、作成で行に入る欄(action_spec の
 * `input` にある欄、または必須の欄)である。`binding` / `records_actor` / `defaults.self` に現れる欄に
 * 絞らないのは、それらが書き忘れうる宣言だからである(書き忘れた欄が縛りの外に落ちる)。
 *
 * 欄は 2 種類に分かれ、縛りを解く規則が違う。
 *
 * | 欄 | 何か | 解く規則 |
 * |---|---|---|
 * | A(`input` に無い) | 実行器が実行者で埋める欄(`owner` で宣言した持ち主・`defaults.self`) | `by` が `kind: system` のロール |
 * | B(`input` にある) | 人が値を選ぶ欄(代理で作る相手・承認者) | `kind: system` のロール / `delegate` でその欄を名指した規則 |
 *
 * **ロールの種類から「管理のロールだから縛らない」を推測しない**(点検 11 回目 A11-3)。以前は「既定のログインロールでない `claim` のロール」を
 * 管理のロールと見なして全部の欄を解いていたので、一般の利用者の役(`verified: claim account.verified` など)の規則でも、
 * 理由なしで任意の人の名前で作れた。解くのは実行者のいない内部実行と、欄 × 理由を名指した `delegate` の 2 つだけで閉じる。
 *
 * **縛りは `by` の段の一部である**(ガードより前)。「この値で作ってよい人か」は「誰が作れるか」の
 * 問いであり、文脈依存ロールの `binding`(`{対象}.{欄} == actor.id`)と同じ形をしている ——
 * したがって拒否の順は既存の規則(ロール → 再送 → 前提 → ガード)のロールの位置に入る。
 * 解く規則の `when` は縛りの判定に混ぜない(規則ごとに「ロール ∧ 縛り」が `by` の段、`when` が
 * ガードの段であり、規則をまたいで条件が混ざらない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { CreateRule, SpecModel } from '../model/types.js';
import type { RoleDef } from '../model/types-role.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import { systemRoleId } from '../model/role-hierarchy.js';
import { findEntityFields } from '../semantics/domain-index.js';
import { actorEntity } from './param-source-facts.js';

/** 実行者の参照の欄 1 つ。 */
export interface ActorBoundField {
  readonly name: string;
  /** action_spec の `input` に現れるか(B)。現れなければ A(実行者で埋まる)。 */
  readonly inInput: boolean;
}

/** 環境で実行者の id を指す変数。 */
export const ACTOR_ID_VARIABLE = 'actor.id';

/**
 * その集約の作成の action_spec が `input` に宣言する欄(宣言順)。
 *
 * @param actions action_spec(無ければ空 = すべての欄を A として扱う)
 * @param entity 集約
 * @returns 欄名
 */
export function createInputFields(actions: ActionSpecModel | null | undefined, entity: string): readonly string[] {
  const action = actions?.actions.find((candidate) => candidate.handles.raw === `${entity}.create`);
  return (action?.input ?? []).filter((ref) => ref.entity === entity).map((ref) => ref.field);
}

/**
 * 作成で行に入る、実行者の参照の欄(entity_spec の宣言順)。
 *
 * @param domain ドメイン仕様
 * @param entity 集約
 * @param inputFields その作成が入力に受ける欄
 * @returns 欄と種類(A / B)
 */
export function actorBoundFields(domain: SpecModel, entity: string, inputFields: readonly string[]): readonly ActorBoundField[] {
  const actor = actorEntity(domain);
  if (actor === null) return [];
  return (findEntityFields(domain, entity) ?? [])
    .filter((field) => field.type.kind === 'ref' && field.type.entity === actor)
    .filter((field) => inputFields.includes(field.name) || field.required)
    .map((field) => ({ name: field.name, inInput: inputFields.includes(field.name) }));
}

/**
 * 作成の**持ち主の欄**(作成者 = 実行者そのもので埋める欄)= `{集約}.create` の action_spec の `owner` の宣言。
 *
 * **明示の宣言だけ**である。以前は「必須で入力に無い実行者への参照は作成者」を推測で当て(点検 8 回目までに
 * 数える母集合を変えて 4 回漏れた。9 回目 A9-1: 起案者を入力に出した代理作成で、残った査閲者の欄が
 * 「ただ 1 本の候補」として黙って作成者で埋まった)、推測の仕組みごと無くした。宣言の無い実行者への参照の欄は、
 * 入力・`defaults.self`・計算値のどれでもなければ実行計画が「値が仕様のどこにも無い」で止める。
 * 実行計画(`param-source-fields.ts` の `owner`)と R2(`risk/verifiers/r2-sites.ts`)がこの 1 本を読む。
 * 宣言の接地(作成の操作・自集約・`ref(実行者の集約)`・必須・入力に無い)は V18 の下位検査(`v18-owner.ts`)が見る。
 *
 * @param actions action_spec(無ければ null)
 * @param entity 集約
 * @returns 持ち主の欄の名前(宣言が無い・別の集約を指すなら null)
 */
export function declaredOwner(actions: ActionSpecModel | null | undefined, entity: string): string | null {
  const owner = actions?.actions.find((candidate) => candidate.handles.raw === `${entity}.create`)?.owner;
  return owner !== undefined && owner.entity === entity ? owner.field : null;
}

/**
 * 実行者がいない規則か(`by` が `kind: system` のロール。A も B も解く。`delegate` を書いても何も足さない)。
 *
 * @param rule 作成の規則
 * @param roles ロールの宣言
 * @returns 全ての欄の縛りを解くなら true
 */
export function isSystemRule(rule: CreateRule, roles: readonly RoleDef[]): boolean {
  return rule.by === systemRoleId(roles);
}

/**
 * その規則がその欄の縛りを解くか(B だけは、その欄を名指した delegate でも解ける)。
 *
 * `delegate` は**名指した欄だけ**を解く(点検 10 回目 A10-2。以前は規則単位で、承認者の欄のために書いた理由が、
 * 後から入力に足した別の実行者への参照の欄の縛りも外した)。欄の集約が作る集約と同じことは読み込みが閉じる。
 *
 * @param rule 作成の規則
 * @param roles ロールの宣言
 * @param field 実行者の参照の欄
 * @returns 解くなら true
 */
export function relaxesBinding(rule: CreateRule, roles: readonly RoleDef[], field: ActorBoundField): boolean {
  return isSystemRule(rule, roles) || (field.inInput && (rule.delegate ?? []).some((decl) => decl.field === field.name));
}

/**
 * その規則のもとで実行者に縛られる欄の名前(規則の `by` の段に足す条件)。
 *
 * @param rule 作成の規則
 * @param roles ロールの宣言
 * @param fields 実行者の参照の欄
 * @returns 縛られる欄の名前(宣言順)
 */
export function ruleBoundFields(rule: CreateRule, roles: readonly RoleDef[], fields: readonly ActorBoundField[]): readonly string[] {
  return fields.filter((field) => !relaxesBinding(rule, roles, field)).map((field) => field.name);
}

/**
 * その集約の作成で、どれかの規則が縛る欄(重複なし・宣言順)。
 *
 * @param domain ドメイン仕様
 * @param entity 集約
 * @param inputFields その作成が入力に受ける欄
 * @returns 欄
 */
export function boundFieldsOfCreate(domain: SpecModel, entity: string, inputFields: readonly string[]): readonly ActorBoundField[] {
  const fields = actorBoundFields(domain, entity, inputFields);
  const rules = createRulesOf(domain, entity);
  const roles = domain.roles.roles;
  return fields.filter((field) => rules.some((rule) => !relaxesBinding(rule, roles, field)));
}

/**
 * 作成の規則ごと(`by`)の、実行者そのものと一致しなければならない欄(`{集約}.{欄}`。engine の規則の `self` と同じ導出)。
 * 生成テストの成功の場面が、成立させるロールのこの欄の入力に実行者を載せるのに使う(`plan-scenario-materialize.ts`)。
 *
 * @param domain ドメイン仕様
 * @param entity 作る集約
 * @param inputFields 作成の入力の欄
 * @returns ロール → 欄の並び(縛る欄の無い規則は空)
 */
export function selfFieldsByRole(domain: SpecModel, entity: string, inputFields: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const fields = actorBoundFields(domain, entity, inputFields);
  const roles = domain.roles.roles;
  return new Map(createRulesOf(domain, entity).map((rule) => [rule.by, ruleBoundFields(rule, roles, fields).map((name) => `${entity}.${name}`)]));
}

/** その集約の `creates`。 */
function createRulesOf(domain: SpecModel, entity: string): readonly CreateRule[] {
  for (const specs of domain.aggregates.values()) {
    if (specs.access?.entity === entity) return specs.access.creates;
  }
  return [];
}
