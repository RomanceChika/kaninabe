/**
 * 要求の出どころの確認と Route Handler の応答の部品(`request-origin.ts`)のテスト。
 *
 * 確かめるのは 3 つ —— ①`Sec-Fetch-Site: same-origin` と自分のホストに一致する `Origin` の**両方**が揃ったときだけ同じオリジンと
 * 認める(片方・食い違い・読めない値は閉じる) ②cookie で認証する口の最初の 1 行は、状態を変える要求だけを確かめる
 * ③ログアウトの応答はブラウザに残るデータを消させ、応答自体も残させない。
 */

import { describe, expect, it } from 'vitest';
import { crossOriginRefusal, isSameOriginRequest, isStateChangingMethod, logoutResponse, noStoreInit, refuseCrossOrigin } from '../request-origin';
import type { BrowserDefensePolicy } from '../browser-defense';

/** 見本の宣言(この部品が読むのはキャッシュの禁止と消去の 2 本だけ)。 */
const POLICY: BrowserDefensePolicy = {
  headers: [],
  csp: { directives: [], nonceDirectives: [], development: [] },
  noStore: { name: 'Cache-Control', value: 'no-store' },
  clearSiteData: { name: 'Clear-Site-Data', value: '"cache", "cookies", "storage"' },
};

describe('isStateChangingMethod', () => {
  it('GET / HEAD / OPTIONS だけが状態を変えない(大文字小文字は問わない)', () => {
    for (const method of ['GET', 'head', 'Options']) expect(isStateChangingMethod(method)).toBe(false);
    for (const method of ['POST', 'put', 'PATCH', 'DELETE']) expect(isStateChangingMethod(method)).toBe(true);
  });
});

describe('isSameOriginRequest(要求の出どころ)', () => {
  /** 要求の URL(`X-Forwarded-Proto` が無いときの自分のスキーム)。 */
  const URL_HTTPS = 'https://app.example/api/x';

  // @spec framework-guarantee-catalog @tc TC-FW-BROWSER-005
  it('Sec-Fetch-Site: same-origin と、自分のホストに一致する Origin の両方が揃ったときだけ同じオリジンと認める', () => {
    const accepted = [
      { host: 'app.example', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' },
      { host: 'internal:3000', 'x-forwarded-host': 'app.example, proxy.example', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' },
    ];
    const refused = [
      { host: 'app.example', origin: 'https://app.example' },
      { host: 'app.example', origin: 'https://app.example', 'sec-fetch-site': 'same-site' },
      { host: 'app.example', 'sec-fetch-site': 'same-origin' },
      { host: 'app.example', origin: 'null', 'sec-fetch-site': 'same-origin' },
      { host: 'app.example', origin: 'not a url', 'sec-fetch-site': 'same-origin' },
      { host: 'app.example', origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' },
      { host: 'app.example', origin: 'https://app.example:8443', 'sec-fetch-site': 'same-origin' },
      { origin: 'https://app.example', 'sec-fetch-site': 'same-origin' },
      { host: '', 'x-forwarded-host': ' ', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' },
    ];
    for (const headers of accepted) expect(isSameOriginRequest({ headers: new Headers(headers), url: URL_HTTPS }), JSON.stringify(headers)).toBe(true);
    for (const headers of refused) expect(isSameOriginRequest({ headers: new Headers(headers), url: URL_HTTPS }), JSON.stringify(headers)).toBe(false);
  });

  it('スキームも比べる: 自分のスキームは X-Forwarded-Proto の先頭、無ければ要求の URL のスキーム(読めない・Web でない値は閉じる)', () => {
    const page = { host: 'app.example', 'sec-fetch-site': 'same-origin' };
    const accepted = [
      { headers: { ...page, origin: 'https://app.example' }, url: URL_HTTPS },
      { headers: { ...page, origin: 'http://app.example' }, url: 'http://app.example/api/x' },
      { headers: { ...page, origin: 'https://app.example', 'x-forwarded-proto': 'https, http' }, url: 'http://internal/api/x' },
      { headers: { ...page, origin: 'https://app.example', 'x-forwarded-proto': ' HTTPS ' }, url: 'http://internal/api/x' },
    ];
    const refused = [
      // http のページから https の口へ(同じホストでも別のオリジン)
      { headers: { ...page, origin: 'http://app.example' }, url: URL_HTTPS },
      { headers: { ...page, origin: 'http://app.example', 'x-forwarded-proto': 'https' }, url: 'http://app.example/api/x' },
      { headers: { ...page, origin: 'https://app.example' }, url: 'http://app.example/api/x' },
      // 前段が付けた値が Web のスキームでない・要求の URL が読めない / Web でない
      { headers: { ...page, origin: 'https://app.example', 'x-forwarded-proto': 'wss' }, url: URL_HTTPS },
      { headers: { ...page, origin: 'https://app.example' }, url: 'not a url' },
      { headers: { ...page, origin: 'https://app.example' }, url: 'file:///api/x' },
    ];
    for (const { headers, url } of accepted) expect(isSameOriginRequest({ headers: new Headers(headers), url }), JSON.stringify({ headers, url })).toBe(true);
    for (const { headers, url } of refused) expect(isSameOriginRequest({ headers: new Headers(headers), url }), JSON.stringify({ headers, url })).toBe(false);
  });
});

describe('refuseCrossOrigin(cookie で認証する口の最初の 1 行)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-BROWSER-006
  it('状態を変える要求で出どころを確かめられなければ 403(理由は書かない)、確かめられるか状態を変えない要求なら本体へ進む', async () => {
    const cross = new Request('https://app.example/api/x', { method: 'POST', headers: { host: 'app.example', origin: 'https://evil.example' } });
    const refused = refuseCrossOrigin(cross, POLICY);
    expect(refused?.status).toBe(403);
    expect(refused?.headers.get('cache-control')).toBe('no-store');
    expect(await refused?.json()).toEqual({ error: 'forbidden' });

    const same = new Request('https://app.example/api/x', {
      method: 'POST',
      headers: { host: 'app.example', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' },
    });
    expect(refuseCrossOrigin(same, POLICY)).toBeNull();
    expect(refuseCrossOrigin(new Request('https://app.example/api/x'), POLICY)).toBeNull();
  });
});

describe('応答の部品', () => {
  it('閉じる応答とキャッシュの禁止の初期値は、宣言のキャッシュの禁止を付ける', () => {
    expect(crossOriginRefusal(POLICY).headers.get('cache-control')).toBe('no-store');
    expect(crossOriginRefusal(POLICY).headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(noStoreInit(POLICY, 201)).toEqual({ status: 201, headers: { 'Cache-Control': 'no-store' } });
  });

  // @spec framework-guarantee-catalog @tc TC-FW-BROWSER-007
  it('ログアウトの応答は 204 で、Clear-Site-Data と no-store を付ける', () => {
    const response = logoutResponse(POLICY);
    expect(response.status).toBe(204);
    expect(response.headers.get('clear-site-data')).toBe('"cache", "cookies", "storage"');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
