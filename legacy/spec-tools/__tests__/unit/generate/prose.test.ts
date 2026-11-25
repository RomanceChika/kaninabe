import { describe, expect, it } from 'vitest';

import { collectSigns, countSigns } from '../../../lib/generate/prose.js';

/** フロントマター + 本文の仕様ファイルを組み立てる。 */
function specFile(body: string): string {
  return ['---', 'doc_type: access_spec', 'entity: entry', '---', body].join('\n');
}

describe('countSigns: 数えないもの', () => {
  it('空文字列・フロントマターだけのファイルは 0 本', () => {
    expect(countSigns('')).toBe(0);
    expect(countSigns(specFile(''))).toBe(0);
  });

  it('見出し・表・コメント行は数えない', () => {
    const body = ['# タイトル', '', '## 節', '', '| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    expect(countSigns(specFile(body))).toBe(0);
  });

  it('AUTO-GENERATED ブロックの中身は箇条書きでも数えない', () => {
    const body = [
      '# タイトル',
      '',
      '<!-- AUTO-GENERATED:access-matrix -->',
      '- 生成された箇条書き',
      '生成された散文',
      '<!-- /AUTO-GENERATED:access-matrix -->',
    ].join('\n');
    expect(countSigns(specFile(body))).toBe(0);
  });
});

describe('countSigns: 数え方', () => {
  it('箇条書きは 1 項目 = 1 本(折り返しの継続行は含める)', () => {
    const body = [
      '# タイトル',
      '',
      '- 一つ目の標識 — 理由は長いので',
      '  折り返して書いてある。',
      '- 二つ目の標識。',
      '- 三つ目の標識。',
    ].join('\n');
    expect(countSigns(specFile(body))).toBe(3);
  });

  it('散文は 1 段落 = 1 本(空行で区切る)', () => {
    const body = [
      '# タイトル',
      '',
      '下書きの削除は物理削除で通知も無い。',
      '提出後の取り消しは状態機械の withdraw であり、deletes には現れない。',
      '',
      '二つ目の段落。',
    ].join('\n');
    expect(countSigns(specFile(body))).toBe(2);
  });

  it('生成ブロックの前後に分かれた標識を合算する', () => {
    const body = [
      '# タイトル',
      '',
      '- 前にある標識。',
      '',
      '<!-- AUTO-GENERATED:x -->',
      '生成された散文',
      '<!-- /AUTO-GENERATED:x -->',
      '',
      '後にある段落。',
    ].join('\n');
    expect(countSigns(specFile(body))).toBe(2);
  });

  it('段落の直後の箇条書きは別の 1 本として数える', () => {
    const body = ['# タイトル', '', '前置きの段落。', '- 標識。'].join('\n');
    expect(countSigns(specFile(body))).toBe(2);
  });
});

describe('collectSigns: 全文抽出(標識台帳の入力)', () => {
  it('標識の本文を出現順にそのまま返す(整形しない)', () => {
    const body = ['# タイトル', '', '- 一つ目の標識。', '', '二つ目は散文の段落。'].join('\n');
    expect(collectSigns(specFile(body))).toEqual(['- 一つ目の標識。', '二つ目は散文の段落。']);
  });

  it('折り返しの継続行は元の改行を保って同じ 1 本に含める', () => {
    const body = ['# タイトル', '', '- 標識 — 理由は長いので', '  折り返して書いてある。'].join('\n');
    expect(collectSigns(specFile(body))).toEqual(['- 標識 — 理由は長いので\n  折り返して書いてある。']);
  });

  it('フロントマター・生成ブロック・見出し・表は含めない', () => {
    const body = [
      '# タイトル',
      '',
      '| a |',
      '| --- |',
      '',
      '<!-- AUTO-GENERATED:x -->',
      '生成された散文',
      '<!-- /AUTO-GENERATED:x -->',
      '',
      '手書きの標識。',
    ].join('\n');
    expect(collectSigns(specFile(body))).toEqual(['手書きの標識。']);
  });

  it('複数行にまたがる HTML コメントの中身は標識に数えない(閉じ `-->` の行も)', () => {
    const body = [
      '<!--',
      '記入ガイド(実例につき削除して構わない)',
      '-->',
      '',
      '# タイトル',
      '',
      '手書きの標識。',
      '<!-- 1 行のコメント -->',
      '',
      '<!-- 書きかけ',
      '続き -->',
      '- 次の標識。',
    ].join('\n');
    expect(collectSigns(specFile(body))).toEqual(['手書きの標識。', '- 次の標識。']);
  });

  it('countSigns は collectSigns の本数と常に一致する', () => {
    const body = ['# タイトル', '', '- 標識その 1。', '- 標識その 2。', '', '段落の標識。'].join('\n');
    const source = specFile(body);
    expect(countSigns(source)).toBe(collectSigns(source).length);
  });
});
