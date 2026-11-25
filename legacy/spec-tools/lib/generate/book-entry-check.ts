/**
 * ハンドブックだけを出す入口(`cli/generate-book.ts`)の**部分の出力の検査**(`--check`): 入口の出力が、全部入りの `generate` が出した対応する章と、
 * **検証の結果と変異の目録に依る部分を除いて**バイト同一か。
 *
 * 入口は全部入りの `generate` の別の道ではなく、**同じ生成器が同じ文脈の組み立てで出す章の部分集合**である(別の本を出さない)。その保証が崩れていないこと
 * (生成器の側が入口だけ違う出力をしていない・入口の文脈が全部入りと食い違っていない)を、手元で確かめる口。全部入りの出力は検証の結果と変異の目録を載せる
 * ので、入口の出力とは**その分だけ**違う(入口は検証を回さず変異を回さない。入口がその節を「未実施・未集計」と書く)。
 *
 * **許す差の範囲は固定する**(`book-verification-cut.ts`): 比べる前に、両側から生成器が印(`data-dep="verify"`)を付けた要素(検証・変異に依る部分)を中身ごと切り出し、残りが 1 バイトも違わないことを見る。
 * 「検証の語を含む行を行ごと捨てる」にも語句の正規化にもしない(印の外が違えば、違いとして残る)。切り出した印の数は章ごとに報告に出す。
 * テストが同じ切り出しで入口と全部入りを比べる(`__tests__/unit/cli/generate-book.test.ts`)のと同じ 1 本である。
 *
 * CI には入れない(全部入りの `generate` の生成物が要り、手元の確認用)。比べる相手の章が無ければ、比べられないことを名指して落とす。
 * 純関数であり throw しない(ファイルの読み書きは呼び手)。**アプリの語彙は 1 語も持たない**。
 */

import { cutVerification } from './book-verification-cut.js';

/** 行の差分の塊 1 つ(切り出した後の、入口の行と、全部入りの行)。 */
export interface LineHunk {
  /** 切り出した入口の行での開始行(1 始まり)。 */
  readonly entryLine: number;
  /** 入口の側の行(全部入りに無い行)。 */
  readonly entry: readonly string[];
  /** 全部入りの側の行(入口に無い行)。 */
  readonly full: readonly string[];
}

/** LCS の表の大きさの上限(これを超える差分は 1 つの塊として扱う)。 */
const LCS_CELL_LIMIT = 16_000_000;

/**
 * 2 つの行の並びの差分を、塊(連続した違い)にする。先頭と末尾の共通部分を除いたあと、最長共通部分列で対応を取る。
 * 表が大きすぎる(`LCS_CELL_LIMIT` 超)ときは、残りを 1 つの塊にする。
 *
 * @param entry 入口の側の行
 * @param full 全部入りの側の行
 */
export function lineHunks(entry: readonly string[], full: readonly string[]): readonly LineHunk[] {
  let head = 0;
  while (head < entry.length && head < full.length && entry[head] === full[head]) head += 1;
  let tail = 0;
  while (tail < entry.length - head && tail < full.length - head && entry[entry.length - 1 - tail] === full[full.length - 1 - tail]) tail += 1;
  const a = entry.slice(head, entry.length - tail);
  const b = full.slice(head, full.length - tail);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length * b.length > LCS_CELL_LIMIT) return [{ entryLine: head + 1, entry: a, full: b }];
  return hunksOf(a, b, head);
}

/** 先頭と末尾を除いた残りを、LCS の表で塊にする。 */
function hunksOf(a: readonly string[], b: readonly string[], offset: number): readonly LineHunk[] {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const hunks: LineHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    const startI = i;
    const startJ = j;
    while ((i < a.length || j < b.length) && !(i < a.length && j < b.length && a[i] === b[j])) {
      if (j >= b.length || (i < a.length && (table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0))) i += 1;
      else j += 1;
    }
    hunks.push({ entryLine: offset + startI + 1, entry: a.slice(startI, i), full: b.slice(startJ, j) });
  }
  return hunks;
}

/** 切り出した印の数(入口の側と全部入りの側)。 */
export interface FragmentCounts {
  readonly entry: number;
  readonly full: number;
}

/** 章 1 本の比べた結果。 */
export type ChapterCheck =
  | { readonly file: string; readonly status: 'identical' }
  /** 検証・変異に依る部分だけが違う(切り出した後は同じ)。 */
  | { readonly file: string; readonly status: 'verification-only'; readonly fragments: FragmentCounts }
  /** 切り出した後にも違いがある(別の本を出している)。 */
  | { readonly file: string; readonly status: 'differs'; readonly hunks: readonly LineHunk[]; readonly fragments: FragmentCounts }
  /** 比べる相手(全部入りの生成物の章)が無い。 */
  | { readonly file: string; readonly status: 'missing' };

/**
 * 章 1 本を比べる。
 *
 * @param file 章のファイル(リポジトリルート相対)
 * @param entry 入口の出力
 * @param full 全部入りの生成物(無ければ null)
 */
export function checkChapter(file: string, entry: string, full: string | null): ChapterCheck {
  if (full === null) return { file, status: 'missing' };
  if (entry === full) return { file, status: 'identical' };
  const cutEntry = cutVerification(entry);
  const cutFull = cutVerification(full);
  const fragments = { entry: cutEntry.fragments, full: cutFull.fragments };
  const hunks = lineHunks(cutEntry.lines, cutFull.lines);
  return hunks.length === 0 ? { file, status: 'verification-only', fragments } : { file, status: 'differs', hunks, fragments };
}

/** 報告に挙げる食い違いの塊の数・行の長さの上限。 */
const SHOWN_HUNKS = 3;
const SHOWN_WIDTH = 160;

/** 長い行を切る。 */
function clip(line: string): string {
  return line.length > SHOWN_WIDTH ? `${line.slice(0, SHOWN_WIDTH)}…` : line;
}

/** 食い違いの塊 1 つを報告の行にする。 */
function hunkLines(hunk: LineHunk): string[] {
  return [
    `    切り出した後の入口の ${hunk.entryLine} 行目〜: 入口 ${hunk.entry.length} 行 / 全部入り ${hunk.full.length} 行`,
    ...hunk.entry.slice(0, 2).map((line) => `      入口 | ${clip(line)}`),
    ...hunk.full.slice(0, 2).map((line) => `      全部 | ${clip(line)}`),
  ];
}

/** 章ごとの切り出した断片の数の行(断片が無い章・比べられなかった章は出さない)。 */
function fragmentLine(check: ChapterCheck): string[] {
  if (check.status !== 'verification-only' && check.status !== 'differs') return [];
  const { entry, full } = check.fragments;
  return entry + full === 0 ? [] : [`  切り出した断片: ${check.file}(入口 ${entry} / 全部入り ${full})`];
}

/** 鮮度検査の報告(標準出力の行と、合格か)。 */
export interface CheckReport {
  readonly lines: readonly string[];
  /** 合格(章が 1 本以上あり、すべて同一か、検証・変異に依る部分だけの違い)。 */
  readonly ok: boolean;
}

/**
 * 比べた結果を報告の行にする。切り出した後にも違いがある章・比べる相手が無い章があれば不合格。
 *
 * @param checks 章ごとの結果
 */
export function formatCheckReport(checks: readonly ChapterCheck[]): CheckReport {
  const count = (status: ChapterCheck['status']): number => checks.filter((check) => check.status === status).length;
  const missing = checks.filter((check) => check.status === 'missing');
  const differing = checks.filter((check): check is Extract<ChapterCheck, { status: 'differs' }> => check.status === 'differs');
  const ok = checks.length > 0 && missing.length === 0 && differing.length === 0;
  const lines = [
    `入口の出力と全部入りの生成物の比較: ${checks.length} 本(同一 ${count('identical')} / 検証・変異に依る部分だけ違う ${count('verification-only')} / 食い違い ${differing.length} / 比べる相手が無い ${missing.length})`,
    ...checks.flatMap(fragmentLine),
    ...differing.flatMap((check) => [`  食い違い: ${check.file}(検証・変異に依る部分を除いても 1 バイト違う塊 ${check.hunks.length} 件)`, ...check.hunks.slice(0, SHOWN_HUNKS).flatMap(hunkLines)]),
    ...missing.map((check) => `  比べる相手が無い: ${check.file}(全部入りの生成物にこの章が無い。\`npm run generate\` を先に回す)`),
    ...(checks.length === 0 ? ['  比べる章がありません(入口が章を 1 本も出さなかった)'] : []),
  ];
  return { lines, ok };
}
