/**
 * A8(spec_ids の実在)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「`test_cases[].spec_ids` が実在する仕様 ID を指す。
 * 書けるのは値域(ドメインイベント ID / 予約 ID / access_spec の id / 不変条件 ID)」。
 */

import { describe, expect, it } from 'vitest';
import { specIdGroundingVerifier } from '../../../../lib/trace/verifiers/a8-spec-ids.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
  event,
  invariant,
  invariantSpec,
  machine,
  role,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { actionSpec, testCase, traceInput } from '../../../helpers/trace-builder.js';

/**
 * entry.submit(遷移)・creates / deletes / writes(予約 ID)・entry-access・INV-ENTRY-001 を
 * すべて持つドメイン。値域の 4 種を 1 つのモデルで覆う。
 */
function domain() {
  return specModel({
    roles: [role('member'), role('performer')],
    aggregates: [
      aggregate({
        name: 'entry',
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['performer'] })],
          }),
        ],
        access: accessSpec('entry', {
          id: 'entry-access',
          creates: [createRule('member')],
          deletes: [deleteRule('performer')],
          writes: [writeRule('performer', ['note'])],
        }),
        invariants: invariantSpec([invariant({ id: 'INV-ENTRY-001' })]),
      }),
    ],
  });
}

/** spec_ids だけを差し替えた 1 件の action_spec を検証する。 */
function verify(specIds: readonly string[]) {
  const action = actionSpec({
    handles: 'entry.submit',
    testCases: [
      testCase({
        id: 'TC-ENTRY-SUBMIT-001',
        specIds,
        covers: ['success'],
        implementation: 'app/src/operation/__tests__/entry/submit.test.ts::下書きから提出できる',
      }),
    ],
  });
  return specIdGroundingVerifier.verify(traceInput({ domain: domain(), actions: [action] }));
}

describe('A8 spec_ids の実在', () => {
  it('ドメインイベント ID を指していれば通る', () => {
    expect(verify(['entry.submit'])).toEqual([]);
  });

  it('予約 ID(create / delete / update)も宣言があれば通る', () => {
    expect(verify(['entry.create', 'entry.delete', 'entry.update'])).toEqual([]);
  });

  it('access_spec の id と不変条件 ID も通る', () => {
    expect(verify(['entry-access', 'INV-ENTRY-001'])).toEqual([]);
  });

  it('実在しない ID は違反になり、どのケースの何が接地していないかを示す', () => {
    const findings = verify(['entry.approve']);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A8');
    expect(findings[0]?.message).toContain('entry.approve');
    expect(findings[0]?.counterexample).toMatchObject({
      test_case: 'TC-ENTRY-SUBMIT-001',
      spec_id: 'entry.approve',
    });
    expect(findings[0]?.suggestion.length).toBeGreaterThan(0);
  });

  it('宣言の無い予約 ID は接地しない(誰も作れないなら entity.create は無い)', () => {
    const model = specModel({
      roles: [role('member')],
      aggregates: [aggregate({ name: 'entry', access: accessSpec('entry') })],
    });
    const action = actionSpec({
      handles: 'entry.create',
      testCases: [
        testCase({
          id: 'TC-ENTRY-CREATE-001',
          specIds: ['entry.create'],
          covers: ['success'],
          implementation: 'app/src/operation/__tests__/entry/create.test.ts::作れる',
        }),
      ],
    });

    const findings = specIdGroundingVerifier.verify(traceInput({ domain: model, actions: [action] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('entry.create');
  });

  it('実在しない ID が複数あればすべて指摘する(1 件で止めない)', () => {
    expect(verify(['entry.approve', 'INV-NOPE-001'])).toHaveLength(2);
  });

  it('action_spec が 1 件も無ければ何も言わない', () => {
    expect(specIdGroundingVerifier.verify(traceInput({ domain: domain() }))).toEqual([]);
  });
});
