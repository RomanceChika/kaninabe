/**
 * H0(auth_spec のスキーマ適合)のうち `platform_ops`(認証基盤の操作を画面から叩く閉じた一覧)の読み取りのテスト。
 *
 * 規約網羅(設計メモ「セッションの管理の画面」§3-1 / ADR-0019):
 *   - 節が無い製品は何も宣言しない(任意の節)
 *   - kind は read | do・read だけが returns(必須)・do だけが confirm(必須)
 *   - actor は { self: true } か { role, active_member? }(混ぜない・self は true だけ)
 *   - args は from: row(of / field)か型つきの自由入力。from の他の種類は書けない
 *   - binding は { port, method } の識別子・操作 id は "{グループ}.{名前}"
 *   - shapes は閉じた欄の集合・shapes を書くなら secret_field_words が要る
 *   - 書けない鍵は綴り間違いとして落とす
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseAuthFlow } from '../../../../lib/model/auth/parse-auth.js';
import type { AuthFlowSpec } from '../../../../lib/model/auth/types.js';

/** platform_ops を除いた最小の正しいフロントマター。 */
function baseData(): Record<string, unknown> {
  return {
    doc_type: 'auth_spec',
    id: 'auth-flow',
    subject: 'membership',
    providers: ['oauth_a'],
    sessions: { inactivity: '8h', absolute: '24h', reason: '確かめた理由', concurrent: { unbounded: '既定のまま' } },
    idp_session: { logout: 'keeps_idp', idp_ends: 'app_continues', lifetime: 'independent', reason: '確かめた理由' },
    mfa: { exempt: '外す理由' },
    axes: [{ id: 'member', kind: 'state', summary: 'メンバー行の状態', of: 'membership', absent: 'none' }],
    landings: [{ id: 'active', screen: 'screen-home', summary: '通常の入口へ' }],
    sign_in: [{ id: 'member_active', member: 'active', lands: 'active', summary: '通す' }],
    gates: [],
    test_cases: [
      {
        id: 'TC-AUTH-SIGNIN-001',
        type: 'unit',
        covers: ['success'],
        spec_ids: ['auth-flow'],
        implementation: 'legacy/spec-tools/__tests__/unit/model/auth/parse-auth.test.ts::正しい宣言を読める',
      },
    ],
  };
}

/** 本人の一覧と終了・スタッフの全員終了を含む、設計どおりの宣言。 */
function platformData(): Record<string, unknown> {
  return {
    ...baseData(),
    platform_ops: [
      { id: 'session.list_mine', label: '自分のセッションの一覧', kind: 'read', actor: { self: true }, returns: 'session_summary', binding: { port: 'SessionManagement', method: 'listMySessions' } },
      {
        id: 'session.end_mine',
        label: '自分のセッションを終える',
        kind: 'do',
        actor: { self: true },
        args: { session_id: { from: 'row', of: 'session.list_mine', field: 'id' } },
        confirm: false,
        binding: { port: 'SessionManagement', method: 'endMySession' },
      },
      { id: 'session.end_others', label: 'ほかの端末を終える', kind: 'do', actor: { self: true }, needs: 'current_session', confirm: true, binding: { port: 'SessionManagement', method: 'endMyOtherSessions' } },
      {
        id: 'session.end_every',
        label: '全員を終える',
        kind: 'do',
        actor: { role: 'staff', active_member: true },
        args: { keep_self: { type: 'bool', default: true } },
        confirm: true,
        binding: { port: 'SessionManagement', method: 'endEverySession' },
      },
    ],
    shapes: { session_summary: { fields: ['id', 'created_at', 'last_used_at', 'user_agent', 'ip', 'is_current'] } },
    secret_field_words: ['token', 'refresh', 'secret', 'jwt'],
  };
}

function parse(data: Record<string, unknown>): { value: AuthFlowSpec; messages: readonly string[] } {
  const reporter = new SpecReporter('docs/specs/backend/auth.md');
  const result = parseAuthFlow(data, reporter);
  if (result.value === null) throw new Error('パーサーが値を返しませんでした');
  return { value: result.value, messages: result.findings.map((finding) => finding.message) };
}

/** platform_ops の 1 要素だけを差し替えた宣言を読む。 */
function withOp(patch: Record<string, unknown>, drop: readonly string[] = []): { value: AuthFlowSpec; messages: readonly string[] } {
  const data = platformData();
  const ops = [...(data['platform_ops'] as Record<string, unknown>[])];
  const op = { ...(ops[1] as Record<string, unknown>), ...patch };
  for (const key of drop) delete op[key];
  ops[1] = op;
  return parse({ ...data, platform_ops: ops });
}

describe('H0: platform_ops の読み取り', () => {
  it('設計どおりの宣言を読める(本人の読み・行から受ける引数・needs・ロールの操作・型つきの入力・shapes・秘密語)', () => {
    const { value, messages } = parse(platformData());

    expect(messages).toEqual([]);
    const section = value.platformOps;
    expect(section?.ops.map((op) => op.id)).toEqual(['session.list_mine', 'session.end_mine', 'session.end_others', 'session.end_every']);
    expect(section?.ops[0]).toMatchObject({ kind: 'read', actor: { kind: 'self' }, returns: 'session_summary', binding: { port: 'SessionManagement', method: 'listMySessions' } });
    expect(section?.ops[1]?.args[0]).toMatchObject({ kind: 'row', name: 'session_id', of: 'session.list_mine', field: 'id' });
    expect(section?.ops[1]).toMatchObject({ confirm: false, needsCurrentSession: false });
    expect(section?.ops[2]).toMatchObject({ needsCurrentSession: true, confirm: true });
    expect(section?.ops[3]).toMatchObject({ actor: { kind: 'role', role: 'staff', activeMember: true } });
    expect(section?.ops[3]?.args[0]).toMatchObject({ kind: 'typed', name: 'keep_self', type: 'bool', default: true });
    expect(section?.shapes[0]).toMatchObject({ name: 'session_summary', fields: ['id', 'created_at', 'last_used_at', 'user_agent', 'ip', 'is_current'] });
    expect(section?.secretWords).toEqual(['token', 'refresh', 'secret', 'jwt']);
  });

  it('節が無い製品は何も宣言しない(任意の節)', () => {
    const { value, messages } = parse(baseData());

    expect(messages).toEqual([]);
    expect(value.platformOps).toBeUndefined();
  });

  it('actor は role だけでも読め、active_member は既定で false', () => {
    const { value, messages } = withOp({ actor: { role: 'staff' } });

    expect(messages).toEqual([]);
    expect(value.platformOps?.ops[1]?.actor).toEqual({ kind: 'role', role: 'staff', activeMember: false });
  });

  const negatives: readonly { readonly name: string; readonly run: () => { messages: readonly string[] }; readonly expected: string }[] = [
    { name: 'kind が read | do 以外', run: () => withOp({ kind: 'write' }), expected: 'kind write は宣言できる語ではありません' },
    { name: 'id が 2 段のスネークケースでない', run: () => withOp({ id: 'endMine' }), expected: '"{グループ}.{名前}"' },
    { name: 'id が 3 段', run: () => withOp({ id: 'session.end.mine' }), expected: '"{グループ}.{名前}"' },
    { name: 'label が無い', run: () => withOp({}, ['label']), expected: 'label がありません' },
    { name: 'actor が無い', run: () => withOp({}, ['actor']), expected: 'actor がありません' },
    { name: 'actor に self と role を混ぜる', run: () => withOp({ actor: { self: true, role: 'staff' } }), expected: 'role は書けません' },
    { name: 'actor.self が true 以外', run: () => withOp({ actor: { self: false } }), expected: 'actor.self は true だけ' },
    { name: 'actor に未知のキー', run: () => withOp({ actor: { role: 'staff', member: true } }), expected: 'member は書けません' },
    { name: 'actor.role が無い', run: () => withOp({ actor: { active_member: true } }), expected: 'role がありません' },
    { name: 'binding が無い', run: () => withOp({}, ['binding']), expected: 'binding がありません' },
    { name: 'binding.method が識別子でない', run: () => withOp({ binding: { port: 'SessionManagement', method: 'end-mine' } }), expected: 'binding.method end-mine が識別子ではありません' },
    { name: 'binding.port が無い', run: () => withOp({ binding: { method: 'endMine' } }), expected: 'port がありません' },
    { name: 'do に confirm が無い(確認の要否を暗黙にしない)', run: () => withOp({}, ['confirm']), expected: 'confirm がありません' },
    { name: 'do に returns', run: () => withOp({ returns: 'session_summary' }), expected: 'returns を持っています' },
    { name: 'read に confirm', run: () => withOp({ kind: 'read', returns: 'session_summary', confirm: true }), expected: 'confirm を持てません' },
    { name: 'read に returns が無い', run: () => withOp({ kind: 'read', confirm: undefined }, ['confirm']), expected: 'returns がありません' },
    { name: 'needs が current_session 以外', run: () => withOp({ needs: 'recent_login' }), expected: 'needs recent_login は宣言できる語ではありません' },
    { name: '引数の from が row 以外(literal は書けない)', run: () => withOp({ args: { session_id: { from: 'literal', of: 'x', field: 'id' } } }), expected: 'from literal は書けません' },
    { name: '引数に of が無い', run: () => withOp({ args: { session_id: { from: 'row', field: 'id' } } }), expected: 'of がありません' },
    { name: '引数の type が値域外', run: () => withOp({ args: { n: { type: 'float' } } }), expected: 'type float は宣言できる語ではありません' },
    { name: '引数の default が型と合わない', run: () => withOp({ args: { keep: { type: 'bool', default: 'yes' } } }), expected: 'default が型 bool と合いません' },
    { name: '引数名がスネークケースでない', run: () => withOp({ args: { SessionId: { type: 'bool' } } }), expected: 'スネークケースではありません' },
    { name: '操作に未知のキー', run: () => withOp({ confirms: true }), expected: 'confirms は書けません' },
    { name: 'shapes を書いたのに secret_field_words が無い', run: () => { const d = platformData(); delete d['secret_field_words']; return parse(d); }, expected: 'secret_field_words がありません' },
    { name: 'secret_field_words に大文字', run: () => parse({ ...platformData(), secret_field_words: ['Token'] }), expected: '小文字の空でない語' },
    { name: 'shapes の fields が空', run: () => parse({ ...platformData(), shapes: { session_summary: { fields: [] } } }), expected: 'fields が空です' },
    { name: 'shapes の要素に未知のキー', run: () => parse({ ...platformData(), shapes: { session_summary: { fields: ['id'], extra: 1 } } }), expected: 'extra は書けません' },
    { name: 'shapes だけで platform_ops が無い', run: () => { const d = platformData(); delete d['platform_ops']; return parse(d); }, expected: 'platform_ops がありません' },
  ];

  it.each(negatives)('$name はエラー', ({ run, expected }) => {
    expect(run().messages.some((message) => message.includes(expected))).toBe(true);
  });

  it('1 件の書き間違いは操作ごと落とし、ほかの操作は残す(落とした行として数える)', () => {
    const reporter = new SpecReporter('docs/specs/backend/auth.md');
    const data = platformData();
    (data['platform_ops'] as Record<string, unknown>[])[1] = { id: 'session.end_mine', label: 'x', kind: 'nope', actor: { self: true }, binding: { port: 'P', method: 'm' } };
    const result = parseAuthFlow(data, reporter);

    expect(result.value?.platformOps?.ops.map((op) => op.id)).toEqual(['session.list_mine', 'session.end_others', 'session.end_every']);
    expect(reporter.droppedCount()).toBeGreaterThan(0);
  });
});
