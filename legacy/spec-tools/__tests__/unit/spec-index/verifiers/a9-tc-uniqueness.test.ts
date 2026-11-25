/**
 * A9(テストケース ID の台帳検査)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md / query-spec-writing.md「テストケース ID は
 * **全仕様(仕様種をまたいで)を通じて一意**」。
 *
 * 以前は一意性を仕様種ごとに見ていた(A6 が action_spec の中、Q6 が query_spec の中)ため、
 * **action_spec × query_spec の重複だけが無検出**だった。その穴が塞がっていることを固定する。
 */

import { describe, expect, it } from 'vitest';
import { tcUniquenessVerifier } from '../../../../lib/spec-index/verifiers/a9-tc-uniqueness.js';
import { buildTcRegistry } from '../../../../lib/testcase/registry.js';
import { collectRetiredTcIds, collectTcEntries } from '../../../../lib/spec-index/sources.js';
import { actionSpec, testCase } from '../../../helpers/trace-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';

const TC = 'TC-ENTRY-SUBMIT-001';
const IMPL = 'app/src/operation/__tests__/entry/submit.test.ts::下書きから提出できる';

/** 指定した ID のテストケースを 1 件だけ持つ action_spec。 */
function action(handles: string, id = TC) {
  return actionSpec({
    handles,
    testCases: [testCase({ id, implementation: IMPL, covers: ['success'] })],
  });
}

/** 指定した ID のテストケースを 1 件だけ持つ query_spec。 */
function query(name: string, id = TC) {
  return querySpec({
    name,
    source: 'workshop',
    for: ['member'],
    scopeUsed: 'all',
    testCases: [testCase({ id, implementation: IMPL, type: 'integration' })],
  });
}

/** 台帳を作る(仕様種は省略できる = その種を持たない構成)。 */
function registry(init: {
  actions?: readonly ReturnType<typeof action>[];
  queries?: readonly ReturnType<typeof query>[];
}) {
  const actionsModel =
    init.actions === undefined
      ? undefined
      : { actions: init.actions, unhandled: [], scans: [], unscanned: [], testTagBaseline: [] };
  return buildTcRegistry(
    collectTcEntries({
      ...(actionsModel === undefined ? {} : { actions: actionsModel }),
      ...(init.queries === undefined
        ? {}
        : { queries: { available: true, queries: init.queries } }),
    }),
    collectRetiredTcIds(actionsModel),
  );
}

describe('A9 テストケース ID の台帳', () => {
  it('ID が全仕様で一意なら通る', () => {
    const built = registry({
      actions: [action('entry.submit'), action('entry.withdraw', 'TC-ENTRY-WITHDRAW-001')],
      queries: [query('workshop_list', 'TC-WORKSHOP-LIST-001')],
    });

    expect(tcUniquenessVerifier.verify(built)).toEqual([]);
  });

  it('同じ ID を 2 つの action_spec が宣言すると違反になる', () => {
    const findings = tcUniquenessVerifier.verify(
      registry({ actions: [action('entry.submit'), action('entry.revise')] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A9');
    expect(findings[0]?.message).toBe(`テストケース ID ${TC} が複数の仕様で宣言されています`);
  });

  it('同じ ID を 2 つの query_spec が宣言すると違反になる', () => {
    const findings = tcUniquenessVerifier.verify(
      registry({ queries: [query('workshop_list'), query('workshop_archive')] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['declared_in']).toContain('query_spec query-workshop-list');
  });

  it('仕様種をまたぐ重複(action_spec × query_spec)を検出する', () => {
    const findings = tcUniquenessVerifier.verify(
      registry({ actions: [action('entry.submit')], queries: [query('workshop_list')] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['declared_in']).toBe(
      'action_spec entry-submit-action(docs/specs/backend/actions/entry/submit.md) / ' +
        'query_spec query-workshop-list(docs/specs/backend/queries/workshop/workshop_list.md)',
    );
  });

  it('反例は重複した全宣言箇所を並べ、位置は先に読み込まれた宣言に付く', () => {
    const findings = tcUniquenessVerifier.verify(
      registry({ actions: [action('entry.submit'), action('entry.revise'), action('entry.withdraw')] }),
    );

    expect(findings[0]?.location.file).toBe('docs/specs/backend/actions/entry/submit.md');
    expect(String(findings[0]?.counterexample?.['declared_in']).split(' / ')).toHaveLength(3);
  });

  it('対処は特定の仕様を名指しせず、宣言箇所は反例に委ねる', () => {
    const findings = tcUniquenessVerifier.verify(
      registry({ actions: [action('entry.submit')], queries: [query('workshop_list')] }),
    );

    expect(findings[0]?.suggestion).toContain('どちらか(後から足した方)');
    expect(findings[0]?.suggestion).toContain('declared_in');
    expect(findings[0]?.suggestion).not.toContain('query-workshop-list');
  });

  it('境界: 台帳が空なら違反は無い', () => {
    expect(tcUniquenessVerifier.verify(registry({}))).toEqual([]);
  });
});

describe('A9 欠番(retired)の再利用', () => {
  /** 欠番リストに TC を持つが、自分の test_cases には無い action_spec。 */
  function retiredOnly(handles: string, id = TC) {
    return actionSpec({ handles, retired: [id] });
  }

  it('欠番にした ID を後から test_cases が再利用すると違反になる', () => {
    const findings = tcUniquenessVerifier.verify(
      registry({ actions: [retiredOnly('entry.withdraw'), action('entry.submit')] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A9');
    expect(findings[0]?.message).toBe(`テストケース ID ${TC} は欠番(retired)にした後、再利用されています`);
    expect(findings[0]?.counterexample).toMatchObject({
      test_case: TC,
      reused_in: expect.stringContaining('entry-submit-action'),
    });
  });

  it('欠番にしただけで誰も再利用していなければ違反にならない', () => {
    const findings = tcUniquenessVerifier.verify(registry({ actions: [retiredOnly('entry.withdraw')] }));

    expect(findings).toEqual([]);
  });

  it('欠番の再利用は query_spec 側でも検出する(仕様種をまたぐ)', () => {
    const findings = tcUniquenessVerifier.verify(
      registry({ actions: [retiredOnly('entry.withdraw')], queries: [query('workshop_list')] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['reused_in']).toContain('query_spec query-workshop-list');
  });
});
