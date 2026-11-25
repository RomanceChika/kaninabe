/**
 * フロントマターの参照キー(norms / decisions)から参照先 ID を取り出す純粋関数。
 *
 * M3(参照実在)と M6(循環参照)が同じ「参照とは何か」の定義を共有するために切り出してある。
 * 検証器同士は依存させない(規約: scripts-code-quality.md)ので、共通の定義はここに置く。
 *
 * 対象キーの正: reference_policy.md / frontmatter_policy.md「参照・依存関係系」。
 * `definitions` と `dependencies` は形式(文字列 / 詳細形式)がまだ揺れているため、
 * この 2 つが安定するまでは対象外とする。
 */

import type { ScannedDoc } from '../model/docs/types.js';

/** 参照 1 件。 */
export interface DocReference {
  /** フロントマターのキー("norms" または "decisions")。 */
  readonly key: string;
  /** 参照先の文書 ID。 */
  readonly id: string;
}

/** ID 参照として検査するフロントマターのキー。 */
export const REFERENCE_KEYS: readonly string[] = ['norms', 'decisions'];

/**
 * 文書のフロントマターから参照先 ID を列挙する。
 *
 * @param doc 対象の文書
 * @returns 参照の一覧(キーの順・記述順)。文字列でない要素は無視する
 */
export function referencesOf(doc: ScannedDoc): DocReference[] {
  const refs: DocReference[] = [];
  for (const key of REFERENCE_KEYS) {
    const value = doc.frontmatter[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim() !== '') {
        refs.push({ key, id: entry.trim() });
      }
    }
  }
  return refs;
}
