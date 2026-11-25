/**
 * 文書整合検証器レジストリ。
 *
 * 新しい検証器の追加は「DocVerifier 実装モジュールを作り、ここに 1 行足す」だけで完了し、
 * CLI 側の変更を伴わない(scripts-code-quality.md の設計規約)。
 * フロントマターが読めない・存在しない場合の指摘はモデル構築と不可分なため
 * lib/model/docs/loader.ts 内で M1 として積まれ、この一覧には現れない(V1・A0 と同じ扱い)。
 */

import type { DocVerifier } from '../verifier.js';
import { frontmatterRequiredVerifier } from './m1-frontmatter-required.js';
import { idConsistencyVerifier } from './m2-id-consistency.js';
import { referenceExistenceVerifier } from './m3-reference-existence.js';
import { markdownLinkVerifier } from './m4-markdown-link.js';
import { templateH2Verifier } from './m5-template-h2.js';
import { circularReferenceVerifier } from './m6-circular-reference.js';

/** 実行順は ID 順。検証器同士は独立で、順序に意味はない(規約)。 */
export const ALL_DOC_VERIFIERS: readonly DocVerifier[] = [
  frontmatterRequiredVerifier,
  idConsistencyVerifier,
  referenceExistenceVerifier,
  markdownLinkVerifier,
  templateH2Verifier,
  circularReferenceVerifier,
];
