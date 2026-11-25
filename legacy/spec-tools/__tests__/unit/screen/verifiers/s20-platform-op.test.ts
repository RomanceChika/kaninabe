/**
 * S20(プラットフォーム操作を露出する画面)の規約網羅テスト。
 *
 * 対象の要求(設計メモ「セッションの管理の画面」§3-2 / §3-4・ADR-0019):
 *   (a) platform_ops の参照が auth_spec に実在する
 *   (b) 露出する画面は requires_auth・ロールの操作は画面を見る全ロールがそのロールを持つ(同じか含意する)
 *   (c) platform_op.{id}.success は、画面が露出する kind: do の操作を指す
 *   (d) op は read・ops / row_actions は do で、画面の platform_ops に居る。shows は返す欄の部分集合
 *   (e) from: row の引数を持つ操作は row_actions にだけ載り、出どころは部品が表にする読み。行のボタンは行の引数を持つ
 *   (f) confirm: true の操作は、部品を opened_by に持つ重ね表示と confirm_bar を持つ
 *   (g) chrome の部品に書けない
 * auth_spec が使えない(阻害)ときは判定を出さず、auth_spec が無い構成は「操作が 1 つも無い」として参照を落とす。
 */

import { describe, expect, it } from 'vitest';
import { platformOpVerifier } from '../../../../lib/screen/verifiers/s20-platform-op.js';
import type { AuthSpecModel } from '../../../../lib/model/auth/types.js';
import type { ScreenContext } from '../../../../lib/screen/verifier.js';
import { authModel, platformOp, platformOpsSection, rowArg, typedArg } from '../../../helpers/auth-builder.js';
import { role, specModel } from '../../../helpers/model-builder-v8plus.js';
import { SCREEN_CTX, chromeSpec, screenInput, screenSpec } from '../../../helpers/screen-builder.js';
import type { OverlayInit } from '../../../helpers/screen-builder.js';

const STAFF = { kind: 'role', role: 'staff', activeMember: true } as const;

/** anonymous / member / staff(member を含意)/ system。 */
const DOMAIN = specModel({ aggregates: [], roles: [role('anonymous'), role('member'), role('staff', undefined, ['member']), role('system')] });

const OPS = platformOpsSection([
  platformOp('session.list_mine', { kind: 'read' }),
  platformOp('session.end_mine', { args: [rowArg('session_id', 'session.list_mine', 'id')] }),
  platformOp('session.end_others', { needsCurrentSession: true, confirm: true }),
  platformOp('session.end_member', { actor: STAFF, args: [rowArg('member_id', 'query-member-admin', 'id')], confirm: true }),
  platformOp('session.end_every', { actor: STAFF, args: [typedArg('keep_self', 'bool', true)], confirm: true }),
]);

const AUTH: AuthSpecModel = authModel({ platformOps: OPS });

const CONFIRM_BAR = [{ slot: 'body.center', components: ['confirm_bar'] }] as const;

/** 本人のセッションの画面(設計 §4 (a))。 */
function sessionsScreen(patch: Partial<Parameters<typeof screenSpec>[0]> = {}) {
  return screenSpec({
    name: 'sessions',
    for: ['anonymous'],
    requiresAuth: true,
    platformOps: ['session.list_mine', 'session.end_mine', 'session.end_others'],
    navigations: [{ on: 'platform_op.session.end_mine.success', to: 'screen-sessions' }],
    overlays: [
      { id: 'end_others_confirm', openedBy: 'end_others_bar', platformOps: ['session.end_others'], closesOn: ['platform_op.session.end_others.success', 'cancel'], slots: [...CONFIRM_BAR] },
    ],
    slots: [
      {
        slot: 'body.center',
        components: [
          { name: 'session_table', kind: 'platform_read', op: 'session.list_mine', shows: ['created_at', 'user_agent'], rowActions: ['session.end_mine'] },
          { name: 'end_others_bar', kind: 'platform_actions', ops: ['session.end_others'] },
        ],
      },
    ],
    ...patch,
  });
}

/** メンバー管理の画面(設計 §4 (b)。query_spec の表の行のボタン)。 */
function adminScreen(patch: Partial<Parameters<typeof screenSpec>[0]> = {}) {
  return screenSpec({
    name: 'member_admin',
    for: ['staff'],
    requiresAuth: true,
    reads: ['query-member-admin'],
    platformOps: ['session.end_member', 'session.end_every'],
    overlays: [
      { id: 'end_member_confirm', openedBy: 'member_table', platformOps: ['session.end_member'], slots: [...CONFIRM_BAR] },
      { id: 'end_every_confirm', openedBy: 'member_bulk_bar', platformOps: ['session.end_every'], slots: [...CONFIRM_BAR] },
    ],
    slots: [
      {
        slot: 'body.center',
        components: [
          { name: 'member_table', kind: 'table', reads: 'query-member-admin', rowActions: ['session.end_member'] },
          { name: 'member_bulk_bar', kind: 'platform_actions', ops: ['session.end_every'] },
        ],
      },
    ],
    ...patch,
  });
}

function run(screens: readonly ReturnType<typeof screenSpec>[], init: { auth?: AuthSpecModel; chromes?: readonly ReturnType<typeof chromeSpec>[]; ctx?: Partial<ScreenContext> } = {}) {
  return platformOpVerifier.verify(screenInput({ domain: DOMAIN, screens, auth: init.auth ?? AUTH, ...(init.chromes === undefined ? {} : { chromes: init.chromes }) }), { ...SCREEN_CTX, ...init.ctx });
}

describe('S20 プラットフォーム操作の画面', () => {
  it('設計の 2 画面(本人のセッション・メンバー管理)が正しく書かれていれば通る', () => {
    expect(run([sessionsScreen(), adminScreen()])).toEqual([]);
  });

  it('platform_ops を書かない画面・宣言の無い製品は何も言わない', () => {
    expect(run([screenSpec({ name: 'plain' })])).toEqual([]);
    expect(run([screenSpec({ name: 'plain' })], { auth: { available: false, flow: null } })).toEqual([]);
  });

  const openedOverlay = (over: Partial<OverlayInit> = {}): OverlayInit => ({ id: 'end_others_confirm', openedBy: 'end_others_bar', platformOps: ['session.end_others'], slots: [...CONFIRM_BAR], ...over });

  const negatives: readonly { readonly name: string; readonly screens: () => ReturnType<typeof screenSpec>[]; readonly expected: string }[] = [
    { name: '(a) auth_spec に無い操作を参照する', screens: () => [sessionsScreen({ platformOps: ['session.list_mine', 'session.nope'] })], expected: 'platform_ops の session.nope に対応する auth_spec の操作がありません' },
    { name: '(b) requires_auth でない画面に置く', screens: () => [sessionsScreen({ requiresAuth: false })], expected: 'requires_auth ではありません' },
    { name: '(b) 管理者の操作をメンバー向けの画面に置く(staff は member を含意するので、見る側の member は staff を持たない)', screens: () => [adminScreen({ for: ['member'] })], expected: 'この画面を見る全ロール(member)は持ちません' },
    { name: '(b) for に実行できないロールが混ざる', screens: () => [adminScreen({ for: ['staff', 'member'] })], expected: 'この画面を見る全ロール(staff / member)は持ちません' },
    { name: '(c) 露出しない操作の success を遷移に使う', screens: () => [sessionsScreen({ navigations: [{ on: 'platform_op.session.end_every.success', to: 'screen-sessions' }] })], expected: 'が指す操作をこの画面は露出しません' },
    { name: '(c) read の success を遷移に使う', screens: () => [sessionsScreen({ navigations: [{ on: 'platform_op.session.list_mine.success', to: 'screen-sessions' }] })], expected: 'は kind: read です。結果の遷移を持てるのは kind: do だけ' },
    { name: '(c) closes_on の success も同じ規則', screens: () => [sessionsScreen({ overlays: [openedOverlay({ closesOn: ['platform_op.session.end_every.success'] })] })], expected: 'が指す操作をこの画面は露出しません' },
    { name: '(d) op に do の操作', screens: () => [sessionsScreen({ slots: [{ slot: 'body.center', components: [{ name: 'session_table', kind: 'platform_read', op: 'session.end_mine' }] }] })], expected: 'は kind: do です。表にできるのは kind: read' },
    { name: '(d) ops に read の操作', screens: () => [sessionsScreen({ slots: [{ slot: 'body.center', components: [{ name: 'bar', kind: 'platform_actions', ops: ['session.list_mine'] }] }] })], expected: 'は kind: read です。ボタンにできるのは kind: do' },
    { name: '(d) 部品の操作を画面の platform_ops が宣言していない', screens: () => [sessionsScreen({ platformOps: ['session.list_mine', 'session.end_mine'], overlays: [] })], expected: '部品 end_others_bar の session.end_others を、画面の platform_ops が宣言していません' },
    { name: '(d) shows が返す欄に無い', screens: () => [sessionsScreen({ slots: [{ slot: 'body.center', components: [{ name: 'session_table', kind: 'platform_read', op: 'session.list_mine', shows: ['created_at', 'token'] }] }] })], expected: 'shows token が、session.list_mine の返す欄にありません' },
    { name: '(e) 行の引数を持つ操作を行を持たない ops に載せる', screens: () => [sessionsScreen({ slots: [{ slot: 'body.center', components: [{ name: 'bar', kind: 'platform_actions', ops: ['session.end_mine'] }] }] })], expected: '行を持たない ops に載っています' },
    { name: '(e) 行の引数を持たない操作を row_actions に載せる', screens: () => [sessionsScreen({ slots: [{ slot: 'body.center', components: [{ name: 'session_table', kind: 'platform_read', op: 'session.list_mine', rowActions: ['session.end_others'] }] }], overlays: [openedOverlay({ openedBy: 'session_table' })] })], expected: '行から受ける引数を持たないのに row_actions に載っています' },
    { name: '(e) 出どころが部品の表にする読みと違う', screens: () => [adminScreen({ reads: ['query-member-admin', 'query-other'], slots: [{ slot: 'body.center', components: [{ name: 'member_table', kind: 'table', reads: 'query-other', rowActions: ['session.end_member'] }] }] })], expected: 'が、部品 member_table の表にする読み(query-other)と一致しません' },
    { name: '(e) query_spec の出どころが画面の reads に無い', screens: () => [adminScreen({ reads: ['query-other'] })], expected: '画面の reads にありません' },
    { name: '(e) 本人の読み以外の表(platform_read)に別の出どころの行のボタン', screens: () => [adminScreen({ platformOps: ['session.list_mine', 'session.end_member'], slots: [{ slot: 'body.center', components: [{ name: 'member_table', kind: 'platform_read', op: 'session.list_mine', rowActions: ['session.end_member'] }] }] })], expected: 'が、部品 member_table の表にする読み(session.list_mine)と一致しません' },
    { name: '(f) 確認が要る操作に重ね表示が無い', screens: () => [sessionsScreen({ overlays: [] })], expected: '確認が要る操作 session.end_others を載せた部品 end_others_bar に、確認の重ね表示がありません' },
    { name: '(f) 重ね表示が別の部品を opened_by に持つ', screens: () => [sessionsScreen({ overlays: [openedOverlay({ openedBy: 'session_table' })] })], expected: '確認の重ね表示がありません' },
    { name: '(f) 重ね表示がその操作を含まない', screens: () => [sessionsScreen({ platformOps: ['session.list_mine', 'session.end_mine', 'session.end_others'], overlays: [openedOverlay({ platformOps: ['session.end_mine'] })] })], expected: '確認の重ね表示がありません' },
    { name: '(f) 重ね表示が confirm_bar を持たない', screens: () => [sessionsScreen({ overlays: [openedOverlay({ slots: [{ slot: 'body.center', components: ['dialog_body'] }] })] })], expected: '確認の器(body.center の confirm_bar)がありません' },
    { name: '(f) 確認が要る操作を行のボタンにしても重ね表示が要る', screens: () => [adminScreen({ overlays: [] })], expected: '確認が要る操作 session.end_member を載せた部品 member_table に、確認の重ね表示がありません' },
  ];

  it.each(negatives)('$name はエラー', ({ screens, expected }) => {
    const findings = run(screens());

    expect(findings.map((finding) => finding.message).some((message) => message.includes(expected))).toBe(true);
    expect(findings.every((finding) => finding.verifier === 'S20' && finding.severity === 'error')).toBe(true);
  });

  it('(g) chrome の部品に platform_read / platform_actions は書けない', () => {
    const chrome = chromeSpec({ name: 'member', slots: [{ slot: 'header', components: [{ name: 'bar', kind: 'platform_actions', ops: ['session.end_others'] }] }] });
    const findings = run([], { chromes: [chrome] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('chrome member の部品 bar は kind: platform_actions です');
  });

  it('auth_spec が使えない(阻害)ときは画面の判定を出さない(chrome の形は言う)', () => {
    const blocked = { ...SCREEN_CTX, reachabilityGaps: [{ input: 'auth', reason: 'invalid' }] } as unknown as ScreenContext;
    const findings = platformOpVerifier.verify(screenInput({ domain: DOMAIN, screens: [sessionsScreen({ platformOps: ['session.nope'] })], auth: AUTH }), blocked);
    expect(findings).toEqual([]);
    expect(run([sessionsScreen({ platformOps: ['session.nope'] })], { auth: { available: true, flow: null } })).toEqual([]);
  });

  it('auth_spec が無い構成で platform_ops を参照すれば、実在しない参照として落とす', () => {
    const findings = run([sessionsScreen()], { auth: { available: false, flow: null } });

    expect(findings.some((finding) => finding.message.includes('に対応する auth_spec の操作がありません'))).toBe(true);
  });

  it('指摘は参照の位置(画面ファイルの platform_ops[n])を指す', () => {
    const findings = run([sessionsScreen({ platformOps: ['session.list_mine', 'session.nope'] })]);

    const location = findings.find((finding) => finding.message.includes('session.nope'))?.location;
    expect(location?.pointer).toBe('platform_ops[1]');
    expect(location?.file.endsWith('/sample/sessions.md')).toBe(true);
  });
});
