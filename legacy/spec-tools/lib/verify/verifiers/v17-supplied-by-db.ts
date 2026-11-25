/**
 * V17 「DB が決める値」(`supplied_by: db`)の宣言が閉じていること。
 *
 * domain-spec-writing.md §entity_spec の要求: `supplied_by: db` の欄は
 *   (a) どの action_spec の `input` にも現れない(人が入れる値ではない)。ただし**作った後の書き換え**は access_spec の `writes` が
 *       宣言する —— `writes` に載る欄は、編集(`{集約}.update`)の `input` に現れてよい(作るときの値だけを DB が決める。
 *       末尾の番号を DB が振り、並べ替えは編集が持つ形。点検 24 回目 B24-1)。もう 1 つの例外は、表の `derives` が
 *       `mode: insert_at` で埋める末尾の番号の列 —— 入れてきた値を位置と読んで差し込み、空なら末尾に振るので、作成(`{集約}.create`)の
 *       `input` に任意で現れてよい(利用者が発表順を選ぶ作成。fix25s。例外の持ち主は model/data/types.ts の `insertAtColumnsOf`)
 *   (b) その表の data_table が**機構**を宣言している(`defaults` の列既定値、または
 *       `triggers[].supplies` に載っている)
 *   (c) 作成 RPC(`insert_{entity}`)の `params` に `p_{欄}` が無い(渡す口が閉じている。(a) の `insert_at` の列は開いてよい)
 *
 * ## なぜこの検査が要るのか
 *
 * 「入力に無いが作成時に決まる値」(招待コードの採番・リマインド時刻の逆算)は、宣言の場所が
 * 無かったあいだ **TS の operation が計算して RPC に渡す**形で実装の中にだけ住んでいた
 * (⑯c-1 報告 §6-2 / §6-3)。仕様に書かれていない知識なので、ユースケース起点で生成した
 * 複合 RPC も 1 画面フォームもその値を知りようがなく、生成フォームは招待コードを**人に
 * 入力させる**形になっていた(⑯c-2 報告 §9-3)。
 *
 * 解は「表現力を買う」ことではなく**形を変える**ことである(dsl-extension-triage.md)——
 * 値の決定を DB 側へ移し、仕様には「DB が決める」とだけ宣言する。この検査はその宣言が
 * 空手形でないこと(機構がある・渡す口が閉じている)を、実装を書く前に固定する。
 */

import type { EntitySpec, FieldDef, SpecModel } from '../../model/types.js';
import type { DataTableSpec } from '../../model/data/types.js';
import { insertAtColumnsOf } from '../../model/data/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';
import { inputValue } from '../../kernel/input-state.js';
import { findAccessSpec } from '../../semantics/domain-lookup.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'V17';

/** 作成 RPC の名前の前置(server-actions.md「5 形の定型」)。 */
const CREATE_RPC_PREFIX = 'insert_';

/** V17 の指摘を組み立てる。 */
function finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** 編集の操作 ID の後置(予約 ID。access_spec の `writes` が書き換えを宣言する操作)。 */
const UPDATE_SUFFIX = '.update';

/** 作成の操作 ID の後置(予約 ID。`insert_at` の末尾の番号の位置を入れてよい操作)。 */
const CREATE_SUFFIX = '.create';

/** 入力に現れてよい例外(`writes` に載る欄の編集・`insert_at` の列の作成)。 */
interface InputExemptions {
  readonly writable: boolean;
  readonly insertAt: boolean;
}

/** その欄を `input` に持つ action_spec の操作 ID(無ければ null。例外の操作の入力は数えない)。 */
function inputHolder(ctx: VerifyContext, entity: string, field: string, exempt: InputExemptions): string | null {
  for (const action of inputValue(ctx.actions)?.actions ?? []) {
    if (exempt.writable && action.handles.raw === `${entity}${UPDATE_SUFFIX}`) continue;
    if (exempt.insertAt && action.handles.raw === `${entity}${CREATE_SUFFIX}`) continue;
    if (action.input.some((ref) => ref.entity === entity && ref.field === field)) return action.handles.raw;
  }
  return null;
}

/** (a) 入力に現れていないこと(作った後の書き換えを `writes` が宣言した欄の編集の入力と、`insert_at` の列の作成の入力は除く)。 */
function checkNotInput(entity: EntitySpec, field: FieldDef, ctx: VerifyContext, model: SpecModel, table: DataTableSpec | undefined): Finding[] {
  const writes = findAccessSpec(model, entity.entity)?.writes ?? [];
  const exempt = {
    writable: writes.some((rule) => rule.fields.includes(field.name)),
    insertAt: table !== undefined && insertAtColumnsOf(table).has(field.name),
  };
  const holder = inputHolder(ctx, entity.entity, field.name, exempt);
  if (holder === null) return [];
  return [
    finding({
      message: `${entity.entity}.${field.name} は supplied_by: db ですが action_spec ${holder} の input に現れます`,
      location: field.location,
      suggestion:
        `${holder} の input から ${entity.entity}.${field.name} を外すか、supplied_by: db をやめる。` +
        '「DB が決める」と「人が入れる」を同じ欄について同時に宣言できない',
      counterexample: { entity: entity.entity, field: field.name, action: holder },
    }),
  ];
}

/** (b) data_table が機構を宣言していること。 */
function checkMechanism(
  entity: EntitySpec,
  field: FieldDef,
  table: DataTableSpec,
  roots: ProductRoots,
): Finding[] {
  const byDefault = Object.keys(table.defaults).includes(field.name);
  const byTrigger = table.triggers.some((trigger) => trigger.supplies.includes(field.name));
  if (byDefault || byTrigger) return [];
  return [
    finding({
      message: `${entity.entity}.${field.name} が supplied_by: db ですが ${table.table}.md が機構を宣言していません`,
      location: field.location,
      suggestion:
        `${specPath(roots, 'backend/data/tables', `${table.table}.md`)} の defaults に "${field.name}: {SQL の式}" を書く` +
        `(列の既定値で決まる場合)か、triggers[].supplies に ${field.name} を載せる(トリガが埋める場合)`,
      counterexample: { entity: entity.entity, field: field.name, table: table.table },
    }),
  ];
}

/** (c) 作成 RPC に渡す口が無いこと。 */
function checkNoParam(entity: EntitySpec, field: FieldDef, table: DataTableSpec): Finding[] {
  if (insertAtColumnsOf(table).has(field.name)) return [];
  const name = `${CREATE_RPC_PREFIX}${entity.entity}`;
  const param = `p_${field.name}`;
  const create = table.functions.find((fn) => fn.name === name);
  if (create === undefined || !create.params.includes(param)) return [];
  return [
    finding({
      message: `${entity.entity}.${field.name} は supplied_by: db ですが ${name} が ${param} を受け取ります`,
      location: field.location,
      suggestion:
        `${name} から ${param} を外す migration を足し、${table.table}.md の functions の args / params も` +
        '同じ形に直す。渡す口が開いていると「DB が決める」は呼び出し側の善意でしか守られない',
      counterexample: { entity: entity.entity, field: field.name, function: name, param },
    }),
  ];
}

/** 1 つの `supplied_by: db` の欄を見る。 */
function checkField(
  entity: EntitySpec,
  field: FieldDef,
  ctx: VerifyContext,
  table: DataTableSpec | undefined,
  model: SpecModel,
): Finding[] {
  if (field.suppliedBy !== 'db') return [];
  const findings = [...checkNotInput(entity, field, ctx, model, table)];
  if (table === undefined) return findings;
  return [...findings, ...checkMechanism(entity, field, table, ctx.roots), ...checkNoParam(entity, field, table)];
}

/** V17 の実装。 */
export const suppliedByDbVerifier: Verifier = {
  id: VERIFIER_ID,
  title: 'DB が決める値 — supplied_by: db は入力に現れず、機構が宣言され、渡す口が閉じている',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    // data_table が使えない(未選択・阻害)構成では機構の宣言を見られないので、(a) だけを見る(見ていない (b)(c) と、
    // action_spec が阻害のときの (a) は実行ログが報告する。`verify/domain-input-notes.ts`)。
    const tables = inputValue(ctx.dataTables);
    const byEntity = new Map<string, DataTableSpec>();
    for (const table of tables?.tables ?? []) {
      if (table.entity !== undefined) byEntity.set(table.entity, table);
    }
    const findings: Finding[] = [];
    for (const specs of model.aggregates.values()) {
      const entity = specs.entity;
      if (entity === undefined) continue;
      for (const field of entity.fields) {
        findings.push(...checkField(entity, field, ctx, byEntity.get(entity.entity), model));
      }
    }
    return findings;
  },
};
