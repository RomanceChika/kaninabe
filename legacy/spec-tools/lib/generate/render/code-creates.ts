/**
 * access_spec の `creates` → 作成規則表(`app/src/domain/generated/{entity}.creates.ts`)の生成器。
 *
 * 遷移テーブル(code-transitions)と同じ考え方である。「誰が・どんな条件で作れるか」の正は
 * ドメイン仕様(access_spec)にあり、実装は表を持たずに生成された表をエンジンが解釈する
 * (ADR-0004)。これが無いと operation がガード式を書き写すことになり、正が 2 つになる。
 *
 * 出力はエンジンの型契約(`app/src/domain/engine/types.ts` の CreateTable)に
 * `as const satisfies` で固定するため、契約から外れた生成物は app 側の typecheck で落ちる。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import type { AccessSpec, SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral, toCamelCase } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import { createTableData } from '../../results/engine-tables.js';
import { createInputFields } from '../../usecase/actor-bound.js';
import { RUNTIME_ENGINE_TYPES_MODULE } from './runtime-modules.js';


/**
 * `creates` を宣言している集約から作成規則表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/{entity}.creates.ts`(1 エンティティ 1 ファイル・全体生成)。
 * `creates` が無い集約は「誰も作れない」であり、表そのものを作らない。
 */
export const createRulesGenerator: DocGenerator = {
  id: 'code-creates',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const sections: GeneratedSection[] = [];
    for (const specs of model.aggregates.values()) {
      const access = specs.access;
      if (access === undefined || access.creates.length === 0) continue;
      sections.push({
        file: generatedFile(ctx.roots, `${access.entity}.creates.ts`),
        content: renderCreatesFile(access, model, ctx),
        wholeFile: true,
      });
    }
    return sections;
  },
};

/** 1 エンティティ分の作成規則ファイル全体を組み立てる。 */
function renderCreatesFile(access: AccessSpec, model: SpecModel, ctx: GenerateContext): string {
  const constName = `${toCamelCase(access.entity)}CreateRules`;
  const table = createTableData(access, ctx.guards, {
    domain: model,
    inputFields: createInputFields(ctx.actions ?? null, access.entity),
  });

  return [
    generatedHeader([access.location.file]),
    '',
    `import type { CreateTable } from '${RUNTIME_ENGINE_TYPES_MODULE}';`,
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      `${access.entity} の作成規則の表。`,
      'ここに現れないロールは作成できない(deny by default)。',
      `仕様: ${access.location.file}`,
    ]),
    `export const ${constName} = ${frozen(`${renderLiteral(table)} as const satisfies CreateTable`)};`,
    '',
  ].join('\n');
}

