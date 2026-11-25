/**
 * 本文つき応答の部品(`response.ts`。ASVS V4.1.1)のテスト。
 *
 * 確かめるのは 3 つ —— ①`Content-Type` に charset が付く(JSON も平文も) ②呼び出し側が別の `Content-Type` を渡しても部品が
 * 決め直す(ほかのヘッダとステータスは残る) ③JSON にならない値は `Response.json` と同じく `TypeError`、日本語の本文が UTF-8 で往復する。
 */

import { describe, expect, it } from 'vitest';
import { JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE, jsonResponse, textResponse } from '../response';

describe('jsonResponse', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-HTTPPARTS-001
  it('application/json; charset=utf-8 を付け、ステータスとほかのヘッダを残す', async () => {
    const response = jsonResponse({ error: 'forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('content-type')).toBe(JSON_CONTENT_TYPE);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  it('init を省くと 200 で、Headers・配列の形の headers も受ける', () => {
    expect(jsonResponse([]).status).toBe(200);
    expect(jsonResponse({}, { headers: new Headers({ 'X-A': '1' }) }).headers.get('x-a')).toBe('1');
    expect(jsonResponse({}, { headers: [['X-B', '2']] }).headers.get('x-b')).toBe('2');
  });

  it('呼び出し側の Content-Type は上書きする(名前の大文字小文字を問わない)', () => {
    for (const headers of [{ 'Content-Type': 'text/html' }, { 'content-type': 'application/json' }, { 'CONTENT-TYPE': 'text/plain; charset=latin1' }]) {
      expect(jsonResponse({}, { headers }).headers.get('content-type'), JSON.stringify(headers)).toBe(JSON_CONTENT_TYPE);
    }
  });

  it('渡した init のヘッダを書き換えない', () => {
    const headers = new Headers({ 'Content-Type': 'text/html' });
    jsonResponse({}, { headers });
    expect(headers.get('content-type')).toBe('text/html');
  });

  it('日本語・null・数値・文字列を JSON にして返す', async () => {
    expect(await jsonResponse({ 名前: '値' }).json()).toEqual({ 名前: '値' });
    expect(await jsonResponse(null).text()).toBe('null');
    expect(await jsonResponse(1).text()).toBe('1');
    expect(await jsonResponse('a').text()).toBe('"a"');
  });

  it('JSON にならない値(undefined・関数・シンボル)は TypeError', () => {
    expect(() => jsonResponse(undefined)).toThrow(TypeError);
    expect(() => jsonResponse(() => 1)).toThrow(TypeError);
    expect(() => jsonResponse(Symbol('x'))).toThrow(TypeError);
  });
});

describe('textResponse', () => {
  it('text/plain; charset=utf-8 を付ける(文字列)', async () => {
    const response = textResponse('こんにちは', { status: 201, headers: { 'Cache-Control': 'no-store' } });
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('content-type')).toBe(TEXT_CONTENT_TYPE);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('こんにちは');
  });

  it('UTF-8 のストリームも同じ Content-Type で逐次に流せる', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('あ'));
        controller.enqueue(encoder.encode('い'));
        controller.close();
      },
    });
    const response = textResponse(stream);
    expect(response.headers.get('content-type')).toBe(TEXT_CONTENT_TYPE);
    expect(await response.text()).toBe('あい');
  });

  it('呼び出し側の Content-Type は上書きする', () => {
    expect(textResponse('x', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }).headers.get('content-type')).toBe(TEXT_CONTENT_TYPE);
  });
});
