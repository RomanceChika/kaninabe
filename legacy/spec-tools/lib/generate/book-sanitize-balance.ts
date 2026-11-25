/**
 * ハンドブックの無害化(`book-sanitize.ts`)で、登録されていない文字列の中の**許可表のタグを釣り合いで選ぶ**(純粋関数)。
 *
 * 仕様の文字列が閉じていない `<div>` や余分な `</div>`、置き場の違う `<template #名前>` を作ると、サイトの Vue のコンパイルが壊れる(ページが開けなくなる)。
 * そこで許可表に合うタグのうち、開きと閉じが同じ名前で入れ子になって対になり、**Markdown の解釈が対を別々の要素にまたがせない**形のものだけを通す:
 *
 *   - 同じ行の中の対は通す。複数行の対は、開きも閉じも**ブロックの始まり**(行頭が字下げ無し。`div` などの HTML ブロック名か、前が空行で行末までがそのタグだけ)のときだけ。
 *     行の途中の開きと次の行頭の閉じは、Markdown が段落を割るので別々の要素に入る
 *   - 同じ段落(空行から空行まで)で開いたままのタグは、その段落に Markdown の記号(`|` `*` `[` `]` `\` `~` `{` `}` と語の途中でない `_`)が出た時点で通さない
 *   - URL の `://` から次の空白までのタグは数えない。自動リンクが URL にタグを飲み込むと対の片方だけが残るので、段落の開いたままのタグも同じ理由で通さない(点検 13 回目 C13-5 の種 517594764)
 *   - `\<` のタグは数えない（仕様の文字列は行頭でコードの柵を開けない = 無害化が割るので、柵の中という状態は無い。生成器の柵は登録された範囲として読み飛ばす）
 *   - `<template>` の開きは、部品の中のブロックの始まりで、その部品の対が成り立ったときだけ通す。スロットの名前が重複する部品・`#default` と他の中身を混ぜた部品は、部品ごと通さない
 *   - 行頭の `:::`(VitePress の容器)は段落とタグの積みの区切りにする(出力では `:::` を割る)
 *
 * **線形**: 行ごとの状態(行頭・前の行が空行か・フェンスの情報文字列・コードスパンの対)を 1 回ずつ求めて使い回し、行の頭からの再走査をしない。
 * それでも超える入力のために**手数の予算**を持ち、超えたら `exhausted` を返す(呼び手は出力のタグを全部割って、名指しの問題にする = 通さない側で止まる)。 *
 * **アプリの語彙は 1 語も持たない**。
 */

import { allowedTag, COMPONENT_NAMES, type AllowedTag } from '../kernel/html-allow-list.js';
import { codeSpanEnd, indexCodeLine, type CodeLine } from './book-sanitize-code.js';
import type { TrustedHtml } from '../kernel/trusted-html.js';

/** 登録の範囲の外の、通してよいタグ(位置 → 内容)。 */
export type ValidTags = ReadonlyMap<number, AllowedTag>;

/** 集めた結果。`exhausted` は手数の予算を超えたこと(通すタグは無い)。 */
export interface CollectedTags {
  readonly valid: ValidTags;
  readonly exhausted: boolean;
  /** 使った手数（予算との比較・性能のテスト用）。 */
  readonly steps: number;
}

/** 登録された範囲(これは見ない)。 */
interface Range {
  readonly start: number;
  readonly end: number;
}

/** 段落の中で開いたままのタグを通さなくする Markdown の記号。 */
const PARAGRAPH_BREAKERS: ReadonlySet<string> = new Set(['|', '*', '[', ']', '\\', '~', '{', '}']);

/** markdown-it が HTML ブロック(種類 6)の始まりと読むタグ名のうち、許可表にあるもの。 */
const BLOCK_NAMES: ReadonlySet<string> = new Set(
  'caption col colgroup dd details div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p section summary table tbody td tfoot th thead tr ul'.split(' '),
);

/** VitePress の容器(`:::`)の行。 */
const CONTAINER_LINE = /^(?:[\s>]|(?:[-*+]|\d+[.)])(?=\s))*:{3,}/;

/** 1 回の無害化に使える時間の上限（ミリ秒）。実測は数ミリ秒〜百ミリ秒なので、負荷の高い日でも超えない余裕。超えたら手数の予算と同じく通さない側で止める。 */
const TIME_LIMIT_MS = 5_000;

/** 1 字あたりの手数の予算(線形の走査は 10 に届かない。余裕を見た上限)。 */
const STEPS_PER_CHAR = 60;

/** 行頭から見る長さ。 */
const HEAD = 400;

/** `{n}` の形の置き場の記号。 */
const PLACEHOLDER = /^\{[A-Za-z0-9_]+\}/;

/** 積みの 1 つ。 */
interface Open {
  readonly at: number;
  readonly tag: AllowedTag;
  readonly block: boolean;
  readonly lineStart: number;
  /** 対が成り立ったら通す、中の `<template>` の対。 */
  readonly pending: [number, AllowedTag, number, AllowedTag][];
}

/**
 * 登録されていない文字列の中のタグを、釣り合いを見て選ぶ(ページ全体で 1 つの積み)。
 *
 * @param markdown 全体
 * @param spans 登録された範囲(昇順・重ならない)
 * @param trusted 登録簿
 * @param stepsPerChar 1 字あたりの手数の予算(テストが小さくして、超えたときの振る舞いを確かめる)
 * @returns 通すタグ(位置 → 内容)と、手数の予算を超えたか
 */
export function collectValidTags(markdown: string, spans: readonly Range[], trusted: TrustedHtml, stepsPerChar = STEPS_PER_CHAR): CollectedTags {
  const valid = new Map<number, AllowedTag>();
  const stack: Open[] = [];
  const budget = stepsPerChar * (markdown.length + 1_000);
  const deadline = performance.now() + TIME_LIMIT_MS;
  let steps = 0;
  let ticks = 0;
  let paragraphStart = 0;
  /** 閉じないバッククォートの後(同じ段落の中は、次の連なりと対になって複数行のコードスパンになりうるので、タグの対を読めない)。 */
  let codeOpen = false;
  /** `://` の後の、空白までの区間にいる(自動リンクがタグを飲み込みうる)。 */
  let inUrl = false;
  // 行の状態: 今の行の頭・1 つ前の行の頭(前の行が空行かを、要るときだけ見る)・行末・コードスパンの索引
  let lineStart = 0;
  let previousLineStart = 0;
  let lineEnd = -1;
  let codeLine: CodeLine | null = null;
  const endOfLine = (): number => {
    if (lineEnd < lineStart) {
      const found = markdown.indexOf('\n', lineStart);
      lineEnd = found === -1 ? markdown.length : found;
    }
    return lineEnd;
  };
  const newLine = (at: number): void => {
    previousLineStart = lineStart;
    lineStart = at;
  };
  const previousBlank = (): boolean => lineStart === 0 || /^[ \t]*$/.test(markdown.slice(previousLineStart, lineStart - 1));
  const startsBlock = (at: number, tag: AllowedTag): boolean => {
    if (at !== lineStart) return false;
    if (BLOCK_NAMES.has(tag.name)) return true;
    const alone = /^[ \t]*(?:\n|$)/.test(markdown.slice(at + tag.length, at + tag.length + 200));
    return alone && previousBlank();
  };
  const breakParagraph = (): void => {
    while (stack.length > 0 && (stack[stack.length - 1]?.at ?? 0) >= paragraphStart) stack.pop();
  };
  /** 先頭から位置 p の手前までの、空白でない字の数（部品の中身の検査を、入れ子の深さに依らず 1 回の走査で済ませる。要るときに 1 度だけ作る）。 */
  let solid: Uint32Array | null = null;
  const solidBefore = (position: number): number => {
    if (solid === null) {
      solid = new Uint32Array(markdown.length + 1);
      steps += markdown.length;
      for (let index = 0; index < markdown.length; index += 1) solid[index + 1] = (solid[index] ?? 0) + (/\s/.test(markdown.charAt(index)) ? 0 : 1);
    }
    return solid[position] ?? 0;
  };
  const hasContent = (from: number, to: number): boolean => to > from && solidBefore(to) - solidBefore(from) > 0;
  /** 部品の中身の検査: スロットの名前が重複しない・`#default` があれば他の中身が無い(Vue のコンパイルが落ちる形)。 */
  const slotsValid = (open: Open, closeAt: number): boolean => {
    const names = new Set<string>();
    for (const [, template] of open.pending) {
      const name = template.slot ?? '';
      if (names.has(name)) return false;
      names.add(name);
    }
    if (!names.has('default')) return true;
    let position = open.at + open.tag.length;
    for (const [openAt, , endAt, endTag] of open.pending) {
      if (hasContent(position, openAt)) return false;
      position = endAt + endTag.length;
    }
    return !hasContent(position, closeAt);
  };
  const commit = (open: Open, closeAt: number, close: AllowedTag): void => {
    if (COMPONENT_NAMES.has(open.tag.name) && !slotsValid(open, closeAt)) return;
    valid.set(open.at, open.tag);
    valid.set(closeAt, close);
    for (const [openAt, openTag, endAt, endTag] of open.pending) {
      valid.set(openAt, openTag);
      valid.set(endAt, endTag);
    }
  };
  const closeTag = (at: number, tag: AllowedTag): void => {
    const open = stack[stack.length - 1];
    if (open?.tag.name !== tag.name) return;
    stack.pop();
    if (open.lineStart !== lineStart && !(open.block && startsBlock(at, tag))) return;
    const outer = stack[stack.length - 1];
    if (tag.name === 'template') outer?.pending.push([open.at, open.tag, at, tag]);
    else commit(open, at, tag);
  };
  const openTag = (at: number, tag: AllowedTag): void => {
    const block = startsBlock(at, tag);
    if (tag.name === 'template') {
      const outer = stack[stack.length - 1];
      if (outer === undefined || !COMPONENT_NAMES.has(outer.tag.name) || !block || tag.slot === undefined) return;
    }
    if (tag.selfClosed) valid.set(at, tag);
    else stack.push({ at, tag, block, lineStart, pending: [] });
  };
  /** 行頭の処理(空行・容器の行)。 */
  const onLineStart = (at: number): void => {
    if (at !== lineStart) newLine(at);
    const end = endOfLine();
    const head = markdown.slice(at, Math.min(end, at + HEAD));
    steps += head.length >> 2;
    // 出力では `:::` を割るので、容器の行は普通の文章の行になる(段落は続く)。それでも、容器が生きる処理系との食い違いに備えて、開いたままのタグは捨てる
    if (CONTAINER_LINE.test(head)) stack.length = 0;
    if (/^[ \t]*$/.test(head) && end - at <= HEAD) {
      paragraphStart = at;
      codeOpen = false;
    }
  };
  const scan = (from: number, to: number): void => {
    for (let at = from; at < to; at += 1) {
      steps += 1;
      ticks += 1;
      // 手数に数えにくい正規表現の仕事に備えて、時計の予算も持つ（4096 字ごとに見る）
      if (steps > budget || ((ticks & 4095) === 0 && performance.now() > deadline)) {
        steps = Infinity;
        return;
      }
      if (at === 0 || markdown.charCodeAt(at - 1) === 10) onLineStart(at);
      if (codeOpen) continue;
      const char = markdown.charAt(at);
      if (/\s/.test(char)) inUrl = false;
      else if (char === ':' && markdown.startsWith('://', at)) {
        inUrl = true;
        breakParagraph();
      }
      if (char === '<') {
        if (inUrl) continue;
        steps += 8;
        const tag = allowedTag(markdown.slice(at, Math.min(to, at + 20_000)), 0, trusted);
        if (tag === null || markdown.charAt(at - 1) === '\\') continue;
        steps += tag.length >> 3;
        if (tag.closing) closeTag(at, tag);
        else openTag(at, tag);
        at += tag.length - 1;
      } else if (char === '`') {
        // 同じ行の中で同じ長さの連なりが閉じるコードスパンは丸ごと読み飛ばす(中の記号とタグは数えない)。閉じないものは段落を割る記号
        if (codeLine?.start !== lineStart) {
          codeLine = indexCodeLine(markdown, lineStart, endOfLine());
          steps += (lineEnd - lineStart) * 4;
        }
        const closing = markdown.charAt(at - 1) === '\\' ? -1 : codeSpanEnd(codeLine, at);
        if (closing === -1) {
          breakParagraph();
          codeOpen = true;
        } else {
          at = closing - 1;
        }
      } else if (char === '{' && PLACEHOLDER.test(markdown.slice(at, at + 80))) {
        // 英数字と `_` だけの `{n}` は、無害化も割らない置き場の記号(属性の記法にならない)
        at += (PLACEHOLDER.exec(markdown.slice(at, at + 80))?.[0].length ?? 1) - 1;
      } else if (PARAGRAPH_BREAKERS.has(char) || (char === '_' && !/^[A-Za-z0-9]{2}$/.test(markdown.charAt(at - 1) + markdown.charAt(at + 1)))) {
        breakParagraph();
      }
    }
  };
  let position = 0;
  const afterSpan = (span: Range): void => {
    // 登録された範囲が行をまたぐなら、行の状態をその中の最後の行へ進める
    if (span.start > 0 && markdown.charCodeAt(span.start - 1) === 10 && lineStart !== span.start) newLine(span.start);
    const last = markdown.lastIndexOf('\n', span.end - 1);
    if (last >= span.start) {
      const before = last > span.start ? markdown.lastIndexOf('\n', last - 1) : -1;
      if (before >= span.start) previousLineStart = before + 1;
      else previousLineStart = lineStart;
      lineStart = last + 1;
    }
  };
  for (const span of spans) {
    scan(position, span.start);
    if (steps > budget) return { valid: new Map(), exhausted: true, steps };
    afterSpan(span);
    position = span.end;
  }
  scan(position, markdown.length);
  return steps > budget ? { valid: new Map(), exhausted: true, steps } : { valid, exhausted: false, steps };
}
