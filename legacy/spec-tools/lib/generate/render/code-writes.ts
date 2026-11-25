/**
 * access_spec の `writes` → 編集規則表(`app/src/domain/generated/{entity}.writes.ts`)の生成器。
 *
 * 作成規則表(code-creates)・削除規則表(code-deletes)と対になる 3 本目。
 * 「誰が・どのフィールドを・どんな条件で編集してよいか」の正はドメイン仕様(access_spec)にあり、
 * 実装は表を持たずに生成された表をエンジンが解釈する(ADR-0004)。
 *
 * 出力はエンジンの型契約(`app/src/domain/engine/types.ts` の WriteTable)に
 * `as const satisfies` で固定するため、契約から外れた生成物は app 側の typecheck で落ちる。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import type { AccessSpec, SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral, toCamelCase } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import { writeTableData } from '../../results/engine-tables.js';
import { RUNTIME_ENGINE_TYPES_MODULE } from './runtime-modules.js';


/**
 * `writes` を宣言している集約から編集規則表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/{entity}.writes.ts`(1 エンティティ 1 ファイル・全体生成)。
 * `writes` が無い集約は「誰も編集できない」であり、表そのものを作らない。
 */
export const writeRulesGenerator: DocGenerator = {
  id: 'code-writes',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const sections: GeneratedSection[] = [];
    for (const specs of model.aggregates.values()) {
      const access = specs.access;
      if (access === undefined || access.writes.length === 0) continue;
      sections.push({
        file: generatedFile(ctx.roots, `${access.entity}.writes.ts`),
        content: renderWritesFile(access, ctx),
        wholeFile: true,
      });
    }
    return sections;
  },
};

/** 1 エンティティ分の編集規則ファイル全体を組み立てる。 */
function renderWritesFile(access: AccessSpec, ctx: GenerateContext): string {
  const constName = `${toCamelCase(access.entity)}WriteRules`;
  const table = writeTableData(access, ctx.guards);

  return [
    generatedHeader([access.location.file]),
    '',
    `import type { WriteTable } from '${RUNTIME_ENGINE_TYPES_MODULE}';`,
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      `${access.entity} の編集規則の表。`,
      'ここに現れない(ロール × フィールド)の組み合わせは編集できない(deny by default)。',
      `仕様: ${access.location.file}`,
    ]),
    `export const ${constName} = ${frozen(`${renderLiteral(table)} as const satisfies WriteTable`)};`,
    '',
  ].join('\n');
}
