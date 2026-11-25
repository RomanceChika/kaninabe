/**
 * 仕様の文字列を生成物の出口に置くときの無害化(`lib/kernel/safe-text.ts`)の単体テスト。
 *
 * 置く位置ごとに、監査が実測した敵対的な入力で「位置を破れない」ことを確かめる:
 * 行コメント(改行)・ブロックコメント(`*\/`)・文字列リテラル(引用符・改行・単独の復帰)・SQL の `$$` の本文。
 */

import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { blockCommentText, lineCommentText, oneLine, sqlCommentText, sqlStringLiteral, tsStringLiteral } from '../../../lib/kernel/safe-text.js';

describe('oneLine / lineCommentText / sqlCommentText', () => {
  it('改行(LF・CRLF・CR・U+2028・U+2029・NEL)を空白 1 つにする。次の行に SQL を足せない', () => {
    const hostile = '目的\n drop table users; --';

    expect(sqlCommentText(hostile)).not.toMatch(/[\n\r]/);
    expect(`-- ${sqlCommentText(hostile)}`.split('\n')).toHaveLength(1);
    for (const separator of ['\r\n', '\r', '\u2028', '\u2029', '\u0085', '\u000B', '\u000C']) {
      expect(lineCommentText(`a${separator}b`)).toBe('a b');
    }
  });

  it('制御文字・向きを変える文字を取り除く。タブは残す', () => {
    expect(oneLine('a\u0000b\u001Bc\u202Ed\u2066e\tf')).toBe('abcde\tf');
  });

  it('正常な文字列は 1 バイトも変えない', () => {
    expect(oneLine('会議室を予約する — 目的 / x')).toBe('会議室を予約する — 目的 / x');
  });
});

describe('blockCommentText', () => {
  it('閉じ記号を逃がす(監査の実測: ラベルの `*/ globalThis.X=1; /*`)', () => {
    const hostile = '*/ globalThis.X = 1; /*';

    const comment = `/** ${blockCommentText(hostile)} */`;

    expect(comment.indexOf('*/')).toBe(comment.length - 2);
    expect(runInNewContext(`${comment}\n1`, { globalThis: {} })).toBe(1);
  });

  it('改行も 1 行にする', () => {
    expect(blockCommentText('a\n*/b')).toBe('a *\\/b');
  });
});

describe('tsStringLiteral', () => {
  it.each([
    ["it's"],
    ['back\\slash'],
    ['line1\nline2'],
    ['lone\rcr'],
    ['sep\u2028arator\u2029'],
    ['nul\u0000and\u001Bescape'],
    ["'; globalThis.X = 1; '"],
  ])('%j は評価すると元の文字列に戻る(リテラルを破らない)', (value) => {
    const literal = tsStringLiteral(value);

    expect(runInNewContext(literal)).toBe(value.replace(/\r\n/g, '\n'));
    expect(literal).not.toMatch(/[\n\r\u2028\u2029]/);
  });

  it('\\r\\n は従来どおり \\n に畳む(出力の安定)', () => {
    expect(tsStringLiteral('a\r\nb')).toBe("'a\\nb'");
  });
});

describe('sqlStringLiteral', () => {
  it('単引用符を二重にする', () => {
    expect(sqlStringLiteral("o'clock")).toBe("'o''clock'");
  });

  it('`$$` を含む値は Unicode エスケープの形にして、`$$` の本文を閉じさせない', () => {
    const literal = sqlStringLiteral("x$$ ; drop table t; --'");

    expect(literal.startsWith("U&'")).toBe(true);
    expect(literal).not.toContain('$');
    expect(literal).toContain('\\0024\\0024');
  });

  it('`$` が 1 つだけの値(正規表現の末尾など)は従来の形のまま', () => {
    expect(sqlStringLiteral('^[a-z]+$')).toBe("'^[a-z]+$'");
  });

  it('NUL は取り除く', () => {
    expect(sqlStringLiteral('a\u0000b')).toBe("'ab'");
  });
});
