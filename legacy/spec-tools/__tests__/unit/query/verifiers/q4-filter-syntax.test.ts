/**
 * Q4(絞り込み式)の規約網羅テスト。
 * 対象の要求: query-spec-writing.md「filters がガード式の文法として妥当で、参照パスが
 * source のフィールド + actor + now で解決できる」。
 *
 * ガードサービスは実物を注入する(文法の正は 1 つであり、スタブを噛ませると
 * 「この式が通るか」の検査そのものが別物になるため)。
 */

import { describe, expect, it } from 'vitest';
import { filterSyntaxVerifier } from '../../../../lib/query/verifiers/q4-filter-syntax.js';
import { aggregate, entitySpec, field, machine, specModel } from '../../../helpers/model-builder.js';
import { QUERY_CTX, queryInput, querySpec } from '../../../helpers/query-builder.js';

/** workshop(state / starts_at / organizer_id)と member を持つドメイン。 */
function domain() {
  return specModel([
    aggregate('workshop', {
      entity: entitySpec('workshop', {
        fields: [
          field('id', { kind: 'uuid' }),
          field('state', { kind: 'state', machine: 'workshop' }),
          field('starts_at', { kind: 'datetime' }),
          field('organizer_id', { kind: 'ref', entity: 'member' }),
        ],
      }),
    }),
    aggregate('member', {
      entity: entitySpec('member', { fields: [field('id', { kind: 'uuid' })] }),
    }),
  ]);
}

/** 検査対象の 1 本を組み立てる。 */
function query(filters: readonly string[], params: readonly { name: string; ref: string }[] = []) {
  return querySpec({
    name: 'workshop_list',
    source: 'workshop',
    for: ['member'],
    scopeUsed: 'all',
    filters,
    params,
  });
}

/** program_item → workshop を context で辿れるドメイン。 */
function contextDomain() {
  return specModel([
    aggregate('program', {
      entity: entitySpec('program_item', {
        context: { workshop: 'program_item.workshop_id' },
        fields: [
          field('id', { kind: 'uuid' }),
          field('workshop_id', { kind: 'ref', entity: 'workshop' }),
          field('order_index', { kind: 'integer' }),
        ],
      }),
    }),
    aggregate('workshop', {
      entity: entitySpec('workshop', {
        fields: [field('id', { kind: 'uuid' }), field('state', { kind: 'state', machine: 'workshop' })],
      }),
    }),
  ]);
}

/** 状態機械 workshop(accepting / closed)を持つドメイン。状態名の突合に使う。 */
function machineDomain() {
  return specModel([
    aggregate('workshop', {
      entity: entitySpec('workshop', {
        fields: [
          field('id', { kind: 'uuid' }),
          field('state', { kind: 'state', machine: 'workshop' }),
          field('listing_kind', { kind: 'enum', values: ['full', 'program_sample'] }),
          field('starts_at', { kind: 'datetime' }),
          field('organizer_id', { kind: 'ref', entity: 'member' }),
        ],
      }),
      stateMachines: [machine('workshop', { states: ['accepting', 'closed'], initial: 'accepting' })],
    }),
    aggregate('member', {
      entity: entitySpec('member', {
        context: { workshop: 'member.id' },
        fields: [field('id', { kind: 'uuid' }), field('display_name', { kind: 'string' })],
      }),
    }),
  ]);
}

describe('Q4 絞り込み式', () => {
  it('source のフィールド・actor・now を参照する式は通る', () => {
    const input = queryInput({
      domain: domain(),
      queries: [
        query([
          'state in [accepting, closed]',
          'now < workshop.starts_at',
          'workshop.organizer_id == actor.id',
        ]),
      ],
    });

    expect(filterSyntaxVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('文法として壊れた式は違反になる', () => {
    const input = queryInput({ domain: domain(), queries: [query(['state =='])] });

    const findings = filterSyntaxVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Q4');
    expect(findings[0]?.message).toContain('解析できません');
  });

  it('source に無いフィールドを参照すると違反になる', () => {
    const input = queryInput({ domain: domain(), queries: [query(['venue == online'])] });

    const findings = filterSyntaxVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('venue');
  });

  it('context に無いエンティティは参照できない', () => {
    const input = queryInput({ domain: domain(), queries: [query(['member.id == actor.id'])] });

    const findings = filterSyntaxVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('context に member がありません');
  });

  it('context で辿れるエンティティのフィールドは参照できる', () => {
    const input = queryInput({
      domain: contextDomain(),
      queries: [
        querySpec({
          name: 'program_list',
          source: 'program_item',
          aggregate: 'program',
          for: ['member'],
          scopeUsed: 'all',
          filters: ['workshop.state == program_published'],
        }),
      ],
    });

    expect(filterSyntaxVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('context 先に無いフィールドは違反になる', () => {
    const input = queryInput({
      domain: contextDomain(),
      queries: [
        querySpec({
          name: 'program_list',
          source: 'program_item',
          aggregate: 'program',
          for: ['member'],
          scopeUsed: 'all',
          filters: ['workshop.venue == online'],
        }),
      ],
    });

    const findings = filterSyntaxVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('workshop にフィールド venue がありません');
  });

  it('宣言済みの param は参照できる', () => {
    const input = queryInput({
      domain: domain(),
      queries: [
        query(['workshop.organizer_id == param.owner_id'], [{ name: 'owner_id', ref: 'member.id' }]),
      ],
    });

    expect(filterSyntaxVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('宣言されていない param を参照すると違反になる', () => {
    const input = queryInput({
      domain: domain(),
      queries: [query(['workshop.organizer_id == param.owner_id'])],
    });

    const findings = filterSyntaxVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('params に owner_id の宣言がありません');
  });

  it('in の値が state 型の状態として実在すれば通る', () => {
    const input = queryInput({
      domain: machineDomain(),
      queries: [query(['state in [accepting, closed]'])],
    });

    expect(filterSyntaxVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('state 型の in に無い状態を並べると違反になる(綴り違いは式としては妥当なので通ってしまう)', () => {
    const input = queryInput({
      domain: machineDomain(),
      queries: [query(['state in [accepting, closd]'])],
    });

    const findings = filterSyntaxVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Q4');
    expect(findings[0]?.message).toContain('closd');
    expect(findings[0]?.message).toContain('状態機械 workshop に無い値があります');
  });

  it('not in の右辺も同じように突き合わせる', () => {
    const input = queryInput({
      domain: machineDomain(),
      queries: [query(['state not in [cancelled]'])],
    });

    const findings = filterSyntaxVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('cancelled');
  });

  it('併読(includes)の filters も検査する — 起点は併読先のエンティティ', () => {
    const input = queryInput({
      domain: machineDomain(),
      queries: [
        querySpec({
          name: 'member_detail',
          source: 'member',
          for: ['member'],
          scopeUsed: 'all',
          returns: 'one',
          includes: [{ entity: 'workshop', scopeUsed: 'all', filters: ['state in [accepting]'] }],
        }),
      ],
    });

    expect(filterSyntaxVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('併読の filters の違反は「どの併読か」を示して報告する', () => {
    const input = queryInput({
      domain: machineDomain(),
      queries: [
        querySpec({
          name: 'member_detail',
          source: 'member',
          for: ['member'],
          scopeUsed: 'all',
          returns: 'one',
          includes: [{ entity: 'workshop', scopeUsed: 'all', filters: ['state in [accepted]'] }],
        }),
      ],
    });

    const findings = filterSyntaxVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('includes.workshop の filters');
    expect(findings[0]?.message).toContain('accepted');
  });

  it('併読の filters は併読先に無いフィールドを参照できない', () => {
    const input = queryInput({
      domain: machineDomain(),
      queries: [
        querySpec({
          name: 'member_detail',
          source: 'member',
          for: ['member'],
          scopeUsed: 'all',
          returns: 'one',
          includes: [{ entity: 'workshop', scopeUsed: 'all', filters: ['display_name == x'] }],
        }),
      ],
    });

    const findings = filterSyntaxVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('workshop にフィールド display_name がありません');
  });

  it('== の右辺が状態として実在すれば通る', () => {
    const input = queryInput({
      domain: machineDomain(),
      queries: [query(['state == accepting'])],
    });

    expect(filterSyntaxVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('== の右辺に無い状態を書くと違反になる', () => {
    const input = queryInput({
      domain: machineDomain(),
      queries: [query(['state == acceptng'])],
    });

    const findings = filterSyntaxVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Q4');
    expect(findings[0]?.message).toContain('状態機械 workshop に無い値があります: acceptng');
    expect(findings[0]?.suggestion).toContain('accepting, closed');
  });

  it('enum の値域も同じ形で突き合わせる', () => {
    const input = queryInput({
      domain: machineDomain(),
      queries: [query(['listing_kind == fulll'])],
    });

    const findings = filterSyntaxVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('enum 宣言 に無い値があります: fulll');
    expect(findings[0]?.counterexample?.declared_by).toBe('enum 宣言');
  });

  it('宣言済みの enum 値なら通る(境界)', () => {
    const input = queryInput({
      domain: machineDomain(),
      queries: [query(['listing_kind == program_sample'])],
    });

    expect(filterSyntaxVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('値域が開いているフィールド(日時・参照)の比較値は突き合わせない(境界)', () => {
    const input = queryInput({
      domain: machineDomain(),
      queries: [query(['now < starts_at', 'organizer_id == actor.id'])],
    });

    expect(filterSyntaxVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('filters が無ければ何も言わない', () => {
    expect(
      filterSyntaxVerifier.verify(queryInput({ domain: domain(), queries: [query([])] }), QUERY_CTX),
    ).toEqual([]);
  });
});
