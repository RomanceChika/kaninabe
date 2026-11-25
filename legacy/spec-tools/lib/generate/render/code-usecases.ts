/**
 * usecase_spec → ユースケース名ごとの宣言の写し(`app/src/domain/generated/usecases.ts`)の生成器。
 *
 * ADR-0011「起点は 2 つ」の束⑯a。この生成物は束⑯c(保存点 → 複合 RPC・1 画面フォームの生成)
 * の入力になる予定であり、この束では「ユースケースの宣言をそのまま app 側へ渡す」ところまでを
 * 担う(複合 RPC・フォームの生成そのものは束⑯c)。
 *
 * `action-inputs.ts` と同じ理由(テスト義務の全域化 束③ Part C)で、仕様の宣言を
 * TypeScript 側へ**そのまま**渡す ―― app 側が仕様の形を手で書き写すと二重管理になる。
 */

import type { SpecModel } from '../../model/types.js';
import type { UsecaseSaveDecl, UsecaseSpec, UsecaseStepDecl } from '../../model/usecase/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { generatedFile, docComment, generatedHeader, renderLiteral, type LiteralValue } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';

/** 出力先(1 ファイルに全ユースケースぶん)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'usecases.ts');

const INTERFACE_BODY = [
  'export interface UsecaseStep {',
  '  readonly op: string;',
  '  /** 別名(`as`)。書かれていなければ null で、鍵は `op` になる。 */',
  '  readonly alias: string | null;',
  '  /** 節の見出し(`label`)。書かれていなければ null で、操作の label になる。 */',
  '  readonly label: string | null;',
  '  readonly repeat: boolean;',
  '  readonly defaultsSelf: boolean;',
  '}',
  '',
  'export interface UsecaseSave {',
  '  readonly id: string;',
  '  readonly label: string;',
  '  readonly steps: readonly UsecaseStep[];',
  '}',
  '',
  'export interface UsecaseDecl {',
  '  readonly id: string;',
  '  readonly goal: string;',
  '  readonly actor: string;',
  '  readonly start: string;',
  '  readonly done: string;',
  '  readonly saves: readonly UsecaseSave[];',
  '}',
].join('\n');

/**
 * usecase_spec からユースケース宣言の写しを生成するジェネレーター。
 * 出力は `app/src/domain/generated/usecases.ts`(ファイル全体)。
 * `ctx.usecases` が無い(specs/frontend/usecases 未整備)環境では何も生成しない。
 */
export const usecasesGenerator: DocGenerator = {
  id: 'code-usecases',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const model = ctx.usecases;
    if (model === undefined || !model.available || model.usecases.length === 0) return [];
    const usecases = [...model.usecases].sort((a, b) => a.name.localeCompare(b.name));
    return [{ file: outputFile(ctx.roots), content: renderFile(usecases, ctx.roots), wholeFile: true }];
  },
};

/** ファイル全体を組み立てる。 */
function renderFile(usecases: readonly UsecaseSpec[], roots: ProductRoots): string {
  const specFiles = usecases.map((usecase) => specPath(roots, `frontend/usecases/${usecase.relPath}`));
  const table: Record<string, LiteralValue> = {};
  for (const usecase of usecases) table[usecase.name] = toLiteral(usecase);

  return [
    generatedHeader(specFiles),
    '',
    docComment([
      'ユースケース名(usecase_spec の name)→ その宣言の写し(目的・誰・どこから・達成条件・',
      '保存点と手順)。ADR-0011「起点は 2 つ」の束⑯a。',
      '',
      '保存点ごとの複合 RPC・1 画面フォームの生成(束⑯c)がこの写しを入力にする。',
    ]),
    INTERFACE_BODY,
    '',
    docComment(['ユースケース名 → 宣言。usecase_spec の全数が母集合。']),
    `export const usecases: Readonly<Record<string, UsecaseDecl>> = ${renderLiteral(table)} as const;`,
    '',
    docComment(['ユースケース名の値域。']),
    'export type UsecaseName = keyof typeof usecases;',
    '',
  ].join('\n');
}

/** UsecaseSpec を TS リテラルの材料(LiteralValue)へ写す。 */
function toLiteral(usecase: UsecaseSpec): LiteralValue {
  return {
    id: usecase.id,
    goal: usecase.goal,
    actor: usecase.actor,
    start: usecase.start,
    done: usecase.done,
    saves: usecase.saves.map(saveToLiteral),
  };
}

/** UsecaseSaveDecl を TS リテラルの材料へ写す。 */
function saveToLiteral(save: UsecaseSaveDecl): LiteralValue {
  return { id: save.id, label: save.label, steps: save.steps.map(stepToLiteral) };
}

/** UsecaseStepDecl を TS リテラルの材料へ写す。 */
function stepToLiteral(step: UsecaseStepDecl): LiteralValue {
  return {
    op: step.op,
    alias: step.alias,
    label: step.label,
    repeat: step.repeat,
    defaultsSelf: step.defaultsSelf,
  };
}
