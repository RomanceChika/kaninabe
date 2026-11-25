/**
 * Q1(フィールドの実在)の規約網羅テスト。
 * 対象の要求: query-spec-writing.md「source が entity_spec にあり、projection / sort の
 * フィールドがそのエンティティに実在する」。
 */

import { describe, expect, it } from 'vitest';
import { fieldExistenceVerifier } from '../../../../lib/query/verifiers/q1-field-existence.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { QUERY_CTX, queryInput, querySpec } from '../../../helpers/query-builder.js';

/** workshop(id / title / starts_at)と entry(id / title)を持つドメイン。 */
function domain() {
  return specModel([
    aggregate('workshop', {
      entity: entitySpec('workshop', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('title', { kind: 'string' }, { required: true }),
          field('starts_at', { kind: 'datetime' }, { required: true }),
        ],
      }),
    }),
    aggregate('entry', {
      entity: entitySpec('entry', {
        fields: [field('id', { kind: 'uuid' }), field('title', { kind: 'string' })],
      }),
    }),
  ]);
}

/** 検査対象の 1 本を組み立てる。 */
function query(init: { projection?: readonly string[]; sort?: readonly { field: string }[] }) {
  return querySpec({
    name: 'workshop_list',
    source: 'workshop',
    for: ['member'],
    scopeUsed: 'all',
    ...(init.projection === undefined ? {} : { projection: init.projection }),
    ...(init.sort === undefined ? {} : { sort: init.sort }),
  });
}

describe('Q1 フィールドの実在', () => {
  it('実在するフィールドだけなら通る', () => {
    const input = queryInput({
      domain: domain(),
      queries: [query({ projection: ['id', 'title'], sort: [{ field: 'starts_at' }] })],
    });

    expect(fieldExistenceVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('source が specs/domain に無ければ違反になり、そこで打ち切る', () => {
    const input = queryInput({
      domain: domain(),
      queries: [
        querySpec({
          name: 'ticket_list',
          source: 'ticket',
          for: ['member'],
          scopeUsed: 'all',
          projection: ['nowhere'],
        }),
      ],
    });

    const findings = fieldExistenceVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Q1');
    expect(findings[0]?.message).toContain('source の ticket は specs/domain にありません');
  });

  it('projection に無いフィールドを書くと違反になり、既存フィールドが候補に出る', () => {
    const input = queryInput({ domain: domain(), queries: [query({ projection: ['venue'] })] });

    const findings = fieldExistenceVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('projection の venue');
    expect(findings[0]?.counterexample?.['known_fields']).toBe('id, title, starts_at');
    expect(findings[0]?.suggestion.length).toBeGreaterThan(0);
  });

  it('sort に無いフィールドを書くと違反になる', () => {
    const input = queryInput({
      domain: domain(),
      queries: [query({ projection: ['id'], sort: [{ field: 'created_at' }] })],
    });

    const findings = fieldExistenceVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('sort の created_at');
  });

  it('params の ref が実在すれば通り、実在しなければ違反になる', () => {
    const ok = queryInput({
      domain: domain(),
      queries: [
        querySpec({
          name: 'workshop_detail',
          source: 'workshop',
          for: ['member'],
          scopeUsed: 'all',
          params: [{ name: 'workshop_id', ref: 'workshop.id' }],
        }),
      ],
    });
    const ng = queryInput({
      domain: domain(),
      queries: [
        querySpec({
          name: 'workshop_detail',
          source: 'workshop',
          for: ['member'],
          scopeUsed: 'all',
          params: [{ name: 'venue', ref: 'workshop.venue' }],
        }),
      ],
    });

    expect(fieldExistenceVerifier.verify(ok, QUERY_CTX)).toEqual([]);
    const findings = fieldExistenceVerifier.verify(ng, QUERY_CTX);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('params.venue.ref の venue');
  });

  it('includes の projection も実在を検査する', () => {
    const input = queryInput({
      domain: domain(),
      queries: [
        querySpec({
          name: 'workshop_detail',
          source: 'workshop',
          for: ['member'],
          scopeUsed: 'all',
          includes: [{ entity: 'entry', scopeUsed: 'own', projection: ['id', 'duration_min'] }],
        }),
      ],
    });

    const findings = fieldExistenceVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('includes.entry.projection の duration_min');
  });

  it('includes の sort も実在を検査する', () => {
    const input = queryInput({
      domain: domain(),
      queries: [
        querySpec({
          name: 'workshop_detail',
          source: 'workshop',
          for: ['member'],
          scopeUsed: 'all',
          includes: [
            { entity: 'entry', scopeUsed: 'own', projection: ['id'], sort: [{ field: 'nope' }] },
          ],
        }),
      ],
    });

    const findings = fieldExistenceVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('includes.entry.sort の nope');
  });

  it('query_spec が 1 件も無ければ何も言わない', () => {
    expect(fieldExistenceVerifier.verify(queryInput({ domain: domain() }), QUERY_CTX)).toEqual([]);
  });
});
