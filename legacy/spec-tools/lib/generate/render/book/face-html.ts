/**
 * 人向けの表示(章の `.md` に埋めるタグ)の部品。
 *
 * 生成器は**意味を持つタグとクラス**だけを吐き、見た目はテーマ(`.vitepress/theme/book-face/`)が決める。
 * ここが持つのは 3 つで、どれも製品の語を知らない:
 *
 * - **ラベルの語 17 語**(値域が決まった集まり)。型 `FaceLabel` が値域なので、18 語目は書けない
 *   (book-human-face.md §7-7。構造テストも出力の側から数える)
 * - **読み方の印の 4 種**(必読 / 参照 / 受け入れ / 変更)
 * - ラベル行・箇条・ピルの書き出し。**1 行 1 ブロック**で、空行を含まない
 *   (空行が入ると markdown が HTML ブロックを閉じ、中身を段落として読み直してしまう)
 *
 * 値は名詞句か 1 短文で、文章にしない。無い欄は「原文に例外の文は無い」(例外の文を拾えなかった公理)か
 * 「(まだ書かれていない)」(仕様に書く場所はあるが、まだ誰も書いていない)。
 */

import type { ElementsOf } from '../../../semantics/reading-class.js';

/**
 * ラベル行の語(17 語。これが全部で、これ以外は出せない)。
 *
 * 出どころは仕様の欄と 1 対 1 に近いが、`補足` と `出どころ` だけは 1 欄に対応しない:
 * `補足` は原文の主文以外の条件(括弧の逃がし先)、`出どころ` は仕様のパス(裁定 2026-09-29)。
 * `遷移ガード` と `関係する公理` は束 ⑧-a2 で足した 2 語(遷移の宣言を写すだけの `条件` が、別の前提の無さと
 * 読まれたため。`条件` はアクセスの宣言の `when` に残る)。
 */
export const FACE_LABELS = [
  '主語',
  '決まること',
  '例外',
  '守らせる場所',
  '原本',
  '誰が',
  'どこへ',
  '条件',
  '遷移ガード',
  '関係する公理',
  'いつ',
  '状態',
  '形式',
  '仕様の語',
  '出どころ',
  '補足',
  '例',
] as const;

/** ラベル行の語。 */
export type FaceLabel = (typeof FACE_LABELS)[number];

/** ラベル行ではなく、群の見出しに使う語(1 語だけ)。 */
export const HANDS_HEADING = '出る手';

/** 仕様に書く場所はあるが、まだ誰も書いていない値。黙って空にしない。 */
export const NOT_WRITTEN = '(まだ書かれていない)';

/**
 * 例外の候補の文が拾えなかった公理の「例外」欄の値。
 *
 * 例外を文の形で拾っているだけなので、「例外は無い」とは断定しない(原文の括弧の中などに、
 * 例外の言い方が残っていることがある)。補足があるときは、そちらを見るよう促す。
 *
 * @param hasSupplement その公理に「補足」の行があるか
 */
export function noException(hasSupplement: boolean): string {
  return hasSupplement ? '原文に例外の文は無い。補足を参照' : '原文に例外の文は無い';
}

/** 読み方の印の種類(4 種)。 */
export type MarkKind = 'axiom' | 'derive' | 'acceptance' | 'changed';

/** 読み方の印の文言(部品は語を持たず、ここの語を受け取る)。 */
export const MARK_WORDS: Readonly<Record<MarkKind, string>> = {
  axiom: '必読',
  derive: '参照',
  acceptance: '受け入れ',
  changed: '変更',
};

/**
 * HTML として安全な文字へ。`{{` は部品側のテンプレートに解釈されるので実体参照にする。
 *
 * Markdown の記号(`` ` `` `*` `[` `]` `|` `\` `~` と、語の途中でない `_`)も実体参照にする。これらは生成器の HTML の中でも Markdown に読まれ(強調・リンク・コード・
 * 表のセルが HTML のタグを別々の要素にまたがせる)、無害化は「記号を含む段落の中で開いたままのタグ」を通さない(`book-sanitize.ts`)。実体参照にした字は見た目が変わらない。
 */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
    .replace(/[`*[\]|\\~]/g, (char) => `&#${char.charCodeAt(0)};`)
    .replace(/_/g, (_char, offset: number, whole: string) => (/^[A-Za-z0-9]{2}$/.test((whole[offset - 1] ?? '') + (whole[offset + 1] ?? '')) ? '_' : '&#95;'));
}

/** 改行を詰めて 1 行にする(HTML ブロックに空行を入れないため)。 */
export function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}

/** 等幅の語(仕様の識別子・式)。 */
export function mono(text: string): string {
  return `<span class="bf-mono">${esc(oneLine(text))}</span>`;
}

/** 用語のツールチップ(辞書に無い id は部品が文字だけを出す)。 */
export function term(id: string, text: string): string {
  return `<Term id="${esc(id)}">${esc(text)}</Term>`;
}

/** 読み方の印(色 + 形の 2 重符号は CSS 側)。 */
export function mark(kind: MarkKind): string {
  return `<span class="bf-mark bf-mark--${kind}">${MARK_WORDS[kind]}</span>`;
}

/** 状態のピル。悪い知らせの状態(tone: negative)だけ別の色。 */
export function pill(id: string, negative: boolean): string {
  return `<span class="bf-pill${negative ? ' bf-pill--negative' : ''}">${esc(id)}</span>`;
}

/** 値が無いこと(薄い字)。 */
export function none(text: string): string {
  return `<span class="bf-none">${esc(text)}</span>`;
}

/** 「—」(状態・ロールだけで決まり、条件の式が無い)。 */
export function dash(): string {
  return '<span class="bf-no">—</span>';
}

/**
 * 箇条(1 項目 1 値)。項目が 1 つなら箇条にせず値そのものを返す(`<ul>` の中に 1 行だけは読みにくい)。
 *
 * @param items 項目(HTML。呼び出し側が `esc` / `mono` を通したもの)
 * @param block 本文直下に置くとき true(上に余白を取る)
 */
export function pts(items: readonly string[], block = false): string {
  const lis = items.map((item) => `<li>${item}</li>`).join('');
  return `<ul class="bf-pts${block ? ' bf-blk' : ''}">${lis}</ul>`;
}

/** 値(HTML)が 1 つなら値そのもの、複数なら箇条。 */
export function valueOf(items: readonly string[]): string {
  const [only] = items;
  return items.length === 1 && only !== undefined ? only : pts(items);
}

/** ラベル行 1 行(値は HTML)。 */
export function kv(label: FaceLabel, valueHtml: string): string {
  return `<div class="bf-kv"><div class="bf-k">${label}</div><div class="bf-v">${valueHtml}</div></div>`;
}

/**
 * 行頭が**仕様の語**(ロール名など)の行(値は HTML)。ラベル行の語 17 語の外なので、行頭のクラスを分ける(`bf-rk`)。
 * 17 語に混ぜると、ロールが増えるたびにラベルが増えて閉じた集合でなくなる。
 */
export function roleKv(headHtml: string, valueHtml: string): string {
  return `<div class="bf-kv"><div class="bf-rk">${headHtml}</div><div class="bf-v">${valueHtml}</div></div>`;
}

/** ラベル行の群(1 ブロック)。行が無ければ空文字。 */
export function kvs(rows: readonly string[]): string {
  return rows.length === 0 ? '' : `<div class="bf-kvs">${rows.join('')}</div>`;
}

/** 文章(人が書く列)の段落。値が無ければ「(まだ書かれていない)」。 */
export function prose(text: string | undefined, lede = false): string {
  const body = text === undefined ? none(NOT_WRITTEN) : esc(oneLine(text));
  return `<p class="bf-prose${lede ? ' bf-lede' : ''}">${body}</p>`;
}

/** 折りたたみ(`<Fold>`)の属性の値を作る(見出しの文字を実体参照にする)。 */
export interface FoldProps {
  readonly kind: 'detail' | 'sign' | 'table' | 'orig';
  readonly title: string;
  readonly count?: string | number | undefined;
  readonly hint?: string | undefined;
  readonly open?: boolean | undefined;
  /**
   * この折りたたみが載せる要素の種類(読み方の表 `semantics/reading-class.ts` が**導出**と決めたものだけ。複数なら並べる)。
   * 型が導出の種類に絞っているので、公理の種類を畳んで下段に置くことは書けない(導出の種類を上段の行に置くことも、
   * `axiomRowHtml` の `AxiomElement` が書けなくしている)。出力に `data-el` として残り、構造テストが生成物の側からも
   * 見る。
   */
  readonly element?: ElementsOf<'derived'> | readonly ElementsOf<'derived'>[] | undefined;
}

/**
 * 折りたたみ 1 つ分の markdown 断片(`<Fold>` + 中身の markdown + 閉じタグ)。
 * 中身が無ければ何も出さない(空の折りたたみは読み手に「何も無い」を開かせるだけである)。
 */
export function fold(props: FoldProps, body: readonly string[]): string[] {
  if (body.length === 0) return [];
  const attrs = [
    `kind="${props.kind}"`,
    `title="${esc(props.title)}"`,
    ...(props.count === undefined ? [] : [`count="${esc(String(props.count))}"`]),
    ...(props.hint === undefined ? [] : [`hint="${esc(props.hint)}"`]),
    ...(props.open === true ? ['open'] : []),
    ...(props.element === undefined ? [] : [`data-el="${typeof props.element === 'string' ? props.element : props.element.join(' ')}"`]),
  ].join(' ');
  return [`<Fold ${attrs}>`, ...body, '</Fold>'];
}
