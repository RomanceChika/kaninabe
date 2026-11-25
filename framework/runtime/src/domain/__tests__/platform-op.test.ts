/**
 * 認証基盤の操作(`platform_ops`)の戻り値の型と拒否の写しのテスト。
 *
 * 規約網羅: 拒否 3 種(入力の検証・多要素認証・配線先の理由)× 文言の引き当て(宣言した理由・宣言に無い理由・理由の語を画面に出さない)・
 * 記録用の `ActionError` への写し(分類・操作 ID・多要素認証の印。理由の語と入力値は載らない)。
 */

import { describe, expect, it } from 'vitest';
import {
  GENERIC_REFUSAL_REASON,
  INVALID_INPUT_MESSAGE,
  MFA_REQUIRED_MESSAGE,
  UNKNOWN_REFUSAL_MESSAGE,
  platformInvalid,
  platformMfaRequired,
  platformOk,
  platformRefused,
  platformRefusedWithin,
  refusalAsActionError,
  refusalMessage,
} from '../platform-op';

const MESSAGES = { unauthenticated: 'ログインしてください', unknown_current_session: 'もう一度ログインしてください' };

describe('refusalMessage', () => {
  it('配線先が宣言した理由は、仕様の文言を返す', () => {
    expect(refusalMessage({ kind: 'refused', reason: 'unknown_current_session' }, MESSAGES)).toBe('もう一度ログインしてください');
    expect(refusalMessage({ kind: 'refused', reason: 'unauthenticated' }, MESSAGES)).toBe('ログインしてください');
  });

  // @spec framework-guarantee-catalog @tc TC-FW-PLATFORMOP-001
  it('宣言に無い理由は一般の文言になり、理由の語を画面に出さない', () => {
    const message = refusalMessage({ kind: 'refused', reason: 'internal_secret_reason' }, MESSAGES);

    expect(message).toBe(UNKNOWN_REFUSAL_MESSAGE);
    expect(message).not.toContain('internal_secret_reason');
  });

  it('入力の検証の失敗と多要素認証は固定の文言', () => {
    expect(refusalMessage({ kind: 'invalid_input', issues: [{ field: 'sessionId', code: 'invalid_type' }] }, MESSAGES)).toBe(INVALID_INPUT_MESSAGE);
    expect(refusalMessage({ kind: 'mfa_required' }, MESSAGES)).toBe(MFA_REQUIRED_MESSAGE);
  });
});

describe('refusalAsActionError(記録用の写し)', () => {
  it('配線先の理由は権限の拒否として、操作 ID だけを載せる(理由の語は載せない)', () => {
    const error = refusalAsActionError('session.end_member', { kind: 'refused', reason: 'forbidden' });

    expect(error).toEqual({ kind: 'forbidden', event: 'session.end_member', role: '' });
    expect(JSON.stringify(error)).not.toContain('"reason"');
  });

  it('多要素認証の拒否は印を付け、入力の検証の失敗は指摘をそのまま運ぶ', () => {
    expect(refusalAsActionError('session.end_every', { kind: 'mfa_required' })).toEqual({ kind: 'forbidden', event: 'session.end_every', role: '', mfaRequired: true });
    expect(refusalAsActionError('session.end_mine', { kind: 'invalid_input', issues: [{ field: 'sessionId', code: 'invalid_type' }] })).toEqual({
      kind: 'invalid_input',
      issues: [{ field: 'sessionId', code: 'invalid_type' }],
    });
  });
});

describe('結果の作り手', () => {
  it('成功は値、拒否は 3 種の形で返る', () => {
    expect(platformOk(3)).toEqual({ ok: true, value: 3 });
    expect(platformRefused('forbidden')).toEqual({ ok: false, refusal: { kind: 'refused', reason: 'forbidden' } });
    expect(platformMfaRequired()).toEqual({ ok: false, refusal: { kind: 'mfa_required' } });
    expect(platformInvalid([{ field: 'x', code: 'too_small' }])).toEqual({ ok: false, refusal: { kind: 'invalid_input', issues: [{ field: 'x', code: 'too_small' }] } });
  });
});

describe('platformRefusedWithin(申告の外の理由を返り値に残さない)', () => {
  const DECLARED = { unauthenticated: 'ログインしてください', forbidden: '権限がありません' };
  const MARKER = 'LEAK-MARKER-reason-9c1e';

  it.each([
    { name: '申告内の理由(1 つ目)', reason: 'unauthenticated', expected: 'unauthenticated' },
    { name: '申告内の理由(2 つ目)', reason: 'forbidden', expected: 'forbidden' },
    { name: '申告の外の理由はマーカーごと一般の理由に落ちる', reason: MARKER, expected: GENERIC_REFUSAL_REASON },
    { name: '空文字は一般の理由', reason: '', expected: GENERIC_REFUSAL_REASON },
    { name: 'Object の継承プロパティの名前は申告ではない', reason: 'toString', expected: GENERIC_REFUSAL_REASON },
    { name: '__proto__ も申告ではない', reason: '__proto__', expected: GENERIC_REFUSAL_REASON },
    { name: '文字列でない実行時の値(型の外から来た)も一般の理由', reason: 42 as unknown as string, expected: GENERIC_REFUSAL_REASON },
  ])('$name', ({ reason, expected }) => {
    expect(platformRefusedWithin(reason, DECLARED)).toEqual({ ok: false, refusal: { kind: 'refused', reason: expected } });
  });

  it('未知の理由のシリアライズ結果にマーカーが残らず、一般の文言になる', () => {
    const result = platformRefusedWithin(MARKER, DECLARED);

    expect(JSON.stringify(result)).not.toContain(MARKER);
    expect(result.ok === false && refusalMessage(result.refusal, DECLARED)).toBe(UNKNOWN_REFUSAL_MESSAGE);
  });
});
