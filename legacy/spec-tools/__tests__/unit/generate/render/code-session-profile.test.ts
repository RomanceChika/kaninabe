/**
 * code-session-profile(entity_spec の `session` 宣言 → SessionProfile 型)のユニットテスト。
 *
 * 対象の要求(手順 1。auth-spec-writing.md §session 属性):
 * ①`session: true` の列だけを宣言順で `SessionProfile` / `SESSION_FIELDS` に列挙する、
 * ②`session: true` が 0 件でも空の型・空配列を出す(閉世界)、③型はフィールド型から導出する。
 */

import { describe, expect, it } from 'vitest';
import { sessionProfileGenerator } from '../../../../lib/generate/render/code-session-profile.js';
import { stubGuards } from '../../../helpers/model-builder.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder-v8plus.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 生成本文を 1 つだけ取り出す。 */
function render(domain: SpecModel): string {
  const sections = sessionProfileGenerator.generate(domain, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() });
  expect(sections).toHaveLength(1);
  return sections[0]?.content ?? '';
}

describe('code-session-profile', () => {
  it('session: true の列だけを SessionProfile / SESSION_FIELDS に列挙する', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'member',
          entity: entitySpec('member', [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('display_name', { kind: 'string' }, { personal: true, session: true }),
            field('bio', { kind: 'text' }, { personal: true }),
          ]),
        }),
      ],
    });

    const content = render(domain);

    expect(content).toContain('export type SessionProfile = {');
    expect(content).toContain('readonly display_name: string;');
    expect(content).not.toContain('readonly bio');
    expect(content).not.toContain('readonly id');
    expect(content).toContain("export const SESSION_FIELDS = deepFreeze(['display_name'] as const");
  });

  it('session: true が 0 件でも空の型・空配列を出す(閉世界)', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'venue',
          entity: entitySpec('venue', [field('name', { kind: 'string' })]),
        }),
      ],
    });

    const content = render(domain);

    expect(content).toContain('export type SessionProfile = {\n};');
    expect(content).toContain('export const SESSION_FIELDS = deepFreeze([] as const');
  });

  it('entity_spec が 1 件も無くても空の生成物を出す', () => {
    const content = render(specModel({}));

    expect(content).toContain('export type SessionProfile = {\n};');
    expect(content).toContain('export const SESSION_FIELDS = deepFreeze([] as const');
  });
});
