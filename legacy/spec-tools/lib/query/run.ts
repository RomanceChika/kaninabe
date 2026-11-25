/**
 * 読み取りクエリ仕様の検証(Q0 + Q1〜Q7)の実行口。
 *
 * app/ の走査結果は A 群の実行口(lib/trace/run.ts)がすでに持っているため、ここでは
 * 走査済みの結果を受け取るだけにする(同じディレクトリを二度歩かない)。
 * CLI はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。
 */

import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { TestScanResult, TcRegistry } from '../testcase/types.js';
import type { QueryContext } from './verifier.js';
import type { QueryInput, QuerySpecModel } from '../model/query/types.js';
import { ALL_QUERY_VERIFIERS } from './verifiers/index.js';

/** runQueryVerification の入力。 */
export interface QueryRunOptions {
  /** 構築済みのドメイン仕様モデル(Q1〜Q5 の突合先)。 */
  readonly domain: SpecModel;
  /** 読み込み済みの query_spec。`available: false` なら検証しない。 */
  readonly queries: QuerySpecModel;
  /** app/ の走査結果(Q6 が使う)。 */
  readonly tests: TestScanResult;
  /**
   * 全仕様種のテストケース ID 台帳(Q6 が query_spec のエントリを引く)。
   * 台帳は CLI が 1 回だけ構築したものをそのまま受け取る(群ごとに作り直さない)。
   */
  readonly registry: TcRegistry;
  /** ガード式の共有サービス(Q4 が使う)。 */
  readonly context: QueryContext;
}

/** runQueryVerification の結果。 */
export interface QueryRunResult {
  readonly findings: Finding[];
  /** specs/backend/queries を読めたか。false なら Q1〜Q7 は実行していない。 */
  readonly available: boolean;
  /** 読み込めた query_spec の数(CLI のサマリ表示用)。 */
  readonly queryCount: number;
}

/**
 * 読み取りクエリ仕様の検証を実行する。
 *
 * query_spec が 1 件も無い(ディレクトリごと無い)環境でも壊れない。その場合
 * `available: false` を返し、検証は行わない。
 *
 * @param options ドメインモデル・query_spec・走査結果・共有サービス
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runQueryVerification(options: QueryRunOptions): QueryRunResult {
  const queries = options.queries;
  if (!queries.available) return { findings: [], available: false, queryCount: 0 };

  const input: QueryInput = {
    domain: options.domain,
    queries,
    tests: options.tests,
    registry: options.registry,
  };
  const findings: Finding[] = [];
  for (const verifier of ALL_QUERY_VERIFIERS) {
    findings.push(...verifier.verify(input, options.context));
  }
  return { findings, available: true, queryCount: queries.queries.length };
}
