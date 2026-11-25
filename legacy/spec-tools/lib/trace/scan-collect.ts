/**
 * 走査の共通部(テスト 1 ファイルから注釈・片方だけの注釈・ブロックの事実・ヘルパ名を集める道具)。
 *
 * 製品の木の走査(`scan.ts`)と仕組みの根の走査(`scan-framework.ts`)が同じ道具を読む。違いは**どの根を見るか**だけで、
 * 注釈の書式・ブロックの切り出し・ヘルパの見つけ方は 2 つの走査で完全に同じでなければならない(A16 と Z3 が同じ判定を下すため)。
 *
 * 検証器はファイル I/O をしないため「実在するか」の判断材料もここで集めて渡す(規約: scripts-code-quality.md)。
 */

import { join } from 'node:path';
import type { Finding } from '../kernel/finding.js';
import type { EachTagRef, HalfTagRef, TestAnnotation, TestBlockRef } from '../testcase/types.js';
import { extractAnnotations } from './extract-annotations.js';
import { collectAssertionHelpers, extractTestBlocks } from '../model/trace/extract-assertions.js';
import { FRAMEWORK_RUNTIME_DIR, toRelative, walkFiles } from '../io/paths.js';
import { readText } from '../io/read-text.js';

/** 走査で積む Finding の検証器 ID(読み取り失敗の報告にだけ使う)。 */
export const SCAN_VERIFIER_ID = 'A0';

/**
 * 実行時パッケージのテスト基盤(ハーネス)の置き場。
 *
 * 束 ①-d 手 1 でハーネス本体がここへ移り、**assert を含むヘルパもここに住む** ——
 * 製品側に残るのは口を渡すアダプタだけなので、ここを見ないと A16 が「生成テストは何も
 * 確かめていない」と言う(実測: 移した直後に error 130 件)。**根で指す**(列挙しない)。
 */
const RUNTIME_TESTING_DIR = 'testing';

/** テスト支援コードの置き場の目印(パスに含まれる)。 */
export const SUPPORT_DIR_MARK = `${'__tests__'}/`;

/** テスト 1 ファイルから集めるものの入れ物(走査の共通部)。 */
export interface TestFileSink {
  readonly testFiles: string[];
  readonly annotations: TestAnnotation[];
  readonly halfTags: HalfTagRef[];
  readonly eachTags: EachTagRef[];
  readonly testBlocks: TestBlockRef[];
  readonly assertionHelpers: Set<string>;
}

/** 空の入れ物を作る。 */
export function newSink(): TestFileSink {
  return {
    testFiles: [],
    annotations: [],
    halfTags: [],
    eachTags: [],
    testBlocks: [],
    assertionHelpers: new Set<string>(),
  };
}

/** 1 ファイルを読んで sink に積む。読めなければ何もしない(Finding は readOrReport が積む)。 */
export function collectTestFile(absolute: string, base: string, sink: TestFileSink, findings: Finding[]): void {
  const file = toRelative(base, absolute);
  sink.testFiles.push(file);
  const source = readOrReport(absolute, file, findings);
  if (source === null) return;
  const extracted = extractAnnotations(source, file);
  sink.annotations.push(...extracted.annotations);
  sink.halfTags.push(...extracted.halfTags);
  sink.eachTags.push(...extracted.eachTags);
  // 全数ループのブロックも A16 の母集合に入れる(**ひな形を書いた分だけ中身の検査が
  // 外れる**形にしない)。ID の代わりにひな形を示すのは、展開前のこの段では台帳を
  // 読んでいないからである —— A16 の指摘は「どのループか」が読めれば足りる。
  const tags = [
    ...extracted.annotations,
    ...extracted.eachTags.map((each) => ({ tcId: each.template, line: each.line })),
  ];
  for (const facts of extractTestBlocks(source, tags)) {
    sink.testBlocks.push({ file, ...facts });
  }
  for (const name of collectAssertionHelpers(source)) sink.assertionHelpers.add(name);
}

/**
 * 実行時パッケージのテスト基盤(ハーネス)から、assert を含むヘルパの名前を集める(ADR-0013・束 ①-d 手 1)。
 *
 * 製品側のアダプタは口を渡すだけで assert を持たないので、ここを見ないと注釈の中身が読めなくなる。
 * **`__tests__` の印は要らない** —— この木は全体がテスト基盤である。
 *
 * @param base ハーネスを持つ根(開発用の木では製品のリポジトリルートと同じ)
 * @param helpers 名前の入れ物
 * @param findings 読み取り失敗の積み先
 */
export function collectHarnessHelpers(base: string, helpers: Set<string>, findings: Finding[]): void {
  const runtimeTesting = join(base, FRAMEWORK_RUNTIME_DIR, RUNTIME_TESTING_DIR);
  for (const absolute of walkFiles(runtimeTesting, isHarnessCandidate)) {
    if (isTestFile(absolute)) continue;
    const source = readOrReport(absolute, toRelative(base, absolute), findings);
    if (source === null) continue;
    for (const name of collectAssertionHelpers(source)) helpers.add(name);
  }
}

/** テスト支援コードの候補(拡張子だけの粗い篩。パスの判定は呼び出し側)。 */
export function isSupportCandidate(name: string): boolean {
  return name.endsWith('.ts') || name.endsWith('.tsx');
}

/** 実行時パッケージのテスト基盤の候補(`.mts` で書く木。拡張子だけの粗い篩)。 */
function isHarnessCandidate(name: string): boolean {
  return name.endsWith('.mts') || name.endsWith('.ts');
}

/** vitest のテストファイル(`*.test.ts` / `*.test.tsx`)か。 */
export function isTestFile(name: string): boolean {
  return name.endsWith('.test.ts') || name.endsWith('.test.tsx');
}

/** Playwright の E2E スペックファイル(`*.spec.mts`)か。 */
export function isE2ESpecFile(name: string): boolean {
  return name.endsWith('.spec.mts');
}

/** 実装ファイル(テストは含めない)か。Server Action と operation の両方に使う。 */
export function isImplementationFile(name: string): boolean {
  return name.endsWith('.ts') && !isTestFile(name);
}

/** ファイルを読む。読めない場合は Finding を積んで null。 */
export function readOrReport(absolute: string, file: string, findings: Finding[]): string | null {
  try {
    return readText(absolute);
  } catch (cause) {
    findings.push({
      verifier: SCAN_VERIFIER_ID,
      severity: 'error',
      message: `テストファイルを読み込めません: ${cause instanceof Error ? cause.message : String(cause)}`,
      location: { file },
      suggestion: 'ファイルの権限とパスを確認する',
    });
    return null;
  }
}
