/**
 * ハンドブックの無害化の釣り合い(`book-sanitize-balance.ts`)が使う、**1 行のコードスパン(バッククォート)の索引**(純粋関数)。
 *
 * 行ごとに 1 回、バッククォートの連なり・同じ長さの次の連なり・各位置の手前の語が URL らしいか・`|` の数を求めて使い回す(連なりごとに行の頭から数え直さない = 線形)。
 *
 * **アプリの語彙は 1 語も持たない**。
 */

/** 自動リンクになりうる語に含まれる字(`:` `.` `@` `/`)。 */
const LINK_LIKE = /[:.@/]/;

/** 語の区切り(空白と `<` `>`)。 */
const WORD_BREAK = /[\s<>]/;

/** 1 行のバッククォートの連なりの索引(コードスパンの対を、行ごとに 1 回で求める)。 */
export interface CodeLine {
  readonly start: number;
  /** 連なりの位置 → 連なりの番号。 */
  readonly byPosition: Map<number, number>;
  readonly positions: number[];
  readonly lengths: number[];
  /** 連なり i と同じ長さの次の連なり(無ければ -1)。 */
  readonly next: number[];
  /** 位置 p(行頭からの相対)の手前の語が URL らしいか。 */
  readonly link: Uint8Array;
  /** 行頭から位置 p の手前までの `|` の数。 */
  readonly pipes: Uint32Array;
}

/** 行 `[start, end)` のバッククォートの連なりを索引にする。 */
export function indexCodeLine(markdown: string, start: number, end: number): CodeLine {
  const length = end - start;
  const link = new Uint8Array(length + 1);
  const pipes = new Uint32Array(length + 1);
  const positions: number[] = [];
  const lengths: number[] = [];
  const byPosition = new Map<number, number>();
  let linkLike = false;
  let pipeCount = 0;
  for (let index = 0; index < length; index += 1) {
    link[index] = linkLike ? 1 : 0;
    pipes[index] = pipeCount;
    const char = markdown.charAt(start + index);
    if (WORD_BREAK.test(char)) linkLike = false;
    else if (LINK_LIKE.test(char)) linkLike = true;
    if (char === '|') pipeCount += 1;
    if (char === '`' && markdown.charAt(start + index - 1) !== '`') {
      let run = 1;
      while (index + run < length && markdown.charAt(start + index + run) === '`') run += 1;
      byPosition.set(start + index, positions.length);
      positions.push(start + index);
      lengths.push(run);
    }
  }
  link[length] = linkLike ? 1 : 0;
  pipes[length] = pipeCount;
  const next: number[] = new Array<number>(positions.length).fill(-1);
  const seen = new Map<number, number>();
  for (let run = positions.length - 1; run >= 0; run -= 1) {
    next[run] = seen.get(lengths[run] ?? 0) ?? -1;
    seen.set(lengths[run] ?? 0, run);
  }
  return { start, byPosition, positions, lengths, next, link, pipes };
}

/**
 * 位置 `at` のバッククォートの連なりが開くコードスパンが、同じ行の中で同じ長さの連なりに閉じる(間に `|` が無い)なら、閉じる連なりの終わりを返す(閉じなければ -1)。
 *
 * VitePress は URL らしい語(`http://x` `www.x` `a@b` `a.md` など)を自動でリンクにし、語に続くバッククォートまでリンクの一部にするので、
 * 開きの手前の語と閉じの手前の語が URL らしければコードスパンとして数えない。表のセルの区切り `|` は、コードスパンの中でも行を割る。
 */
export function codeSpanEnd(line: CodeLine, at: number): number {
  const run = line.byPosition.get(at);
  if (run === undefined) return -1;
  const closer = line.next[run] ?? -1;
  if (closer === -1) return -1;
  const open = at - line.start;
  const close = (line.positions[closer] ?? 0) - line.start;
  const openEnd = open + (line.lengths[run] ?? 0);
  if (line.link[open] === 1 || line.link[close] === 1) return -1;
  if ((line.pipes[close] ?? 0) - (line.pipes[openEnd] ?? 0) > 0) return -1;
  return line.start + close + (line.lengths[closer] ?? 0);
}

