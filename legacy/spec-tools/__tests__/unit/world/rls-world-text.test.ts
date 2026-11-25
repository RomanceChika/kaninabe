/**
 * world が機械的に置く文字列の値(`textValue`)のテスト。
 * 書式なしは `{欄名}-{連番}` を `max_length` の中に詰め、書式 url は文法に合う URL を置く。
 */

import { describe, expect, it } from 'vitest';
import { textValue } from '../../../lib/world/rls-world-text.js';
import { matchesUrl } from '../../../lib/kernel/url-format.js';
import { field } from '../../helpers/model-builder.js';

describe('textValue', () => {
  it('書式なしの欄は {欄名}-{連番}', () => {
    expect(textValue(field('title', { kind: 'string' }), 7)).toBe('title-7');
  });

  it('max_length を超えるときは末尾側を残して詰める(連番が残るので一意性を保つ)', () => {
    expect(textValue({ ...field('very_long_title', { kind: 'string' }), maxLength: 5 }, 12)).toBe('le-12');
    expect(textValue({ ...field('t', { kind: 'string' }), maxLength: 3 }, 1)).toBe('t-1');
  });

  it('書式 url の欄は文法に合う URL で、連番ごとに値が変わり、max_length に収まる', () => {
    const url = { ...field('ticket_url', { kind: 'string' }), format: 'url' as const, maxLength: 500 };
    expect(matchesUrl(textValue(url, 1))).toBe(true);
    expect(textValue(url, 1)).not.toBe(textValue(url, 2));
    const tight = textValue({ ...url, maxLength: 40 }, 123456);
    expect(tight.length).toBeLessThanOrEqual(40);
    expect(matchesUrl(tight)).toBe(true);
  });
});
