/**
 * 台帳検査レジストリ。
 *
 * 新しい検査の追加は「SpecIndexVerifier 実装モジュールを作り、ここに 1 行足す」だけで完了し、
 * CLI 側の変更を伴わない(scripts-code-quality.md の設計規約)。
 */

import type { SpecIndexVerifier } from '../verifier.js';
import { tcUniquenessVerifier } from './a9-tc-uniqueness.js';

/** 実行順は ID 順。検証器同士は独立で、順序に意味はない(規約)。 */
export const ALL_SPEC_INDEX_VERIFIERS: readonly SpecIndexVerifier[] = [tcUniquenessVerifier];
