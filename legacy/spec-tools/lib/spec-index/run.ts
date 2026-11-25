/**
 * 台帳検査(A9)の実行口。
 *
 * 台帳は CLI が全仕様種を読み込んだあとに 1 回だけ構築し、この実行口・A 群・Q 群へ配る。
 * ここは仕様種の有無で分岐しない — 台帳さえあれば実行できる検査だけを集めた群だからである。
 */

import type { Finding } from '../kernel/finding.js';
import type { TcRegistry } from '../testcase/types.js';
import { ALL_SPEC_INDEX_VERIFIERS } from './verifiers/index.js';

/**
 * 台帳検査を実行する。
 *
 * @param registry 構築済みのテストケース ID 台帳
 * @returns 全 Finding(違反ゼロなら空)
 */
export function runSpecIndexVerification(registry: TcRegistry): Finding[] {
  return ALL_SPEC_INDEX_VERIFIERS.flatMap((verifier) => verifier.verify(registry));
}
