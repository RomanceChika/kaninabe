/**
 * ドメイン仕様(SpecModel)への参照解決をまとめた純粋モジュール。
 *
 * A1(handles の実在)・A3(input の実在)・A4(ハンドラの網羅)は、いずれも
 * 「action_spec に書かれた ID が specs/domain に実在するか」を問う。その引き当てを
 * 各検証器に散らさず、ここに 1 箇所だけ置く。
 */

import type {
  AccessSpec,
  CreateRule,
  DeleteRule,
  EventDef,
  FieldDef,
  SpecModel,
  StateMachineSpec,
  WriteRule,
} from '../model/types.js';
import { systemRoleId } from '../model/role-hierarchy.js';

/** 状態機械のイベント 1 件を、それが属する集約・機械とともに指すもの。 */
export interface EventEntry {
  /** 集約名(specs/domain のディレクトリ名)。 */
  readonly aggregate: string;
  readonly machine: StateMachineSpec;
  readonly event: EventDef;
  /** `{machine}.{event}` 形式のドメインイベント ID。 */
  readonly id: string;
}

/**
 * そのロールが人間の実行者を表すか(内部実行のロール以外はすべて人間)。
 *
 * A4 は「人間ロールが実行できるイベント」だけを Server Action の対象とし、A10 は逆に
 * 「内部実行(role_spec の `kind: system`)が実行できるイベント」だけを対象とする。内部実行の
 * ロール ID は仕組み側に固定しない(dsl-extension-triage.md §軸と語)ため、呼び出し側が
 * `systemRoleId(roles)` で引いた ID をここへ渡す。
 *
 * @param roleId 判定するロール ID
 * @param systemRoleId 内部実行のロール ID(role_spec に `kind: system` の宣言が無ければ `undefined`)
 */
export function isHumanRole(roleId: string, systemRoleId: string | undefined): boolean {
  return roleId !== systemRoleId;
}

/**
 * モデル中の全ドメインイベントを列挙する。
 *
 * @param model ドメイン仕様全体
 * @returns 集約・機械の宣言順に並んだイベント
 */
export function listEvents(model: SpecModel): EventEntry[] {
  const entries: EventEntry[] = [];
  for (const [aggregate, specs] of model.aggregates) {
    for (const machine of specs.stateMachines) {
      for (const event of machine.events) {
        entries.push({ aggregate, machine, event, id: `${machine.machine}.${event.id}` });
      }
    }
  }
  return entries;
}

/**
 * system が起こせる遷移イベントを列挙する(A10 の母集合)。
 *
 * 人間ロールとの混在(`by: [organizer, system]`)も含める。混在のイベントは「人間が起こす
 * 経路もあるが、時刻が来たら自動でも実行されるはず」であり、走査が無いなら
 * その自動の側は存在しないことになるためである。
 *
 * @param model ドメイン仕様全体
 * @returns `by` に system を含むイベント
 */
export function listSystemEvents(model: SpecModel): EventEntry[] {
  const systemRole = systemRoleId(model.roles.roles);
  if (systemRole === undefined) return [];
  return listEvents(model).filter((entry) => entry.event.by.includes(systemRole));
}

/**
 * `{machine}.{event}` を引き当てる。
 *
 * @param model ドメイン仕様全体
 * @param id `{machine}.{event}` 形式のドメインイベント ID
 * @returns 見つかったイベント。存在しなければ null
 */
export function findEvent(model: SpecModel, id: string): EventEntry | null {
  return listEvents(model).find((entry) => entry.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// 予約 ID `{entity}.create`
// ---------------------------------------------------------------------------

/**
 * 作成操作を表す予約イベント名(action-spec-writing.md §予約 ID)。
 *
 * `{entity}.create` は状態機械のイベントではない。作成は「状態を変える操作」ではなく
 * 「対象を生む操作」であり、その権限の正は access_spec の `creates` にある。
 * A1 はこの ID を state_spec ではなく creates に対して接地させる。
 */
export const CREATE_EVENT = 'create';

/** ドメインイベント ID が作成の予約 ID(`{entity}.create`)かどうか。 */
export function isCreateId(id: string): boolean {
  return id.endsWith(`.${CREATE_EVENT}`);
}

/**
 * 削除操作を表す予約イベント名(action-spec-writing.md §予約 ID)。
 *
 * `{entity}.delete` も状態機械のイベントではない。削除は「状態を変える操作」ではなく
 * 「対象を消す操作」であり、その権限の正は access_spec の `deletes` にある。
 * 作成(`create`)と完全に対称の扱いをする。
 */
export const DELETE_EVENT = 'delete';

/** ドメインイベント ID が削除の予約 ID(`{entity}.delete`)かどうか。 */
export function isDeleteId(id: string): boolean {
  return id.endsWith(`.${DELETE_EVENT}`);
}

/**
 * 編集操作を表す予約イベント名(action-spec-writing.md §予約 ID)。
 *
 * 接地先は access_spec の `writes`。状態を変えないフィールド更新を境界に公開するときに使う。
 */
export const UPDATE_EVENT = 'update';

/** ドメインイベント ID が編集の予約 ID(`{entity}.update`)かどうか。 */
export function isUpdateId(id: string): boolean {
  return id.endsWith(`.${UPDATE_EVENT}`);
}

/** access_spec の規則(creates / deletes / writes)に接地する予約 ID の宣言 1 件。 */
export interface AccessOpEntry<TRule> {
  /** 集約名(specs/domain のディレクトリ名)。 */
  readonly aggregate: string;
  /** access_spec の entity(= 予約 ID の前半)。 */
  readonly entity: string;
  readonly access: AccessSpec;
  /** `{entity}.{op}` 形式の予約 ID。 */
  readonly id: string;
  readonly rules: readonly TRule[];
}

/** 作成が宣言されたエンティティ 1 件。 */
export type CreateEntry = AccessOpEntry<CreateRule>;

/** 削除が宣言されたエンティティ 1 件。 */
export type DeleteEntry = AccessOpEntry<DeleteRule>;

/** 編集が宣言されたエンティティ 1 件。 */
export type UpdateEntry = AccessOpEntry<WriteRule>;

/** access_spec の規則から予約 ID の宣言を組み立てる共通処理(creates / deletes / writes 共用)。 */
function listAccessOps<TRule>(
  model: SpecModel,
  op: string,
  rulesOf: (access: AccessSpec) => readonly TRule[],
): AccessOpEntry<TRule>[] {
  const entries: AccessOpEntry<TRule>[] = [];
  for (const [aggregate, specs] of model.aggregates) {
    const access = specs.access;
    if (access === undefined) continue;
    const rules = rulesOf(access);
    if (rules.length === 0) continue;
    entries.push({ aggregate, entity: access.entity, access, id: `${access.entity}.${op}`, rules });
  }
  return entries;
}

/**
 * 予約 ID を引き当てる共通処理。
 *
 * 集約ディレクトリ名とエンティティ名が食い違う場合に備え、どちらの名前でも引ける
 * (findEntityFields と同じ規則)。
 */
function findAccessOp<TRule>(
  entries: readonly AccessOpEntry<TRule>[],
  op: string,
  id: string,
): AccessOpEntry<TRule> | null {
  return entries.find((entry) => entry.id === id || `${entry.aggregate}.${op}` === id) ?? null;
}

/**
 * `creates` を 1 件以上宣言している集約を列挙する。
 *
 * @param model ドメイン仕様全体
 * @returns 宣言順に並んだ作成宣言(creates が空の集約は含まない)
 */
export function listCreates(model: SpecModel): CreateEntry[] {
  return listAccessOps(model, CREATE_EVENT, (access) => access.creates);
}

/**
 * 予約 ID `{entity}.create` を引き当てる。
 *
 * @param model ドメイン仕様全体
 * @param id `{entity}.create` 形式の ID
 * @returns 見つかった作成宣言。creates が無い(= 誰も作れない)場合も null
 */
export function findCreate(model: SpecModel, id: string): CreateEntry | null {
  return findAccessOp(listCreates(model), CREATE_EVENT, id);
}

/**
 * `deletes` を 1 件以上宣言している集約を列挙する。
 *
 * @param model ドメイン仕様全体
 * @returns 宣言順に並んだ削除宣言(deletes が空の集約は含まない)
 */
export function listDeletes(model: SpecModel): DeleteEntry[] {
  return listAccessOps(model, DELETE_EVENT, (access) => access.deletes);
}

/**
 * 予約 ID `{entity}.delete` を引き当てる。
 *
 * @param model ドメイン仕様全体
 * @param id `{entity}.delete` 形式の ID
 * @returns 見つかった削除宣言。deletes が無い(= 誰も消せない)場合も null
 */
export function findDelete(model: SpecModel, id: string): DeleteEntry | null {
  return findAccessOp(listDeletes(model), DELETE_EVENT, id);
}

/**
 * `writes` を 1 件以上宣言している集約を列挙する。
 *
 * @param model ドメイン仕様全体
 * @returns 宣言順に並んだ編集宣言(writes が空の集約は含まない)
 */
export function listUpdates(model: SpecModel): UpdateEntry[] {
  return listAccessOps(model, UPDATE_EVENT, (access) => access.writes);
}

/**
 * 予約 ID `{entity}.update` を引き当てる。
 *
 * @param model ドメイン仕様全体
 * @param id `{entity}.update` 形式の ID
 * @returns 見つかった編集宣言。writes が無い(= 誰も編集できない)場合も null
 */
export function findUpdate(model: SpecModel, id: string): UpdateEntry | null {
  return findAccessOp(listUpdates(model), UPDATE_EVENT, id);
}

/**
 * 集約名(specs/domain のディレクトリ名)から、その entity_spec のエンティティ名を引く。
 *
 * 集約ディレクトリ名とエンティティ名が食い違う場合に備え、entity_spec が無ければ
 * ディレクトリ名をそのまま返す(findEntityFields と同じ規則)。`involves` の引き当て
 * (required-coverage.ts の遷移系の導出)が、イベントの属する集約からエンティティ名を
 * 解決するために使う。
 */
export function entityNameOfAggregate(model: SpecModel, aggregate: string): string {
  return model.aggregates.get(aggregate)?.entity?.entity ?? aggregate;
}

/** モデル中の状態機械名の一覧(メッセージの「候補」表示に使う)。 */
export function listMachineNames(model: SpecModel): string[] {
  const names = new Set<string>();
  for (const specs of model.aggregates.values()) {
    for (const machine of specs.stateMachines) names.add(machine.machine);
  }
  return [...names];
}

/**
 * `{entity}.{field}` を entity_spec から引き当てる。
 *
 * 集約ディレクトリ名とエンティティ名が食い違う場合に備え、どちらの名前でも引ける
 * (lib/semantics/domain-env.ts の buildDomainEnv と同じ規則)。
 *
 * @param model ドメイン仕様全体
 * @param entity エンティティ名(または集約名)
 * @param field フィールド名
 * @returns 見つかったフィールド定義。エンティティ自体が無い場合も null
 */
export function findField(model: SpecModel, entity: string, field: string): FieldDef | null {
  const spec = findEntityFields(model, entity);
  if (spec === null) return null;
  return spec.find((candidate) => candidate.name === field) ?? null;
}

/**
 * エンティティ名(または集約名)から entity_spec のフィールド一覧を引く。
 *
 * @returns フィールド一覧。そのエンティティが存在しない場合は null
 */
export function findEntityFields(model: SpecModel, entity: string): readonly FieldDef[] | null {
  for (const [aggregate, specs] of model.aggregates) {
    const spec = specs.entity;
    if (spec === undefined) continue;
    if (spec.entity === entity || aggregate === entity) return spec.fields;
  }
  return null;
}
