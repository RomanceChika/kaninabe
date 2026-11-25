/**
 * 「assertion が 0 の it は実行時に赤」が題材の木の設定で効くことの観測(fix27 A2)。
 *
 * 生成器は見るものの無い試験を出さない(出す試験には落ちうる assertion が 1 つ以上ある)。その決まりの実行時の側の網は vitest の `expect.requireAssertions` で、
 * 題材の木の設定(`db-places.ts` の `REQUIRE_ASSERTIONS_LINE` を共有)が持つ。ここは assertion を 1 つも持たない it を題材の木に 1 本置き、
 * 配線の段と同じ設定で実行して、赤になった it の数を返す(設定が assertion の無い it を通していれば 0 — 表の `guard:require-assertions` の行が赤にする)。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProductRoots } from '../../../model/product/types.js';
import { includeVitestConfig } from './db-parity-tree.js';
import { runGeneratedTests } from './db-tests.js';
import { sampleAppRoot } from './db-tree.js';

/** 置く試験(題材の実装の木の根からの相対)。 */
const PROBE_FILE = '__samples_probe__/no-assertion.test.ts';

/** vitest の JSON の報告のうち読む欄。 */
interface ProbeReport {
  readonly testResults?: readonly { readonly assertionResults: readonly { readonly status: string }[] }[];
}

/**
 * assertion を 1 つも持たない it を題材の木の設定で実行し、赤になった it の数を返す。
 *
 * @param args 一時ツリー・リポジトリルート・その題材が宣言した根
 * @returns 赤になった it の数(効いていれば 1)
 */
export function probeNoAssertion(args: { readonly tree: string; readonly repoRoot: string; readonly roots: ProductRoots }): number {
  const app = sampleAppRoot(args.roots);
  const file = path.join(args.tree, app, PROBE_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, ["import { it } from 'vitest';", '', "it('assertion を 1 つも持たない', () => {});", ''].join('\n'));
  const configFile = path.join(args.tree, app, 'vitest.samples-probe.mts');
  writeFileSync(configFile, includeVitestConfig([PROBE_FILE]).join('\n'));
  const reportFile = path.join(args.tree, 'samples-probe.json');
  runGeneratedTests({ configFile, root: path.join(args.tree, app), repoRoot: args.repoRoot, stack: null, roots: args.roots, reportFile });
  if (!existsSync(reportFile)) return 0;
  const report = JSON.parse(readFileSync(reportFile, 'utf-8')) as ProbeReport;
  return (report.testResults ?? []).flatMap((result) => result.assertionResults).filter((assertion) => assertion.status === 'failed').length;
}
