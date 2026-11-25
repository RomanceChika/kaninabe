/**
 * action_spec 個別ファイルの `action-body` マーカーに、宣言の可読形を生成するジェネレーター。
 *
 * action_spec の YAML(handles / input / errors / test_cases)と、handles が接地する
 * ドメイン仕様(state_spec の遷移・access_spec の規則)を表に写すだけで、情報を足さない。
 * 「どの状態から・誰が・どんな条件で」の正は specs/domain にあり、ここはその引き写しである。
 */

import type { SpecModel } from '../../model/types.js';
import type { ActionSpec } from '../../model/trace/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { cell, EMPTY_CELL, markdownTable, withLabel } from '../../gen-kit/state-machine-table.js';
import { fieldRefTable, groundingKindText, groundingRoles, kvTable, testCaseTable } from './spec-body.js';
import { groundOperation, type OperationGrounding } from '../../semantics/operation-ground.js';
import { specPath } from '../../model/product/paths.js';

/** 受けるフィールドが無いときの表記(書き忘れではなく `input: []` の宣言であることを示す)。 */
const NO_INPUT = 'この操作は入力を受けない（`input: []`。対象もセッションから導く）。';

/**
 * action_spec の本文ブロックを生成するジェネレーター。
 * 出力は各 action_spec ファイルの `action-body` マーカー 1 か所ずつ。
 */
export const actionBodyGenerator: DocGenerator = {
  id: 'action-body',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const actions = ctx.actions;
    if (actions === undefined) return [];
    return actions.actions.map((action) => ({
      file: specPath(ctx.roots, `backend/actions/${action.relPath}`),
      marker: 'action-body',
      content: renderAction(model, action),
    }));
  },
};

/**
 * action_spec 1 本の本文(宣言表・前提と帰結・input・固有エラー・テストケース)を組み立てる。
 *
 * @param model ドメイン仕様全体(handles の接地先)
 * @param action 対象の action_spec
 * @returns Markdown 断片(末尾に改行を含まない)
 */
export function renderAction(model: SpecModel, action: ActionSpec): string {
  const grounding = groundOperation(model, action.handles.raw);
  const sections = [
    '### 宣言',
    '',
    declarationTable(action, grounding),
    '',
    '### 前提と帰結（ドメイン仕様からの導出）',
    '',
    groundingTable(grounding),
    '',
    '### input（受けるフィールド）',
    '',
    action.input.length === 0 ? NO_INPUT : fieldRefTable(model, action.input),
    ...additionalErrors(action),
    '',
    '### テストケース',
    '',
    testCaseTable(action.testCases),
  ];
  return sections.join('\n');
}

/** 宣言表(handles / 種別 / 実行ロール / エラー契約)。 */
function declarationTable(action: ActionSpec, grounding: OperationGrounding): string {
  const roles = groundingRoles(grounding);
  return kvTable([
    ['handles', `\`${action.handles.raw}\``],
    ['種別', groundingKindText(grounding)],
    ['実行ロール（by）', roles.join(', ')],
    ['エラー契約', errorSummary(action)],
  ]);
}

/** エラー契約の 1 行表記(共通 3 分類 + 固有エラーの kind)。 */
function errorSummary(action: ActionSpec): string {
  const additional = action.errors.additional.map((error) => error.kind);
  const base = `${action.errors.inherits}（共通 3 分類）`;
  return additional.length === 0 ? base : `${base} + ${additional.join(', ')}`;
}

/**
 * 前提と帰結の表。種別ごとに形が違う:
 * - 遷移: from / to / guard / effects(state_spec の 1 イベント分)
 * - 作成・削除: by / 条件(access_spec の規則)
 * - 編集: by / 編集できるフィールド / 条件(access_spec の規則)
 */
function groundingTable(grounding: OperationGrounding): string {
  switch (grounding.kind) {
    case 'transition': {
      const { machine, event } = grounding.entry;
      const state = (id: string): string => withLabel(id, machine.stateLabels[id]);
      const effects = machine.effects
        .filter((effect) => effect.on === event.id || effect.on === `${machine.machine}.${event.id}`)
        .flatMap((effect) => effect.do);
      return markdownTable(
        ['from', 'to', 'guard', 'effects'],
        [
          [
            cell(event.from.map(state).join(', ')),
            cell(state(event.to)),
            event.guard === undefined ? EMPTY_CELL : `\`${cell(event.guard)}\``,
            cell(effects.join(', ')),
          ],
        ],
      );
    }
    case 'create':
    case 'delete':
      return markdownTable(
        ['by', '条件（when）'],
        grounding.entry.rules.map((rule) => [
          cell(rule.by),
          rule.when === undefined ? EMPTY_CELL : `\`${cell(rule.when)}\``,
        ]),
      );
    case 'update':
      return markdownTable(
        ['by', '編集できるフィールド', '条件（when）'],
        grounding.entry.rules.map((rule) => [
          cell(rule.by),
          cell(rule.fields.join(', ')),
          rule.when === undefined ? EMPTY_CELL : `\`${cell(rule.when)}\``,
        ]),
      );
    default:
      return 'ドメイン仕様に接地先が見つからない（`npm run verify` の A1 を確認すること）。';
  }
}

/** 固有エラーの節(additional が空なら節ごと出さない)。 */
function additionalErrors(action: ActionSpec): string[] {
  if (action.errors.additional.length === 0) return [];
  const table = markdownTable(
    ['kind', 'when'],
    action.errors.additional.map((error) => [cell(error.kind), cell(error.when)]),
  );
  return ['', '### 固有エラー', '', table];
}
