/**
 * Q2(スコープ整合)の規約網羅テスト。
 * 対象の要求: query-spec-writing.md「for の各ロールについて access_spec の reads に宣言があり、
 * scope_used と一致する。scope: none のロールが for に居たらエラー」。
 */

import { describe, expect, it } from 'vitest';
import { scopeConsistencyVerifier } from '../../../../lib/query/verifiers/q2-scope-consistency.js';
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

/** workshop の reads: member=all / organizer=own / anonymous=none。 */
function domain(withAccess = true) {
  return specModel(
    [
      aggregate('workshop', {
        entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' })] }),
        ...(withAccess
          ? {
              access: accessSpec('workshop', {
                reads: [read('member', 'all'), read('organizer', 'own'), read('anonymous', 'none')],
              }),
            }
          : {}),
      }),
    ],
    roleSpec([role('member'), role('organizer'), role('anonymous')]),
  );
}

/** 検査対象の 1 本を組み立てる。 */
function query(forRoles: readonly string[], scopeUsed: string) {
  return querySpec({ name: 'workshop_list', source: 'workshop', for: forRoles, scopeUsed });
}

describe('Q2 スコープ整合', () => {
  it('reads の宣言と scope_used が一致していれば通る', () => {
    const input = queryInput({ domain: domain(), queries: [query(['member'], 'all')] });

    expect(scopeConsistencyVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('scope_used が reads と食い違うと違反になり、宣言側の値が反例に出る', () => {
    const input = queryInput({ domain: domain(), queries: [query(['organizer'], 'all')] });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Q2');
    expect(findings[0]?.counterexample).toMatchObject({ declared: 'own', used: 'all' });
  });

  it('scope: none のロールを for に並べると違反になる', () => {
    const input = queryInput({ domain: domain(), queries: [query(['anonymous'], 'all')] });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('読めません');
    expect(findings[0]?.counterexample?.['scope']).toBe('none');
  });

  it('roles.md に無いロールを for に並べると違反になる', () => {
    const input = queryInput({ domain: domain(), queries: [query(['guest'], 'all')] });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('roles.md にありません');
  });

  it('reads の宣言そのものが無いロールは違反になる', () => {
    const model = specModel(
      [
        aggregate('workshop', {
          entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' })] }),
          access: accessSpec('workshop', { reads: [read('member', 'all')] }),
        }),
      ],
      roleSpec([role('member'), role('organizer')]),
    );
    const input = queryInput({ domain: model, queries: [query(['organizer'], 'own')] });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('reads 宣言がありません');
  });

  it('source に access_spec が無ければ 1 件の違反にまとめる', () => {
    const input = queryInput({ domain: domain(false), queries: [query(['member'], 'all')] });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('access_spec がありません');
  });

  it('文脈依存ロールを for に並べると違反になり、via に分けるよう促す', () => {
    const model = specModel(
      [
        aggregate('workshop', {
          entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' })] }),
          access: accessSpec('workshop', {
            reads: [read('member', 'all'), read('performer', 'own')],
          }),
        }),
      ],
      roleSpec([role('member'), role('performer', 'entry.performer_id == actor.id', ['member'])]),
    );
    const input = queryInput({ domain: model, queries: [query(['performer'], 'own')] });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings.map((finding) => finding.message)).toContainEqual(
      expect.stringContaining('文脈依存ロールです'),
    );
    expect(findings[0]?.suggestion).toContain('via: performer');
    // 指摘の位置は for の当該要素まで示す(どの要素を直すかが分かるように)。
    expect(findings[0]?.location.pointer).toBe('for.performer');
  });

  it('context スコープは対象エンティティまで含めて比較する', () => {
    const model = specModel(
      [
        aggregate('entry', {
          entity: entitySpec('entry', { fields: [field('id', { kind: 'uuid' })] }),
          access: accessSpec('entry', { reads: [read('organizer', 'context(workshop)')] }),
        }),
      ],
      roleSpec([role('organizer')]),
    );
    const ok = queryInput({
      domain: model,
      queries: [
        querySpec({
          name: 'entry_list',
          source: 'entry',
          for: ['organizer'],
          scopeUsed: 'context(workshop)',
        }),
      ],
    });
    const ng = queryInput({
      domain: model,
      queries: [
        querySpec({
          name: 'entry_list',
          source: 'entry',
          for: ['organizer'],
          scopeUsed: 'context(member)',
        }),
      ],
    });

    expect(scopeConsistencyVerifier.verify(ok, QUERY_CTX)).toEqual([]);
    expect(scopeConsistencyVerifier.verify(ng, QUERY_CTX)).toHaveLength(1);
  });
});

/**
 * via（可視性の供給元）の借用規則。
 * 対象の要求: query-spec-writing.md「§via の借用が成立する 3 条件」。
 */
describe('Q2 via の借用', () => {
  /** entry の reads: member=none / performer=own / organizer=context(workshop) / anonymous=all。 */
  function entryDomain(options: { performerScope?: string; implies?: readonly string[] } = {}) {
    return specModel(
      [
        aggregate('entry', {
          entity: entitySpec('entry', { fields: [field('id', { kind: 'uuid' })] }),
          access: accessSpec('entry', {
            reads: [
              read('member', 'none'),
              read('performer', options.performerScope ?? 'own'),
              read('organizer', 'context(workshop)'),
              read('anonymous', 'all'),
            ],
          }),
        }),
      ],
      roleSpec([
        role('member'),
        role('anonymous'),
        role('performer', 'entry.performer_id == actor.id', options.implies ?? ['member']),
        role('organizer', 'workshop.organizer_id == actor.id', ['member']),
      ]),
    );
  }

  /** for: [member] + via の 1 本を組み立てる。 */
  function viaQuery(via: string, scopeUsed: string) {
    return querySpec({ name: 'entry_own_list', source: 'entry', for: ['member'], via, scopeUsed });
  }

  it('via が for のロールを含意し、関係スコープが一致すれば通る', () => {
    const input = queryInput({
      domain: entryDomain(),
      queries: [viaQuery('performer', 'own')],
    });

    expect(scopeConsistencyVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('context スコープも借りられる', () => {
    const input = queryInput({
      domain: entryDomain(),
      queries: [viaQuery('organizer', 'context(workshop)')],
    });

    expect(scopeConsistencyVerifier.verify(input, QUERY_CTX)).toEqual([]);
  });

  it('条件① via が for のロールを含意していなければ違反になる', () => {
    const input = queryInput({
      domain: entryDomain({ implies: [] }),
      queries: [viaQuery('performer', 'own')],
    });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('含意していません');
  });

  it('条件② all は借りられない（宣言の可読性が壊れるため）', () => {
    const input = queryInput({
      domain: entryDomain({ performerScope: 'all' }),
      queries: [viaQuery('performer', 'all')],
    });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('all を借りられません');
    expect(findings[0]?.counterexample).toMatchObject({ declared: 'all' });
  });

  it('条件③ for のロール自身で読めるなら via は不要（書けば違反）', () => {
    const model = specModel(
      [
        aggregate('entry', {
          entity: entitySpec('entry', { fields: [field('id', { kind: 'uuid' })] }),
          access: accessSpec('entry', { reads: [read('member', 'own'), read('performer', 'own')] }),
        }),
      ],
      roleSpec([role('member'), role('performer', 'entry.performer_id == actor.id', ['member'])]),
    );
    const input = queryInput({ domain: model, queries: [viaQuery('performer', 'own')] });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('不要です');
  });

  it('借りたスコープが scope_used と食い違えば違反になる', () => {
    const input = queryInput({
      domain: entryDomain(),
      queries: [viaQuery('performer', 'context(workshop)')],
    });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ declared: 'own', used: 'context(workshop)' });
  });

  it('via に文脈依存でないロール(binding が無い)を書くと違反になる', () => {
    // 借りるのは「関係」であり、グローバルロールの宣言は誰にとっても同じなので借用の対象にならない。
    const model = specModel(
      [
        aggregate('entry', {
          entity: entitySpec('entry', { fields: [field('id', { kind: 'uuid' })] }),
          access: accessSpec('entry', {
            reads: [read('member', 'none'), read('staff', 'own')],
          }),
        }),
      ],
      roleSpec([role('member'), role('staff', undefined, ['member'])]),
    );
    const input = queryInput({ domain: model, queries: [viaQuery('staff', 'own')] });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('文脈依存ロールではありません');
  });

  it('via と for に同じロールを書くと専用の指摘になる', () => {
    const input = queryInput({
      domain: entryDomain(),
      queries: [
        querySpec({
          name: 'entry_own_list',
          source: 'entry',
          for: ['performer'],
          via: 'performer',
          scopeUsed: 'own',
        }),
      ],
    });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);
    const messages = findings.map((finding) => finding.message);

    // 「performer が performer を含意していません」という無意味な助言にはしない。
    expect(messages).toContainEqual(expect.stringContaining('via と for に同じロール'));
    expect(messages.join('')).not.toContain('含意していません');
  });

  it('via のロールが roles.md に無ければ違反になる', () => {
    const input = queryInput({ domain: entryDomain(), queries: [viaQuery('guest', 'own')] });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('roles.md にありません');
  });

  it('via のロール自身が読めない（reads が無い / none）なら違反になる', () => {
    const model = specModel(
      [
        aggregate('entry', {
          entity: entitySpec('entry', { fields: [field('id', { kind: 'uuid' })] }),
          access: accessSpec('entry', {
            reads: [read('member', 'none'), read('performer', 'none')],
          }),
        }),
      ],
      roleSpec([role('member'), role('performer', 'entry.performer_id == actor.id', ['member'])]),
    );
    const input = queryInput({ domain: model, queries: [viaQuery('performer', 'own')] });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('読めません');
  });

  it('暗黙の implies 歩きはしない（via 無しでは member の宣言だけを見る）', () => {
    // performer が member を含意していても、via を書かなければ borrow は起きない。
    const input = queryInput({
      domain: entryDomain(),
      queries: [
        querySpec({ name: 'entry_own_list', source: 'entry', for: ['member'], scopeUsed: 'own' }),
      ],
    });

    const findings = scopeConsistencyVerifier.verify(input, QUERY_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toContain('via');
  });
});
