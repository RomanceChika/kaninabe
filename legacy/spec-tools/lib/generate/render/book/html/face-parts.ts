/**
 * 人向けの表示の部品(折りたたみ・読む量の 4 枚・語釈。語と型は `face-html.ts` のもの)。
 *
 * 見た目は `face.css` がクラス名で決める。文字列は出力の口(`markup.ts`)が逃がす
 * (呼ぶ側は `esc` を通さない。`esc` の Markdown の記号の実体参照は HTML では要らない)。部品は script を要らない形にする:
 * 折りたたみは `<details>`(表示モードは `book.js` が開け閉めする)、語釈は CSS のツールチップ、4 枚は素の `<div>`。
 *
 * ラベルの語(17 語)・印の語・「まだ書かれていない」は `face-html.ts` のものを使い、ここに語は持たない。
 */

import type { ElementsOf } from '../../../../semantics/reading-class.js';
import { MARK_WORDS, NOT_WRITTEN, oneLine, type FaceLabel, type MarkKind } from '../face-html.js';
import { el, join, type Child, type Html } from './markup.js';

/** 等幅の語(仕様の識別子・式)。 */
export function mono(value: string): Html {
  return el('span', { class: 'bf-mono' }, oneLine(value));
}

/** 太字。 */
export function bold(...kids: readonly Child[]): Html {
  return el('b', null, kids);
}

/** 語釈の引き先(台帳の `id` → 語釈)。 */
export type Glossary = (id: string) => string | undefined;

/**
 * 用語のツールチップ(台帳に無い `id` は字だけ)。語釈は CSS が出す(フォーカスでも出る)。
 *
 * @param glossary 語釈の引き先
 * @param id 台帳の `id`
 * @param label 本文に出す字
 */
export function term(glossary: Glossary, id: string, label: string): Html {
  const gloss = glossary(id);
  return gloss === undefined ? el('span', null, label) : el('span', { class: 'bf-term', tabindex: 0 }, label, el('span', { class: 'bf-term-tip', role: 'tooltip' }, gloss));
}

/** 読み方の印。 */
export function mark(kind: MarkKind): Html {
  return el('span', { class: ['bf-mark', `bf-mark--${kind}`] }, MARK_WORDS[kind]);
}

/** 状態のピル。 */
export function pill(id: string, negative: boolean): Html {
  return el('span', { class: ['bf-pill', negative ? 'bf-pill--negative' : ''] }, id);
}

/** 値が無いこと(薄い字)。 */
export function none(value: string): Html {
  return el('span', { class: 'bf-none' }, value);
}

/** 「—」。 */
export function dash(): Html {
  return el('span', { class: 'bf-no' }, '—');
}

/**
 * 箇条(1 項目 1 値)。
 *
 * @param items 項目
 * @param block 本文直下に置くとき true
 */
export function pts(items: readonly Child[], block = false): Html {
  return el(
    'ul',
    { class: ['bf-pts', block ? 'bf-blk' : ''] },
    items.map((item) => el('li', null, item)),
  );
}

/** 値が 1 つなら値そのもの、複数なら箇条。 */
export function valueOf(items: readonly Child[]): Child {
  const [only] = items;
  return items.length === 1 ? only : pts(items);
}

/** ラベル行 1 行。 */
export function kv(label: FaceLabel, value: Child): Html {
  return el('div', { class: 'bf-kv' }, el('div', { class: 'bf-k' }, label), el('div', { class: 'bf-v' }, value));
}

/** 行頭が仕様の語(ロール名など)の行。 */
export function roleKv(head: Child, value: Child): Html {
  return el('div', { class: 'bf-kv' }, el('div', { class: 'bf-rk' }, head), el('div', { class: 'bf-v' }, value));
}

/** ラベル行の群。行が無ければ何も出さない。 */
export function kvs(rows: readonly Child[]): Html | null {
  return rows.length === 0 ? null : el('div', { class: 'bf-kvs' }, rows);
}

/** 人が書く文の段落。値が無ければ「(まだ書かれていない)」。 */
export function prose(value: string | undefined, lede = false): Html {
  return el('p', { class: ['bf-prose', lede ? 'bf-lede' : ''] }, value === undefined ? none(NOT_WRITTEN) : oneLine(value));
}

/** 折りたたみの見出しと種類。 */
export interface FoldProps {
  readonly kind: 'detail' | 'sign' | 'table' | 'orig';
  readonly title: string;
  readonly count?: string | number | undefined;
  readonly hint?: string | undefined;
  readonly open?: boolean | undefined;
  readonly element?: ElementsOf<'derived'> | readonly ElementsOf<'derived'>[] | undefined;
}

/**
 * 折りたたみ 1 つ(`<details>`)。中身が無ければ何も出さない。
 *
 * 既定で開くものは `data-default-open` を持ち、表示モードを変えても開いたままにする(`book.js`)。
 */
export function fold(props: FoldProps, body: readonly Child[]): Html | null {
  if (body.length === 0) return null;
  const element = props.element === undefined ? undefined : typeof props.element === 'string' ? props.element : props.element.join(' ');
  return el(
    'details',
    {
      class: 'bf-fold',
      'data-kind': props.kind,
      ...(props.open === true ? { open: true, 'data-default-open': 'true' } : {}),
      ...(element === undefined ? {} : { 'data-el': element }),
    },
    el(
      'summary',
      { class: 'bf-fold-head' },
      el('span', { class: 'bf-fold-sign', 'aria-hidden': 'true' }),
      el('span', { class: 'bf-fold-title' }, props.title),
      props.count === undefined ? null : el('span', { class: 'bf-fold-n' }, String(props.count)),
      props.hint === undefined ? null : el('span', { class: 'bf-fold-hint' }, props.hint),
    ),
    el('div', { class: 'bf-fold-body' }, body),
  );
}

/** 読む量の 4 枚の 1 枚。 */
export interface GridCell {
  readonly id: string;
  readonly label: string;
  readonly mark?: MarkKind;
  readonly value?: string;
  readonly body: readonly Child[];
  /** 数と中身が検証の結果に依る(`verified` の印を付ける)。 */
  readonly verify?: boolean;
}

/** 読む量の 4 枚。 */
export function grid(cells: readonly GridCell[]): Html {
  return el(
    'div',
    { class: 'bf-grid', role: 'list' },
    cells.map((cell) =>
      el(
        'div',
        { class: 'bf-cell', role: 'listitem', 'data-cell': cell.id },
        el('div', { class: 'bf-cell-k' }, cell.mark === undefined ? null : mark(cell.mark), el('span', null, cell.label)),
        cell.value === undefined ? null : el('div', { class: 'bf-cell-v' }, cell.verify === true ? verified([cell.value]) : cell.value),
        el('div', { class: 'bf-cell-s' }, cell.verify === true ? verified(cell.body, true) : cell.body),
      ),
    ),
  );
}

/**
 * 検証の結果(警告)に依る部分の印。ハンドブックだけを出す入口は検証を回さないので、ここだけが全部入りの `generate` と違ってよい
 * (`book-verification-cut.ts` が、この印の付いた要素を中身ごと切り出して比べる)。印の外は 1 バイトも違ってはいけない。
 *
 * @param kids 中身
 * @param block ブロックを包むとき true(`<div>`。字の中なら `<span>`)
 */
export function verified(kids: readonly Child[], block = false): Html {
  return el(block ? 'div' : 'span', { 'data-dep': 'verify' }, kids);
}

/**
 * 共有の文(表のセル・定型の文)を HTML にする。読む記法は 2 つだけ: `` `識別子` `` を等幅の字に、`**語**` を太字にする。
 * `\|`(表のセルの区切りの逃がし)は `|` に戻す。それ以外の字はすべて字として逃がす(Markdown として読まない)。
 *
 * @param value 文
 */
export function inline(value: string): Html {
  const parts = value.replace(/\\\|/g, '|').split(/(`[^`]+`|\*\*[^*]+\*\*)/);
  return join(
    parts.map((part) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1
        ? mono(part.slice(1, -1))
        : part.startsWith('**') && part.endsWith('**') && part.length > 3
          ? bold(part.slice(2, -2))
          : part,
    ),
  );
}
