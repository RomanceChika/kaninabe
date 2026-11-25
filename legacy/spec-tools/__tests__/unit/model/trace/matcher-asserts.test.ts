/**
 * `matcherAssertionOffsets`(A16 の assert の数え方)のユニットテスト。
 *
 * 数えるのは「`expect(...)` を根に持ち、matcher の呼び出しで終わるメンバ連鎖」だけである。
 * 網の穴探し 2026-10-06 の M31(`expect(isCronAuthorized(undefined, null));` と matcher を
 * 落としても「assert あり」と数えられた)を直接の根拠とする。
 */

import { describe, expect, it } from 'vitest';
import { matcherAssertionOffsets } from '../../../../lib/model/trace/matcher-asserts.js';

/** 断片の中の assert の数。 */
function count(body: string): number {
  return matcherAssertionOffsets(`{\n${body}\n}`).length;
}

describe('matcherAssertionOffsets: matcher で終わる expect だけを数える', () => {
  it('matcher の呼び出しで終わる連鎖を数える', () => {
    expect(count('expect(a).toBe(1);')).toBe(1);
    expect(count('expect(a).toBe(1);\nexpect(b).toEqual(2);')).toBe(2);
  });

  it('matcher の無い expect(...) は数えない(M31)', () => {
    expect(count("expect(isCronAuthorized(undefined, 'Bearer undefined'));")).toBe(0);
  });

  it('連鎖が matcher を呼ばずに終わるものは数えない(参照だけ・修飾だけ)', () => {
    expect(count('expect(a).toBe;')).toBe(0);
    expect(count('expect(a).not;')).toBe(0);
    expect(count('expect(a).resolves;')).toBe(0);
    expect(count('expect(a).rejects.not;')).toBe(0);
  });

  it('.not / .resolves / .rejects を挟んでよい', () => {
    expect(count('expect(a).not.toBe(1);')).toBe(1);
    expect(count('await expect(p).resolves.toBe(1);')).toBe(1);
    expect(count('await expect(p).rejects.toThrow();')).toBe(1);
    expect(count('await expect(p).resolves.not.toBe(1);')).toBe(1);
  });

  it('await のトップレベル・括弧の中・メッセージつき expect でも数える', () => {
    expect(count('await expect(page.locator("x")).toBeVisible();')).toBe(1);
    expect(count("expect(a, 'なぜか').toBe(1);")).toBe(1);
  });

  it('添字で書いた matcher も数える', () => {
    expect(count("expect(a)['toBe'](1);")).toBe(1);
    expect(count("expect(a)['not'];")).toBe(0);
  });

  it('コメント・文字列の中の expect は数えない', () => {
    expect(count('// expect(a).toBe(1);')).toBe(0);
    expect(count("const s = 'expect(a).toBe(1)';")).toBe(0);
  });

  it('expect でない関数の連鎖は数えない', () => {
    expect(count('other(a).toBe(1);')).toBe(0);
    expect(count('expectation(a).toBe(1);')).toBe(0);
  });

  it('位置は断片の先頭からの index で、包みの長さを含まない', () => {
    const fragment = '{ expect(a).toBe(1); }';

    expect(matcherAssertionOffsets(fragment)).toEqual([fragment.indexOf('expect')]);
  });

  it('構文が壊れていても読める部分は数える(パーサの回復)', () => {
    expect(count('expect(a).toBe(1);\nconst = ;')).toBe(1);
  });

  it('型の山括弧(ジェネリックなアロー関数・型アサーション)のあとの expect も数える(㉓-a2 P2。TSX 固定だと 0 になる)', () => {
    expect(count('const f = <T>(x: T) => x;\nexpect(f(1)).toBe(1);')).toBe(1);
    expect(count('const g = <T,>(x: T) => x;\nexpect(g(1)).toBe(1);')).toBe(1);
    expect(count('const v = <any>foo;\nexpect(a).toBe(1);')).toBe(1);
    expect(count('const f = <T>(x: T) => x;\nexpect(f(1)).toBe(1);\nexpect(f(2)).toBe(2);')).toBe(2);
  });

  it('JSX を含む断片は TSX に倒して数える(TS のままでは構文エラーになる形)', () => {
    expect(count('const el = <div className="a" />;\nexpect(el).toBeTruthy();')).toBe(1);
    expect(count('render(<Panel title="t">x</Panel>);\nexpect(screen.getByText("x")).toBeVisible();')).toBe(1);
  });

  it('位置のずれも TS / TSX どちらの読み方でも同じ(包みの長さを引く)', () => {
    const generic = '{ const f = <T>(x: T) => x; expect(f(1)).toBe(1); }';
    const jsx = '{ const el = <div />; expect(el).toBe(1); }';

    expect(matcherAssertionOffsets(generic)).toEqual([generic.indexOf('expect')]);
    expect(matcherAssertionOffsets(jsx)).toEqual([jsx.indexOf('expect')]);
  });
});
