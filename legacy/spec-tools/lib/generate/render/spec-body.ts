/**
 * 仕様ファイル本文ブロック(action-body / query-body / screen-body)の共有部品。
 *
 * どのブロックも「YAML の形を変えるだけで情報を足さない」という同じ原則に立つ。
 * 操作 ID の接地(状態遷移 / 作成 / 削除 / 編集)とテストケース表は action_spec と
 * screen_spec / query_spec が同じ表現を使うため、ここに 1 つだけ置く。
 */

import type { SpecModel } from '../../model/types.js';
import type { ActionTestCase } from '../../testcase/types.js';
import { findField } from '../../semantics/domain-index.js';
import type { OperationGrounding } from '../../semantics/operation-ground.js';
import { cell, EMPTY_CELL, markdownTable, withLabel } from '../../gen-kit/state-machine-table.js';
import { renderFieldRow } from './field-table.js';

/** 操作の種別の表記(接地先の仕様も併記する)。 */
export function groundingKindText(grounding: OperationGrounding): string {
  switch (grounding.kind) {
    case 'transition':
      return `状態遷移(state_spec: ${grounding.entry.machine.machine})`;
    case 'create':
      return `作成(access_spec: ${grounding.entry.entity} の creates)`;
    case 'delete':
      return `削除(access_spec: ${grounding.entry.entity} の deletes)`;
    case 'update':
      return `編集(access_spec: ${grounding.entry.entity} の writes)`;
    default:
      return '?(ドメイン仕様に接地先が見つからない)';
  }
}

/** 操作を実行できるロールの一覧(重複を除き宣言順)。接地できていなければ空。 */
export function groundingRoles(grounding: OperationGrounding): readonly string[] {
  switch (grounding.kind) {
    case 'transition':
      return grounding.entry.event.by;
    case 'unknown':
      return [];
    default:
      return [...new Set(grounding.entry.rules.map((rule) => rule.by))];
  }
}

/**
 * 操作の前提の 1 セル要約(screen_spec の actions 表用)。
 *
 * - 遷移: `from → to` と guard
 * - 作成 / 削除: when(無条件なら —)
 * - 編集: ロールごとの編集可能フィールドと when
 */
export function groundingSummary(grounding: OperationGrounding): string {
  switch (grounding.kind) {
    case 'transition': {
      const { machine, event } = grounding.entry;
      const state = (id: string): string => withLabel(id, machine.stateLabels[id]);
      const transition = `${event.from.map(state).join(', ')} → ${state(event.to)}`;
      return event.guard === undefined ? transition : `${transition}、\`${event.guard}\``;
    }
    case 'create':
    case 'delete': {
      const whens = grounding.entry.rules
        .filter((rule) => rule.when !== undefined)
        .map((rule) => `${rule.by}: \`${rule.when ?? ''}\``);
      return whens.length === 0 ? EMPTY_CELL : whens.join('、');
    }
    case 'update':
      return grounding.entry.rules
        .map((rule) => {
          const when = rule.when === undefined ? '' : `（\`${rule.when}\`）`;
          return `${rule.by}: ${rule.fields.join(', ')}${when}`;
        })
        .join('、');
    default:
      return EMPTY_CELL;
  }
}

/** `{entity}.{field}` 参照のマトリクスの見出し(entity.md の field-table と同じ列)。 */
const FIELD_REF_HEADERS = ['フィールド', '型', '必須', '制約', '説明'] as const;

/**
 * `{entity}.{field}` 参照の一覧を、entity_spec の定義を展開した表にする。
 *
 * 型・制約の正は entity_spec であり、ここはそれを引き写すだけで情報を足さない。
 * 参照先が見つからないフィールド(verify 通過後には無いはず)は全セル ? で出す。
 *
 * @param model ドメイン仕様全体
 * @param refs 展開する参照(`raw` は `{entity}.{field}` の書かれたままの文字列)
 */
export function fieldRefTable(
  model: SpecModel,
  refs: readonly { readonly entity: string; readonly field: string; readonly raw: string }[],
): string {
  const rows = refs.map((ref) => {
    const def = findField(model, ref.entity, ref.field);
    if (def === null) return [cell(ref.raw), '?', '?', '?', '?'];
    const [, ...rest] = renderFieldRow(def);
    return [cell(ref.raw), ...rest];
  });
  return markdownTable(FIELD_REF_HEADERS, rows);
}

/** テストケース表の見出し。 */
const TEST_CASE_HEADERS = ['ID', 'type', 'covers', 'by_role', 'spec_ids', 'implementation'] as const;

/**
 * test_cases の一覧表(action_spec / query_spec / screen_spec で同形)。
 *
 * implementation は `{パス}::{テスト名}` なのでコードとして出す。
 * covers 未宣言(移行期)は — で出し、宣言済みと区別できるようにする。
 * by_role は success のケースだけが持つ(A7 が「宣言に並ぶロールごとに成功のケースがある」を
 * 要求する口)ので、持たない行は — になる。
 *
 * @param cases 仕様の test_cases(宣言順)
 */
export function testCaseTable(cases: readonly ActionTestCase[]): string {
  const rows = cases.map((testCase) => [
    cell(testCase.id),
    cell(testCase.type),
    testCase.covers === undefined ? EMPTY_CELL : cell(testCase.covers.join(', ')),
    testCase.byRole === undefined ? EMPTY_CELL : cell(testCase.byRole),
    cell(testCase.specIds.join(', ')),
    `\`${cell(testCase.implementation.raw)}\``,
  ]);
  return markdownTable(TEST_CASE_HEADERS, rows);
}

/**
 * 「項目 | 値」の 2 列表(宣言のキー・バリューの写し)。
 *
 * @param rows [項目名, 値] の組(値は整形済みの文字列。空は — になる)
 */
export function kvTable(rows: readonly (readonly [string, string])[]): string {
  return markdownTable(
    ['項目', '値'],
    rows.map(([key, value]) => [key, cell(value)]),
  );
}
