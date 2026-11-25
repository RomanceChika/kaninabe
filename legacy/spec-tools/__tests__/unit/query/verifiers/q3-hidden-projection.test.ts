/**
 * Q3(隠しフィールドの衝突)の規約網羅テスト。
 * 対象の要求: query-spec-writing.md「fields_hidden で for のロールから隠されるフィールドが
 * projection に含まれていたらエラー」。
 */

import { describe, expect, it } from 'vitest';
import { hiddenProjectionVerifier } from '../../../../lib/query/verifiers/q3-hidden-projection.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  loc,
  read,
  role,
  roleSpec,
  specModel,
} from '../../../helpers/model-builder.js';
import { QUERY_CTX, queryInput, querySpec } from '../../../helpers/query-builder.js';

/** entry の note は member から隠す。 */
function domain() {
  return specModel(
    [
      aggregate('entry', {
        entity: entitySpec('entry', {
          fields: [field('id', { kind: 'uuid' }), field('note', { kind: 'text' })],
        }),
        access: accessSpec('entry', {
          reads: [read('member', 'all'), read('performer', 'own')],
          fieldsHidden: [
            { field: 'note', from: ['member'], location: loc('docs/specs/domain/entry/access.md') },
          ],
        }),
      }),
    ],
    roleSpec([role('member'), role('performer')]),
  );
}

/** workshop から entry を併読するドメイン(entry の note は member から隠す)。 */
function domainWithInclude() {
  return specModel(
    [
      aggregate('workshop', {
        entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' })] }),
        access: accessSpec('workshop', { reads: [read('member', 'all')] }),
      }),
      aggregate('entry', {
        entity: entitySpec('entry', {
          fields: [field('id', { kind: 'uuid' }), field('note', { kind: 'text' })],
        }),
        access: accessSpec('entry', {
          reads: [read('member', 'all')],
          fieldsHidden: [
            { field: 'note', from: ['member'], location: loc('docs/specs/domain/entry/access.md') },
          ],
        }),
      }),
    ],
    roleSpec([role('member')]),
  );
}

/** 検査対象の 1 本を組み立てる。 */
function query(forRoles: readonly string[], projection: readonly string[]) {
  return querySpec({
    name: 'entry_list',
    source: 'entry',
    for: forRoles,
    scopeUsed: forRoles.includes('member') ? 'all' : 'own',
    projection,
  });
}

describe('Q3 隠しフィールドの衝突', () => {
  it('隠されないロールが隠しフィールドを返すのは通る', () => {
    const input = queryInput({ domain: domain(), queries: [query(['performer'], ['id', 'note'])] });

    expect(hiddenProjectionVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('隠されるフィールドを projection に入れると違反になる', () => {
    const input = queryInput({ domain: domain(), queries: [query(['member'], ['id', 'note'])] });

    const findings = hiddenProjectionVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Q3');
    expect(findings[0]?.counterexample).toMatchObject({ field: 'note', roles: 'member' });
  });

  it('隠しフィールドを返さなければ通る', () => {
    const input = queryInput({ domain: domain(), queries: [query(['member'], ['id'])] });

    expect(hiddenProjectionVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('隠しフィールドでの絞り込みも違反になる(件数から漏れる)', () => {
    const input = queryInput({
      domain: domain(),
      queries: [
        querySpec({
          name: 'entry_list',
          source: 'entry',
          for: ['member'],
          scopeUsed: 'all',
          projection: ['id'],
          filters: ['note != none'],
        }),
      ],
    });

    const findings = hiddenProjectionVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['where']).toBe('filters');
  });

  it('隠しフィールドでの並べ替えも違反になる(順序から漏れる)', () => {
    const input = queryInput({
      domain: domain(),
      queries: [
        querySpec({
          name: 'entry_list',
          source: 'entry',
          for: ['member'],
          scopeUsed: 'all',
          projection: ['id'],
          sort: [{ field: 'note' }],
        }),
      ],
    });

    const findings = hiddenProjectionVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['where']).toBe('sort');
  });

  it('includes の projection も検査対象にする', () => {
    const model = domainWithInclude();
    const input = queryInput({
      domain: model,
      queries: [
        querySpec({
          name: 'workshop_detail',
          source: 'workshop',
          for: ['member'],
          scopeUsed: 'all',
          projection: ['id'],
          includes: [{ entity: 'entry', scopeUsed: 'all', projection: ['note'] }],
        }),
      ],
    });

    const findings = hiddenProjectionVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('includes.entry.projection の note');
  });

  it('includes の filters も検査対象にする(併読でも件数から中身が漏れる)', () => {
    const model = domainWithInclude();
    const input = queryInput({
      domain: model,
      queries: [
        querySpec({
          name: 'workshop_detail',
          source: 'workshop',
          for: ['member'],
          scopeUsed: 'all',
          projection: ['id'],
          includes: [
            { entity: 'entry', scopeUsed: 'all', projection: ['id'], filters: ['note == x'] },
          ],
        }),
      ],
    });

    const findings = hiddenProjectionVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('includes.entry.filters の note');
  });

  it('via があるときは via のロールを基準に判定する(本人には見えてよい)', () => {
    const model = specModel(
      [
        aggregate('entry', {
          entity: entitySpec('entry', {
            fields: [field('id', { kind: 'uuid' }), field('note', { kind: 'text' })],
          }),
          access: accessSpec('entry', {
            reads: [read('member', 'none'), read('performer', 'own')],
            fieldsHidden: [
              {
                field: 'note',
                from: ['member'],
                location: loc('docs/specs/domain/entry/access.md'),
              },
            ],
          }),
        }),
      ],
      roleSpec([role('member'), role('performer', 'entry.performer_id == actor.id', ['member'])]),
    );
    const input = queryInput({
      domain: model,
      queries: [
        querySpec({
          name: 'entry_own_list',
          source: 'entry',
          for: ['member'],
          via: 'performer',
          scopeUsed: 'own',
          projection: ['id', 'note'],
        }),
      ],
    });

    expect(hiddenProjectionVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('via のロールから隠されるフィールドは違反になる(基準がずれるだけで無効化はしない)', () => {
    const model = specModel(
      [
        aggregate('entry', {
          entity: entitySpec('entry', {
            fields: [field('id', { kind: 'uuid' }), field('note', { kind: 'text' })],
          }),
          access: accessSpec('entry', {
            reads: [read('member', 'none'), read('performer', 'own')],
            fieldsHidden: [
              {
                field: 'note',
                from: ['member', 'performer'],
                location: loc('docs/specs/domain/entry/access.md'),
              },
            ],
          }),
        }),
      ],
      roleSpec([role('member'), role('performer', 'entry.performer_id == actor.id', ['member'])]),
    );
    const input = queryInput({
      domain: model,
      queries: [
        querySpec({
          name: 'entry_own_list',
          source: 'entry',
          for: ['member'],
          via: 'performer',
          scopeUsed: 'own',
          projection: ['id', 'note'],
        }),
      ],
    });

    const findings = hiddenProjectionVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ field: 'note', roles: 'performer' });
  });

  it('includes の via は併読ごとに効き、source 側の判定には影響しない', () => {
    const model = specModel(
      [
        aggregate('workshop', {
          entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' })] }),
          access: accessSpec('workshop', { reads: [read('member', 'all')] }),
        }),
        aggregate('entry', {
          entity: entitySpec('entry', {
            fields: [field('id', { kind: 'uuid' }), field('note', { kind: 'text' })],
          }),
          access: accessSpec('entry', {
            reads: [read('member', 'none'), read('performer', 'own')],
            fieldsHidden: [
              {
                field: 'note',
                from: ['member'],
                location: loc('docs/specs/domain/entry/access.md'),
              },
            ],
          }),
        }),
      ],
      roleSpec([role('member'), role('performer', 'entry.performer_id == actor.id', ['member'])]),
    );
    const input = queryInput({
      domain: model,
      queries: [
        querySpec({
          name: 'workshop_detail',
          source: 'workshop',
          for: ['member'],
          scopeUsed: 'all',
          projection: ['id'],
          includes: [
            { entity: 'entry', scopeUsed: 'own', via: 'performer', projection: ['id', 'note'] },
          ],
        }),
      ],
    });

    expect(hiddenProjectionVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('access_spec が無い source では何も言わない(Q2 が指摘する)', () => {
    const model = specModel([
      aggregate('entry', {
        entity: entitySpec('entry', { fields: [field('note', { kind: 'text' })] }),
      }),
    ]);
    const input = queryInput({ domain: model, queries: [query(['member'], ['note'])] });

    expect(hiddenProjectionVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });
});
