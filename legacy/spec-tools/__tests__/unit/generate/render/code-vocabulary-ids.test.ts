/**
 * ドメイン識別子の恒等表(app/src/domain/generated/vocabulary-ids.ts)の生成器のテスト。
 *
 * 対象の要求: 「集約名・状態 ID・イベント ID を `{ id: id }` の恒等表にし、仕組み側の
 * コード(ウォーカーのオラクル等)が文字列リテラルとして書かずにプロパティアクセスで
 * 引けるようにする」(builder-report-12a2.md ⑫a2)。
 */

import { describe, expect, it } from 'vitest';
import { vocabularyIdsGenerator } from '../../../../lib/generate/render/code-vocabulary-ids.js';
import { aggregate, entitySpec, event, machine, specModel } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

describe('vocabularyIdsGenerator', () => {
  it('ファイル全体モードで app/src/domain/generated/vocabulary-ids.ts を出力する', () => {
    const model = specModel([aggregate('entry', { entity: entitySpec('entry', { fields: [] }) })]);
    const sections = vocabularyIdsGenerator.generate(model, GEN_CTX);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/domain/generated/vocabulary-ids.ts');
    expect(sections[0]?.wholeFile).toBe(true);
  });

  it('集約名を AGGREGATE_IDS の恒等表にする', () => {
    const model = specModel([
      aggregate('entry', { entity: entitySpec('entry', { fields: [] }) }),
      aggregate('workshop', { entity: entitySpec('workshop', { fields: [] }) }),
    ]);
    const content = vocabularyIdsGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('export const AGGREGATE_IDS = {');
    expect(content).toContain("  workshop: 'workshop',");
    expect(content).toContain("  entry: 'entry',");
  });

  it('全状態機械の状態 ID・イベント ID を合併して STATE_IDS / EVENT_IDS にする', () => {
    const model = specModel([
      aggregate('entry', {
        stateMachines: [
          machine('entry', {
            states: ['draft', 'submitted'],
            initial: 'draft',
            events: [event('submit', { from: ['draft'], to: 'submitted' })],
          }),
        ],
      }),
    ]);
    const content = vocabularyIdsGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('export const STATE_IDS = {');
    expect(content).toContain("  draft: 'draft',");
    expect(content).toContain("  submitted: 'submitted',");
    expect(content).toContain('export const EVENT_IDS = {');
    expect(content).toContain("  submit: 'submit',");
  });

  it('複数の機械が同じ状態 ID を持っても 1 つに畳む', () => {
    const model = specModel([
      aggregate('entry', {
        stateMachines: [
          machine('entry', { states: ['draft'], initial: 'draft' }),
          machine('site_page', { states: ['draft', 'published'], initial: 'draft' }),
        ],
      }),
    ]);
    const content = vocabularyIdsGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content.match(/ draft: 'draft',/g)).toHaveLength(1);
  });

  it('集約が 0 件でも閉世界として空のオブジェクトを出す', () => {
    const content = vocabularyIdsGenerator.generate(specModel([]), GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('export const AGGREGATE_IDS = {} as const;');
    expect(content).toContain('export const STATE_IDS = {} as const;');
    expect(content).toContain('export const EVENT_IDS = {} as const;');
  });

  it('同じモデルからは同じ出力になる(生成物の決定性 — ADR-0006)', () => {
    const model = specModel([aggregate('entry', { entity: entitySpec('entry', { fields: [] }) })]);
    const first = vocabularyIdsGenerator.generate(model, GEN_CTX)[0]?.content;
    const second = vocabularyIdsGenerator.generate(model, GEN_CTX)[0]?.content;
    expect(first).toBe(second);
  });
});
