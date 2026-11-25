/**
 * クエリ検証器レジストリ。
 *
 * 新しい検証器の追加は「QueryVerifier 実装モジュールを作り、ここに 1 行足す」だけで完了し、
 * CLI 側の変更を伴わない(scripts-code-quality.md の設計規約)。
 * Q0(query_spec のスキーマ適合)はモデル構築と不可分なため lib/model/query/loader.ts 内で
 * 実施され、この一覧には現れない(V1 / A0 と同じ扱い)。
 */

import type { QueryVerifier } from '../verifier.js';
import { fieldExistenceVerifier } from './q1-field-existence.js';
import { scopeConsistencyVerifier } from './q2-scope-consistency.js';
import { hiddenProjectionVerifier } from './q3-hidden-projection.js';
import { filterSyntaxVerifier } from './q4-filter-syntax.js';
import { includeResolutionVerifier } from './q5-include-resolution.js';
import { queryTestTraceVerifier } from './q6-test-trace.js';
import { uniquenessVerifier } from './q7-uniqueness.js';
import { boundedByVerifier } from './q8-bounded-by.js';

/** 実行順は ID 順。検証器同士は独立で、順序に意味はない(規約)。 */
export const ALL_QUERY_VERIFIERS: readonly QueryVerifier[] = [
  fieldExistenceVerifier,
  scopeConsistencyVerifier,
  hiddenProjectionVerifier,
  filterSyntaxVerifier,
  includeResolutionVerifier,
  queryTestTraceVerifier,
  uniquenessVerifier,
  boundedByVerifier,
];
