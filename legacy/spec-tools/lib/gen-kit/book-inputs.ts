/**
 * ハンドブックが「実装の実物」を写すための入力の型と、その純粋なパース関数。
 *
 * ハンドブックの一部(パーツ見本の CSS・画面カードの SSR プレビュー)は仕様ではなく
 * **実装そのもの**が正である。生成器は I/O をしない規約(scripts-code-quality.md)のため、
 * 読むのは CLI の仕事で、ここには「読んだ後の形」と「文字列 → 形」の変換だけを置く
 * (loader と同じ分担)。入力の**型**(`BookInputs` / `StateGap`)は `GenerateContext` が持つので
 * 同じ道具箱の `book-inputs-types.ts` にあり、ここは型を再輸出する。
 */

import type { BookInputs, StateGap } from './book-inputs-types.js';

export type { BookInputs, StateGap };

/** `statePreviews` のキー(`{画面名}.{状態}`)を組み立てる。 */
export function stateKeyOf(screen: string, state: string): string {
  return `${screen}.${state}`;
}

/**
 * 断片ファイル(`docs/book/assets/previews/{画面名}.html`)の中身からマークアップを取り出す。
 *
 * 先頭行は手編集を止める注意書き(`<!-- AUTO-GENERATED … -->`)なので落とす。
 * 注意書きが無いファイルも受ける — 落とすのは「先頭行がコメントなら」に限る。
 *
 * @param content ファイルの中身
 * @returns マークアップ(前後の空白を落とした 1 行)
 */
export function parsePreviewFile(content: string): string {
  const lines = content.split('\n');
  const body = lines[0]?.startsWith('<!--') === true ? lines.slice(1) : lines;
  return body.join('\n').trim();
}

/**
 * 断片ファイルの名前から画面名を読む。
 *
 * @param file ファイル名(パスを含まない)
 * @returns 画面名。`{画面名}.html` の形でなければ null
 */
export function previewScreenOf(file: string): string | null {
  const match = /^([a-z0-9_]+)\.html$/.exec(file);
  return match?.[1] ?? null;
}

/**
 * 状態別断片のファイル名から画面名と状態を読む。
 *
 * `previewScreenOf` と違い `.` を 2 つ持つ(`{画面名}.{状態}.html`)ので正規表現で分ける。
 *
 * @param file ファイル名(パスを含まない)
 * @returns 画面名と状態。この形でなければ null(`{画面名}.html` にはマッチしない)
 */
export function previewStateOf(file: string): { readonly screen: string; readonly state: string } | null {
  const match = /^([a-z0-9_]+)\.([a-z_]+)\.html$/.exec(file);
  if (match === null) return null;
  const [, screen, state] = match;
  if (screen === undefined || state === undefined) return null;
  return { screen, state };
}
