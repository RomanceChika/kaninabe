/**
 * A3(input の実在)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「{entity}.{field} が entity_spec に存在する」。
 */

import { describe, expect, it } from 'vitest';
import { inputExistenceVerifier } from '../../../../lib/trace/verifiers/a3-input-existence.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder-v8plus.js';
import { actionSpec, traceInput } from '../../../helpers/trace-builder.js';

/** entry エンティティ(id / title)だけを持つドメイン。 */
function domain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('title', { kind: 'string' }, { required: true }),
        ]),
      }),
    ],
  });
}

describe('A3 input の実在', () => {
  it('entity_spec に実在するフィールドだけなら通る', () => {
    const input = traceInput({
      domain: domain(),
      actions: [actionSpec({ handles: 'entry.submit', input: ['entry.id', 'entry.title'] })],
    });

    expect(inputExistenceVerifier.verify(input)).toEqual([]);
  });

  it('存在しないフィールドは違反になり、既存フィールドが候補に出る', () => {
    const input = traceInput({
      domain: domain(),
      actions: [actionSpec({ handles: 'entry.submit', input: ['entry.subject'] })],
    });

    const findings = inputExistenceVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A3');
    expect(findings[0]?.counterexample?.['known_fields']).toBe('id, title');
  });

  it('存在しないエントリティを指すと別のメッセージで違反になる', () => {
    const input = traceInput({
      domain: domain(),
      actions: [actionSpec({ handles: 'entry.submit', input: ['program.slot'] })],
    });

    const findings = inputExistenceVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('エンティティ program は specs/domain にありません');
  });

  it('境界: input が空でも違反にならない(受けるものが無いアクション)', () => {
    const input = traceInput({
      domain: domain(),
      actions: [actionSpec({ handles: 'entry.submit', input: [] })],
    });

    expect(inputExistenceVerifier.verify(input)).toEqual([]);
  });

  it('境界: 集約名とエンティティ名が違ってもどちらの名前でも引ける', () => {
    const model = specModel({
      aggregates: [
        aggregate({ name: 'entries', entity: entitySpec('entry', [field('id', { kind: 'uuid' })]) }),
      ],
    });
    const input = traceInput({
      domain: model,
      actions: [actionSpec({ handles: 'entry.submit', input: ['entry.id', 'entries.id'] })],
    });

    expect(inputExistenceVerifier.verify(input)).toEqual([]);
  });
});
