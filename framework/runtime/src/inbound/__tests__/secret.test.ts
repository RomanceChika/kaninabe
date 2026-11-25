/**
 * サービスの認証の秘密の部品(関門・定数時間の照合・新旧両対応)のテスト。
 * 網羅の基準は「受理の型 1 つずつ」と「拒否の型 1 つずつ」を表で持つこと。
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyInboundSignature } from '../signature';
import { constantTimeEquals, matchesAnySecret, readServiceSecret } from '../secret';

const LONG = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

describe('readServiceSecret(関門)', () => {
  const closed: readonly (readonly [string, string | undefined])[] = [
    ['未設定', undefined],
    ['空文字', ''],
    ['下限より 1 文字短い', 'a'.repeat(31)],
    ['1 文字', 'a'],
  ];
  const open: readonly (readonly [string, string])[] = [
    ['ちょうど下限', 'a'.repeat(32)],
    ['下限より長い', 'a'.repeat(64)],
  ];

  // @spec framework-guarantee-catalog @tc TC-FW-SECRET-001
  it('未設定・空・下限に満たない秘密は設定されていないものとして閉じ(undefined)、下限以上は値をそのまま返す。下限が正の整数でなければ書き間違いとして例外にし、値は文面に出さない', () => {
    for (const [label, raw] of closed) expect(readServiceSecret('CRON_SECRET', raw, 32), label).toBeUndefined();
    for (const [label, raw] of open) expect(readServiceSecret('CRON_SECRET', raw, 32), label).toBe(raw);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => readServiceSecret('X', LONG, bad)).toThrow(/minLength/u);
    }
    expect(() => readServiceSecret('X', 'topsecretvalue', 0)).not.toThrow(/topsecretvalue/u);
  });
});

describe('constantTimeEquals', () => {
  const table: readonly (readonly [string, string, string, boolean])[] = [
    ['同じ', 'abc', 'abc', true],
    ['1 文字違い', 'abc', 'abd', false],
    ['長さ違い(短い)', 'abc', 'ab', false],
    ['長さ違い(長い)', 'abc', 'abcd', false],
    ['空と空', '', '', true],
    ['空と非空', '', 'a', false],
    ['非 ASCII', 'あいう', 'あいう', true],
    ['非 ASCII の違い', 'あいう', 'あいえ', false],
  ];

  // @spec framework-guarantee-catalog @tc TC-FW-SECRET-003
  it('秘密の照合は timingSafeEqual で行い、等しい文字列だけが true になる(長さが違っても例外にならない)。秘密を === / !== で比べる行が無い', () => {
    for (const [label, left, right, expected] of table) expect(constantTimeEquals(left, right), label).toBe(expected);

    // コメントを落としたソース(説明文の `===` を数えない)で、比較が node:crypto の timingSafeEqual であることを見る。
    const source = readFileSync(path.resolve(__dirname, '../secret.ts'), 'utf8')
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll(/(^|[^:])\/\/.*$/gm, '$1');
    expect(source).toMatch(/import \{[^}]*\btimingSafeEqual\b[^}]*\} from 'node:crypto'/);
    expect(source).toMatch(/timingSafeEqual\(/);
    const comparisons = source
      .split('\n')
      .map((line) => line.replaceAll(/[!=]==\s*(null|undefined|''|true|false)/g, ''))
      .filter((line) => /[!=]==/.test(line));
    expect(comparisons).toEqual([]);
  });
});

describe('更新の間は新旧どちらの秘密も受ける', () => {
  const body = new TextEncoder().encode('{"id":"evt_1"}');
  const sign = (key: string): string => createHmac('sha256', key).update(body).digest('hex');

  const matches: readonly (readonly [string, string | null, readonly (string | undefined)[], boolean])[] = [
    ['現在の秘密に一致', LONG, [LONG, OTHER], true],
    ['更新前の秘密に一致', OTHER, [LONG, OTHER], true],
    ['どちらにも一致しない', 'c'.repeat(32), [LONG, OTHER], false],
    ['更新前が未設定でも現在に一致', LONG, [LONG, undefined], true],
    ['現在が未設定(短すぎて捨てた)でも更新前に一致', OTHER, [undefined, OTHER], true],
    ['受け付ける秘密が 1 つも無い', LONG, [undefined, undefined], false],
    ['秘密の並びが空', LONG, [], false],
    ['提示が無い', null, [LONG], false],
    ['空の提示は一致しない', '', [LONG], false],
  ];

  const signatures: readonly (readonly [string, string | undefined | readonly (string | undefined)[], string | null, boolean])[] = [
    ['単一の鍵で一致(従来の形)', LONG, sign(LONG), true],
    ['単一の鍵で不一致', LONG, sign(OTHER), false],
    ['単一の鍵が未設定', undefined, sign(LONG), false],
    ['現在の鍵で署名した相手を受ける', [LONG, OTHER], sign(LONG), true],
    ['更新前の鍵で署名した相手も受ける', [LONG, OTHER], sign(OTHER), true],
    ['どちらでもない鍵は受けない', [LONG, OTHER], sign('c'.repeat(32)), false],
    ['更新前が未設定なら現在の鍵だけ', [LONG, undefined], sign(OTHER), false],
    ['鍵が全部未設定なら閉じる', [undefined, undefined], sign(LONG), false],
    ['空の鍵は鍵として数えない', [''], sign(''), false],
    ['署名が無い', [LONG, OTHER], null, false],
    ['空の署名', [LONG, OTHER], '', false],
    ['大文字・前後の空白は揃えて比べる', LONG, `  ${sign(LONG).toUpperCase()} `, true],
  ];

  // @spec framework-guarantee-catalog @tc TC-FW-SECRET-002
  it('現在の秘密と更新前の秘密のどちらにも一致を受け、どちらでもなければ・受け付ける秘密が無ければ閉じる(受信の署名の検証も、鍵の並びで同じ)', () => {
    for (const [label, presented, secrets, expected] of matches) expect(matchesAnySecret(presented, secrets), label).toBe(expected);
    for (const [label, secret, presented, expected] of signatures) {
      expect(verifyInboundSignature('hmac_sha256', secret, body, presented), label).toBe(expected);
    }
  });
});
