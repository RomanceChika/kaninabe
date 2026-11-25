/**
 * S22 プレビューの断片の許可表の単体テスト。
 */

import { describe, expect, it } from 'vitest';
import type { ScreenInput } from '../../../lib/model/screen/types.js';
import { previewFragmentsVerifier } from '../../../lib/screen/verifiers/s22-preview-fragments.js';
import type { ScreenContext } from '../../../lib/screen/verifier.js';

const CTX = { roots: { specs: 'docs/specs', previews: 'docs/book/assets/previews' } } as unknown as ScreenContext;

/** 断片だけを持つ入力。 */
function inputOf(previews?: ReadonlyMap<string, string>): ScreenInput {
  return (previews === undefined ? {} : { previews }) as unknown as ScreenInput;
}

describe('S22', () => {
  it.each([
    ['置き場が無い', undefined],
    ['断片が 0 本', new Map<string, string>()],
    ['許可表の中', new Map([['home', '<div class="a"><a href="/x">x</a></div>']])],
  ] as const)('正例: %s', (_name, previews) => {
    expect(previewFragmentsVerifier.verify(inputOf(previews), CTX)).toEqual([]);
  });

  it.each([
    ['on* の属性', '<img src="/a" onerror="x">', 'onerror'],
    ['script', '<script>x</script>', 'script'],
    ['Vue の式の属性', '<div :items="[1]"></div>', ':items'],
    ['コメント', '<!-- x --><div></div>', '<!--'],
  ] as const)('負例: %s', (_name, fragment, expected) => {
    const findings = previewFragmentsVerifier.verify(inputOf(new Map([['screen.x', fragment]])), CTX);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('S22');
    expect(findings[0]?.message).toContain('screen.x');
    expect(findings[0]?.message).toContain(expected);
  });

  it('断片ごとに 1 件', () => {
    const previews = new Map([['a', '<script></script>'], ['b', '<div></div>'], ['c', '<iframe></iframe>']]);
    expect(previewFragmentsVerifier.verify(inputOf(previews), CTX).map((finding) => finding.counterexample?.['fragment'])).toEqual(['a', 'c']);
  });
});
