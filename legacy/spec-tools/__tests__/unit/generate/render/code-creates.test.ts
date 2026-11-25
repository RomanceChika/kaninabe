import { describe, expect, it } from 'vitest';

import { createRulesGenerator } from '../../../../lib/generate/render/code-creates.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { accessSpec, aggregate, create, specModel, stubGuards } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** creates を持つ 1 集約だけのモデルを作り、生成された本文を返す。 */
function generateOne(
  creates: readonly ReturnType<typeof create>[],
  ctx: GenerateContext = GEN_CTX,
): string {
  const model = specModel([aggregate('entry', { access: accessSpec('entry', { creates }) })]);
  const section = createRulesGenerator.generate(model, ctx)[0];
  if (section === undefined) throw new Error('セクションが生成されませんでした');
  return section.content;
}

describe('createRulesGenerator', () => {
  it('ファイル全体モードで app/src/domain/generated/{entity}.creates.ts を出力する', () => {
    const model = specModel([
      aggregate('entry', { access: accessSpec('entry', { creates: [create('member')] }) }),
      aggregate('workshop', { access: accessSpec('workshop', { creates: [create('member')] }) }),
    ]);

    const sections = createRulesGenerator.generate(model, GEN_CTX);

    expect(sections.map((s) => s.file)).toEqual([
      'app/src/domain/generated/entry.creates.ts',
      'app/src/domain/generated/workshop.creates.ts',
    ]);
    expect(sections[0]?.wholeFile).toBe(true);
    expect(sections[0]?.marker).toBeUndefined();
  });

  it('creates を持たない集約からは何も生成しない(誰も作れない)', () => {
    const model = specModel([
      aggregate('member', { access: accessSpec('member', {}) }),
      aggregate('program', {}),
    ]);

    expect(createRulesGenerator.generate(model, GEN_CTX)).toEqual([]);
  });

  it('手編集禁止のヘッダと仕様への参照を先頭に置く', () => {
    const content = generateOne([create('member')]);

    expect(content).toContain('AUTO-GENERATED');
    expect(content).toContain('docs/specs/domain/entry/access.md');
    expect(content).toContain("import type { CreateTable } from '@kaninabe/runtime/engine/types';");
    expect(content).toContain('export const entryCreateRules = deepFreeze({');
    expect(content).toContain('as const satisfies CreateTable);');
  });

  it('when をエンジンが読める AST に変換し、原文も guardSource に残す', () => {
    const content = generateOne([create('member', 'workshop.state == accepting')]);

    expect(content).toContain("by: 'member',");
    expect(content).toContain("path: 'workshop.state',");
    expect(content).toContain("op: '==',");
    expect(content).toContain("value: 'accepting',");
    expect(content).toContain("guardSource: 'workshop.state == accepting',");
  });

  it('when が無い規則は guard も guardSource も持たない(常に許可)', () => {
    const content = generateOne([create('system')]);

    expect(content).toContain("by: 'system',");
    expect(content).not.toContain('guardSource');
    expect(content).not.toContain('guard:');
  });

  it('境界: パースできない when は guardSource だけを残す(fail-open にしない)', () => {
    const broken = 'workshop.state === accepting';
    const ctx: GenerateContext = {
      guards: { ...stubGuards(), parse: () => ({ ok: false, error: { message: '演算子が不正', offset: 0 } }) },
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    };

    const content = generateOne([create('member', broken)], ctx);

    expect(content).toContain(`guardSource: '${broken}',`);
    expect(content).not.toContain('guard:');
  });
});
