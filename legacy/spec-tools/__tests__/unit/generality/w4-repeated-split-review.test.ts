import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOversizeRule } from '../../../lib/io/oversize-rule.js';
import { countDeclaredOversize } from '../../../lib/generality/oversize-count.js';
import { repeatedReviewFindings } from '../../../lib/generality/verifiers/w4-repeated-split-review.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
/**
 * 同じ本文の `@split-review` が 3 本以上あること(**定型文の使い回し**)を warning にする仕組み
 * (W4 と、その判定の純関数 `repeatedSplitReviews`)のテスト。
 *
 * 見たいのは 4 つ。
 *   ① 純関数: ラベル・空白・改行の違いは同じ本文とみなし、3 本以上の組だけを返す(2 本は返さない)
 *   ② 本文が無い(null)・短すぎるものは数えない(それは別の規則の仕事)
 *   ③ 走査: 3 つの木の宣言つきファイルから、同じ本文の組を拾う(宣言が揃わないファイルは数えない)
 *   ④ W4 の Finding: 組 1 つにつき 1 件の warning で、ファイルを名指しし、直し方を言う
 */

const { repeatedSplitReviews, REPEATED_REVIEW_MIN } = loadOversizeRule();

const created: string[] = [];
afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SAME = '割る案と結果: 割ると 2 枚を行き来することになるので割らない。';

describe('repeatedSplitReviews(判定の純関数)', () => {
  it('3 本以上が同じ本文なら 1 組として返す(既定の閾値は 3)', () => {
    expect(REPEATED_REVIEW_MIN).toBe(3);
    const groups = repeatedSplitReviews([
      { file: 'c.ts', splitReview: SAME },
      { file: 'a.ts', splitReview: SAME },
      { file: 'b.ts', splitReview: SAME },
      { file: 'd.ts', splitReview: '割る案と結果: このファイルだけの理由を書いたもの。' },
    ]);
    expect(groups).toEqual([{ body: '割ると 2 枚を行き来することになるので割らない。', files: ['a.ts', 'b.ts', 'c.ts'] }]);
  });

  it('2 本だけなら返さない', () => {
    expect(
      repeatedSplitReviews([
        { file: 'a.ts', splitReview: SAME },
        { file: 'b.ts', splitReview: SAME },
      ]),
    ).toEqual([]);
  });

  it('ラベル・空白・改行の違いは同じ本文とみなす', () => {
    const groups = repeatedSplitReviews([
      { file: 'a.ts', splitReview: '割る案と結果: 割ると 2 枚を  行き来する。' },
      { file: 'b.ts', splitReview: '割る案と結果：割ると 2 枚を\n行き来する。' },
      { file: 'c.ts', splitReview: '割ると 2 枚を 行き来する。' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.files).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('本文が無い・短すぎるものは数えない(別の規則が error にする)', () => {
    const groups = repeatedSplitReviews([
      { file: 'a.ts', splitReview: null },
      { file: 'b.ts', splitReview: null },
      { file: 'c.ts', splitReview: null },
      { file: 'd.ts', splitReview: '短い' },
      { file: 'e.ts', splitReview: '短い' },
      { file: 'f.ts', splitReview: '短い' },
    ]);
    expect(groups).toEqual([]);
  });

  it('閾値は引数で変えられる', () => {
    const entries = [
      { file: 'a.ts', splitReview: SAME },
      { file: 'b.ts', splitReview: SAME },
    ];
    expect(repeatedSplitReviews(entries, 2)).toHaveLength(1);
  });
});

/** 300 行を超える本文(冒頭の JSDoc に指定の宣言)。 */
function big(splitReview: string, withOversize = true): string {
  const oversize = withOversize ? ' * @oversize 超える理由: 1 つの表の全規則を 1 か所で読み通せるようにするため。\n' : '';
  const header = `/**\n * 見出し。\n${oversize} * @split-review ${splitReview}\n */\n`;
  return `${header}${Array.from({ length: 310 }, (_, i) => `export const v${i} = ${i};`).join('\n')}\n`;
}

/** 指定のファイルを持つ一時ツリーを作る。 */
function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'w4-'));
  created.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

describe('countDeclaredOversize の repeated(走査)', () => {
  it('同じ本文の宣言が 3 本ある組を拾う(宣言が揃わないファイルは数えない)', () => {
    const app = TEST_ROOTS.app ?? 'app';
    const root = tree({
      'legacy/spec-tools/lib/x/a.ts': big(SAME),
      'legacy/spec-tools/lib/x/b.ts': big(SAME),
      [`${app}/src/c.ts`]: big(SAME),
      'legacy/spec-tools/lib/x/unique.ts': big('割る案と結果: 状態ごとに割る案は、遷移表を 1 枚で見ないと到達性が読めないので採らない。'),
      // @oversize が無い宣言は揃っていない(lint が error にする)ので、数えない。
      'legacy/spec-tools/lib/x/only-review.ts': big(SAME, false),
    });
    const { repeated } = countDeclaredOversize(root, TEST_ROOTS, TEST_LAYOUT);
    expect(repeated).toHaveLength(1);
    expect(repeated[0]?.files).toEqual([`${app}/src/c.ts`, 'legacy/spec-tools/lib/x/a.ts', 'legacy/spec-tools/lib/x/b.ts']);
  });

  it('2 本だけなら空', () => {
    const root = tree({ 'legacy/spec-tools/lib/x/a.ts': big(SAME), 'legacy/spec-tools/lib/x/b.ts': big(SAME) });
    expect(countDeclaredOversize(root, TEST_ROOTS, TEST_LAYOUT).repeated).toEqual([]);
  });
});

describe('repeatedReviewFindings(W4)', () => {
  it('組 1 つにつき warning 1 件。ファイルを名指しし、ファイル固有の理由を求める', () => {
    const findings = repeatedReviewFindings([{ body: '割ると 2 枚を行き来することになるので割らない。', files: ['a.ts', 'b.ts', 'c.ts'] }]);
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.verifier).toBe('W4');
    expect(finding?.severity).toBe('warning');
    expect(finding?.location.file).toBe('a.ts');
    expect(finding?.message).toContain('3 本');
    expect(finding?.counterexample?.['files']).toBe('a.ts, b.ts, c.ts');
    expect(finding?.suggestion).toContain('ファイル固有');
  });

  it('組が無ければ何も言わない', () => {
    expect(repeatedReviewFindings([])).toEqual([]);
  });

  it('このリポジトリの実物には使い回しが無い(宣言はファイルごとに書いてある)', () => {
    const repo = path.resolve(import.meta.dirname, '../../../../..');
    expect(countDeclaredOversize(repo, TEST_ROOTS, TEST_LAYOUT).repeated).toEqual([]);
  });
});
