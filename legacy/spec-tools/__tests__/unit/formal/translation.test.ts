/**
 * PlusCal の翻訳の一致のテスト。
 *
 * 翻訳結果は生成物である。**手で直した翻訳結果が黙って通る**なら、読んでいる模型と
 * 走っている模型がずれるので、差分 0 を機械が見る。
 */

import { describe, expect, it } from 'vitest';
import { translationBlock, translationFindings } from '../../../lib/formal/translation.js';

const COMMITTED = `---- MODULE M ----
(*--algorithm M { variables x = 0; { a: x := 1; } } *)
\\* BEGIN TRANSLATION
VARIABLES pc, x
Init == x = 0
\\* END TRANSLATION
====`;

describe('translationBlock', () => {
  it('目印に挟まれた本文だけを取り出す', () => {
    expect(translationBlock(COMMITTED)).toEqual(['VARIABLES pc, x', 'Init == x = 0']);
  });

  it('目印が揃っていなければ null を返す', () => {
    expect(translationBlock('---- MODULE M ----\n====')).toBeNull();
  });
});

describe('translationFindings', () => {
  it('翻訳し直した結果と一致していれば何も言わない', () => {
    expect(translationFindings('M', COMMITTED, COMMITTED)).toEqual([]);
  });

  it('翻訳結果が食い違ったら赤になり、最初に違う行を出す', () => {
    const retranslated = COMMITTED.replace('Init == x = 0', 'Init == x = 1');
    const findings = translationFindings('M', COMMITTED, retranslated);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.detail?.join('\n')).toContain('Init == x = 0');
    expect(findings[0]?.detail?.join('\n')).toContain('Init == x = 1');
  });

  it('翻訳結果の行数が増えても最初の食い違いを指す', () => {
    const retranslated = COMMITTED.replace('Init == x = 0', 'Init == x = 0\nNext == x\' = 1');
    const findings = translationFindings('M', COMMITTED, retranslated);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail?.[0]).toContain('3 行目');
  });

  it('コミット済みに目印が無ければ赤になる', () => {
    expect(translationFindings('M', '---- MODULE M ----\n====', COMMITTED)[0]?.message).toContain('目印');
  });

  it('翻訳し直した結果に目印が無ければ赤になる', () => {
    expect(translationFindings('M', COMMITTED, '---- MODULE M ----\n====')[0]?.message).toContain('翻訳できていません');
  });
});
