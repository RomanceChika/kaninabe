/**
 * ハンドブックだけを出す入口(`cli/generate-book.ts`)が、**阻害した種類を読んでいる章の冒頭に、読めた分だけで出していることを名指す**部品。
 *
 * 阻害した種類(採ったのに章の材料へ渡せない)の持ち主の章は生成しない(`book-entry-plan.ts`)。持ち主を宣言しない章 —— 複数の種類を読む章(索引・
 * 集約の章・可視性・L2 の網羅・手引きなど)と、別の種類も読む持ち主の章(操作の章がテーブル仕様を読む、など)—— は止めない。止めなかった章は、その種類の
 * 材料が無い前提で出ている。以前はそのことを**実行報告に 1 行**書くだけで、**どの章のどの節か**を特定せず、本だけを後から読む人には伝わらなかった。
 * ここは章そのものの冒頭(HTML の章の `<h1>` の直下)に、阻害した種類ごとに 1 行を足す(出力の口 `html/markup.ts` で組む。仕様の文字列を HTML に連結しない): どの種類がなぜ読めず、その種類に依る部分が章のどこか。
 *
 * **読む種類と節の表(`CHAPTER_READERS`)は実測で守る**: 全種類を採る製品で、1 つの種類を「置き場が無い」にする / 仕様を 1 件落とした部分のモデル(阻害の理由 `invalid`)にして章を作り直すと、
 * 変わる章とその節が決まる。表はその和集合と**双方向に**一致する(`book-entry-notice.test.ts`。章・種類の組も、節も。表に無い節が変わったら赤・表に書いたのに一度も変わらない節も赤。
 * 節は章の本文(ページの枠・目次・検索の索引を除く)を `<h2>` の位置で割った、位置つきの並びで比べる)。落とす件は、件数が少ない種類は各件・多い種類は**件の形**(操作なら手書きか計画か × 作成・更新・削除・遷移、など。種類ごとに軸を決める)ごとの代表である
 * (位置の先頭・真ん中では、特定の形の件だけが効く節を拾えない。実例: 状態遷移の網羅の章は、操作のうち遷移のものを落としたときだけ変わる)。全件を測る実測は環境変数 `BOOK_NOTICE_FULL=1`(`npm run book:notice:full`)で有効になる(約 15 分 = 2026-10-08 の実測 14 分 43 秒。他の検査と並行した環境で、単独ならもう少し短い。既定は代表だけで、CI には入れない)。
 * 節は見出しの名前(数や名前の入る見出しは一般形)で書く。章でないファイル(部品の CSS・
 * 要約の JSON・検索の索引)には注記を入れられないので、名指しの対象外である。
 *
 * 足すのは**入口の出力だけ**(全部入りの `generate` の章には足さない = 全部入りの出力は変わらない)。未選択(採っていない)種類は事実として無いので足さない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない**(章の名前と種類は仕組みが決める形)。
 */

import type { BlockedReason } from '../kernel/input-state.js';
import type { ProductRoots } from '../model/product/types.js';
import type { SpecKind } from '../model/product/uses.js';
import { BLOCKED_REASON_TEXT } from '../verify/check-run-report.js';
import type { FileSection } from './apply-sections.js';
import { el, type Html } from './render/book/html/markup.js';
import type { EntryInputPlan } from './book-entry-plan.js';
import { bookFile } from './render/book/chapters.js';

/** 章が読む種類 1 件(章・種類・その種類に依る節)。 */
export interface ChapterReader {
  /** 章(ハンドブックの根の中のファイル名。HTML)。`domain/*` は集約の章すべて、`spec/*` は新しい形の章すべて。 */
  readonly chapter: string;
  /** 章が読む種類。 */
  readonly kind: SpecKind;
  /** その種類に依る節(見出しの名前。数・名前の入る見出しは一般形。`冒頭` = タイトルの下の導入と数の表示)。 */
  readonly sections: readonly string[];
}

/** 読む節の言い方(表の綴りを 1 か所に)。 */
const READS = {
  axiom: '上段 — 公理',
  derive: '下段 — 導出',
  origin: '数の出どころ',
  terms: '前提にする語',
  legend: '読み方の印の凡例',
  head: '冒頭',
  exempt: '理由をつけて外している守り',
  scale: '規模',
  toc: '章立て',
  amount: '読む量',
  blocks: 'ブロックごとの数',
  guide: 'どの章を読むか',
  tasks: 'タスクから読む',
  perUsecase: 'ユースケースごとの節',
} as const;

/** 種類横断の章と、別の種類も読む持ち主の章が、阻害した種類を読む節(実測の表)。 */
export const CHAPTER_READERS: readonly ChapterReader[] = [
  { chapter: 'index.html', kind: 'actions', sections: [READS.scale, READS.toc] },
  { chapter: 'index.html', kind: 'auth', sections: [READS.exempt, READS.toc] },
  { chapter: 'index.html', kind: 'config', sections: [READS.exempt, READS.toc] },
  { chapter: 'index.html', kind: 'data_tables', sections: [READS.toc] },
  { chapter: 'index.html', kind: 'design_tokens', sections: [READS.scale, READS.toc] },
  { chapter: 'index.html', kind: 'external', sections: [READS.toc] },
  { chapter: 'index.html', kind: 'guarantees', sections: [READS.toc] },
  { chapter: 'index.html', kind: 'jobs', sections: [READS.toc] },
  { chapter: 'index.html', kind: 'notifications', sections: [READS.toc] },
  { chapter: 'index.html', kind: 'queries', sections: [READS.scale] },
  { chapter: 'index.html', kind: 'screens', sections: [READS.scale, READS.toc] },
  { chapter: 'index.html', kind: 'usecases', sections: [READS.toc] },
  { chapter: 'index.html', kind: 'ux_principles', sections: [READS.toc] },
  { chapter: 'usecases.html', kind: 'actions', sections: [READS.head, READS.perUsecase] },
  { chapter: 'usecases.html', kind: 'data_tables', sections: [READS.head, READS.perUsecase] },
  { chapter: 'usecases.html', kind: 'jobs', sections: [READS.perUsecase] },
  { chapter: 'usecases.html', kind: 'screens', sections: [READS.perUsecase] },
  { chapter: 'domain/*', kind: 'actions', sections: [READS.head, READS.terms, READS.legend, READS.axiom, READS.derive, READS.origin] },
  { chapter: 'domain/*', kind: 'data_tables', sections: [READS.head, READS.terms, READS.legend, READS.axiom, READS.derive, READS.origin] },
  { chapter: 'domain/*', kind: 'jobs', sections: [READS.head, READS.derive, READS.origin] },
  { chapter: 'domain/*', kind: 'notifications', sections: [READS.axiom, READS.derive] },
  { chapter: 'domain/*', kind: 'queries', sections: [READS.derive] },
  { chapter: 'domain/*', kind: 'usecases', sections: [READS.head, READS.legend, READS.axiom, READS.derive, READS.origin] },
  // spec/* は外部連携(external)の inbound も発火元に読むが、実測の製品に inbound が無く節が変わらないので表に無い
  // (表は実測と双方向に一致させる。inbound を持つ製品では阻害しても冒頭の注記が出ない = 既知の限界。外部レビュー の Q5)。
  { chapter: 'spec/*', kind: 'data_tables', sections: [READS.head] },
  { chapter: 'spec/*', kind: 'jobs', sections: ['流れ'] },
  { chapter: 'spec/*', kind: 'auth', sections: ['流れ'] },
  { chapter: 'spec/*', kind: 'actions', sections: ['流れ', '決めごと'] },
  { chapter: 'external.html', kind: 'config', sections: ['有料の資源を使う口'] },
  { chapter: 'visibility.html', kind: 'surface', sections: [READS.head, READS.axiom] },
  { chapter: 'visibility.html', kind: 'data_tables', sections: [READS.head, READS.axiom, READS.derive, READS.origin] },
  { chapter: 'visibility.html', kind: 'external', sections: [READS.head, READS.derive, READS.origin] },
  { chapter: 'visibility.html', kind: 'queries', sections: [READS.head, READS.terms, READS.axiom, READS.derive, READS.origin] },
  { chapter: 'actions.html', kind: 'data_tables', sections: [READS.head, READS.axiom, READS.derive, READS.origin] },
  { chapter: 'actions.html', kind: 'jobs', sections: [READS.derive] },
  { chapter: 'actions.html', kind: 'notifications', sections: [READS.derive] },
  { chapter: 'notifications.html', kind: 'jobs', sections: [READS.axiom, READS.derive] },
  { chapter: 'jobs.html', kind: 'notifications', sections: [READS.head, READS.axiom, READS.derive, READS.origin] },
  { chapter: 'sweep.html', kind: 'actions', sections: ['状態遷移', '通知', 'ジョブ', '押さえるテストが1本も無い行'] },
  { chapter: 'sweep.html', kind: 'jobs', sections: ['ジョブ'] },
  { chapter: 'sweep.html', kind: 'notifications', sections: ['通知', 'ジョブ'] },
  { chapter: 'sweep.html', kind: 'queries', sections: ['状態', '読み取り経路'] },
  { chapter: 'sweep.html', kind: 'screens', sections: ['状態遷移', '状態', '画面 × 操作', '押さえるテストが1本も無い行'] },
  { chapter: 'examples.html', kind: 'guarantees', sections: ['保証の見張りテストを紐づける'] },
  { chapter: 'examples.html', kind: 'jobs', sections: ['通知を足す(effects 1 要素 + カタログ 1 項目 + 表 1 行)', 'ジョブを足す'] },
  { chapter: 'examples.html', kind: 'notifications', sections: ['通知を足す(effects 1 要素 + カタログ 1 項目 + 表 1 行)'] },
  { chapter: 'ux-principles.html', kind: 'screens', sections: [READS.head, '画面ごとの受け入れ(原則から外れてよい場所)'] },
  { chapter: 'review-guide.html', kind: 'actions', sections: [READS.tasks, READS.guide, READS.amount, '人が書く文の未記入', READS.blocks] },
  { chapter: 'review-guide.html', kind: 'surface', sections: [READS.guide, READS.amount, READS.blocks] },
  { chapter: 'review-guide.html', kind: 'auth', sections: [READS.guide, READS.amount, READS.blocks] },
  { chapter: 'review-guide.html', kind: 'config', sections: [READS.guide, READS.amount, READS.blocks] },
  { chapter: 'review-guide.html', kind: 'data_tables', sections: [READS.guide, READS.amount, '人が書く文の未記入', READS.blocks] },
  { chapter: 'review-guide.html', kind: 'design_tokens', sections: [READS.guide, READS.amount, READS.blocks] },
  { chapter: 'review-guide.html', kind: 'external', sections: [READS.guide, READS.amount, READS.blocks] },
  { chapter: 'review-guide.html', kind: 'guarantees', sections: [READS.guide, READS.amount, READS.blocks] },
  { chapter: 'review-guide.html', kind: 'jobs', sections: [READS.guide, READS.amount, READS.blocks] },
  { chapter: 'review-guide.html', kind: 'notifications', sections: [READS.guide, READS.amount, READS.blocks] },
  { chapter: 'review-guide.html', kind: 'queries', sections: [READS.guide, READS.amount, READS.blocks] },
  { chapter: 'review-guide.html', kind: 'screens', sections: [READS.tasks, READS.guide, READS.amount, READS.blocks] },
  { chapter: 'review-guide.html', kind: 'usecases', sections: [READS.tasks, READS.guide, READS.amount, READS.blocks] },
  { chapter: 'review-guide.html', kind: 'ux_principles', sections: [READS.guide, READS.blocks] },
];

/** 章の冒頭に足す注記 1 件(どの章が、どの種類を、なぜ読めずに、どの節で読めた分だけにしているか)。 */
export interface ReaderNotice {
  /** 章のファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** 阻害した種類。 */
  readonly kind: SpecKind;
  /** 阻害の理由。 */
  readonly reason: BlockedReason;
  /** その種類に依る節。 */
  readonly sections: readonly string[];
}

/**
 * 章のファイルを、表の章の名前にする(ハンドブックの根の中の相対。`domain/<集約>.html` は `domain/*`)。
 * ハンドブックの根の外のファイル・章でないファイル(部品)は null。
 *
 * @param file リポジトリルート相対のファイル
 * @param roots 製品が宣言した根
 */
export function chapterKeyOf(file: string, roots: ProductRoots): string | null {
  const base = `${bookFile(roots)}/`;
  if (!file.startsWith(base) || !file.endsWith('.html')) return null;
  const relative = file.slice(base.length);
  if (/^domain\/[^/]+\.html$/.test(relative)) return 'domain/*';
  return /^spec\/[^/]+\.html$/.test(relative) ? 'spec/*' : relative;
}

/**
 * 阻害した種類を読む章ごとの注記を決める(生成した章だけ。阻害した種類が持ち主の章は生成していないので、対象にならない)。
 *
 * @param plan 入力の状態から決めた実行の計画(阻害した種類)
 * @param files 生成した章・部品(リポジトリルート相対)
 * @param roots 製品が宣言した根
 * @returns 注記(ファイル順 → 種類の順)
 */
export function readerNotices(plan: EntryInputPlan, files: readonly string[], roots: ProductRoots): readonly ReaderNotice[] {
  const notices: ReaderNotice[] = [];
  for (const file of [...files].sort()) {
    const key = chapterKeyOf(file, roots);
    if (key === null) continue;
    for (const blocked of plan.blocked) {
      const reader = CHAPTER_READERS.find((candidate) => candidate.chapter === key && candidate.kind === blocked.kind);
      if (reader !== undefined) notices.push({ file, kind: blocked.kind, reason: blocked.reason, sections: reader.sections });
    }
  }
  return notices;
}

/** 節の言い方(`冒頭` はタイトルの下の導入と数の表示)。 */
function sectionWords(sections: readonly string[]): string {
  return sections.map((section) => (section === READS.head ? '冒頭の数の表示' : `「${section}」`)).join('・');
}

/**
 * 注記 1 件を、章の冒頭に足す 1 行(箇条書きの 1 項目)にする。
 *
 * @param notice 注記
 */
export function noticeLine(notice: ReaderNotice): Html {
  return el(
    'li',
    null,
    el('strong', null, `${notice.kind} が読めない(阻害)入口の出力です`),
    `: ${notice.kind} を採っているが章の材料へ渡せない(${BLOCKED_REASON_TEXT[notice.reason]})ため、`,
    `この章の${sectionWords(notice.sections)}のうち ${notice.kind} に依る部分は、読めた分だけ(読めなければ無い前提)で出しています。本物の章は `,
    el('code', null, 'npm run generate'),
    ' が出します。',
  );
}

/** 注記の引用の印(章の中の注記を見分ける)。 */
const NOTICE_ATTRS = { class: 'bf-notice', 'data-entry-notice': 'blocked' } as const;

/**
 * 生成した章の冒頭(最初の `<h1>` 要素の直下)に注記を足す。注記が無い章・`<h1>` が無い章・全体生成でない章はそのまま。
 *
 * @param byFile ファイルごとの生成セクション
 * @param notices 注記(`readerNotices`)
 * @returns 注記を足したファイルごとの生成セクション(足さなかったファイルは同じ値)
 */
export function withReaderNotices(
  byFile: ReadonlyMap<string, readonly FileSection[]>,
  notices: readonly ReaderNotice[],
): ReadonlyMap<string, readonly FileSection[]> {
  const result = new Map<string, readonly FileSection[]>();
  for (const [file, sections] of byFile) {
    const lines = notices.filter((notice) => notice.file === file).map(noticeLine);
    result.set(file, lines.length === 0 ? sections : sections.map((section, index) => (index === 0 ? withNotice(section, lines) : section)));
  }
  return result;
}

/** 閉じる `</h1>` の直後に、注記の引用を足す(全体生成でない・`<h1>` が無いセクションはそのまま)。 */
function withNotice(section: FileSection, lines: readonly Html[]): FileSection {
  if (section.wholeFile !== true) return section;
  const close = '</h1>';
  const at = section.content.indexOf(close);
  if (at === -1) return section;
  const end = at + close.length;
  const notice = el('blockquote', NOTICE_ATTRS, el('ul', null, lines));
  return { ...section, content: `${section.content.slice(0, end)}${notice}${section.content.slice(end)}` };
}
