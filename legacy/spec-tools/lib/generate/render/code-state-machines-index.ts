/**
 * 全状態機械の索引(`app/src/domain/generated/state-machines.ts`)の生成器。
 *
 * `{machine}.transitions.ts` は 1 機械 1 ファイルであり、複数の機械をまとめて名前で引く口が
 * 無かった。ウォーカーのオラクル(`app/e2e/walker-oracle.mts`)は 1 つのテーブルが複数の
 * 状態機械を持つとき(`workshops` の `state` / `publication_state`)、`stateColumnsByTable`
 * (`transition-writes.ts`)が返す機械名から実際の `MachineTable` を引く必要があるが、
 * かつては `{ workshop: workshopMachine, workshop_publication: workshopPublicationMachine }`
 * のように**集約名を手で import して**表を作っていた —— 新しい状態機械を足しても、
 * この手書きの表を直さない限りウォーカーが追随しなかった。
 *
 * ここでは全状態機械を機械名 → `MachineTable` の対応表にまとめて出し、ウォーカーは
 * この索引と `stateColumnsByTable` の機械名だけで、集約が増えても手直し無しに追随する。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import { allMachines, type SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { generatedFile, docComment, generatedHeader, toCamelCase } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';
import { RUNTIME_ENGINE_TYPES_MODULE } from './runtime-modules.js';

/** 生成物の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'state-machines.ts');


/**
 * 全状態機械の索引を生成するジェネレーター。
 * 出力は `app/src/domain/generated/state-machines.ts`(1 ファイル・全体生成)。
 */
export const stateMachinesIndexGenerator: DocGenerator = {
  id: 'code-state-machines-index',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const machines = allMachines(model);
    if (machines.length === 0) return [];
    const specFiles = [...new Set(machines.map(({ machine }) => machine.location.file))].sort((a, b) =>
      a.localeCompare(b),
    );
    return [{ file: outputFile(ctx.roots), content: renderFile(machines, specFiles), wholeFile: true }];
  },
};

/** ファイル全体を組み立てる。 */
function renderFile(
  machines: ReadonlyArray<{ readonly aggregate: string; readonly machine: { readonly machine: string } }>,
  specFiles: readonly string[],
): string {
  const names = machines.map(({ machine }) => machine.machine).sort((a, b) => a.localeCompare(b));
  return [
    generatedHeader(specFiles),
    '',
    `import type { MachineTable } from '${RUNTIME_ENGINE_TYPES_MODULE}';`,
    ...names.map((name) => `import { ${toCamelCase(name)}Machine } from './${name}.transitions';`),
    ...names.map((name) => `import { ${toCamelCase(name)}EventLabels } from './${name}.labels';`),
    '',
    docComment([
      '全状態機械の索引(機械名 → 遷移テーブル)。',
      '',
      '`app/e2e/walker-oracle.mts` はこの索引と `stateColumnsByTable`(`transition-writes.ts`)の',
      '機械名だけを使い、1 テーブルが複数の状態機械を持つ場合でも集約名を手で書き並べない。',
    ]),
    `export const STATE_MACHINES: Readonly<Record<string, MachineTable>> = {`,
    ...names.map((name) => `  ${name}: ${toCamelCase(name)}Machine,`),
    '};',
    '',
    docComment([
      '全状態機械の索引(機械名 → イベントの表示名の表)。',
      '',
      '「いまできること」(遷移表から現在状態で起こせる遷移の label を並べる案内。ADR-0011 §3-1)を',
      '機械名から汎用に導くための対。`{machine}.labels.ts` を集約ごとに手で import して',
      'いた画面(生成の表・ボタン列が使う `transitionAllows` 等)と同じ材料だが、機械名を文字列で受け取る側',
      '(`app/src/components` の共有部品)はここを引けば集約を問わない。',
      'label を宣言していないイベントはキーを持たない(仕様の写像であり、無い値を発明しない)。',
    ]),
    `export const EVENT_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {`,
    ...names.map((name) => `  ${name}: ${toCamelCase(name)}EventLabels,`),
    '};',
    '',
  ].join('\n');
}
