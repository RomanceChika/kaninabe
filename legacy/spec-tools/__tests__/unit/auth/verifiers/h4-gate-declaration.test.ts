/**
 * H4(関門の宣言 — screen_spec ⇔ auth_spec の双方向一致)のユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §検証):
 *   - 画面が掛かる関門が gates に宣言されていれば違反なし・宣言が無ければエラー・どの画面も掛からない関門は警告
 *   - 画面仕様を採っていない(未選択)なら何も見ない
 *   - ロールの関門(`guards: role_gate`)の role は roles.md に実在し、その行は高々 1 つ(画面に依らない宣言の接地)
 *   - 画面仕様が阻害(読めずに落とした画面がある)なら「どの画面も掛からない関門」を言わない(落とした画面が掛かる関門を「掛かる画面が無い」と言わない)。
 *     読めた画面が掛かる関門の宣言漏れは言う(読めた分についての真の検出)
 */

import { describe, expect, it } from 'vitest';
import { verifyGateDeclaration, verifyGateRoles } from '../../../../lib/auth/verifiers/h4-gate-declaration.js';
import { role, specModel } from '../../../helpers/model-builder-v8plus.js';
import type { CatalogInput } from '../../../../lib/kernel/input-state.js';
import type { ScreenSpecModel } from '../../../../lib/model/screen/types.js';
import { authGate, authModel } from '../../../helpers/auth-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** 要ログインの画面を 1 枚だけ持つ画面仕様。 */
function screensModel(requiresAuth: boolean): ScreenSpecModel {
  return {
    available: true,
    screens: [screenSpec({ name: 'workshop_list', route: '/workshops', requiresAuth })],
    chromes: [],
    unexposed: [],
    unreachableStates: [],
    unseenStates: [],
  };
}

/** 関門 session だけを宣言した auth_spec。 */
const FLOW = authModel({ gates: [authGate('session')] }).flow;

describe('H4: 関門の宣言', () => {
  it('画面が掛かる関門が宣言されていれば違反なし', () => {
    expect(verifyGateDeclaration(FLOW, loadedInput(screensModel(true)), TEST_ROOTS)).toEqual([]);
  });

  it('画面が掛かる関門を auth_spec が宣言していなければエラー・どの画面も掛からない関門は警告', () => {
    const missing = verifyGateDeclaration(authModel({ gates: [] }).flow, loadedInput(screensModel(true)), TEST_ROOTS);
    expect(missing.map((finding) => [finding.severity, finding.message])).toEqual([['error', expect.stringContaining('関門 requires_auth に掛かりますが')]]);

    const unused = verifyGateDeclaration(FLOW, loadedInput(screensModel(false)), TEST_ROOTS);
    expect(unused.map((finding) => finding.severity)).toEqual(['warning']);
  });

  it('画面仕様を採っていない(未選択)なら何も見ない', () => {
    expect(verifyGateDeclaration(authModel({ gates: [] }).flow, UNSELECTED, TEST_ROOTS)).toEqual([]);
  });

  it('画面仕様が阻害なら「どの画面も掛からない関門」を言わない(落とした画面が掛かる関門を「掛かる画面が無い」と言わない)', () => {
    const blocked: CatalogInput<ScreenSpecModel> = { state: 'blocked', reason: 'invalid', findings: [], partial: screensModel(false) };

    expect(verifyGateDeclaration(FLOW, blocked, TEST_ROOTS)).toEqual([]);
    expect(verifyGateDeclaration(FLOW, blockedInput('missing'), TEST_ROOTS)).toEqual([]);
    // 対: 読込済みなら同じ入力が警告になる(保留が効いている)
    expect(verifyGateDeclaration(FLOW, loadedInput(screensModel(false)), TEST_ROOTS)).toHaveLength(1);
  });

  it('画面仕様が阻害でも、読めた画面が掛かる関門の宣言漏れは言う(読めた分についての真の検出)', () => {
    const blocked: CatalogInput<ScreenSpecModel> = { state: 'blocked', reason: 'invalid', findings: [], partial: screensModel(true) };

    const findings = verifyGateDeclaration(authModel({ gates: [] }).flow, blocked, TEST_ROOTS);

    expect(findings.map((finding) => [finding.severity, finding.message])).toEqual([['error', expect.stringContaining('関門 requires_auth に掛かりますが')]]);
    // 読めない阻害(部分のモデルが無い)は何も言わない
    expect(verifyGateDeclaration(authModel({ gates: [] }).flow, blockedInput('missing'), TEST_ROOTS)).toEqual([]);
  });

  it('auth_spec 自体が壊れている(null)なら何も見ない(ほかの検証器が指摘済み)', () => {
    expect(verifyGateDeclaration(null, loadedInput(screensModel(true)), TEST_ROOTS)).toEqual([]);
  });
});

describe('H4: ロールの関門の宣言の接地', () => {
  const domain = specModel({ roles: [role('anonymous'), role('member'), role('staff'), role('system')] });
  const staffGate = (id: string, gateRole: string) =>
    authGate(id, { guards: 'role_gate', role: gateRole, implementation: 'app/src/composition/auth.ts::requireStaff' });

  it('role が roles.md に無ければエラー(綴り違いのロールにはどの画面の for も一致せず、関門が黙って外れる)', () => {
    const findings = verifyGateRoles(authModel({ gates: [staffGate('staff_only', 'stafff')] }).flow, domain);

    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['H4', 'error']]);
    expect(findings[0]?.message).toContain('role stafff は roles.md に定義されていません');
  });

  it('role_gate の行が 2 つあればエラー(導出は最初の行しか見ない)', () => {
    const findings = verifyGateRoles(authModel({ gates: [staffGate('staff_only', 'staff'), staffGate('member_only', 'member')] }).flow, domain);

    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('関門 member_only は 2 つ目の guards: role_gate の行です')]);
  });

  it('実在するロールの関門が 1 つなら何も言わない(対照)・auth_spec が壊れていれば見ない(境界)', () => {
    expect(verifyGateRoles(authModel({ gates: [authGate('session'), staffGate('staff_only', 'staff')] }).flow, domain)).toEqual([]);
    expect(verifyGateRoles(null, domain)).toEqual([]);
  });
});
