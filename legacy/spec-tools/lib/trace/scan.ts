/**
 * app/ を走査して TestScanResult を構築するローダー(製品の木の走査)と、仕組みの根の走査をつなぐ入口。
 *
 * 走査は 2 つに分かれる。製品の実装の木は `scanProductTests`(ここ)、仕組みの見張りテストは `scanFrameworkTests`
 * (`scan-framework.ts`)で、`scanAppTests` が両方を呼んで入れ子にまとめる。**早期 return(実装の木が無い)は製品の部分だけ**
 * を止め、仕組みの走査は製品の木に依らず行う。仕組みの見張りテストは仕組みの走査だけが読む(製品の走査は読まない)。
 *
 * 製品の走査が集めるのは 4 つ。
 * 1. `app/src/**\/*.test.ts(x)` のテストファイルと、その中の `@spec` / `@tc` アノテーション。実行時パッケージ(`@kaninabe/runtime`)と
 *    検証器・生成器の木の見張りテストの置き場は、仕組みの走査(`scan-framework.ts`)の母集合であり、ここには入れない。
 * 2. `app/e2e/*.spec.mts`(E2E スモーク。1 段のみ・サブディレクトリは無い)の同様のアノテーション
 *    (2026-09-04 拡張。BACKLOG「E2E 注釈の受け皿」— screen_spec の `smoke:` と S8/S11 の突合先)。
 * 3. Server Action の実装ファイル(A2 の配置チェック用)。走査の根は配置の役割 `operation-entry` の逆引きが決める
 *    (いまの Next.js の配置では `app/src/app/_actions/**\/*.ts`)。
 * 4. operation の実装ファイル(A10 の走査モジュールの実在チェック用)と、そこに手書きされた `guardEnv` の鍵
 *    (A14 が実行計画の導出と突き合わせる材料)。走査の根は配置の役割 `operation-logic` の逆引きが決める
 *    (いまの Next.js の配置では `app/src/operation/**\/*.ts`)。
 *
 * **走査の根(実装のソースの根・Server Action・operation)は置き場の配置から引く**(部品化 ③-c4b。以前はここが `src/app/_actions` ・`src/operation` の綴りを直書きしていた)。
 * E2E スモークの置き場も配置の役割 `e2e-root` が決める(部品化 ③-c6。同じ置き場を読む `generality/scan.ts` ・`model/screen/parse-screen-smoke.ts` ・`config/env-scan.ts` も同じ口を通る)。
 *
 * 検証器はファイル I/O をしないため「実在するか」の判断材料もここで集めて渡す
 * (規約: scripts-code-quality.md)。アノテーションの抽出そのものは
 * extract-annotations.ts の純粋関数が行う(`@spec` / `@tc` の書式は `*.test.ts(x)` と共通)。
 */

import { join } from 'node:path';
import type { Finding } from '../kernel/finding.js';
import type { GuardEnvRef, TestScanResult } from '../testcase/types.js';
import type { ScanWithFramework } from '../testcase/index.js';
import { collectAssertionHelpers } from '../model/trace/extract-assertions.js';
import { extractGuardEnv } from './extract-guard-env.js';
import { isDirectory, toRelative, walkFiles } from '../io/paths.js';
import { e2eRootPath, layoutScan, sourceRootPath } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import {
  SUPPORT_DIR_MARK,
  collectHarnessHelpers,
  collectTestFile,
  isE2ESpecFile,
  isImplementationFile,
  isSupportCandidate,
  isTestFile,
  newSink,
  readOrReport,
} from './scan-collect.js';
import { scanFrameworkTests } from './scan-framework.js';

/** スキャナの設定。 */
export interface ScanOptions {
  /**
   * 結果のパスの基準にするリポジトリルート(**必須**)。以前は省略すると実装の木から上へ製品の根の宣言を探した
   * (`appRoot` が無いと作業ディレクトリに依る読みになる。scripts-code-quality.md §根は製品が宣言する)ので、呼び手が決めて渡す。
   */
  readonly repoRoot: string;
  /**
   * 仕組みの根の絶対パス(仕組み自身の見張りテストと保証台帳の置き場)。**省略は「渡していない」**(`framework.state` が
   * `not_requested`。検査は未実施と名指しする)。CLI は必ず渡す。
   *
   * 渡したとき、仕組みの見張りテストは仕組みの走査(`framework`)の持ち物になり、製品の走査(`available` 以下)には入らない。
   * 渡さないあいだ(移行中)は、従来どおり製品の走査がそれらも読む —— 製品の台帳が仕組みの見張りテストを宣言している間の互換である。
   */
  readonly frameworkRoot?: string;
}

/** scanAppTests の結果。 */
export interface ScanResult {
  readonly scan: ScanWithFramework;
  /** 走査中に検出した読み取り失敗。app/ が無いだけなら空(available=false で表す)。 */
  readonly findings: Finding[];
}

/** scanProductTests の結果。 */
export interface ProductScanResult {
  readonly scan: TestScanResult;
  readonly findings: Finding[];
}

/**
 * 製品の木と仕組みの根を走査して、テストアノテーションと Server Action 実装ファイルを集める。
 *
 * 2 つの走査は**独立**である(製品の木が無くても仕組みの走査は行う。逆も同じ)。`available` は製品の実装の木を走査できたかだけを
 * 意味し、仕組みの走査の結果は `framework` に入れ子で添える。
 *
 * @param appRoot app ディレクトリの絶対パス。実装の木を宣言していなければ null
 * @param layout 置き場の配置(アプリの枠の後段が与える。実装のソースの根・Server Action・operation の走査の根を引く)
 * @param options リポジトリルート(必須)と仕組みの根(任意)
 * @returns 走査結果と読み取り失敗のリスト
 */
export function scanAppTests(appRoot: string | null, layout: ProductLayout, options: ScanOptions): ScanResult {
  const product = scanProductTests(appRoot, layout, options);
  const framework = scanFrameworkTests(options.frameworkRoot);
  return {
    scan: { ...product.scan, framework: framework.scan },
    findings: [...product.findings, ...framework.findings],
  };
}

/**
 * 製品の実装の木を走査する。
 *
 * app/ が無い環境(仕様だけを持つリポジトリ)では `available: false` を返し、
 * 呼び出し側(CLI)がトレース検証のスキップを判断する。**この早期 return は製品の部分だけ**を止める。
 *
 * @param appRoot app ディレクトリの絶対パス。実装の木を宣言していなければ null
 * @param layout 置き場の配置
 * @param options リポジトリルート(必須)と仕組みの根(任意。渡すと仕組みの見張りテストはここでは読まない)
 * @returns 走査結果と読み取り失敗のリスト
 */
export function scanProductTests(appRoot: string | null, layout: ProductLayout, options: ScanOptions): ProductScanResult {
  // **実装の木を宣言していない製品では走査そのものを行わない。** 空文字に倒すと
  // `join('', 'src')` が相対パス `src` になり、プロセスの cwd に依存する読みが入る
  // (scripts-code-quality.md §根は製品が宣言する)。
  const tree = appRoot;
  // 実装のソースの根・Server Action・operation の走査の根は、置き場の配置が決める(製品の根からの相対 `''` で引き、実装の木の絶対パスに接ぐ)。
  const sourceRel = sourceRootPath(layout, { app: '' });
  const srcDir = tree === null || sourceRel === null ? null : join(tree, sourceRel);
  const { repoRoot } = options;
  if (tree === null || srcDir === null || !isDirectory(srcDir)) {
    return {
      scan: {
        available: false,
        testFiles: [],
        annotations: [],
        halfTags: [],
        eachTags: [],
        actionFiles: [],
        operationFiles: [],
        testBlocks: [],
        assertionHelpers: [],
      },
      findings: [],
    };
  }

  const findings: Finding[] = [];
  const sink = newSink();

  // 製品の実装の木だけを読む。実行時パッケージと見張りテストの置き場は仕組みの走査(`scan-framework.ts`)の母集合である。
  for (const absolute of walkFiles(srcDir, isTestFile)) collectTestFile(absolute, repoRoot, sink, findings);

  // E2E スモークの置き場は配置の役割 `e2e-root` が決める(製品の根からの相対 `''` で引き、実装の木の絶対パスに接ぐ)。
  const e2eRel = e2eRootPath(layout, { app: '' });
  for (const absolute of e2eRel === null ? [] : walkFiles(join(tree, e2eRel), isE2ESpecFile)) {
    collectTestFile(absolute, repoRoot, sink, findings);
  }

  // テスト支援コード(`__tests__` 配下でテスト本体ではないファイル)も assert を含むヘルパの
  // 出どころである。注釈付きブロックがそれを呼んでいれば assert はある(A16 の許容)。
  for (const absolute of walkFiles(srcDir, isSupportCandidate)) {
    if (!absolute.includes(`${SUPPORT_DIR_MARK}`) || isTestFile(absolute)) continue;
    const source = readOrReport(absolute, toRelative(repoRoot, absolute), findings);
    if (source === null) continue;
    for (const name of collectAssertionHelpers(source)) sink.assertionHelpers.add(name);
  }

  // 実行時パッケージのテスト基盤(ハーネス)も同じ出どころである(製品側のアダプタは口を渡すだけで assert を持たない)。
  // ハーネスは仕組みの根の持ち物なので、仕組みの根を渡したときだけ読む(渡さなければ、ヘルパを借りる注釈の中身は読めない)。
  if (options.frameworkRoot !== undefined) collectHarnessHelpers(options.frameworkRoot, sink.assertionHelpers, findings);

  const actionsRel = layoutScan(layout, '', 'operation-entry')?.dir;
  const actionFiles = (actionsRel === undefined ? [] : walkFiles(join(tree, actionsRel), isImplementationFile)).map((absolute) =>
    toRelative(repoRoot, absolute),
  );
  const operationRel = layoutScan(layout, '', 'operation-logic')?.dir;
  const operationAbsolute = operationRel === undefined ? [] : walkFiles(join(tree, operationRel), isImplementationFile);
  const operationFiles = operationAbsolute.map((absolute) => toRelative(repoRoot, absolute));
  const guardEnvs: GuardEnvRef[] = [];
  for (const absolute of operationAbsolute) {
    const file = toRelative(repoRoot, absolute);
    const source = readOrReport(absolute, file, findings);
    if (source === null) continue;
    const extracted = extractGuardEnv(source);
    if (extracted !== null) guardEnvs.push({ file, keys: extracted.keys, unreadable: extracted.unreadable });
  }

  return {
    scan: {
      available: true,
      testFiles: sink.testFiles,
      annotations: sink.annotations,
      halfTags: sink.halfTags,
      eachTags: sink.eachTags,
      actionFiles,
      operationFiles,
      guardEnvs,
      testBlocks: sink.testBlocks,
      assertionHelpers: [...sink.assertionHelpers],
    },
    findings,
  };
}
