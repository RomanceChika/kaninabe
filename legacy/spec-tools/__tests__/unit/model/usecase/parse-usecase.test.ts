/**
 * usecase_spec パーサー(Y0)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md「書けるのは allowlist のキーだけ(ADR-0011 §2)」。
 */

import { describe, expect, it } from 'vitest';
import { parseUsecaseSpec } from '../../../../lib/model/usecase/parse-usecase.js';

const FILE = 'docs/specs/frontend/usecases/entry_self.md';

const VALID = {
  doc_type: 'usecase_spec',
  scope: 'frontend',
  id: 'usecase-entry-self',
  name: 'entry_self',
  goal: '自分一人で発表枠に申し込む',
  actor: 'member',
  start: 'screen-workshop-list',
  done: 'entry.state == submitted',
  saves: [
    {
      id: 'register',
      label: '申し込む',
      migration: '20260908000050_usecase_entry_self_register.sql',
      steps: [{ op: 'entry.create' }, { op: 'entry.submit' }],
    },
  ],
  test_cases: [
    {
      id: 'TC-USECASE-ENTRY_SELF-001',
      type: 'integration',
      covers: ['success'],
      spec_ids: ['usecase-entry-self'],
      implementation:
        'app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::entry_self.register の複合 RPC が宣言どおりの署名で実在する',
    },
  ],
};

describe('parseUsecaseSpec', () => {
  it('allowlist どおりの宣言を読める', () => {
    const result = parseUsecaseSpec(VALID, FILE, 'entry_self.md');

    expect(result.findings).toEqual([]);
    expect(result.value).toMatchObject({
      id: 'usecase-entry-self',
      name: 'entry_self',
      actor: 'member',
      saves: [
        { id: 'register', label: '申し込む', migration: '20260908000050_usecase_entry_self_register.sql' },
      ],
    });
  });

  it('allowlist に無いキーは Y0 違反になる(ADR-0011 §2: ガードは書けない)', () => {
    const result = parseUsecaseSpec({ ...VALID, guard: 'workshop.state == accepting' }, FILE, 'entry_self.md');

    expect(result.findings.some((f) => f.message.includes('guard') && f.message.includes('書けません'))).toBe(true);
  });

  it('as / label を読み、書かなければ null になる(鍵は op)', () => {
    const withAlias = {
      ...VALID,
      saves: [
        {
          id: 'register',
          label: '申し込む',
          migration: '20260908000050_usecase_entry_self_register.sql',
          steps: [
            { op: 'entry.create' },
            { op: 'entry_participant.create', as: 'self', label: '自分' },
            { op: 'entry_participant.create', as: 'others', repeat: true },
          ],
        },
      ],
    };

    const result = parseUsecaseSpec(withAlias, FILE, 'entry_self.md');

    expect(result.findings).toEqual([]);
    expect(result.value?.saves[0]?.steps).toMatchObject([
      { op: 'entry.create', alias: null, label: null },
      { op: 'entry_participant.create', alias: 'self', label: '自分' },
      { op: 'entry_participant.create', alias: 'others', label: null, repeat: true },
    ]);
  });

  it('as が snake_case でなければ Y0 違反になる', () => {
    const badAlias = {
      ...VALID,
      saves: [
        {
          id: 'register',
          label: '申し込む',
          migration: '20260908000050_usecase_entry_self_register.sql',
          steps: [{ op: 'entry.create', as: 'Self' }],
        },
      ],
    };

    const result = parseUsecaseSpec(badAlias, FILE, 'entry_self.md');

    expect(result.value).toBeNull();
    expect(result.findings.some((f) => f.message.includes('as Self が snake_case ではありません'))).toBe(true);
  });

  it('defaults.self: false は意味を持たないので違反になる', () => {
    const withFalseSelf = {
      ...VALID,
      saves: [
        {
          id: 'register',
          label: '申し込む',
          migration: '20260908000050_usecase_entry_self_register.sql',
          steps: [{ op: 'entry.create', defaults: { self: false } }],
        },
      ],
    };
    const result = parseUsecaseSpec(withFalseSelf, FILE, 'entry_self.md');

    expect(result.value).toBeNull();
    expect(result.findings.some((f) => f.message.includes('self: false'))).toBe(true);
  });

  it('budget の指標が null なら error で名指すが数えない(既定値に戻ることは error が言う)。型違いの値は数える', () => {
    const nulled = parseUsecaseSpec({ ...VALID, budget: { inputs: null } }, FILE, 'entry_self.md');
    const typo = parseUsecaseSpec({ ...VALID, budget: { inputs: 'abc' } }, FILE, 'entry_self.md');

    expect(nulled.findings.map((f) => f.message)).toEqual([expect.stringContaining('budget.inputs が null です')]);
    expect(nulled.dropped).toBe(0);
    expect(nulled.value?.budget).toEqual({});
    expect(typo.findings.some((f) => f.severity === 'error')).toBe(true);
    expect(typo.dropped).toBeGreaterThan(0);
  });

  it('accept は予算の指標(metric)でも不変条件(invariant)でも書ける', () => {
    const result = parseUsecaseSpec(
      {
        ...VALID,
        accept: [
          { metric: 'inputs', reason: '面倒の実物を記録する場所だから' },
          { invariant: 'INV-ENTRY-008', reason: '行を作るだけで合計を変えないから' },
        ],
      },
      FILE,
      'entry_self.md',
    );

    expect(result.findings).toEqual([]);
    expect(result.value?.accept).toEqual([
      expect.objectContaining({ kind: 'budget', metric: 'inputs' }),
      expect.objectContaining({ kind: 'invariant', invariant: 'INV-ENTRY-008' }),
    ]);
  });

  it('accept の 1 要素に metric と invariant の両方は書けない(何を受け入れたか決まらない)', () => {
    const result = parseUsecaseSpec(
      { ...VALID, accept: [{ metric: 'inputs', invariant: 'INV-ENTRY-008', reason: '理由' }] },
      FILE,
      'entry_self.md',
    );

    expect(result.findings.some((f) => f.message.includes('両方は書けません'))).toBe(true);
  });

  it('accept の 1 要素に受け入れる対象が無ければ違反になる', () => {
    const result = parseUsecaseSpec({ ...VALID, accept: [{ reason: '理由' }] }, FILE, 'entry_self.md');

    expect(result.findings.some((f) => f.message.includes('metric も invariant もありません'))).toBe(true);
  });
});
