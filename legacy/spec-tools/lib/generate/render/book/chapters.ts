/**
 * ハンドブック(docs/book/)の章立てモデルと、章をまたいで使う共有部品。
 *
 * docs/book/ は人間の唯一の入口であり、全ページが仕様からの生成物(手書きゼロ)である。
 * ここが持つのは「どの仕様ファイルがどの章に属するか」の対応 1 つだけ —
 * レビューの手引き(review-guide)が判断ポイントを章ごとに集計するのも、
 * 各章が標識(手書き散文)をその場に引用するのも、同じ対応の上に立つ。
 * 対応が 2 か所に書かれると「手引きが指す章に標識が無い」というズレが起きるため、
 * 母集合(collectLedgerEntries)への割り付けはこのモジュールに 1 つだけ置く。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { collectSigns } from '../../prose.js';
import { registerQuotedFences } from '../fenced.js';
import { descendantsOf } from '../../../semantics/aggregate-structure.js';
import { hasExamplesChapter } from '../code-examples.js';
import { bookLayout } from './face-scope.js';
import { bookPath, specPath } from '../../../model/product/paths.js';
import type { ProductRoots } from '../../../model/product/types.js';

/**
 * ハンドブックの中の 1 ページ(リポジトリルート相対)。
 *
 * **読み物の置き場そのものは製品が宣言する**(`product.md` の `roots.book`)。章の構成と
 * ファイル名は仕組みが決めている形なので、ここが持つのは置き場の中の名前だけである(W3)。
 *
 * @param roots 製品が宣言した根
 * @param name 置き場の中の名前(省略すると置き場そのもの)
 * @returns リポジトリルート相対のパス
 */
export function bookFile(roots: ProductRoots, name?: string): string {
  return name === undefined ? bookPath(roots) : bookPath(roots, name);
}

/**
 * 操作の章(結果表が載るページ)。章の索引が結果表の判断ポイントをここに足すので、
 * パスの宣言は 1 つにする(足す先と出す先が別のファイルになりうるため)。
 */
export function actionsPage(roots: ProductRoots): string {
  return bookFile(roots, 'actions.md');
}

/** タスクの章(保存点の結果表が載るページ。判断ポイントを足す先は 2 つある)。 */
export function usecasesPage(roots: ProductRoots): string {
  return bookFile(roots, 'usecases.md');
}

/** データの置き場の章(テーブル仕様の標識が載るページ。章立てと割り付けの両方がここを指す)。 */
export function dataPage(roots: ProductRoots): string {
  return bookFile(roots, 'data.md');
}

/**
 * 章のグループ(表紙の並びの束ね方)。
 *
 * 章が増えるほど表紙の平坦な箇条書きは読めなくなるので、**同じ問いに答える章**をまとめる。
 * とくに `feature` は「通知・ジョブ・設定」= **人が押していないのに起きること・
 * 外と繋がっていること**の束であり、「自明でない挙動は全部ハンドブックにある」を
 * この 1 グループが引き受ける。
 */
export const CHAPTER_GROUPS = ['task', 'domain', 'surface', 'feature', 'design', 'reference'] as const;

/** 章のグループ。 */
export type ChapterGroup = (typeof CHAPTER_GROUPS)[number];

/** グループの見出し(表紙に出る)。 */
export const CHAPTER_GROUP_TITLES: Readonly<Record<ChapterGroup, string>> = {
  task: 'タスク(この人はこれを 1 分でできるか)',
  domain: '集約ごとのライフサイクル',
  surface: '画面と見え方',
  feature: '機能(人が押していないのに起きること・外と繋がっていること)',
  design: 'デザイン',
  reference: '開発の参考',
};

/**
 * 精読が要らないことの**宣言**(理由は必須 —— 理由の無い宣言は型で書けない)。
 *
 * レビューの手引きが「流し読みで良い」と言えるのは、章の定義がこれを持つときだけである。
 * 集計が 0 件でも宣言が無ければ「未分類(要確認)」と出る —— **数えていない**と
 * **数えた結果 0 だった**は同じではない(外部レビュー の外部レビュー④の指摘)。実際、保証と
 * 外部連携の章は「集計の対象に入っていなかった」だけで流し読み扱いになっていた
 * (この束で母集合に入れた)。
 */
export interface ChapterReviewFree {
  /** なぜ人の判断が 1 つも乗らないのか(手引きにそのまま出る)。 */
  readonly reason: string;
}

/** ハンドブックの 1 章。 */
export interface BookChapter {
  /** 章ページのファイル(リポジトリルート相対)。例: docs/book/domain/workshop.md */
  readonly file: string;
  /** 章の表題(リンク文言に使う)。 */
  readonly title: string;
  /** 表紙で束ねるグループ。 */
  readonly group: ChapterGroup;
  /** 集約の章なら、その集約名。横断章(画面・可視性・デザイン)は undefined。 */
  readonly aggregate?: string;
  /**
   * 集約の章の中の節として畳んだ従属する集約(集約名。子・孫…の順)。独立の章を持たないので、表紙は
   * この章へのリンクとして並べる。畳まないときは undefined。
   */
  readonly folded?: readonly string[];
  /** 精読が要らないことの宣言(理由つき)。宣言の無い章は 0 件でも「未分類」になる。 */
  readonly reviewFree?: ChapterReviewFree;
  /**
   * この章の宣言の公理は集約の章がすでに数えているので、この章は公理を数えない(可視性と操作の章)。
   * 手引きの一覧の行が「精読」と必読 0 の食い違いに見えないよう、そう添えるための宣言。
   */
  readonly countedByAggregates?: true;
}

/**
 * 章立て(集約の章 → 画面 → 可視性 → 機能 → デザイン)を返す。
 * 集約の章は**重い順**で(`semantics/aggregate-structure.ts`)、従属する集約は親の章の節に畳むので
 * 独立の章を持たない(全章に展開しているとき)。レビューの手引き・索引ページの導線もこの順に従う。
 * 表紙だけがさらに `group` で束ね直す(並び自体はここが唯一の正)。
 */
export function bookChapters(model: SpecModel, ctx: GenerateContext): BookChapter[] {
  const chapters: BookChapter[] = [];
  if (ctx.usecases?.available === true) {
    // レビューはタスクから読む(ADR-0011 §5)ので、章立ての先頭に置く。
    chapters.push({ file: usecasesPage(ctx.roots), title: 'タスク', group: 'task' });
  }
  const layout = bookLayout(model, ctx);
  for (const name of layout.roots) {
    const specs = model.aggregates.get(name);
    if (specs === undefined) continue;
    const folded = layout.nested ? descendantsOf(layout.ownership, layout.weights, name) : [];
    chapters.push({
      file: bookFile(ctx.roots, `domain/${name}.md`),
      title: aggregateTitle(name, specs.entity?.label),
      group: 'domain',
      aggregate: name,
      ...(folded.length === 0 ? {} : { folded }),
    });
  }
  if (ctx.screens?.available === true) {
    chapters.push({ file: bookFile(ctx.roots, `screens.md`), title: '画面', group: 'surface' });
  }
  chapters.push({ file: bookFile(ctx.roots, `visibility.md`), title: '誰に何が見えるか', group: 'surface', countedByAggregates: true });
  if (ctx.actions !== undefined) {
    chapters.push({ file: bookFile(ctx.roots, `actions.md`), title: '誰が何を実行できるか(操作)', group: 'surface', countedByAggregates: true });
  }
  if (ctx.notifications?.available === true) {
    chapters.push({ file: bookFile(ctx.roots, `notifications.md`), title: '誰に何が飛ぶか(通知)', group: 'feature' });
  }
  if (ctx.jobs?.available === true) {
    chapters.push({
      file: bookFile(ctx.roots, `jobs.md`),
      title: '誰も見ていないときに何が動くか(ジョブ)',
      group: 'feature',
    });
  }
  if (ctx.config?.available === true) {
    chapters.push({
      file: bookFile(ctx.roots, `config.md`),
      title: '何を設定すると何が変わるか(設定と連携)',
      group: 'feature',
    });
  }
  if (ctx.auth?.available === true) {
    chapters.push({ file: bookFile(ctx.roots, `auth.md`), title: '入るとどうなるか(認証)', group: 'feature' });
  }
  if (ctx.guarantees?.available === true) {
    chapters.push({
      file: bookFile(ctx.roots, `guarantees.md`),
      title: '何が起こりえないか(保証)',
      group: 'feature',
    });
  }
  if (ctx.external?.available === true) {
    chapters.push({
      file: bookFile(ctx.roots, `external.md`),
      title: '外と何をやり取りするか(外部連携)',
      group: 'feature',
    });
  }
  if (ctx.actions !== undefined) {
    chapters.push({
      file: bookFile(ctx.roots, `sweep.md`),
      title: '一通り試すとは何か(L2 網羅台帳)',
      group: 'feature',
      // 対応する仕様ファイルを持たない章である(操作仕様・画面仕様の組み合わせを数え上げた台帳)。
      // 判断は数え上げの元 —— 操作の章と画面の章 —— にあり、ここには新しい判断が 1 つも無い。
      reviewFree: {
        reason: 'この章に対応する仕様ファイルが無い(操作と画面の宣言からの数え上げだけで、判断はその 2 章にある)',
      },
    });
  }
  if (ctx.design?.available === true && ctx.design.spec !== null) {
    chapters.push({ file: bookFile(ctx.roots, `design.md`), title: 'デザイン', group: 'design' });
  }
  if (ctx.uxPrinciples?.available === true && ctx.uxPrinciples.spec !== null) {
    chapters.push({
      file: bookFile(ctx.roots, `ux-principles.md`),
      title: 'UX 原則',
      group: 'design',
      // 判断ポイントは画面ごとの受け入れ(各 screen_spec の `ux:`)の件数。1 件ごとに「その理由で本当に原則から
      // 外れてよいか」の判断が乗る(`semantic-review-counts.ts` の台帳の行)。受け入れが無ければ 0 件になる。
    });
  }
  if (ctx.dataTables?.available === true) {
    chapters.push({ file: dataPage(ctx.roots), title: 'データの置き場(テーブル仕様)', group: 'reference' });
  }
  // 章そのものと同じ判定を使う(表紙が存在しないページへリンクしないため。code-examples.ts)。
  if (hasExamplesChapter(ctx)) {
    chapters.push({
      file: bookFile(ctx.roots, `examples.md`),
      title: '書き方の例',
      group: 'reference',
      // 全文が実コード・実仕様からの抜粋であり(印の文法は code-examples.md が正)、
      // 抜粋元が間違っていれば元の章で赤くなる。ここに固有の判断は 1 つも無い。
      reviewFree: { reason: '実コード・実仕様からの抜粋だけで、判断は引用元の章にある(鮮度は generate:check が見る)' },
    });
  }
  return chapters;
}

/**
 * 集約の章題(`集約 workshop(催し)`)。
 *
 * 表題は章ページの見出しと表紙の章立てリンクの両方に出るため、写像はここ 1 か所に置く
 * (2 か所で組み立てると「表紙のリンク文言と章の見出しが違う」というズレが起きる)。
 * 日本語名は `entity_spec` のトップレベル `label`。宣言が無ければ従来どおり内部名だけ。
 *
 * @param name 集約名(ディレクトリ名)
 * @param label 集約の表示名(entity_spec の label。未宣言なら undefined)
 */
export function aggregateTitle(name: string, label: string | undefined): string {
  return label === undefined ? `集約 ${name}` : `集約 ${name}(${label})`;
}

/**
 * 章ページから見た相対 href。**`docs/` の中で解決する**(`../../../docs/...` のように
 * いったんリポジトリルートへ出る形にしない)— VitePress のサイトルートが `docs/` であり、
 * サイトの外へ出るリンクは閲覧時に解決できないため。
 *
 * @param fromFile リンク元の章ページ(リポジトリルート相対。docs/ 配下であること)
 * @param toFile リンク先のファイル(リポジトリルート相対。docs/ 配下であること)
 */
export function relativeHref(fromFile: string, toFile: string): string {
  const prefix = 'docs/';
  const from = fromFile.startsWith(prefix) ? fromFile.slice(prefix.length) : fromFile;
  const to = toFile.startsWith(prefix) ? toFile.slice(prefix.length) : toFile;
  const up = from.split('/').length - 1;
  return `${'../'.repeat(up)}${to}`;
}

/**
 * 仕様ファイル 1 枚の標識(生成ブロック外の手書き本文)を、出典リンクつきの
 * 引用ブロックにする。標識が無ければ空配列。
 *
 * 標識は機械に導出できない人間の判断の記録であり、章の文脈の中でこそ意味を持つ
 * (別冊の台帳には集めない)。転記は原文のままで、要約・解釈はしない。
 *
 * @param file 仕様ファイル(リポジトリルート相対)
 * @param ctx specSources を持つ生成コンテキスト
 * @param fromFile 引用を置く章ページ(出典への相対リンクの起点)
 * @returns Markdown ブロックの並び(空行区切りで連結できる形)
 */
export function signpostQuotes(file: string, ctx: GenerateContext, fromFile: string): string[] {
  const signs = collectSigns(ctx.specSources?.get(file) ?? '');
  if (signs.length === 0) return [];
  const quoted = signs.map((sign) => {
    registerQuotedFences(sign.split('\n'), '> '); // 標識の中の開きも閉じも揃った柵だけ登録する(それ以外の行頭の柵の記号は、無害化が割る)
    return sign.split('\n').map((line) => `> ${line}`).join('\n');
  });
  return [signpostLead(file, signs.length, ctx.roots, fromFile), ...quoted];
}

/**
 * 標識の引用の頭の 1 行(ブロックの標識の本数と出典リンク)。
 *
 * 引用を出す側(`signpostQuotes`)と、章がこのブロックを実際に出したかを確かめる側
 * (`block-check.ts`)が同じ 1 行を読むので、綴りはここ 1 か所に置く。
 *
 * @param file 仕様ファイル(リポジトリルート相対)
 * @param count そのファイルの標識の本数(ブロックの標識の数)
 * @param roots 製品が宣言した根(出典の表示名を仕様の木からの相対にする)
 * @param fromFile 引用を置く章ページ(出典への相対リンクの起点)
 */
export function signpostLead(file: string, count: number, roots: ProductRoots, fromFile: string): string {
  const specsRoot = `${specPath(roots)}/`;
  const label = file.startsWith(specsRoot) ? file.slice(specsRoot.length) : file;
  const href = relativeHref(fromFile, file);
  return (
    `**標識 ${count} 本** — [${label}](${href}) に残された手書きの判断` +
    '(原文のまま転記。引用内の相対リンクは出典ファイル基準。違うと思ったら異議を出す場所):'
  );
}
