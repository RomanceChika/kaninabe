/**
 * U5(フォーム長)のテスト。
 *
 * ux-lint.md の U5 が要求する 4 つ(状態ごとに数えること・閾値の境界・ロールでの絞り込み・
 * 状態機械を持たないエンティティの扱い)にケースを置く。
 */

import { describe, expect, it } from 'vitest';
import { formLengthVerifier } from '../../../../lib/ux/verifiers/u5-form-length.js';
import { MAX_WRITABLE_FIELDS } from '../../../../lib/model/ux/types.js';
import type { WriteRule } from '../../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  machine,
  role,
  roleSpec,
  specModel,
  write,
} from '../../../helpers/model-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { UX_CTX, uxInput } from '../../../helpers/ux-builder.js';

const ROLES = roleSpec([role('anonymous'), role('member'), role('organizer', undefined, ['member'])]);

/** f0〜f{count-1} のフィールド名。 */
function names(count: number, offset = 0): string[] {
  return Array.from({ length: count }, (_, index) => `f${index + offset}`);
}

/** 状態機械を持つ thing のモデル。 */
function domainWith(writes: readonly WriteRule[], stateful = true) {
  const fields = [
    ...names(12).map((name) => field(name, { kind: 'string' })),
    ...(stateful ? [field('state', { kind: 'state', machine: 'thing' })] : []),
  ];
  return specModel(
    [
      aggregate('thing', {
        entity: entitySpec('thing', { fields }),
        stateMachines: stateful
          ? [machine('thing', { states: ['open', 'closed'], initial: 'open' })]
          : [],
        access: accessSpec('thing', { writes }),
      }),
    ],
    ROLES,
  );
}

/** U5 を実行して指摘を返す。 */
function run(domain: ReturnType<typeof domainWith>, forRoles: readonly string[] = ['member']) {
  return formLengthVerifier.verify(
    uxInput({ domain, screens: [screenSpec({ name: 's', for: forRoles, actions: ['thing.update'] })] }),
    UX_CTX,
  );
}

describe('U5 フォーム長', () => {
  it('閾値は文脈(台帳から引いたもの)が決める — 上げれば通り、下げれば指摘する', () => {
    const domain = domainWith([write('member', names(MAX_WRITABLE_FIELDS + 1), 'state == open')]);
    const input = uxInput({ domain, screens: [screenSpec({ name: 's', actions: ['thing.update'] })] });
    const limits = (maxWritableFields: number) => ({ ...UX_CTX, limits: { maxSimultaneousActions: 7, maxWritableFields } });

    expect(formLengthVerifier.verify(input, limits(MAX_WRITABLE_FIELDS + 1))).toEqual([]);
    const lowered = formLengthVerifier.verify(input, limits(3));
    expect(lowered[0]?.finding.counterexample?.['limit']).toBe('3');
    expect(lowered[0]?.finding.message).toContain('目安 3 個');
  });

  it('閾値ちょうどは通る', () => {
    expect(run(domainWith([write('member', names(MAX_WRITABLE_FIELDS), 'state == open')]))).toEqual([]);
  });

  it('1 つの状態で閾値を超えると警告する', () => {
    const findings = run(domainWith([write('member', names(MAX_WRITABLE_FIELDS + 1), 'state == open')]));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('U5');
    expect(findings[0]?.subject).toBe('thing.update/thing.open');
    expect(findings[0]?.finding.severity).toBe('warning');
  });

  it('状態で分かれていれば通る', () => {
    const findings = run(
      domainWith([
        write('member', names(4), 'state == open'),
        write('member', names(4, 4), 'state == closed'),
      ]),
    );

    expect(findings).toEqual([]);
  });

  it('同じフィールドを 2 つの規則が挙げても入力欄は 1 つ', () => {
    const findings = run(
      domainWith([
        write('member', names(MAX_WRITABLE_FIELDS)),
        write('member', names(MAX_WRITABLE_FIELDS)),
      ]),
    );

    expect(findings).toEqual([]);
  });

  it('画面のロールが編集できない規則は数えない', () => {
    // organizer だけが編集できるフォームを anonymous 向けの画面が数えると、必ず過大に出る。
    const findings = run(domainWith([write('organizer', names(MAX_WRITABLE_FIELDS + 1))]), ['anonymous']);

    expect(findings).toEqual([]);
  });

  it('状態機械を持たないエンティティは状態を添えずに数える', () => {
    const findings = run(domainWith([write('member', names(MAX_WRITABLE_FIELDS + 1))], false));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.subject).toBe('thing.update');
    expect(findings[0]?.finding.counterexample?.['state']).toBeUndefined();
  });

  it('接地しない編集 ID には重ねて指摘しない(S2 の領分)', () => {
    const findings = formLengthVerifier.verify(
      uxInput({
        domain: domainWith([write('member', names(MAX_WRITABLE_FIELDS + 1))]),
        screens: [screenSpec({ name: 's', actions: ['nothing.update'] })],
      }),
      UX_CTX,
    );

    expect(findings).toEqual([]);
  });
});
