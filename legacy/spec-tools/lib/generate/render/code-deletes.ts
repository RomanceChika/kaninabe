/**
 * access_spec の `deletes` → 削除規則表(`app/src/domain/generated/{entity}.deletes.ts`)の生成器。
 *
 * 作成規則表(code-creates)と完全に対になる。「誰が・どんな条件で消せるか」の正は
 * ドメイン仕様(access_spec)にあり、実装は表を持たずに生成された表をエンジンが解釈する
 * (ADR-0004)。これが無いと operation がガード式を書き写すことになり、正が 2 つになる。
 *
 * 出力はエンジンの型契約(`app/src/domain/engine/types.ts` の DeleteTable)に
 * `as const satisfies` で固定するため、契約から外れた生成物は app 側の typecheck で落ちる。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import type { AccessSpec, SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral, toCamelCase } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import { deleteTableData } from '../../results/engine-tables.js';
import { RUNTIME_ENGINE_TYPES_MODULE } from './runtime-modules.js';


/**
 * `deletes` を宣言している集約から削除規則表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/{entity}.deletes.ts`(1 エンティティ 1 ファイル・全体生成)。
 * `deletes` が無い集約は「誰も消せない」であり、表そのものを作らない。
 */
export const deleteRulesGenerator: DocGenerator = {
  id: 'code-deletes',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const sections: GeneratedSection[] = [];
    for (const specs of model.aggregates.values()) {
      const access = specs.access;
      if (access === undefined || access.deletes.length === 0) continue;
      sections.push({
        file: generatedFile(ctx.roots, `${access.entity}.deletes.ts`),
        content: renderDeletesFile(access, ctx),
        wholeFile: true,
      });
    }
    return sections;
  },
};

/** 1 エンティティ分の削除規則ファイル全体を組み立てる。 */
function renderDeletesFile(access: AccessSpec, ctx: GenerateContext): string {
  const constName = `${toCamelCase(access.entity)}DeleteRules`;
  const table = deleteTableData(access, ctx.guards);

  return [
    generatedHeader([access.location.file]),
    '',
    `import type { DeleteTable } from '${RUNTIME_ENGINE_TYPES_MODULE}';`,
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      `${access.entity} の削除規則の表。`,
      'ここに現れないロールは削除できない(deny by default)。',
      `仕様: ${access.location.file}`,
    ]),
    `export const ${constName} = ${frozen(`${renderLiteral(table)} as const satisfies DeleteTable`)};`,
    '',
  ].join('\n');
}

