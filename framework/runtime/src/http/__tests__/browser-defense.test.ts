/**
 * ブラウザ側の守りの部品(`browser-defense.ts`)のテスト。
 *
 * 確かめるのは 4 つ —— ①nonce は暗号論的な乱数 16 バイトで、要求ごとに変わる ②文書の CSP は nonce を宣言した指令にだけ差し込み、
 * 開発の源は開発中にしか足さない ③状態を変える要求は出どころを確かめられなければ描画に進ませない ④進ませる要求は nonce と CSP を
 * 要求と応答の両方に載せ、応答にキャッシュの禁止を付ける。宣言の値は製品の生成物と同じ形の最小の見本である。
 */

import { describe, expect, it } from 'vitest';
import {
  CSP_HEADER,
  NONCE_REQUEST_HEADER,
  contentSecurityPolicy,
  createNonce,
  gateDocumentRequest,
  staticHeaderEntries,
} from '../browser-defense';
import type { BrowserDefensePolicy } from '../browser-defense';

/** 見本の宣言(生成物と同じ形)。 */
const POLICY: BrowserDefensePolicy = {
  headers: [
    { name: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { name: 'X-Content-Type-Options', value: 'nosniff' },
  ],
  csp: {
    directives: [
      { name: 'script-src', sources: ["'strict-dynamic'"] },
      { name: 'object-src', sources: ["'none'"] },
      { name: 'base-uri', sources: ["'none'"] },
    ],
    nonceDirectives: ['script-src'],
    development: [{ name: 'script-src', sources: ["'unsafe-eval'"] }],
  },
  noStore: { name: 'Cache-Control', value: 'no-store' },
  clearSiteData: { name: 'Clear-Site-Data', value: '"cache", "cookies", "storage"' },
};

/** 決まった値で埋める乱数の口(0, 1, 2, …)。 */
const SEQUENTIAL = (bytes: Uint8Array): Uint8Array => bytes.map((_, index) => index);

describe('createNonce(要求ごとの nonce)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-BROWSER-001
  it('nonce は乱数 16 バイトの base64 で、既定の乱数源では要求ごとに変わる', () => {
    expect(createNonce(SEQUENTIAL)).toBe(btoa(String.fromCharCode(...Array.from({ length: 16 }, (_, index) => index))));
    expect(atob(createNonce()).length).toBe(16);
    const seen = new Set(Array.from({ length: 64 }, () => createNonce()));
    expect(seen.size).toBe(64);
  });
});

describe('contentSecurityPolicy(文書の CSP)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-BROWSER-002
  it('nonce は宣言した指令の先頭にだけ入り、開発の源は開発中にしか足さない', () => {
    expect(contentSecurityPolicy(POLICY.csp, 'abc', false)).toBe("script-src 'nonce-abc' 'strict-dynamic'; object-src 'none'; base-uri 'none'");
    expect(contentSecurityPolicy(POLICY.csp, 'abc', true)).toBe(
      "script-src 'nonce-abc' 'strict-dynamic' 'unsafe-eval'; object-src 'none'; base-uri 'none'",
    );
  });
});

describe('staticHeaderEntries(全応答の固定のヘッダ)', () => {
  it('宣言のヘッダを key / value の形に写す(並びと値を変えない)', () => {
    expect(staticHeaderEntries(POLICY)).toEqual([
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
    ]);
  });
});

/** 同じオリジンのページから出た要求のヘッダ。 */
function sameOriginHeaders(): Headers {
  return new Headers({ host: 'app.example', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' });
}

describe('gateDocumentRequest(文書の口の判定)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-BROWSER-003
  it('出どころを確かめられない状態を変える要求(Origin の無い Server Action・他サイトから)は、描画に進ませず 403 で閉じる', async () => {
    const crossSite = new Headers({ host: 'app.example', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    const noOrigin = new Headers({ host: 'app.example' });
    const untrusted = [crossSite, noOrigin];
    expect(untrusted).toHaveLength(2);
    for (const headers of untrusted) {
      const gate = gateDocumentRequest({ method: 'POST', headers, url: 'https://app.example/' }, POLICY, { development: false });
      expect(gate.kind).toBe('refuse');
      if (gate.kind !== 'refuse') continue;
      expect(gate.response.status).toBe(403);
      expect(gate.response.headers.get('cache-control')).toBe('no-store');
      expect(await gate.response.json()).toEqual({ error: 'forbidden' });
    }
  });

  // @spec framework-guarantee-catalog @tc TC-FW-BROWSER-004
  it('進ませる要求には同じ nonce の CSP を要求と応答の両方に載せ、応答にキャッシュの禁止を付ける', () => {
    const passing = [
      { method: 'GET', headers: new Headers({ host: 'app.example' }), url: 'https://app.example/' },
      { method: 'POST', headers: sameOriginHeaders(), url: 'https://app.example/' },
    ];
    expect(passing).toHaveLength(2);
    for (const request of passing) {
      const gate = gateDocumentRequest(request, POLICY, { development: false, fill: SEQUENTIAL });
      expect(gate.kind).toBe('pass');
      if (gate.kind !== 'pass') continue;
      const nonce = createNonce(SEQUENTIAL);
      const csp = contentSecurityPolicy(POLICY.csp, nonce, false);
      expect(gate.requestHeaders.get(NONCE_REQUEST_HEADER)).toBe(nonce);
      expect(gate.requestHeaders.get(CSP_HEADER)).toBe(csp);
      expect(gate.requestHeaders.get('host')).toBe('app.example');
      expect(gate.responseHeaders).toEqual([{ name: CSP_HEADER, value: csp }, POLICY.noStore]);
    }
  });
});
