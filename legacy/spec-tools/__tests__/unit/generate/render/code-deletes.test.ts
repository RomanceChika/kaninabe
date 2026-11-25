import { describe, expect, it } from 'vitest';

import { deleteRulesGenerator } from '../../../../lib/generate/render/code-deletes.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { accessSpec, aggregate, del, specModel, stubGuards } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** deletes を持つ 1 集約だけのモデルを作り、生成された本文を返す。 */
function generateOne(
  deletes: readonly ReturnType<typeof del>[],
  ctx: GenerateContext = GEN_CTX,
): string {
  const model = specModel([aggregate('entry', { access: accessSpec('entry', { deletes }) })]);
  const section = deleteRulesGenerator.generate(model, ctx)[0];
  if (section === undefined) throw new Error('セクションが生成されませんでした');
  return section.content;
}

describe('deleteRulesGenerator', () => {
  it('ファイル全体モードで app/src/domain/generated/{entity}.deletes.ts を出力する', () => {
    const model = specModel([
      aggregate('entry', { access: accessSpec('entry', { deletes: [del('performer')] }) }),
      aggregate('program', { access: accessSpec('program_item', { deletes: [del('organizer')] }) }),
    ]);

    const sections = deleteRulesGenerator.generate(model, GEN_CTX);

    expect(sections.map((s) => s.file)).toEqual([
      'app/src/domain/generated/entry.deletes.ts',
      'app/src/domain/generated/program_item.deletes.ts',
    ]);
    expect(sections[0]?.wholeFile).toBe(true);
    expect(sections[0]?.marker).toBeUndefined();
  });

  it('deletes を持たない集約からは何も生成しない(誰も消せない)', () => {
    const model = specModel([
      aggregate('member', { access: accessSpec('member', {}) }),
      aggregate('program', {}),
    ]);

    expect(deleteRulesGenerator.generate(model, GEN_CTX)).toEqual([]);
  });

  it('手編集禁止のヘッダと仕様への参照を先頭に置く', () => {
    const content = generateOne([del('performer')]);

    expect(content).toContain('AUTO-GENERATED');
    expect(content).toContain('docs/specs/domain/entry/access.md');
    expect(content).toContain("import type { DeleteTable } from '@kaninabe/runtime/engine/types';");
    expect(content).toContain('export const entryDeleteRules = deepFreeze({');
    expect(content).toContain('as const satisfies DeleteTable);');
  });

  it('when をエンジンが読める AST に変換し、原文も guardSource に残す', () => {
    const content = generateOne([del('performer', 'state == draft')]);

    expect(content).toContain("by: 'performer',");
    expect(content).toContain("path: 'state',");
    expect(content).toContain("op: '==',");
    expect(content).toContain("value: 'draft',");
    expect(content).toContain("guardSource: 'state == draft',");
  });

  it('when が無い規則は guard も guardSource も持たない(常に許可)', () => {
    const content = generateOne([del('system')]);

    expect(content).toContain("by: 'system',");
    expect(content).not.toContain('guardSource');
    expect(content).not.toContain('guard:');
  });

  it('境界: パースできない when は guardSource だけを残す(fail-open にしない)', () => {
    const broken = 'state === draft';
    const ctx: GenerateContext = {
      guards: { ...stubGuards(), parse: () => ({ ok: false, error: { message: '演算子が不正', offset: 0 } }) },
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    };

    const content = generateOne([del('performer', broken)], ctx);

    expect(content).toContain(`guardSource: '${broken}',`);
    expect(content).not.toContain('guard:');
  });
});
