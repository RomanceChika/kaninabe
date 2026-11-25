/**
 * plan-scenario.ts が使う、**計画の宣言を具体的な行と入力にする**部分。
 *
 * 実行計画は「どの表のどの行のどの列を読むか」「どの列が誰のロールの根拠か」を宣言している。
 * ここはその宣言を逆に辿り、「その判定になる行と入力」を組み立てる。
 */

import { findField } from '../semantics/domain-index.js';
import type { UsecaseRead } from './plan-facts-types.js';
import type { Assignment, ScenarioValue } from './plan-scenario-values.js';
import { placeholderOf } from './plan-scenario-values.js';
import type { ScenarioContext, ScenarioRow } from './plan-scenario-rows.js';
import { OTHER_ID, TARGET_ID } from './plan-scenario-rows.js';

/** 行と入力を組み立てるときの選択。 */
export interface MaterializeOptions {
  readonly env: Assignment;
  /** 実行者と結び付ける(= 成立させる)ロール。 */
  readonly boundRoles: readonly string[];
  readonly actorId: string | null;
  /** 編集で動かす欄(それ以外の形では null)。 */
  readonly changeField: string | null;
  /** 行を 1 つも用意しない(対象が見つからない場面)。 */
  readonly missing?: boolean;
}

/** 組み立てた行と入力。 */
export interface Materialized {
  readonly rows: readonly ScenarioRow[];
  readonly input: Readonly<Record<string, ScenarioValue>>;
}

/**
 * 計画の宣言を、具体的な行と入力にする。
 *
 * id は**集約ごとに 1 つ**を先に決めてから、入力・親への参照列・行の鍵の 3 か所へ同じ値を
 * 配る。こうしないと「入力が指す行」と「実行器が読む行」がずれ、テストが読む行の取り違えを
 * 見逃す(束 ⑰-2 で実測した権限の穴はまさにそれである)。
 */
export function materialize(ctx: ScenarioContext, options: MaterializeOptions): Materialized {
  const ids = idsOf(ctx, options);
  const rows = options.missing === true ? [] : ctx.reads.map((read) => rowOf(ctx, read, ids, options));
  return { rows, input: inputOf(ctx, ids, options) };
}

/** 集約 → その行の id。 */
function idsOf(ctx: ScenarioContext, options: MaterializeOptions): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();
  ctx.reads.forEach((read, index) => {
    ids.set(read.entity, `dddddddd-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  });
  if (!ids.has(ctx.entity)) ids.set(ctx.entity, TARGET_ID);
  // 実行者自身の行を読む計画では、その行の鍵は実行者の id そのものである。
  for (const read of ctx.reads) {
    if (read.idFrom.kind === 'actor' && options.actorId !== null) ids.set(read.entity, options.actorId);
  }
  // ロールの根拠が行の `id` そのものなら(本人ロール)、成立させたい行の id は実行者の id になる。
  for (const role of options.boundRoles) {
    const ref = ctx.roleRefs.get(role);
    if (ref === undefined) continue;
    const [entity, field] = ref.split('.');
    if (field === 'id' && entity !== undefined && options.actorId !== null) ids.set(entity, options.actorId);
  }
  return ids;
}

/** 読み取り 1 件ぶんの行。 */
function rowOf(
  ctx: ScenarioContext,
  read: UsecaseRead,
  ids: ReadonlyMap<string, string>,
  options: MaterializeOptions,
): ScenarioRow {
  const id = ids.get(read.entity) ?? TARGET_ID;
  const values: Record<string, ScenarioValue> = {};
  for (const field of read.fields) {
    values[field] = valueOf(ctx, read.entity, field, { id, ids, options });
  }
  return { table: read.table, id, values };
}

/** 列 1 つの値(ガードの割当 → ロールの根拠 → 親への参照 → 型の既定値の順に決まる)。 */
function valueOf(
  ctx: ScenarioContext,
  entity: string,
  field: string,
  at: { readonly id: string; readonly ids: ReadonlyMap<string, string>; readonly options: MaterializeOptions },
): ScenarioValue {
  const ref = `${entity}.${field}`;
  if (field === 'id') return at.id;
  const variable = ctx.variables.find((candidate) => candidate.ref === ref);
  if (variable !== undefined) return at.options.env[variable.key] ?? null;
  if (ctx.stateVariable?.ref === ref) return at.options.env[ctx.stateVariable.key] ?? null;
  for (const [role, roleRef] of ctx.roleRefs) {
    if (roleRef !== ref) continue;
    return at.options.boundRoles.includes(role) ? (at.options.actorId ?? OTHER_ID) : OTHER_ID;
  }
  // 親の行を辿る参照列(`context`)。指す先の id を載せないと親が読めない。
  const child = ctx.reads.find((read) => read.idFrom.kind === 'context' && read.idFrom.ref === ref);
  if (child !== undefined) return at.ids.get(child.entity) ?? TARGET_ID;
  return placeholderOf(findField(ctx.domain, entity, field));
}

/** 入力(対象の id + 親への参照 + その形が要る欄)。 */
function inputOf(
  ctx: ScenarioContext,
  ids: ReadonlyMap<string, string>,
  options: MaterializeOptions,
): Readonly<Record<string, ScenarioValue>> {
  const input: Record<string, ScenarioValue> = {};
  for (const key of ctx.inputKeys) {
    if (key === 'id') {
      input['id'] = ids.get(ctx.entity) ?? TARGET_ID;
      continue;
    }
    // 編集は**動かす欄だけ**を運ぶ(鍵が無いことが「変更しない」である)。
    if (ctx.kind === 'update' && key !== options.changeField) continue;
    // 成立させるロールの規則が実行者そのものと一致させる欄(`self`)は、実行者の id を載せる。
    if (options.actorId !== null && options.boundRoles.some((role) => (ctx.selfRefs.get(role) ?? []).includes(`${ctx.entity}.${key}`))) {
      input[key] = options.actorId;
      continue;
    }
    const field = findField(ctx.domain, ctx.entity, key);
    const target = field?.type.kind === 'ref' ? ids.get(field.type.entity) : undefined;
    input[key] = target ?? placeholderOf(field);
  }
  return input;
}
