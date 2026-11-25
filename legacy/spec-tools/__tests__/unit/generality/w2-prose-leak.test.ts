/**
 * W2(散文の語彙漏れ)のユニットテスト。
 *
 * 規約網羅(dsl-extension-triage.md §軸と語 の「例示の印」):
 *   - 散文に仕様の語があれば warning(error ではない)
 *   - 報告はファイル 1 件につき 1 件にまとまること(消し込みの単位)
 *   - 行に `例:` があれば対象外(「書くな」ではなく「例だと明示せよ」)
 *   - 文書への参照(`.../styling.md`)の中の一般語は拾わないこと
 *   - `entry.performer_id` のような修飾つきの語は、頭(`entry`)でも拾うこと
 *   - 体系側の値域と同じ綴りの語(`system` / `anonymous` …)は拾わないこと
 *   - コメントの範囲は 1 回の走査で決まること(行コメントの中の `/**`・ブロックの中の `//`・
 *     文字列の中の `//`・**正規表現リテラルの中の引用符**。4 つとも実測で報告が出た / 見落ちた経路)
 */

import { describe, expect, it } from 'vitest';
import { commentLines, commentSegments, matchProseWords } from '../../../lib/generality/prose-scan.js';
import { groupProseHits } from '../../../lib/generality/verifiers/w2-prose-leak.js';

/** このアプリの語(テスト内の最小の母集合)。 */
const VOCABULARY = new Set(['entry', 'workshop', 'staff', 'submit', 'system', 'none']);

/** 散文のヒットを 1 件作る。 */
function hit(file: string, line: number, word: string, text = '') {
  return { file, line, word, text };
}

describe('matchProseWords: 散文 1 行から仕様の語を拾う', () => {
  it('素の語を拾う', () => {
    expect(matchProseWords('* 催し(workshop)の状態を見る', VOCABULARY)).toEqual(['workshop']);
  });

  it('修飾つきの語は頭でも拾う(`entry.performer_id` は entry の使用でもある)', () => {
    expect(matchProseWords('* 集約ごとに違う(`entry.performer_id`)', VOCABULARY)).toEqual(['entry']);
  });

  it('「例:」のある行は拾わない(例だと明示すれば通る)', () => {
    expect(matchProseWords('* 例: `entry.submit` のような操作 ID', VOCABULARY)).toEqual([]);
  });

  it('文書への参照の中の語は拾わない(パスは語の使用ではない)', () => {
    expect(matchProseWords('* 仕様: docs/rules/process/frontend/system/x.md', VOCABULARY)).toEqual([]);
  });

  it('短い語は拾わない(偶然の一致が多すぎる)', () => {
    expect(matchProseWords('* id を返す', new Set(['id']))).toEqual([]);
  });
});

describe('commentLines: コメントが占める行', () => {
  /** 行番号の昇順。 */
  const at = (source: string): readonly number[] => [...commentLines(source)].sort((a, b) => a - b);

  it('ブロックコメントと行コメントの両方を拾う', () => {
    const source = ['/**', ' * a', ' */', 'const x = 1; // b', 'const y = 2;'].join('\n');

    expect(at(source)).toEqual([1, 2, 3, 4]);
  });

  // 以下 3 本は**実コードが散文に化ける**経路(どれも実測で報告が出た)。1 回の走査で閉じている
  // ことを固定する —— 正規表現を 2 回当てる形は、どちらの順でもこのうち 1 本を取り落とす。
  it('行コメントの中の `/**` は偽のブロックを開かない', () => {
    const source = ['// `src/**` を測る', 'const resolve = { workshop: 1 };', '/* 本物 */'].join('\n');

    expect(at(source)).toEqual([1, 3]);
  });

  it('ブロックコメントの中の `//` は閉じを食べない', () => {
    const source = ['/** see https://example.test/y */', 'const resolve = { workshop: 1 };', '/* 本物 */'].join('\n');

    expect(at(source)).toEqual([1, 3]);
  });

  it('正規表現リテラルの中の引用符は文字列を開かない(改行を越えて居座らない)', () => {
    // レビューの反例: `` /[`]/ `` のバッククォートが `template` 状態を開き、改行で戻らないので
    // **以降の本物のコメントが黙って落ちた**(期待 [2]・実測 [])。
    const source = ['const RE = /[`]/;', '// entry の説明(本物のコメント)', 'const organizer = 1;'].join('\n');

    expect(at(source)).toEqual([2]);
  });

  it('文字列の中の `//` は行コメントを開かない', () => {
    const source = ["const url = 'https://example.test/workshop';", 'const y = 2;'].join('\n');

    expect(at(source)).toEqual([]);
  });
});

describe('commentSegments: コメントの文字だけを行ごとに', () => {
  it('コードと同じ行のコメントは、コメントの部分だけを返す', () => {
    const source = "const url = 'x'; // 行末のコメント\nconst y = 2;";

    expect(commentSegments(source)).toEqual([{ line: 1, text: '// 行末のコメント' }]);
  });

  it('ブロックコメントは 1 行ずつに割り、行番号は元のもの', () => {
    const source = ['const a = 1;', '/**', ' * 説明', ' */', 'const b = 2;'].join('\n');

    expect(commentSegments(source)).toEqual([
      { line: 2, text: '/**' },
      { line: 3, text: ' * 説明' },
      { line: 4, text: ' */' },
    ]);
  });

  it('文字列の中の // はコメントではない(コメントの走査器を W1 / W2 と共有する)', () => {
    expect(commentSegments("const url = 'https://example.test';")).toEqual([]);
  });
});

describe('groupProseHits: ファイル 1 件 = warning 1 件', () => {
  it('同じファイルの複数のヒットを 1 件にまとめる', () => {
    const findings = groupProseHits([
      hit('app/src/components/a.ts', 3, 'workshop'),
      hit('app/src/components/a.ts', 9, 'entry'),
      hit('app/src/components/b.ts', 1, 'staff'),
    ]);

    expect(findings).toHaveLength(2);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.verifier).toBe('W2');
    expect(findings[0]?.counterexample).toMatchObject({ occurrences: '2' });
  });

  it('体系側の値域と同じ綴りの語は拾わない(W1 が accepted としているのと同じ理由)', () => {
    expect(groupProseHits([hit('app/src/components/a.ts', 3, 'system')])).toEqual([]);
  });
});
