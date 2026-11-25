/**
 * H9(プラットフォーム操作の宣言 — `platform_ops` の閉世界)のユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §H9 / 設計メモ「セッションの管理の画面」§3-4):
 *   - 操作 id の重複・同じ配線先(port.method)の重複
 *   - actor.role が roles.md に実在する
 *   - needs: current_session は本人の do だけ
 *   - 型つきの自由入力に string を許さない(識別子は from: row だけ)
 *   - 本人の操作の from: row は、本人の読み(actor: self の read)の行からだけ。of が宣言した読みなら field が返す欄に居る
 *   - returns が shapes に居る・欄名に secret_field_words の語を含まない
 *   - 宣言の無い製品・auth_spec が壊れている(null)なら何も見ない
 */

import { describe, expect, it } from 'vitest';
import { verifyPlatformOps } from '../../../../lib/auth/verifiers/h9-platform-ops.js';
import type { AuthPlatformOps, PlatformOpDecl } from '../../../../lib/model/auth/platform-ops.js';
import { authFlow, platformOp, platformOpsSection, platformShape, rowArg, typedArg } from '../../../helpers/auth-builder.js';
import { role, specModel } from '../../../helpers/model-builder-v8plus.js';

const DOMAIN = specModel({ aggregates: [], roles: [role('anonymous'), role('member'), role('staff'), role('system')] });

const LIST_MINE = platformOp('session.list_mine', { kind: 'read' });
const END_MINE = platformOp('session.end_mine', { args: [rowArg('session_id', 'session.list_mine', 'id')] });
const END_MEMBER = platformOp('session.end_member', { actor: { kind: 'role', role: 'staff', activeMember: true }, args: [rowArg('member_id', 'query-member-admin', 'id')], confirm: true });

function run(section: AuthPlatformOps) {
  return verifyPlatformOps(authFlow({ platformOps: section }), DOMAIN);
}

const withOps = (...ops: PlatformOpDecl[]) => platformOpsSection(ops);

describe('H9: プラットフォーム操作の宣言', () => {
  it('設計どおりの宣言(本人の読みと行から受ける終了・ロールの操作・型つきの入力)は違反なし', () => {
    const everyone = platformOp('session.end_every', { actor: { kind: 'role', role: 'staff', activeMember: true }, args: [typedArg('keep_self', 'bool', true)], confirm: true });
    const others = platformOp('session.end_others', { needsCurrentSession: true, confirm: true });

    expect(run(withOps(LIST_MINE, END_MINE, others, END_MEMBER, everyone))).toEqual([]);
  });

  it('宣言の無い製品・auth_spec が壊れている(null)なら何も見ない', () => {
    expect(verifyPlatformOps(authFlow({}), DOMAIN)).toEqual([]);
    expect(verifyPlatformOps(null, DOMAIN)).toEqual([]);
  });

  const negatives: readonly { readonly name: string; readonly section: AuthPlatformOps; readonly expected: string; readonly counter?: Record<string, string> }[] = [
    { name: '操作 id の重複', section: withOps(LIST_MINE, platformOp('session.list_mine', { kind: 'read', binding: { port: 'SessionManagement', method: 'other', params: [], result: { kind: 'rows', row: 'SessionSummary' } } })), expected: '操作 session.list_mine が重複しています' },
    { name: '同じ配線先を 2 つの操作が使う', section: withOps(LIST_MINE, platformOp('session.end_mine', { binding: { port: 'SessionManagement', method: 'list_mine', params: [], result: { kind: 'scalar', type: 'boolean' } } })), expected: '同じ配線先 SessionManagement.list_mine', counter: { op: 'session.end_mine', earlier: 'session.list_mine' } },
    { name: 'actor のロールが roles.md に無い', section: withOps(platformOp('session.end_member', { actor: { kind: 'role', role: 'ghost', activeMember: true }, confirm: true })), expected: 'ロール ghost が roles.md にありません' },
    { name: 'ロールの操作に needs: current_session', section: withOps(platformOp('session.end_every', { actor: { kind: 'role', role: 'staff', activeMember: true }, needsCurrentSession: true, confirm: true })), expected: 'needs: current_session は、本人' },
    { name: '本人の read に needs: current_session', section: withOps(platformOp('session.list_mine', { kind: 'read', needsCurrentSession: true })), expected: 'needs: current_session は、本人' },
    { name: '本人の操作に string の自由入力(メンバー ID を運べる)', section: withOps(LIST_MINE, platformOp('session.end_mine', { args: [typedArg('member_id', 'string')] })), expected: '引数 member_id は string の自由入力' },
    { name: 'ロールの操作に string の自由入力', section: withOps(platformOp('session.end_member', { actor: { kind: 'role', role: 'staff', activeMember: true }, args: [typedArg('reason', 'string')], confirm: true })), expected: '引数 reason は string の自由入力' },
    { name: '本人の操作が query_spec の行を出どころにする(別の人の行)', section: withOps(LIST_MINE, platformOp('session.end_mine', { args: [rowArg('session_id', 'query-member-admin', 'id')] })), expected: '本人の読み(actor: self の kind: read)ではありません' },
    { name: '本人の操作の出どころがロールの読み', section: withOps(platformOp('session.list_all', { kind: 'read', actor: { kind: 'role', role: 'staff', activeMember: true } }), platformOp('session.end_mine', { args: [rowArg('session_id', 'session.list_all', 'id')] })), expected: '本人の読み(actor: self の kind: read)ではありません' },
    { name: '出どころが do の操作', section: withOps(END_MINE, platformOp('session.end_member', { actor: { kind: 'role', role: 'staff', activeMember: true }, args: [rowArg('member_id', 'session.end_mine', 'id')], confirm: true })), expected: 'kind: read ではありません' },
    { name: 'field が出どころの返す欄に無い', section: withOps(LIST_MINE, platformOp('session.end_mine', { args: [rowArg('session_id', 'session.list_mine', 'sid')] })), expected: 'field sid が、session.list_mine の返す欄にありません' },
    { name: 'returns が shapes に無い', section: platformOpsSection([platformOp('session.list_mine', { kind: 'read', returns: 'nope' })]), expected: 'returns nope が shapes にありません' },
    { name: '欄名に秘密語(refresh)を含む', section: platformOpsSection([LIST_MINE], { shapes: [platformShape('session_summary', ['id', 'refresh_token_hash'])] }), expected: '欄 refresh_token_hash は秘密を指す語 token を含みます' },
    { name: '欄名の秘密語は大文字小文字を区別しない', section: platformOpsSection([LIST_MINE], { shapes: [platformShape('session_summary', ['id', 'JwtClaims'])] }), expected: '欄 JwtClaims は秘密を指す語 jwt を含みます' },
    { name: '使われていない shape の欄も見る', section: platformOpsSection([], { shapes: [platformShape('unused', ['client_secret'])] }), expected: '欄 client_secret は秘密を指す語 secret を含みます' },
  ];

  it.each(negatives)('$name はエラー', ({ section, expected, counter }) => {
    const findings = run(section);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.verifier === 'H9' && finding.severity === 'error')).toBe(true);
    const hit = findings.find((finding) => finding.message.includes(expected));
    expect(hit).toBeDefined();
    if (counter !== undefined) expect(hit?.counterexample).toMatchObject(counter);
    expect(hit?.location.file).toBe('docs/specs/backend/auth.md');
  });

  it('秘密語の宣言が空なら語による検査は何も言わない(語彙は製品が宣言する)', () => {
    const section = platformOpsSection([LIST_MINE], { shapes: [platformShape('session_summary', ['id', 'refresh_token'])], secretWords: [] });

    expect(run(section)).toEqual([]);
  });
});
