/**
 * code-personal-expectations(entity_spec の `personal` 宣言 → 監査ペイロード期待表)の
 * ユニットテスト。
 *
 * 対象の要求(手順 1。docs/design/security-surface-proposal.md §3):
 * ①テーブルごとに personal: true の列だけを宣言順で列挙する、②personal: false のテーブルも
 * 空配列で閉世界に載る、③placeholder は文字列または null をそのまま写す、④entity_spec が
 * 1 件も無ければ何も生成しない。
 */

import { describe, expect, it } from 'vitest';
import { personalExpectationsGenerator } from '../../../../lib/generate/render/code-personal-expectations.js';
import { stubGuards } from '../../../helpers/model-builder.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder-v8plus.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 生成本文を 1 つだけ取り出す。 */
function render(domain: SpecModel): string {
  const sections = personalExpectationsGenerator.generate(domain, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() });
  expect(sections).toHaveLength(1);
  return sections[0]?.content ?? '';
}

describe('code-personal-expectations', () => {
  it('personal: true の列だけを宣言順で列挙する', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'member',
          entity: entitySpec('member', [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('display_name', { kind: 'string' }, {
              required: true,
              personal: true,
              personalPlaceholder: '(消去済み)',
            }),
            field('is_staff', { kind: 'boolean' }, { required: true }),
          ]),
        }),
      ],
    });

    const content = render(domain);

    expect(content).toContain(
      "members: [\n    {\n      column: 'display_name',\n      placeholder: '(消去済み)',\n    },\n  ],",
    );
    expect(content).not.toContain("column: 'id'");
    expect(content).not.toContain("column: 'is_staff'");
  });

  it('personal な列が 0 のテーブルも空配列で閉世界に載る', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'venue',
          entity: entitySpec('venue', [field('id', { kind: 'uuid' }, { auto: true })]),
        }),
      ],
    });

    expect(render(domain)).toContain('venues: [],');
  });

  it('personal_placeholder が null(NOT NULL でない列)ならそのまま null を写す', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'entry',
          entity: entitySpec('entry', [
            field('note', { kind: 'text' }, { personal: true, personalPlaceholder: null }),
          ]),
        }),
      ],
    });

    const content = render(domain);

    expect(content).toContain("column: 'note',\n      placeholder: null,");
  });

  it('table の上書き宣言があればそちらをキーにする', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'person',
          entity: {
            ...entitySpec('person', [
              field('name', { kind: 'string' }, { personal: true, personalPlaceholder: '(消去済み)' }),
            ]),
            table: 'people',
          },
        }),
      ],
    });

    const content = render(domain);

    expect(content).toContain('people: [');
    expect(content).not.toContain('persons:');
  });

  it('entity_spec が 1 件も無ければ何も生成しない', () => {
    expect(personalExpectationsGenerator.generate(specModel({}), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});
