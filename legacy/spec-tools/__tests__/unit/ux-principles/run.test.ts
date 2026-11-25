/**
 * U8(UX 原則の台帳の整合)と、台帳から引く閾値のユニットテスト。
 *
 * 規約網羅(ux-lint.md §台帳の整合 / §閾値と根拠):
 *   - enforced_by が advisory か実在する検査 ID であること
 *   - U 群の検証器すべてと Y5 の 6 指標が 1 行ずつ載っていること
 *   - budget は U4 / U5 / Y5 の行に必須・advisory の行には書けない
 *   - affects: confirm_required は U1 の行にだけ
 *   - Y5 を見張る行の id は Y5-{指標} だけ(余り行は未知の原則 id)
 *   - 台帳が無い・読めないときは何も言わず、閾値は定数の既定値になる
 */

import { describe, expect, it } from 'vitest';
import { usecaseBudgetDefaultsOf, uxLimitsOf } from '../../../lib/ux-principles/limits.js';
import { verifyUxPrinciples } from '../../../lib/ux-principles/run.js';
import { NO_UX_PRINCIPLES, type UxPrincipleDecl, type UxPrinciplesModel } from '../../../lib/model/ux-principles/types.js';
import { DEFAULT_USECASE_BUDGET } from '../../../lib/model/usecase/types.js';
import { MAX_SIMULTANEOUS_ACTIONS, MAX_WRITABLE_FIELDS } from '../../../lib/model/ux/types.js';

const FILE = 'docs/specs/frontend/ux-principles.md';
const KNOWN = { ux: ['U1', 'U2', 'U3', 'U4', 'U5'], usecase: ['Y5'] };

/** 原則 1 行。 */
function row(
  id: string,
  enforcedBy: string,
  extra: Pick<UxPrincipleDecl, 'budget' | 'affects'> = {},
): UxPrincipleDecl {
  return { id, statement: `${id} の原則`, derives: [], enforcedBy, ...extra, location: { file: FILE, pointer: `principles.${id}` } };
}

/** 揃った台帳の行(欠けを作るテストはここから抜く)。 */
function fullRows(): UxPrincipleDecl[] {
  return [
    row('U1', 'U1', { affects: 'confirm_required' }),
    row('U2', 'U2'),
    row('U3', 'U3'),
    row('U4', 'U4', { budget: { limit: 7 } }),
    row('U5', 'U5', { budget: { limit: 7 } }),
    row('Y5-steps', 'Y5', { budget: { limit: 4 } }),
    row('Y5-screens', 'Y5', { budget: { limit: 2 } }),
    row('Y5-concepts', 'Y5', { budget: { limit: 3 } }),
    row('Y5-preconditions', 'Y5', { budget: { limit: 2 } }),
    row('Y5-inputs', 'Y5', { budget: { limit: 8 } }),
    row('Y5-confirmations', 'Y5', { budget: { limit: 1 } }),
    row('U6', 'advisory'),
  ];
}

/** 行から台帳モデルを作る。 */
function model(rows: readonly UxPrincipleDecl[]): UxPrinciplesModel {
  return { available: true, spec: { id: 'ux-principles', principles: rows, location: { file: FILE } } };
}

describe('U8: 台帳の整合', () => {
  it('揃った台帳は指摘なし', () => {
    expect(verifyUxPrinciples(model(fullRows()), KNOWN)).toEqual([]);
  });

  it('台帳が無い・構築できていないときは何も言わない', () => {
    expect(verifyUxPrinciples(NO_UX_PRINCIPLES, KNOWN)).toEqual([]);
    expect(verifyUxPrinciples({ available: true, spec: null }, KNOWN)).toEqual([]);
  });

  it('enforced_by が実在しない検査 ID ならエラー', () => {
    const findings = verifyUxPrinciples(model([...fullRows(), row('U9', 'U9')]), KNOWN);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'U8', severity: 'error' });
    expect(findings[0]?.message).toContain('実在する検査 ID ではありません');
  });

  it('U 群の検証器を見張る行が欠けていればエラー', () => {
    const findings = verifyUxPrinciples(model(fullRows().filter((r) => r.id !== 'U3')), KNOWN);

    expect(findings.map((f) => f.counterexample?.['missing'])).toEqual(['U3']);
    expect(findings[0]?.message).toContain('検査 U3 を見張る原則の行がありません');
  });

  it('Y5 の指標の行が欠けていればエラー', () => {
    const findings = verifyUxPrinciples(model(fullRows().filter((r) => r.id !== 'Y5-inputs')), KNOWN);

    expect(findings.map((f) => f.counterexample?.['missing'])).toEqual(['Y5-inputs']);
  });

  it('Y5 を検査器の一覧が持たない構成では Y5 の行を要求しない', () => {
    const rows = fullRows().filter((r) => r.enforcedBy !== 'Y5');

    expect(verifyUxPrinciples(model(rows), { ux: KNOWN.ux, usecase: [] })).toEqual([]);
  });

  it('U4 / U5 / Y5 の行に budget が無ければエラー', () => {
    const rows = fullRows().map((r) => (r.id === 'U4' || r.id === 'Y5-steps' ? row(r.id, r.enforcedBy) : r));
    const findings = verifyUxPrinciples(model(rows), KNOWN);

    expect(findings.map((f) => f.counterexample?.['principle'])).toEqual(['U4', 'Y5-steps']);
    expect(findings[0]?.message).toContain('budget がありません');
  });

  it('advisory の行に budget があればエラー(誰も読まない数字)', () => {
    const rows = [...fullRows().filter((r) => r.id !== 'U6'), row('U6', 'advisory', { budget: { limit: 3 } })];
    const findings = verifyUxPrinciples(model(rows), KNOWN);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('見張る検査(advisory)が読みません');
  });

  it('affects は U1 の行にだけ書ける・U1 の行には必須', () => {
    const noAffects = fullRows().map((r) => (r.id === 'U1' ? row('U1', 'U1') : r));
    expect(verifyUxPrinciples(model(noAffects), KNOWN)[0]?.message).toContain('affects: confirm_required がありません');

    const stray = fullRows().map((r) => (r.id === 'U3' ? row('U3', 'U3', { affects: 'confirm_required' }) : r));
    expect(verifyUxPrinciples(model(stray), KNOWN)[0]?.message).toContain('U1 以外の行には書けません');
  });
});

describe('U8: Y5 の余り行', () => {
  it('enforced_by が Y5 で id が指標の行でなければエラー', () => {
    const findings = verifyUxPrinciples(model([...fullRows(), row('Y5-extra', 'Y5', { budget: { limit: 3 } })]), KNOWN);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'U8', severity: 'error' });
    expect(findings[0]?.message).toContain('id が指標の行');
    expect(findings[0]?.counterexample).toEqual({ principle: 'Y5-extra', enforced_by: 'Y5' });
  });

  it('指標の行(Y5-steps など)と Y5 以外の行は余り行ではない', () => {
    expect(verifyUxPrinciples(model(fullRows()), KNOWN)).toEqual([]);
  });
});

describe('台帳から引く閾値', () => {
  it('台帳が無ければ定数の既定値', () => {
    expect(uxLimitsOf(NO_UX_PRINCIPLES)).toEqual({
      maxSimultaneousActions: MAX_SIMULTANEOUS_ACTIONS,
      maxWritableFields: MAX_WRITABLE_FIELDS,
    });
    expect(usecaseBudgetDefaultsOf(NO_UX_PRINCIPLES)).toEqual(DEFAULT_USECASE_BUDGET);
  });

  it('台帳の budget が既定値を上書きする', () => {
    const rows = fullRows().map((r) =>
      r.id === 'U4' ? row('U4', 'U4', { budget: { limit: 9 } }) : r.id === 'Y5-screens' ? row(r.id, 'Y5', { budget: { limit: 5 } }) : r,
    );

    expect(uxLimitsOf(model(rows))).toEqual({ maxSimultaneousActions: 9, maxWritableFields: 7 });
    expect(usecaseBudgetDefaultsOf(model(rows))).toEqual({ ...DEFAULT_USECASE_BUDGET, screens: 5 });
  });

  it('その行が無ければ既定値のまま', () => {
    expect(uxLimitsOf(model([row('U1', 'U1')]))).toEqual({
      maxSimultaneousActions: MAX_SIMULTANEOUS_ACTIONS,
      maxWritableFields: MAX_WRITABLE_FIELDS,
    });
  });
});
