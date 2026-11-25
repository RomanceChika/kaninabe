/**
 * シェルと YAML の `#` コメントの取り出しのテスト。
 *
 * 規約網羅(term-ledger-writing.md §走査の範囲): M9 はシェルと YAML のコメントを読む。`#` がコメントに
 * なる条件は「行頭か空白の直後・引用符の外・ヒアドキュメントの本文の外」で、**読み違えると 2 方向に壊れる**:
 *   - 文字列やデータの中の `#` を切ると、コードの一部が散文に化けて誤検出になる
 *   - コメントを取りこぼすと、範囲に入れた意味が無い(黙って外れる)
 */

import { describe, expect, it } from 'vitest';
import { hashCommentProseLines } from '../../../lib/terms/hash-comments.js';

/** コメントの (行番号, 文字) の対だけを返す。 */
function comments(source: string): readonly (readonly [number, string])[] {
  return hashCommentProseLines(source).map((line) => [line.line, line.text]);
}

describe('hashCommentProseLines: 取る形', () => {
  it('行頭のコメントと、コードの後ろのコメントを行番号つきで取る', () => {
    expect(comments('#!/bin/sh\n# 説明\nset -e # 後ろの説明\n\necho ok\n')).toEqual([
      [1, '#!/bin/sh'],
      [2, '# 説明'],
      [3, '# 後ろの説明'],
    ]);
  });

  it('字下げしたコメントも取る(YAML のジョブの中・シェルの if の中)', () => {
    expect(comments('jobs:\n  a:\n    # ジョブの説明\n    runs-on: x # 後ろ\n')).toEqual([
      [3, '# ジョブの説明'],
      [4, '# 後ろ'],
    ]);
  });

  it('YAML の run ブロックの中のシェルのコメントも取る', () => {
    expect(comments('steps:\n  - run: |\n      # 鮮度を見る\n      npm run x\n')).toEqual([[3, '# 鮮度を見る']]);
  });

  it('`例:` のある行に例示の印を付ける', () => {
    const lines = hashCommentProseLines('# 普通\n# 旧綴り(例: ゲート)\n');

    expect(lines.map((line) => line.example)).toEqual([false, true]);
  });

  it('コメントが無ければ空', () => {
    expect(comments('echo ok\nname: x\n')).toEqual([]);
  });
});

describe('hashCommentProseLines: 取らない形(コードの一部を散文に化けさせない)', () => {
  it('ダブルクォート・シングルクォートの中の # はコメントではない', () => {
    expect(comments('echo "a # b"\necho \'a # b\'\nname: "x # y" # 本物\n')).toEqual([[3, '# 本物']]);
  });

  it('引用符は行をまたぐ(複数行の文字列の中の # はコメントではない)', () => {
    expect(comments('echo "一行目\n# 二行目の頭\n三行目" # 本物\n')).toEqual([[3, '# 本物']]);
  });

  it('空白の直後でない # はコメントではない($# / ${#x} / foo#bar / YAML のプレーンな値)', () => {
    expect(comments('echo $# ${#x} foo#bar\nurl: http://x/#a\n')).toEqual([]);
  });

  it('バックスラッシュでエスケープした # はコメントではない', () => {
    expect(comments('echo \\# x\n')).toEqual([]);
  });

  it('英単語の途中のアポストロフィは引用符を開かない(後ろのコメントを食べない)', () => {
    expect(comments("echo don't # 本物\n")).toEqual([[1, '# 本物']]);
  });

  it('ヒアドキュメントの本文の # はコメントではない(終わりの語の次の行から読み直す)', () => {
    const source = 'cat <<EOF\n# データ\nEOF\n# 本物\ncat <<-\'END\'\n# データ 2\nEND\n';

    expect(comments(source)).toEqual([[4, '# 本物']]);
  });

  it('ヒアストリング <<< はヒアドキュメントではない', () => {
    expect(comments('cat <<<word\n# 本物\n')).toEqual([[2, '# 本物']]);
  });

  it('ヒアドキュメントの開始行のコメントは取る', () => {
    expect(comments('cat <<EOF # 開始行\n# データ\nEOF\n')).toEqual([[1, '# 開始行']]);
  });
});
