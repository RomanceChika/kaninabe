/**
 * action_spec の `input` → 操作 ID(handles)ごとの入力フィールド名の表
 * (`app/src/domain/generated/action-inputs.ts`)の生成器。
 *
 * テスト義務の全域化 束③ Part C の裁定(2026-09-04)による新設。Server Action の実行時
 * スキーマ(`.omit()` / `.pick()` で作った zod オブジェクト)と action_spec の `input` の
 * 一致は、TypeScript の式を読む機械が要るため legacy/spec-tools の検証器(モデルを引数に取る
 * 純粋関数)の枠を超える。代わりにここで**期待集合そのものを生成物として app 側へ渡す**
 * ことで、app 側のテストが期待値を手で書き写す(= 仕様との二重管理)のを避ける。
 *
 * 対象は `input` を宣言する全 action_spec(= 全操作)。1 件も無いエントリ(`input: []`)も
 * 空配列として載せる ―― 「操作 ID が表に載っているか」自体が閉世界の判定材料になるため、
 * 省略してはならない。
 */

import type { SpecModel } from '../../model/types.js';
import type { ActionSpec } from '../../model/trace/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { generatedFile, docComment, generatedHeader, renderLiteral, type LiteralValue } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';

/** 出力先(1 ファイルに全操作ぶん)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'action-inputs.ts');

/**
 * action_spec の `input` から操作 ID ごとのフィールド名表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/action-inputs.ts`(ファイル全体)。
 */
export const actionInputsGenerator: DocGenerator = {
  id: 'code-action-inputs',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const model = ctx.actions;
    if (model === undefined || model.actions.length === 0) return [];
    const actions = [...model.actions].sort((a, b) => a.handles.raw.localeCompare(b.handles.raw));
    return [{ file: outputFile(ctx.roots), content: renderFile(actions, ctx.roots), wholeFile: true }];
  },
};

/** ファイル全体を組み立てる。 */
function renderFile(actions: readonly ActionSpec[], roots: ProductRoots): string {
  const specFiles = actions.map((action) => specPath(roots, `backend/actions/${action.relPath}`));
  const table: Record<string, LiteralValue> = {};
  for (const action of actions) {
    table[action.handles.raw] = action.input.map((field) => field.field);
  }

  return [
    generatedHeader(specFiles),
    '',
    docComment([
      '操作 ID(action_spec の handles)→ その action_spec が宣言した input のフィールド名',
      '(`{entity}.{field}` の裸名。識別子ではなく完全修飾名を書きたくなったら action_spec 側の',
      '規約を見直す ―― ここは写像であって新しい語彙を持たない)。',
      '',
      'Server Action が実際に safeParse する zod スキーマの鍵集合がこの配列と過不足なく',
      '一致することを app/src/app/_actions/__tests__/action-input-parity.test.ts が確かめる',
      '(テスト義務の全域化 束③ Part C)。',
    ]),
    `export const actionInputFields = ${renderLiteral(table)} as const;`,
    '',
    docComment(['操作 ID(action_spec の handles)の値域。']),
    'export type ActionOperationId = keyof typeof actionInputFields;',
    '',
  ].join('\n');
}
