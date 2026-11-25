/**
 * R2 が守る**役の根拠の欄**を仕様から集める(危ない形の群)。
 *
 * 役が立つかどうかを決める欄は 3 種類あり、どれを書き換えても権限が動く。
 *
 * | 種類 | どこから引くか | 書き換えると |
 * |---|---|---|
 * | `claim` | role_spec の `claim: {集約}.{欄}`(値の集合つきも) | その役が立つ / 消える(自己昇格) |
 * | `binding` | role_spec の `binding: {集約}.{欄} == actor.id`(`contains` も) | 行に対する文脈の役が別の人に移る(所有者のすり替え) |
 * | `actor_attribute` | access_spec の `reads[].filters` の右辺と、式の中の `actor.{欄}`(実行者の集約の `session: true` の欄) | 実行者の側の境界が動く(テナントの乗り換え) |
 *
 * 対象の行の側の列(`filters` の左辺)は根拠の欄に数えない —— 行を境界の外へ動かす形は別の型であり、R2 の範囲の外である
 * (設計 §7 の凍結。範囲の外の形は報告に挙げる)。
 *
 * 読むのは role_spec の `claim` / `binding` / `implies`・entity_spec の `session`・access_spec の `filters` と式の中の
 * `actor.{欄}` だけで、**アプリの語彙は 1 語も持たない**。純関数であり throw しない。
 */

import type { RoleDef, SourceLocation, SpecModel } from '../../model/types.js';
import { claimPartsOf } from '../../model/role-claim.js';
import { impliedRoles } from '../../model/role-hierarchy.js';
import { actorEntity } from '../../usecase/param-source-facts.js';

/** 根拠の欄の種類。 */
export type GroundKind = 'claim' | 'binding' | 'actor_attribute';

/** 役の根拠の欄 1 本。 */
export interface Ground {
  readonly kind: GroundKind;
  /** 欄の集約(エンティティ名)。 */
  readonly entity: string;
  readonly field: string;
  /** その欄が根拠の役(`claim` / `binding`)。 */
  readonly role?: string;
  /** `claim` の値の集合(boolean の欄なら null)。 */
  readonly values?: readonly string[] | null;
  /** 根拠を宣言した場所(反例の出どころ)。 */
  readonly declaredAt: SourceLocation;
}

/** `binding` を読めなかった文脈依存ロール(形が読めない根拠は追えないので、R2 が止める)。 */
export interface UnreadableBinding {
  readonly role: RoleDef;
}

/** 集めた根拠。 */
export interface Grounds {
  readonly grounds: readonly Ground[];
  readonly unreadableBindings: readonly UnreadableBinding[];
  /** 実行者の集約(`session: true` の欄を持つ 1 つ。無ければ null)。 */
  readonly actorEntity: string | null;
}

/** `binding` の書き方(`{集約}.{欄} == actor.id` / `{集約}.{欄} contains actor.id`)。 */
const BINDING_FORM = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\s*(?:==|contains)\s*actor\.id$/u;

/** 式の中の実行者の属性(`actor.{欄}`)。 */
const ACTOR_ATTRIBUTE = /\bactor\.([a-z][a-z0-9_]*)\b/gu;

/** 実行者の識別子そのもの(属性ではない)。 */
const ACTOR_ID = 'id';

/**
 * `binding` を `{集約, 欄}` に分ける。
 *
 * @param binding role_spec の `binding` の文字列
 * @returns 欄の位置。形が読めなければ null
 */
export function bindingField(binding: string): { readonly entity: string; readonly field: string } | null {
  const match = BINDING_FORM.exec(binding.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  return { entity: match[1], field: match[2] };
}

/**
 * その役を**持つ / 含意する**役(役 R の根拠を書いてよい人。R 自身を含む)。
 *
 * @param roles 全ロール
 * @param id 役 R
 */
export function holdersOf(roles: readonly RoleDef[], id: string): ReadonlySet<string> {
  return new Set(roles.filter((role) => role.id === id || impliedRoles(roles, role.id).has(id)).map((role) => role.id));
}

/** 仕様の式の中から実行者の属性の欄を集める。 */
function actorAttributesIn(texts: readonly (string | undefined)[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    if (text === undefined) continue;
    for (const match of text.matchAll(ACTOR_ATTRIBUTE)) {
      const field = match[1];
      if (field !== undefined && field !== ACTOR_ID) found.push(field);
    }
  }
  return found;
}

/**
 * 役の根拠の欄を全部集める(同じ欄・同じ種類・同じ役は 1 本に畳む)。
 *
 * @param model ドメイン仕様全体
 * @returns 根拠の欄と、形を読めなかった `binding`
 */
export function collectGrounds(model: SpecModel): Grounds {
  const actor = actorEntity(model);
  const grounds = new Map<string, Ground>();
  const add = (ground: Ground): void => {
    const key = [ground.kind, ground.entity, ground.field, ground.role ?? ''].join('|');
    if (!grounds.has(key)) grounds.set(key, ground);
  };
  const unreadableBindings: UnreadableBinding[] = [];
  for (const role of model.roles.roles) {
    const claim = claimPartsOf(role);
    if (claim !== null) add({ kind: 'claim', entity: claim.entity, field: claim.field, role: role.id, values: claim.values, declaredAt: role.location });
    if (role.binding === undefined) continue;
    const bound = bindingField(role.binding);
    if (bound === null) unreadableBindings.push({ role });
    else add({ kind: 'binding', entity: bound.entity, field: bound.field, role: role.id, declaredAt: role.location });
  }
  for (const specs of model.aggregates.values()) {
    const access = specs.access;
    if (access === undefined) continue;
    for (const read of access.reads) {
      for (const filter of read.filters ?? []) {
        if (actor !== null) add({ kind: 'actor_attribute', entity: actor, field: filter.actorField, declaredAt: read.location });
      }
    }
    if (actor === null) continue;
    const texts = [
      ...access.reads.map((rule) => rule.when),
      ...access.creates.map((rule) => rule.when),
      ...access.writes.map((rule) => rule.when),
      ...access.deletes.map((rule) => rule.when),
      ...specs.stateMachines.flatMap((machine) => machine.events.map((event) => event.guard)),
    ];
    for (const field of actorAttributesIn(texts)) add({ kind: 'actor_attribute', entity: actor, field, declaredAt: access.location });
  }
  return { grounds: [...grounds.values()], unreadableBindings, actorEntity: actor };
}
