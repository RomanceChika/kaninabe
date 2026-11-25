/**
 * 用語の台帳の走査(本文の行の取り出しと、綴りの照合)のユニットテスト。
 *
 * 規約網羅(term-ledger-writing.md §走査の規則):
 *   - フロントマターと HTML コメントの行は本文に入らない(複数行のコメントも)
 *   - `例:` / `例：` のある行は例示の行として印が付く
 *   - 引用(`> ` の行・かぎ括弧「」の中)は M9 が読まないので、その取り出しの口が正しく切る
 *   - **綴りの照合は語の境界を見る**: 漢字・カタカナ・英数字の連なりの途中は別の語として数えない
 *     (例: `閉世界` の中の `世界`・`画面` の中の `面`・`名札` の中の `札`)
 */

import { describe, expect, it } from 'vitest';
import { commentProseLines, findSpelling, isQuoteBlockLine, proseLines, withoutQuotes } from '../../../lib/terms/prose.js';

describe('proseLines: 本文の行の取り出し', () => {
  it('フロントマターを本文に入れず、行番号は元のファイルのままにする', () => {
    const lines = proseLines('---\ndoc_type: meta\n---\n本文の 1 行目\n本文の 2 行目\n');

    expect(lines.map((line) => [line.line, line.text])).toEqual([
      [4, '本文の 1 行目'],
      [5, '本文の 2 行目'],
      [6, ''],
    ]);
  });

  it('フロントマターが無ければ全行を本文にする(閉じていないときも同じ)', () => {
    expect(proseLines('a\nb').map((line) => line.text)).toEqual(['a', 'b']);
    expect(proseLines('---\na: 1\nb').map((line) => line.text)).toEqual(['---', 'a: 1', 'b']);
  });

  it('HTML コメントの行を落とす(1 行のものも複数行のものも)', () => {
    const lines = proseLines('前\n<!-- AUTO-GENERATED:x -->\n<!--\n複数行の\nコメント\n-->\n後\n');

    expect(lines.map((line) => line.text)).toEqual(['前', '後', '']);
  });

  it('`例:` と `例：` のある行に例示の印を付ける', () => {
    const lines = proseLines('普通の行\n旧綴り(例: 固定物)\n旧綴り(例：固定物)\n');

    expect(lines.map((line) => line.example)).toEqual([false, true, true, false]);
  });
});

describe('proseLines: 生成ブロックを落とす設定', () => {
  const source = '前\n<!-- AUTO-GENERATED:table -->\n生成された行\n<!-- /AUTO-GENERATED:table -->\n後\n';

  it('既定では生成ブロックの中も本文として読む(ブックは生成物だが読者が読む文そのもの)', () => {
    expect(proseLines(source).map((line) => line.text)).toEqual(['前', '生成された行', '後', '']);
  });

  it('skipGeneratedBlocks なら、開きから閉じまでの行を落とす(行番号は元のまま)', () => {
    const lines = proseLines(source, { skipGeneratedBlocks: true });

    expect(lines.map((line) => [line.line, line.text])).toEqual([
      [1, '前'],
      [5, '後'],
      [6, ''],
    ]);
  });

  it('閉じの無い生成ブロックは末尾まで落とす(壊れた入力で後ろの本文を出し直さない)', () => {
    const lines = proseLines('前\n<!-- AUTO-GENERATED:x -->\n生成\n', { skipGeneratedBlocks: true });

    expect(lines.map((line) => line.text)).toEqual(['前']);
  });
});

describe('commentProseLines: コードのコメントを本文の行にする', () => {
  it('コメントの部分だけを行にし、`例:` の行には印を付ける', () => {
    const lines = commentProseLines("const s = '固定物'; // 旧綴り(例: 固定物)\n// 普通のコメント\n");

    expect(lines).toEqual([
      { line: 1, text: '// 旧綴り(例: 固定物)', example: true },
      { line: 2, text: '// 普通のコメント', example: false },
    ]);
  });

  it('文字列の中の綴りは行に入らない(コメントの外は別の道で直す)', () => {
    expect(commentProseLines("const s = '固定物';\n")).toEqual([]);
  });
});

describe('findSpelling: 語の境界を見る照合', () => {
  it('前後が区切りや仮名なら数える', () => {
    expect(findSpelling('RLS の世界を作る', '世界')).toEqual([5]);
    expect(findSpelling('世界', '世界')).toEqual([0]);
    expect(findSpelling('外から届く面。', '面')).toEqual([5]);
  });

  it('漢字の連なりの途中は数えない(閉世界・画面・場面)', () => {
    expect(findSpelling('閉世界の外', '世界')).toEqual([]);
    expect(findSpelling('画面と場面', '面')).toEqual([]);
    expect(findSpelling('名札を付ける', '札')).toEqual([]);
  });

  it('語が 2 回出れば 2 回数える(境界で落ちたものは数えない)', () => {
    expect(findSpelling('世界と閉世界と世界', '世界')).toEqual([0, 7]);
  });

  it('カタカナの連なりの途中は数えない', () => {
    expect(findSpelling('全ステップ緑', 'ステップ')).toEqual([1]);
    expect(findSpelling('ワンステップ', 'ステップ')).toEqual([]);
    expect(findSpelling('ステップバイステップ', 'ステップ')).toEqual([]);
  });

  it('漢字が隣でも、端の文字が漢字でなければ数える', () => {
    expect(findSpelling('全ゲート緑', 'ゲート')).toEqual([1]);
  });

  it('英数字の連なりの途中は数えない', () => {
    expect(findSpelling('data parity test', 'parity')).toEqual([5]);
    expect(findSpelling('parity_test', 'parity')).toEqual([]);
    expect(findSpelling('nonparity', 'parity')).toEqual([]);
  });

  it('英字の綴りは、- . / でもう 1 つの英数字の連なりにつながるなら識別子の一部として数えない(ID・ファイル名・パス)', () => {
    expect(findSpelling('data-table-parity が落ちる', 'parity')).toEqual([]);
    expect(findSpelling('parity-tree を作る', 'parity')).toEqual([]);
    expect(findSpelling('policy.parity.test.ts', 'parity')).toEqual([]);
    expect(findSpelling('__tests__/parity/x.ts', 'parity')).toEqual([]);
    expect(findSpelling('検査 ID は parity だけ', 'parity')).toEqual([8]);
    expect(findSpelling('`parity` と書く', 'parity')).toEqual([1]);
    expect(findSpelling('文末の parity.', 'parity')).toEqual([4]);
    expect(findSpelling('突合/parity と書く', 'parity')).toEqual([3]);
    expect(findSpelling('parity- のように', 'parity')).toEqual([0]);
  });

  it('日本語の綴りには識別子の規則を当てない(スラッシュ区切りの列挙や文末の記号の隣でも数える)', () => {
    expect(findSpelling('ステップ/手順', 'ステップ')).toEqual([0]);
    expect(findSpelling('手順/ゲート', 'ゲート')).toEqual([3]);
    expect(findSpelling('ステップ-手順', 'ステップ')).toEqual([0]);
  });

  it('空の綴りは何も見つけない', () => {
    expect(findSpelling('なんでも', '')).toEqual([]);
  });

  it('例: 漢字を含みひらがなで終わる綴り(活用する語)は、後ろに続くひらがなで切らずに数える', () => {
    expect(findSpelling('判断が降りるのは困る', '降りる')).toEqual([3]);
    expect(findSpelling('式が降ろして書かれる', '降ろし')).toEqual([2]);
    expect(findSpelling('降りてきた要請', '降りて')).toEqual([0]);
    expect(findSpelling('降りた。', '降りた')).toEqual([0]);
  });

  it('例: 活用する語の前の隣の文字は、いつもの規則のまま(漢字が続くなら語の途中)', () => {
    expect(findSpelling('以降りる', '降りる')).toEqual([]);
    expect(findSpelling('に降りる', '降りる')).toEqual([1]);
  });

  it('ひらがなだけの綴りには当てない(漢字を含まないので語の途中として切る)', () => {
    expect(findSpelling('あるのだ', 'ある')).toEqual([]);
  });
});

describe('isQuoteBlockLine: 引用ブロックの行', () => {
  it('`> ` で始まる行(先頭の空白・`>` だけの行も)は引用ブロックの行', () => {
    expect(isQuoteBlockLine('> 引用の行')).toBe(true);
    expect(isQuoteBlockLine('  > 字下げした引用')).toBe(true);
    expect(isQuoteBlockLine('>')).toBe(true);
  });

  it('行の途中の `>`・`>` に続く文字・普通の行は引用ブロックではない', () => {
    expect(isQuoteBlockLine('a > b')).toBe(false);
    expect(isQuoteBlockLine('>>記法')).toBe(false);
    expect(isQuoteBlockLine('普通の行')).toBe(false);
  });
});

describe('withoutQuotes: かぎ括弧「」の中を落とす', () => {
  it('かぎ括弧の中身を落とし、括弧は残す(外の綴りは残る)', () => {
    expect(withoutQuotes('前「ステップ」後 ステップ')).toBe('前「」後 ステップ');
  });

  it('同じ行に複数あれば全部落とす', () => {
    expect(withoutQuotes('「a」と「b」')).toBe('「」と「」');
  });

  it('入れ子は外側の括弧ごとに落とす', () => {
    expect(withoutQuotes('前「外「内」外」後')).toBe('前「」後');
  });

  it('同じ行で閉じていない「は引用として扱わない(行の残りを黙って読まなくならない)', () => {
    expect(withoutQuotes('前「閉じ忘れ ステップ')).toBe('前「閉じ忘れ ステップ');
    expect(withoutQuotes('「a」前「閉じ忘れ')).toBe('「」前「閉じ忘れ');
  });

  it('対応しない」は文字としてそのまま残る', () => {
    expect(withoutQuotes('a」b')).toBe('a」b');
  });

  it('かぎ括弧が無い行は変えない', () => {
    expect(withoutQuotes('ただの行')).toBe('ただの行');
  });
});

describe('findSpelling: 英字の綴りは大文字小文字を区別しない', () => {
  it('大文字小文字の違う綴り(例: Parity / PARITY)も数える(識別子の一部は数えない)', () => {
    expect(findSpelling('Parity テスト', 'parity')).toEqual([0]);
    expect(findSpelling('PARITY を見る', 'parity')).toEqual([0]);
    expect(findSpelling('expectDdlParity と checkVariantParity', 'parity')).toEqual([]);
    expect(findSpelling('data-table-Parity', 'parity')).toEqual([]);
  });

  it('日本語の綴りには影響しない', () => {
    expect(findSpelling('ステップ', 'ステップ')).toEqual([0]);
  });

  it('ハイフンでつながる形は検査 ID と同じ形として見分けない(現存 0 件の取りこぼしを明示)', () => {
    expect(findSpelling('parity-check を回す', 'parity')).toEqual([]);
  });
});
