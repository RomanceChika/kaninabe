/**
 * query_spec からドメイン仕様(SpecModel)を引くための純粋モジュール。
 *
 * Q1〜Q5 はいずれも「query_spec に書かれた名前が specs/domain の何に接地するか」を問う。
 * その引き当て(エンティティ・access_spec・ロール・スコープの比較)を各検証器に散らさず、
 * ここに 1 箇所だけ置く(lib/semantics/domain-index.ts と同じ役割)。
 */

import type { AccessSpec, EntitySpec, ReadRule, ReadScope, RoleDef, SpecModel, StateMachineSpec } from '../model/types.js';

/**
 * エンティティ名(または集約ディレクトリ名)から entity_spec を引く。
 *
 * 集約ディレクトリ名とエンティティ名が食い違う場合に備え、どちらの名前でも引ける
 * (lib/semantics/domain-index.ts の findEntityFields と同じ規則)。
 *
 * @param model ドメイン仕様全体
 * @param entity エンティティ名または集約名
 * @returns 見つかった entity_spec。無ければ null
 */
export function findEntitySpec(model: SpecModel, entity: string): EntitySpec | null {
  for (const [aggregate, specs] of model.aggregates) {
    const spec = specs.entity;
    if (spec === undefined) continue;
    if (spec.entity === entity || aggregate === entity) return spec;
  }
  return null;
}

/**
 * エンティティ名(または集約ディレクトリ名)から access_spec を引く。
 *
 * @param model ドメイン仕様全体
 * @param entity エンティティ名または集約名
 * @returns 見つかった access_spec。無ければ null
 */
export function findAccessSpec(model: SpecModel, entity: string): AccessSpec | null {
  for (const [aggregate, specs] of model.aggregates) {
    const access = specs.access;
    if (access === undefined) continue;
    if (access.entity === entity || aggregate === entity) return access;
  }
  return null;
}

/**
 * エンティティ名(または集約ディレクトリ名)から、その集約の状態機械を引く(`findEntitySpec` と同じ規則)。
 *
 * 遷移 RPC の名前が集約の名前を指すとき、その集約の機械が**ちょうど 1 本**なら名前から機械が決まる ——
 * SQL の側(`sql/rpc-transition-machine.ts`)と実行計画の側(`usecase/step-plan-rpc.ts`)が同じこの 1 本を読む。
 *
 * @param model ドメイン仕様全体
 * @param entity エンティティ名または集約名
 * @returns その集約の状態機械(宣言順)。集約が無ければ空
 */
export function findStateMachines(model: SpecModel, entity: string): readonly StateMachineSpec[] {
  for (const [aggregate, specs] of model.aggregates) {
    if (specs.entity?.entity === entity || aggregate === entity) return specs.stateMachines;
  }
  return [];
}

/**
 * access_spec から特定ロールの読み取り規則を引く。
 *
 * @param access 対象エンティティの access_spec
 * @param role ロール ID
 * @returns 見つかった reads 行。宣言が無ければ null(V4 が別途「全域性違反」として指摘する)
 */
export function findReadRule(access: AccessSpec, role: string): ReadRule | null {
  return access.reads.find((rule) => rule.by === role) ?? null;
}

/** ロールが roles.md に定義されているか。 */
export function hasRole(model: SpecModel, role: string): boolean {
  return model.roles.roles.some((candidate) => candidate.id === role);
}

/**
 * ロール ID から定義を引く。
 *
 * @param model ドメイン仕様全体
 * @param role ロール ID
 * @returns 見つかった定義。無ければ null
 */
export function findRole(model: SpecModel, role: string): RoleDef | null {
  return model.roles.roles.find((candidate) => candidate.id === role) ?? null;
}

/**
 * 文脈依存ロール(対象の行との関係で成立するロール)か。
 *
 * 判定は `binding`(関係を表す条件式)の有無で行う。binding を持たないロールは
 * 「その主体が誰であるか」だけで決まるグローバルロール(member / anonymous / system)であり、
 * `query_spec` の `for` に書けるのはこちらだけである(Q2)。
 *
 * @param model ドメイン仕様全体
 * @param role ロール ID
 * @returns binding を持つロールなら true(未定義のロールは false)
 */
export function isContextRole(model: SpecModel, role: string): boolean {
  return findRole(model, role)?.binding !== undefined;
}

/** モデルに定義された全ロール ID(メッセージの「候補」表示に使う)。 */
export function listRoleIds(model: SpecModel): string[] {
  return model.roles.roles.map((role) => role.id);
}

/** 読み取りスコープの文字列表現(own / all / none / context(entity))。 */
export function scopeText(scope: ReadScope): string {
  return scope.kind === 'context' ? `context(${scope.entity})` : scope.kind;
}

/** 2 つの読み取りスコープが同じか(context は対象エンティティまで含めて比較する)。 */
export function sameScope(a: ReadScope, b: ReadScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'context' && b.kind === 'context') return a.entity === b.entity;
  return true;
}

/**
 * 2 つのエンティティが参照関係で結ばれているか(どちらの向きでもよい)。
 *
 * 判定に使うのは entity_spec が持つ 2 種類の宣言だけである。
 * - `context` の写像(文脈依存ロールの解決パス)
 * - `ref({entity})` 型のフィールド(参照そのもの)
 *
 * 「載せてよいか」ではなく「そもそも辿れるか」を見る検査なので向きは問わない
 * (例: workshop から entry は entry 側の `ref(workshop)` で辿れる)。
 *
 * @param model ドメイン仕様全体
 * @param from 起点のエンティティ名
 * @param to 到達したいエンティティ名
 * @returns 参照関係で結ばれていれば true
 */
export function isRelated(model: SpecModel, from: string, to: string): boolean {
  return referencesTo(model, from, to) || referencesTo(model, to, from);
}

/** `from` の entity_spec が `to` を context または ref フィールドで指しているか。 */
function referencesTo(model: SpecModel, from: string, to: string): boolean {
  const spec = findEntitySpec(model, from);
  if (spec === null) return false;
  if (spec.context[to] !== undefined) return true;
  return spec.fields.some((field) => field.type.kind === 'ref' && field.type.entity === to);
}
