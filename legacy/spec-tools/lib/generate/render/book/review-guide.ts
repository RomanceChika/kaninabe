/**
 * レビューの手引き(docs/book/review-guide.md)の生成器。
 *
 * 人間のレビューはハンドブックの章を読みながらその場で行う(判断ポイントは各章に
 * インラインで埋めてある)。このページはその**索引** — どの章にどれだけ人間の判断が
 * 乗っているかを配り、**乗っていない章は「流し読みで良い」と機械が言う**。
 *
 * 集計は block-loads.ts(ブロック = 章の節 × 仕様ファイルごとの標識と判断ポイント)が正で、
 * 章の合計(chapter-loads.ts)・各章の頭の 1 行・この手引きの数は**同じ集計から出る**。
 * 標識(手書き)と判断ポイント(宣言)は単位が違うので並べて出し、足さない。
 * 文章は定型のみで、判断の中身はここに書かない(それは各章の仕事)。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { chapterReading, requiredOf } from './block-reading.js';
import { type ChapterLoad } from './chapter-loads.js';
import { SECTION_ORDER } from './sections.js';
import { specPath } from '../../../model/product/paths.js';
import { breakdownText } from '../semantic-review-counts.js';
import type { ProductRoots } from '../../../model/product/types.js';
import { type Segment } from './text-segments.js';

/** 数え方の正(保証マップ)のファイル。 */
export const PLAYBOOK_FILE = 'docs/rules/process/common/specification/playbooks/system-spec-route.md';

/** ページの題。 */
export const GUIDE_TITLE = 'レビューの手引き';

/** 導入の 1 文目(ハンドブックへのリンクが文の途中に入る)。 */
export const HEADER_LEAD: readonly Segment[] = [
  '機械は形式、人間は意味 — 形式・整合・網羅の検査は `npm run verify` が済ませてある。' +
    '人間に残るのは「見せていいか・できていいか・その判断でいいか」だけで、' +
    'その判断ポイントは',
  { label: 'ハンドブック', to: 'handbook' },
  'の各章にインラインで埋めてある:',
];

/** 判断ポイントの置き場 4 つ(箇条)。 */
export const HEADER_POINTS: readonly string[] = [
  '- **⚠ の行** — 全件公開(scope: all)と DSL 外の不変条件。章の表の中で人が判断するところ',
  '- **「条件の意味」列とマトリクス** — ガード条件の業務タイミングと、全マスの ✓/✗ が意図と合っているか',
  '- **結果表(操作カード・保存点の直下の折り畳み)** — 「誰が・どの状態のものを動かせるか」と' +
    '**どういう場合に落ちるか**。❌ の理由がそのまま判断ポイントになる',
  '- **標識(引用ブロック)** — 仕様ファイルに残された手書きの判断。違うと思ったら異議を出す場所',
];

/** 数える 2 つの単位の説明。 */
export const HEADER_UNITS =
  '数えるものは 2 つで、**単位が違うので足さない**。**標識**は仕様ファイルの手書きの段落と箇条、' +
  '**判断ポイント**は仕様の宣言から数えた判断の場所である。数える単位は**ブロック**(章の 1 節 × 仕様ファイル 1 枚)で、' +
  '章の合計も各章の頭の 1 行も下のブロックごとの表も、同じ集計から出る。';

/** 一覧の読み方(数え方の正へのリンクが文の途中に入る)。 */
export const HEADER_INDEX: readonly Segment[] = [
  '下の一覧は「どの章にどれだけ人間の判断が乗っているか」の索引である。' +
    '**「流し読みで良い」と出るのは、章が理由つきで精読不要を宣言している場合だけ**であり、' +
    '宣言が無いまま 0 件の章は「未分類(要確認)」と出す' +
    '(**数えていない**と**数えた結果 0 だった**を見分けのつかない形で配らないため)。' +
    '数え方の正は ',
  { label: 'system-spec-route.md の保証マップ', to: 'playbook' },
  '(「(軽)」= 値域だけの軽い確認)。',
];

/** 「どの章を読むか」の節の題。 */
export const CHAPTER_HEADING = 'どの章を読むか';

/** 「流し読みで良い」の定型文言(章が理由を宣言しているときだけ使う)。 */
export const VERDICT_SKIP = '流し読みで良い';

/**
 * 集計が 0 件で、精読不要の宣言も無い章の文言。
 *
 * **数えていない**と**数えた結果 0 だった**は同じではない(外部レビュー の外部レビュー④)。
 * 母集合に入っていないだけの章が「流し読みで良い」と書くと、手引きは
 * 「読まなくてよい」を機械の保証のように配ってしまう。宣言が無い 0 件はこう出す。
 */
export const VERDICT_UNCLASSIFIED =
  '**未分類(要確認)**: 判断ポイントも標識も 0 件だが、精読不要の宣言が無い' +
  '(集計の母集合に入っていない疑い。章の定義に `reviewFree` の理由を書くか、集計を足す)';

/**
 * 一覧の行に「必読 0(集約の章が数える)」と添える章か。
 *
 * 宣言の公理を集約の章が数えている章(可視性と操作。`countedByAggregates`)は、判断ポイントや標識があって「精読」と出る一方、
 * 章の必読は 0 になる。添えないと、2 つが食い違って見える。**実際に両方の読み手の必読が 0 のときだけ**添える
 * (検証の結果が渡されていなくて、まだ通していない分が引けないときは、0 と言い切れないので添えない)。
 */
export function readsInAggregates(load: ChapterLoad, model: SpecModel, ctx: GenerateContext): boolean {
  if (load.chapter.countedByAggregates !== true) return false;
  const sum = chapterReading(model, ctx, load.chapter.file);
  return sum.pending !== null && requiredOf(sum.byReader.business) + requiredOf(sum.byReader.developer) === 0;
}

/** 必読 0 の添え書き(集約の章が数える章だけ)。 */
export const ZERO_REQUIRED_NOTE = '。必読 0(この章の宣言は、集約の章が数えている)';

/** 章 1 つ分の索引行の言い分(リンクの後ろ)。`counted` は標識か判断ポイントがある(必読 0 の添え書きを付けうる)。 */
export function chapterVerdict(load: ChapterLoad): { readonly text: string; readonly counted: boolean } {
  if (load.declCount === 0 && load.signCount === 0) {
    // 「流し読みで良い」は**章が理由を宣言しているときだけ**言える。宣言の無い 0 件は
    // 「数えていない」かもしれないので、そう書く(VERDICT_UNCLASSIFIED の JSDoc)。
    const free = load.chapter.reviewFree;
    return { text: free === undefined ? VERDICT_UNCLASSIFIED : `${VERDICT_SKIP}: ${free.reason}`, counted: false };
  }
  // 標識と判断ポイントは単位が違うので並べて出し、足さない。0 件も「数えて 0 だった」として出す。
  const breakdown = load.declCount > 0 ? `(${load.declBreakdown})` : '';
  // 開発の参考の章(表紙の群と揃える)は、判断を人が下す章ではなく、仕組み側の表の標識を引く場所である。
  const verdict = load.chapter.group === 'reference' ? '**参照**' : '**精読**';
  return { text: `${verdict}: 標識 ${load.signCount} 本・判断ポイント ${load.declCount} 件${breakdown}`, counted: true };
}

/** 「ブロックごとの数」の節の題と導入。 */
export const BLOCK_HEADING = 'ブロックごとの数';
export const BLOCK_LEAD = '標識も判断ポイントも 0 のブロックは出さない。**標識と判断ポイントは足さない**(単位が違う)。';
export const BLOCK_HEADERS = ['節', '仕様ファイル', '標識(本)', '判断ポイント(件)', '判断ポイントの内訳'] as const;

/** ブロック表の 1 行(仕様ファイルは仕様の木からの相対パスで見せ、リンク先はリポジトリルート相対)。 */
export interface BlockRow {
  readonly section: string;
  /** 仕様ファイル(リポジトリルート相対)。特定のファイルが無ければ null。 */
  readonly file: string | null;
  readonly shown: string;
  readonly signs: string;
  readonly decls: string;
  /** 判断ポイントの内訳(無ければ null)。 */
  readonly breakdown: string | null;
}

/** 章のブロックの表の行(節の並び → 仕様ファイル)。 */
export function blockRows(load: ChapterLoad, roots: ProductRoots): readonly BlockRow[] {
  const specsRoot = `${specPath(roots)}/`;
  const rank = (section: string): number => {
    const index = SECTION_ORDER.indexOf(section);
    return index === -1 ? SECTION_ORDER.length : index;
  };
  return [...load.blocks]
    .sort((a, b) => rank(a.section) - rank(b.section) || (a.file ?? '').localeCompare(b.file ?? ''))
    .map((block) => ({
      section: block.section,
      file: block.file,
      shown: block.file === null ? '(特定のファイルなし)' : block.file.startsWith(specsRoot) ? block.file.slice(specsRoot.length) : block.file,
      signs: String(block.signCount),
      decls: String(block.declCount),
      breakdown: block.parts.length === 0 ? null : breakdownText(block.parts),
    }));
}
