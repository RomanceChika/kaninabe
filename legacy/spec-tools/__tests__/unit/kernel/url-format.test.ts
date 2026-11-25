/**
 * `format: url` の文法(kernel)のテスト。
 *
 * 正解表(`helpers/url-cases.ts`)を、検証器・生成器の正規表現と実行時パッケージの `matchesUrl` の
 * 両方に当てて、2 つの綴りが**同じ判定**をすることを固定する(片方だけを直した日に赤になる)。
 * Postgres の `~` との一致は `url-format-parity.integration.test.ts` が見る。
 */

import { describe, expect, it } from 'vitest';
import * as runtime from '@kaninabe/runtime/url';
import * as runtimeMarkdown from '@kaninabe/runtime/markdown';
import {
  FIELD_FORMATS,
  MARKDOWN_MAX_LENGTH,
  URL_MAX_LENGTH,
  effectivePattern,
  matchesUrl,
  urlRegexSource,
  worldUrl,
} from '../../../lib/kernel/url-format.js';
import { URL_CASES } from '../../helpers/url-cases.js';

describe('urlRegexSource / matchesUrl(正解表)', () => {
  it.each(URL_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(matchesUrl(c.value, 'http_https'), 'http_https').toBe(c.httpHttps);
    expect(matchesUrl(c.value, 'https'), 'https').toBe(c.httpsOnly);
  });

  it('正規表現の綴りが実行時パッケージと一字一句同じ(2 つの文法が離れない)', () => {
    expect(urlRegexSource('http_https')).toBe(runtime.urlRegexSource('http_https'));
    expect(urlRegexSource('https')).toBe(runtime.urlRegexSource('https'));
    expect(URL_MAX_LENGTH).toBe(runtime.URL_MAX_LENGTH);
  });

  it.each(URL_CASES.map((c) => [c.name, c] as const))('実行時パッケージの matchesUrl も同じ答え: %s', (_name, c) => {
    expect(runtime.matchesUrl(c.value, 'http_https')).toBe(c.httpHttps);
    expect(runtime.matchesUrl(c.value, 'https')).toBe(c.httpsOnly);
  });

  it('Postgres の ARE でも解釈が揺れない部分集合だけを使っている(後読み・名前つき・\\d・\\s・括弧内のバックスラッシュを持たない)', () => {
    for (const schemes of ['http_https', 'https'] as const) {
      const source = urlRegexSource(schemes);
      expect(source).not.toMatch(/\(\?[<!=]/);
      expect(source).not.toMatch(/\\[dsw]/i);
      expect(source).not.toMatch(/\[[^\]]*\\/);
      expect(source).not.toContain("'");
    }
  });
});

describe('effectivePattern', () => {
  it('format: url は URL の綴りを、pattern はそれを、どちらも無ければ undefined を返す', () => {
    expect(effectivePattern({ format: 'url' })).toBe(urlRegexSource('http_https'));
    expect(effectivePattern({ pattern: '^a$' })).toBe('^a$');
    expect(effectivePattern({})).toBeUndefined();
  });

  it('format: markdown は欄に効く正規表現を持たない(値の文法を課さない)', () => {
    expect(effectivePattern({ format: 'markdown' })).toBeUndefined();
  });

  it('format の語彙は url と markdown だけ(増やすのは DSL の拡張)', () => {
    expect(FIELD_FORMATS).toEqual(['url', 'markdown']);
  });

  it('format: markdown の max_length の天井が、実行時パッケージの解釈の天井と同じ', () => {
    expect(MARKDOWN_MAX_LENGTH).toBe(runtimeMarkdown.MARKDOWN_RENDER_LIMIT);
  });
});

describe('worldUrl(world が機械的に置く URL)', () => {
  it('文法に合い、連番で値が変わる', () => {
    expect(matchesUrl(worldUrl('ticket_url', 1, 500))).toBe(true);
    expect(worldUrl('ticket_url', 1, 500)).not.toBe(worldUrl('ticket_url', 2, 500));
  });

  it('上限が無ければ天井を使い、長い名前でも上限の中に詰めて文法に合う', () => {
    expect(matchesUrl(worldUrl('a'.repeat(3000), 1, undefined))).toBe(true);
    expect(worldUrl('a'.repeat(3000), 1, undefined).length).toBeLessThanOrEqual(URL_MAX_LENGTH);
    const tight = worldUrl('very_long_field_name', 12345, 30);
    expect(tight.length).toBeLessThanOrEqual(30);
    expect(matchesUrl(tight)).toBe(true);
  });

  it('上限がスキームとホストより短いときは、頭だけを返す(R10 と max_length の別の検査が止める領域)', () => {
    expect(worldUrl('x', 1, 5)).toBe('https://example.test/');
  });
});
