/**
 * Q5(併読の解決)の規約網羅テスト。
 * 対象の要求: query-spec-writing.md「includes のエンティティが source から context / ref で
 * 辿れ、scope_used が併読先の reads と一致する」。
 */

import { describe, expect, it } from 'vitest';
import { includeResolutionVerifier } from '../../../../lib/query/verifiers/q5-include-resolution.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  read,
  role,
  roleSpec,
  specModel,
} from '../../../helpers/model-builder.js';
import { QUERY_CTX, queryInput, querySpec } from '../../../helpers/query-builder.js';

/**
 * workshop ← entry(ref)・member(参照関係なし)を持つドメイン。
 * entry の reads: performer=own、member の reads: member=all。
 */
function domain() {
  return specModel(
    [
      aggregate('workshop', {
        entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' })] }),
        access: accessSpec('workshop', { reads: [read('performer', 'own')] }),
      }),
      aggregate('entry', {
        entity: entitySpec('entry', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('workshop_id', { kind: 'ref', entity: 'workshop' }),
          ],
        }),
        access: accessSpec('entry', { reads: [read('performer', 'own')] }),
      }),
      aggregate('member', {
        entity: entitySpec('member', { fields: [field('id', { kind: 'uuid' })] }),
        access: accessSpec('member', { reads: [read('performer', 'none')] }),
      }),
    ],
    roleSpec([role('performer')]),
  );
}

/** 検査対象の 1 本を組み立てる。 */
function query(includes: readonly { entity: string; scopeUsed: string }[]) {
  return querySpec({
    name: 'workshop_detail',
    source: 'workshop',
    for: ['performer'],
    scopeUsed: 'own',
    includes,
  });
}

describe('Q5 併読の解決', () => {
  it('逆向きの ref で辿れ、スコープが一致していれば通る', () => {
    const input = queryInput({
      domain: domain(),
      queries: [query([{ entity: 'entry', scopeUsed: 'own' }])],
    });

    expect(includeResolutionVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('specs/domain に無いエンティティは違反になる', () => {
    const input = queryInput({
      domain: domain(),
      queries: [query([{ entity: 'ticket', scopeUsed: 'own' }])],
    });

    const findings = includeResolutionVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Q5');
    expect(findings[0]?.message).toContain('specs/domain にありません');
  });

  it('参照関係で辿れないエンティティは違反になる', () => {
    const input = queryInput({
      domain: domain(),
      queries: [query([{ entity: 'member', scopeUsed: 'all' }])],
    });

    const findings = includeResolutionVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('辿れません');
  });

  it('併読先の reads とスコープが食い違うと違反になる', () => {
    const input = queryInput({
      domain: domain(),
      queries: [query([{ entity: 'entry', scopeUsed: 'all' }])],
    });

    const findings = includeResolutionVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ declared: 'own', used: 'all' });
    expect(findings[0]?.message).toContain('includes.entry.scope_used');
  });

  it('context 宣言でも辿れる', () => {
    const model = specModel(
      [
        aggregate('entry', {
          entity: entitySpec('entry', {
            context: { workshop: 'entry.workshop_id' },
            fields: [field('id', { kind: 'uuid' })],
          }),
          access: accessSpec('entry', { reads: [read('performer', 'own')] }),
        }),
        aggregate('workshop', {
          entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' })] }),
          access: accessSpec('workshop', { reads: [read('performer', 'own')] }),
        }),
      ],
      roleSpec([role('performer')]),
    );
    const input = queryInput({
      domain: model,
      queries: [
        querySpec({
          name: 'entry_detail',
          source: 'entry',
          for: ['performer'],
          scopeUsed: 'own',
          includes: [{ entity: 'workshop', scopeUsed: 'own' }],
        }),
      ],
    });

    expect(includeResolutionVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('includes が無ければ何も言わない', () => {
    expect(
      includeResolutionVerifier.verify(
        queryInput({ domain: domain(), queries: [query([])] }),
        QUERY_CTX,
      ),
    ).toEqual([]);
  });

  /**
   * 併読ごとの via。
   * 対象の要求: query-spec-writing.md「for のロール自身では読めない併読先には via を書く。
   * source の via は includes に継がれない」。
   */
  describe('併読の via', () => {
    /** workshop(member=all)← entry(member=none / performer=own) を持つドメイン。 */
    function detailDomain() {
      return specModel(
        [
          aggregate('workshop', {
            entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' })] }),
            access: accessSpec('workshop', { reads: [read('member', 'all')] }),
          }),
          aggregate('entry', {
            entity: entitySpec('entry', {
              fields: [
                field('id', { kind: 'uuid' }),
                field('workshop_id', { kind: 'ref', entity: 'workshop' }),
              ],
            }),
            access: accessSpec('entry', {
              reads: [read('member', 'none'), read('performer', 'own')],
            }),
          }),
        ],
        roleSpec([role('member'), role('performer', 'entry.performer_id == actor.id', ['member'])]),
      );
    }

    /** 催し詳細 + 自分のエントリー併読の 1 本。 */
    function detail(include: { entity: string; scopeUsed: string; via?: string }) {
      return querySpec({
        name: 'workshop_detail',
        source: 'workshop',
        for: ['member'],
        scopeUsed: 'all',
        includes: [include],
      });
    }

    it('via で関係スコープを借りれば併読できる', () => {
      const input = queryInput({
        domain: detailDomain(),
        queries: [detail({ entity: 'entry', scopeUsed: 'own', via: 'performer' })],
      });

      expect(includeResolutionVerifier.verify(input, QUERY_CTX)).toEqual([]);
    });

    it('via が無ければ「for のロールでは読めない」として違反になる', () => {
      const input = queryInput({
        domain: detailDomain(),
        queries: [detail({ entity: 'entry', scopeUsed: 'own' })],
      });

      const findings = includeResolutionVerifier.verify(input, QUERY_CTX);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('読めません');
    });

    it('併読の via は source 側とは独立に検査される', () => {
      // source(workshop)は member 自身の all で読み、include(entry)だけ performer から借りる。
      const input = queryInput({
        domain: detailDomain(),
        queries: [detail({ entity: 'entry', scopeUsed: 'own', via: 'performer' })],
      });

      expect(includeResolutionVerifier.verify(input, QUERY_CTX)).toEqual([]);
    });
  });
});
