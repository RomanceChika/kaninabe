/**
 * ユースケース仕様の検証(Y0 + Y 群)の実行口。
 *
 * ローダー(Y0)が構築したモデルを検証器(Y 群)に流すところまでをまとめる。
 * 配線(lib/compose/verify-pipeline.ts)はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。チェック内容の正は usecase-spec-writing.md。
 */

import type { Finding } from '../kernel/finding.js';
import type { UsecaseContext } from './verifier.js';
import type { UsecaseInput } from './derive.js';
import { ALL_USECASE_VERIFIERS } from './verifiers/index.js';

/** 登録済みの検査器 ID(実行ログの範囲表記の母集合)。手書きの `Y1〜Y11` は腐る。 */
const USECASE_VERIFIER_IDS: readonly string[] = ALL_USECASE_VERIFIERS.map((verifier) => verifier.id);

/** runUsecaseVerification の結果。 */
export interface UsecaseRunResult {
  readonly findings: Finding[];
  /** specs/frontend/usecases を読めたか。false なら Y 群は実行していない。 */
  readonly available: boolean;
  /** 読み込めた usecase_spec の数(CLI のサマリ表示用)。 */
  readonly usecaseCount: number;
  /** 実行した検査器の ID(登録配列そのまま。実行ログの範囲表記をここから導く)。 */
  readonly verifierIds: readonly string[];
}

/**
 * ユースケース仕様の検証を実行する。
 *
 * usecase_spec が 1 件も無い(ディレクトリごと無い)環境でも壊れない。その場合
 * `available: false` を返し、検証は行わない。
 *
 * @param input ドメイン・action_spec・screen_spec・auth_spec・usecase_spec のモデル
 * @param ctx ガード式の共有サービス
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runUsecaseVerification(input: UsecaseInput, ctx: UsecaseContext): UsecaseRunResult {
  if (!input.usecases.available) {
    return { findings: [], available: false, usecaseCount: 0, verifierIds: USECASE_VERIFIER_IDS };
  }

  const findings: Finding[] = [];
  for (const verifier of ALL_USECASE_VERIFIERS) findings.push(...verifier.verify(input, ctx));
  return {
    findings,
    available: true,
    usecaseCount: input.usecases.usecases.length,
    verifierIds: USECASE_VERIFIER_IDS,
  };
}
