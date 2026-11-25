import { describe, expect, it } from 'vitest';
import { cutVerification } from '../../helpers/book-verification-cut.js';

describe('cutVerification: HTML で書き出した章', () => {
  const page = (dep: string): string =>
    `<!doctype html>\n<html><body><h3 id="a"><span data-dep="verify">${dep}</span> 印</h3><div data-dep="verify"><div><ul><li>${dep}</li></ul></div></div><p>本文</p></body></html>`;

  it('印の付いた要素だけを中身ごと切り出し、入れ子の同じタグも数えて閉じを決める', () => {
    const entry = cutVerification(page('未集計'));
    const full = cutVerification(page('受け入れ(3)'));
    expect(entry.lines).toEqual(full.lines);
    expect(entry.fragments).toBe(2);
    expect(entry.lines.join('')).toContain('<p>本文</p>');
  });

  it('印の外の違いは違いとして残る', () => {
    expect(cutVerification(page('x')).lines).not.toEqual(cutVerification(page('x').replace('本文', '本文 2')).lines);
  });

  it('検証の語を含んでいても、印の付いていない部分は 1 バイトも変えない(語句の正規化も行ごとの除外もしない)', () => {
    const entry = '<!doctype html>\n<p>まだ通していない分は未集計</p>';
    const full = '<!doctype html>\n<p>まだ通していない分 3 件</p>';
    expect(cutVerification(entry).lines).not.toEqual(cutVerification(full).lines);
    expect(cutVerification(entry).fragments).toBe(0);
  });

  it('HTML でない資材(JSON・CSS・script)は印を持たないので、行に割るだけ', () => {
    expect(cutVerification('a\nb')).toEqual({ lines: ['a', 'b'], fragments: 0 });
  });
});
