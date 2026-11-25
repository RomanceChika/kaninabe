import { describe, expect, it } from 'vitest';

import { writeRulesGenerator } from '../../../../lib/generate/render/code-writes.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { accessSpec, aggregate, entitySpec, field, specModel, stubGuards, write } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** writes を持つ 1 集約だけのモデルを作り、生成された本文を返す。 */
function generateOne(
  writes: readonly ReturnType<typeof write>[],
  ctx: GenerateContext = GEN_CTX,
): string {
  const model = specModel([aggregate('entry', { access: accessSpec('entry', { writes }) })]);
  const section = writeRulesGenerator.generate(model, ctx)[0];
  if (section === undefined) throw new Error('セクションが生成されませんでした');
  return section.content;
}

describe('writeRulesGenerator', () => {
  it('ファイル全体モードで app/src/domain/generated/{entity}.writes.ts を出力する', () => {
    const model = specModel([
      aggregate('entry', { access: accessSpec('entry', { writes: [write('performer', ['title'])] }) }),
      aggregate('program', {
        access: accessSpec('program_item', { writes: [write('organizer', ['order_index'])] }),
      }),
    ]);

    const sections = writeRulesGenerator.generate(model, GEN_CTX);

    expect(sections.map((s) => s.file)).toEqual([
      'app/src/domain/generated/entry.writes.ts',
      'app/src/domain/generated/program_item.writes.ts',
    ]);
    expect(sections[0]?.wholeFile).toBe(true);
    expect(sections[0]?.marker).toBeUndefined();
  });

  it('writes を持たない集約からは何も生成しない(誰も編集できない)', () => {
    const model = specModel([
      aggregate('member', { access: accessSpec('member', {}) }),
      aggregate('program', {}),
    ]);

    expect(writeRulesGenerator.generate(model, GEN_CTX)).toEqual([]);
  });

  it('手編集禁止のヘッダと仕様への参照を先頭に置く', () => {
    const content = generateOne([write('performer', ['title'])]);

    expect(content).toContain('AUTO-GENERATED');
    expect(content).toContain('docs/specs/domain/entry/access.md');
    expect(content).toContain("import type { WriteTable } from '@kaninabe/runtime/engine/types';");
    expect(content).toContain('export const entryWriteRules = deepFreeze({');
    expect(content).toContain('as const satisfies WriteTable);');
  });

  it('fields をそのまま並べ、when を AST と原文の両方で持つ', () => {
    const content = generateOne([write('performer', ['title', 'note'], 'state == draft')]);

    expect(content).toContain("by: 'performer',");
    expect(content).toContain("fields: ['title', 'note'],");
    expect(content).toContain("path: 'state',");
    expect(content).toContain("guardSource: 'state == draft',");
  });

  it('when が無い規則は guard も guardSource も持たない(常に許可)', () => {
    const content = generateOne([write('member', ['display_name'])]);

    expect(content).toContain("fields: ['display_name'],");
    expect(content).not.toContain('guardSource');
    expect(content).not.toContain('guard:');
  });

  it('編集規則の表だけを出す(フィールドの表示名の表は {entity}.labels.ts の側 — 書き込み規則の有無に依らないため)', () => {
    const model = specModel([
      aggregate('entry', {
        entity: entitySpec('entry', {
          fields: [field('title', { kind: 'string' }, { label: '演目名' })],
        }),
        access: accessSpec('entry', { writes: [write('performer', ['title'])] }),
      }),
    ]);

    const content = writeRulesGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('export const entryWriteRules = deepFreeze({');
    expect(content).not.toContain('FieldLabels');
  });

  it('effects を宣言した規則は生成物にもそのまま並ぶ', () => {
    const content = generateOne([write('account_owner', ['display_name'], 'state == active', [
      'refresh_session_profile',
    ])]);

    expect(content).toContain("effects: ['refresh_session_profile'],");
  });

  it('effects の無い規則は effects キーを持たない', () => {
    const content = generateOne([write('performer', ['title'])]);

    expect(content).not.toContain('effects:');
  });

  it('境界: パースできない when は guardSource だけを残す(fail-open にしない)', () => {
    const broken = 'state === draft';
    const ctx: GenerateContext = {
      guards: { ...stubGuards(), parse: () => ({ ok: false, error: { message: '演算子が不正', offset: 0 } }) },
      roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    };

    const content = generateOne([write('performer', ['title'], broken)], ctx);

    expect(content).toContain(`guardSource: '${broken}',`);
    expect(content).not.toContain('guard:');
  });
});
