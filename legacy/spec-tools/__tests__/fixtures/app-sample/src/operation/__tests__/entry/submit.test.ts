/**
 * lib/trace/scan.ts のテスト用フィクスチャ(app/ の代わりに走査させるツリー)。
 *
 * scan.ts は `*.test.ts` だけを拾うため、フィクスチャもその名前で置く必要がある。
 * 名前が一致する以上 vitest 本体からも実行されるので、中身は「アノテーションが
 * 実物どおりに書かれた、実行しても壊れないテスト」にしてある。
 */

import { describe, expect, it } from 'vitest';

describe('scan フィクスチャ', () => {
  // @spec entry.submit @tc TC-FIXTURE-SUBMIT-001
  it('下書きから提出できる', () => {
    expect(true).toBe(true);
  });

  // @spec INV-ENTRY-001 @tc TC-FIXTURE-SUBMIT-002
  it('不変条件違反はそのまま不変条件違反として返る', () => {
    expect(true).toBe(true);
  });
});
