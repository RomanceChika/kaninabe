/**
 * 仕組みの根の見張りテストを走査して `FrameworkScan` を構築するローダー。
 *
 * 製品の木の走査(`scan.ts`)とは**独立に**行う —— 製品の実装の木が無い(仕様だけの製品・配布の木)ときも、
 * 仕組み自身の見張りテストは同じ場所に在る。走査の母集合は `FRAMEWORK_TEST_ROOTS`(実行時パッケージのソース全体と、
 * 検証器・生成器の木の `__tests__/guarantees`)で、ハーネスの assert を含むヘルパ(`framework/runtime/testing`)も
 * 注釈の中身の検査(Z3 が使う A16 と同じ判定)の出どころとして集める。
 *
 * 呼び手が根を渡さなければ `not_requested`(単体テスト用。CLI は必ず渡す)。根が在るのに置き場が 1 つも無い・読めない
 * ファイルがあるときは `blocked`(検査は error で言う。空の走査で緑にならない)。パスは**仕組みの根からの相対**。
 */

import { join } from 'node:path';
import type { Finding } from '../kernel/finding.js';
import { FRAMEWORK_TEST_ROOTS } from '../io/framework-paths.js';
import { isDirectory, walkFiles } from '../io/paths.js';
import type { FrameworkScan } from '../testcase/index.js';
import { notRequestedFrameworkScan } from '../testcase/index.js';
import { collectHarnessHelpers, collectTestFile, isTestFile, newSink } from './scan-collect.js';

/** `scanFrameworkTests` の結果。 */
export interface FrameworkScanResult {
  readonly scan: FrameworkScan;
  /** 走査中に検出した読み取り失敗。 */
  readonly findings: Finding[];
}

/** 根を渡さなかったときの未実施の理由(Z3 の行に出る)。 */
export const FRAMEWORK_NOT_REQUESTED_REASON = '仕組みの根が渡されていません';

/**
 * 仕組みの根の見張りテストを走査して注釈を集める。
 *
 * @param frameworkRoot 仕組みの根の絶対パス。省略は呼び手が根を渡さなかったことを表す(`not_requested`)
 * @returns 走査結果と読み取り失敗のリスト
 */
export function scanFrameworkTests(frameworkRoot: string | undefined): FrameworkScanResult {
  if (frameworkRoot === undefined) {
    return { scan: notRequestedFrameworkScan(FRAMEWORK_NOT_REQUESTED_REASON), findings: [] };
  }
  const roots = FRAMEWORK_TEST_ROOTS.map((relative) => join(frameworkRoot, relative)).filter(isDirectory);
  if (roots.length === 0) {
    return {
      scan: {
        state: { state: 'blocked', reason: `仕組みの根の下にテストの置き場が 1 つもありません(${FRAMEWORK_TEST_ROOTS.join(' / ')})` },
        testFiles: [],
        annotations: [],
      },
      findings: [],
    };
  }

  const findings: Finding[] = [];
  const sink = newSink();
  for (const root of roots) {
    for (const absolute of walkFiles(root, isTestFile)) collectTestFile(absolute, frameworkRoot, sink, findings);
  }
  collectHarnessHelpers(frameworkRoot, sink.assertionHelpers, findings);

  const unreadable = findings.length;
  return {
    scan: {
      state: stateOf(sink.testFiles.length, unreadable),
      testFiles: sink.testFiles,
      annotations: sink.annotations,
      halfTags: sink.halfTags,
      eachTags: sink.eachTags,
      testBlocks: sink.testBlocks,
      assertionHelpers: [...sink.assertionHelpers],
    },
    findings,
  };
}

/** 走査の状態。テストファイルが 1 本も無い走査は、空の走査で緑にならないよう阻害として言う。 */
function stateOf(testFileCount: number, unreadable: number): FrameworkScan['state'] {
  if (testFileCount === 0) return { state: 'blocked', reason: '仕組みの根の下にテストファイルが 1 本も見つかりません' };
  if (unreadable > 0) return { state: 'blocked', reason: `読めないテストファイルが ${unreadable} 件あります` };
  return { state: 'scanned' };
}
