/**
 * 版の写しから 1 本の生成物を読み出し、**読めなかったことを黙らせない**ための層。
 *
 * 3 つを分ける(C23 と同じ流儀) ——
 * - **その版に無かった**(`present: false`。事実の表が空になるだけで、行は出入りとして出る)
 * - **読めた**(値)
 * - **読めなかった**(`problem`。呼び出し側が「判定できない」として報告する。ここで空の値に
 *   倒すと、壊れた生成物が「意味の差分はありません」として通ってしまう)
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { PlainValue } from './ts-literal.js';
import { readExportedValue, readPlainValue, topLevelKeys } from './ts-literal.js';
import type { DiffProblem, SideSnapshot } from './types.js';

/** 1 本の読み出しの結末。 */
export interface SideRead<T> {
  /** その版にファイルがあったか。 */
  readonly present: boolean;
  /** 読めた値(読めなかった・無かったなら undefined)。 */
  readonly value: T | undefined;
  /** 読めなかった理由(読めたなら null)。 */
  readonly problem: DiffProblem | null;
}

/** 版の写しの 1 行(無い = null、未取得 = undefined)。 */
function contentOf(snapshot: SideSnapshot, path: string): string | null | undefined {
  return snapshot.get(path);
}

/**
 * 宣言が無かったのか、読めなかったのかを分ける。
 *
 * **どちらも黙らせない**が、赤にするのは後者だけである —— 生成物の export は版ごとに
 * 増えるので、古い版と比べるたびに「宣言が無い」が湧く。それを赤にすると、過去と比べる
 * 実行が常に落ちる。逆にどちらも黙らせると、export の改名で軸が 1 本死んでも気づけない。
 */
function declarationGap<T>(
  read: { readonly reason: string; readonly missing?: boolean },
  side: DiffProblem['side'],
  path: string,
): SideRead<T> {
  const kind = read.missing === true ? 'undeclared' : 'unreadable';
  return { present: true, value: undefined, problem: { kind, side, path, reason: read.reason } };
}

/** 「無かった」ことを表す結末。 */
function absent<T>(): SideRead<T> {
  return { present: false, value: undefined, problem: null };
}

/**
 * 生成 TS の `export const {name}` を素のデータとして読む。
 *
 * @param snapshot 版の写し
 * @param side どちらの版か(理由の文面に使う)
 * @param path リポジトリルート相対のパス
 * @param name export の名前
 * @returns 読み出しの結末
 */
export function readExport(
  snapshot: SideSnapshot,
  side: DiffProblem['side'],
  path: string,
  name: string,
): SideRead<PlainValue> {
  const content = contentOf(snapshot, path);
  if (content === null || content === undefined) return absent();
  const read = readExportedValue(content, name);
  if (read.ok) return { present: true, value: read.value, problem: null };
  return declarationGap(read, side, path);
}

/**
 * 結果表の元データ(JSON)を読む。
 *
 * @param snapshot 版の写し
 * @param side どちらの版か
 * @param path リポジトリルート相対のパス
 * @returns 読み出しの結末
 */
export function readJson(snapshot: SideSnapshot, side: DiffProblem['side'], path: string): SideRead<PlainValue> {
  const content = contentOf(snapshot, path);
  if (content === null || content === undefined) return absent();
  const read = readPlainValue(content);
  if (read.ok) return { present: true, value: read.value, problem: null };
  return { present: true, value: undefined, problem: { kind: 'unreadable', side, path, reason: read.reason } };
}

/**
 * 素のデータではない生成物から、第 1 階層の鍵だけを読む(実行計画)。
 *
 * @param snapshot 版の写し
 * @param side どちらの版か
 * @param path リポジトリルート相対のパス
 * @param name export の名前
 * @returns 読み出しの結末
 */
export function readKeys(
  snapshot: SideSnapshot,
  side: DiffProblem['side'],
  path: string,
  name: string,
): SideRead<readonly string[]> {
  const content = contentOf(snapshot, path);
  if (content === null || content === undefined) return absent();
  const read = topLevelKeys(content, name);
  if (read.ok) return { present: true, value: read.value, problem: null };
  return declarationGap(read, side, path);
}

/** 版の写しの中から、接尾辞に合うパスを名前順に並べる。 */
export function pathsWith(snapshot: SideSnapshot, matches: (path: string) => boolean): readonly string[] {
  return [...snapshot.keys()].filter((path) => matches(path) && snapshot.get(path) !== null).sort();
}

/** 両版に現れるパスの合併(片側にしか無いものも含む)。 */
export function unionPaths(
  base: SideSnapshot,
  head: SideSnapshot,
  matches: (path: string) => boolean,
): readonly string[] {
  return [...new Set([...pathsWith(base, matches), ...pathsWith(head, matches)])].sort();
}

/**
 * どれかが**読めなかった**か(その軸は差分を計算してはいけない)。
 *
 * **その版にファイルが無いのは「読めなかった」ではない** —— 生成物が生まれる前の版であり、
 * 全部が「増えた」側になるのが正しい姿である。壊れて読めなかったときだけ true になる。
 * ここで差分を計算すると、読めた側の中身がまるごと「増えた」に化けて**偽の 🔓** が並ぶ。
 *
 * @param reads 片側ずつの読み出しの結末
 * @returns 1 つでも読めていなければ true
 */
export function unreadable(...reads: readonly SideRead<unknown>[]): boolean {
  return reads.some((read) => read.problem !== null && read.problem.kind === 'unreadable');
}

/** 読めなかった理由を 1 本にまとめる(null は落とす)。 */
export function problemsOf(...reads: readonly SideRead<unknown>[]): readonly DiffProblem[] {
  return reads.map((read) => read.problem).filter((problem): problem is DiffProblem => problem !== null);
}
