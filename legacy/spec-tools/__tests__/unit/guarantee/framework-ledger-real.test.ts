/**
 * 実物の仕組みの保証台帳(`framework/guarantees.md`)と、仕組みの根の見張りテストの注釈の突合(構造テスト)。
 *
 * 開発用の木でも配布の木でも回る(製品の台帳は、その木の製品のもの)。見るのは台帳の約束事 3 つ ——
 *   - 仕組みの台帳の見張りテスト(canary)と、仕組みの根の注釈が過不足なく一致する
 *     (注釈はあるのに台帳に無い・台帳にあるのに注釈が無い、のどちらも無い)
 *   - 製品の台帳が仕組みの予約(`fw_` / `TC-FW-`)を 1 つも使っていない
 *   - 仕組みの台帳の見張りテストは、すべて仕組みの根の置き場の下の実在するテストファイルを指す
 * 最後に、実物の木に Z3 を当てて違反が 0 であることを確かめる(CLI の verify が実行する検査と同じ入力)。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyFrameworkGuarantees } from '../../../lib/guarantee/verifiers/z3-framework-scan.js';
import { FRAMEWORK_TEST_ROOTS, frameworkHostRoot, isUnderFrameworkTestRoots } from '../../../lib/io/framework-paths.js';
import { detectRepoRoot } from '../../../lib/io/paths.js';
import { loadFrameworkGuaranteeLedger } from '../../../lib/model/guarantee/framework-loader.js';
import { loadGuaranteeSpecModel } from '../../../lib/model/guarantee/loader.js';
import { FRAMEWORK_GUARANTEE_ID_PREFIX, FRAMEWORK_TC_ID_PREFIX } from '../../../lib/model/guarantee/namespace.js';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { specPath } from '../../../lib/model/product/paths.js';
import { collectTcEntries } from '../../../lib/spec-index/sources.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import { scanFrameworkTests } from '../../../lib/trace/scan-framework.js';

const FRAMEWORK_ROOT = frameworkHostRoot();

/** 仕組みの台帳(実物)。読めなければこのファイルのテストはすべて落ちる(空の台帳で緑にしない)。 */
const ledger = loadFrameworkGuaranteeLedger(FRAMEWORK_ROOT);
const scan = scanFrameworkTests(FRAMEWORK_ROOT).scan;

/** この木の製品の保証台帳(無ければ null)。 */
function productLedger() {
  const repoRoot = detectRepoRoot(import.meta.dirname);
  const roots = loadProductRoots(repoRoot).model.roots;
  if (roots === null) return null;
  const loaded = loadGuaranteeSpecModel(path.join(repoRoot, specPath(roots, 'backend', 'guarantees.md')), { repoRoot });
  return loaded.model.available ? loaded.model : null;
}

describe('実物の仕組みの保証台帳', () => {
  it('読めて、Z0 の違反が 0 で、保証と見張りテストの宣言が 1 件以上ある', () => {
    expect(ledger.state).toBe('loaded');
    if (ledger.state !== 'loaded') return;
    expect(ledger.findings).toEqual([]);
    expect(ledger.model.catalog?.guarantees.length).toBeGreaterThan(0);
    expect(ledger.model.catalog?.testCases.length).toBeGreaterThan(0);
  });

  it('仕組みの根の見張りテストを走査できている', () => {
    expect(scan.state).toEqual({ state: 'scanned' });
    expect(scan.annotations.length).toBeGreaterThan(0);
  });

  it('canary(台帳の見張りテスト)と仕組みの根の注釈が過不足なく一致する(製品の台帳が置き場の下を指す宣言は注釈の側に含める)', () => {
    if (ledger.state !== 'loaded') throw new Error('仕組みの台帳を読めていない');
    const declared = new Set((ledger.model.catalog?.testCases ?? []).map((testCase) => testCase.id));
    const product = productLedger();
    const productInRoots = (product?.catalog?.testCases ?? [])
      .filter((testCase) => isUnderFrameworkTestRoots(testCase.implementation.file))
      .map((testCase) => testCase.id);
    const annotated = new Set(scan.annotations.map((annotation) => annotation.tcId));

    expect([...annotated].filter((id) => !declared.has(id) && !productInRoots.includes(id))).toEqual([]);
    expect([...declared].filter((id) => !annotated.has(id))).toEqual([]);
    // 注釈の本数と宣言の本数も一致する(同じ @tc が 2 本あれば Set では見えない)。
    expect(scan.annotations.filter((annotation) => declared.has(annotation.tcId))).toHaveLength(declared.size);
  });

  it('保証 ID とテストケース ID は、仕組みの予約の綴り(fw_ / TC-FW-)である', () => {
    if (ledger.state !== 'loaded') throw new Error('仕組みの台帳を読めていない');
    const catalog = ledger.model.catalog;
    expect(catalog?.guarantees.every((g) => g.id.startsWith(FRAMEWORK_GUARANTEE_ID_PREFIX))).toBe(true);
    expect(catalog?.testCases.every((t) => t.id.startsWith(FRAMEWORK_TC_ID_PREFIX))).toBe(true);
  });

  it('見張りテストの宣言は、すべて仕組みの根の置き場の下の、走査で見つかった実在のテストファイルを指す', () => {
    if (ledger.state !== 'loaded') throw new Error('仕組みの台帳を読めていない');
    const files = new Set(scan.testFiles);
    for (const testCase of ledger.model.catalog?.testCases ?? []) {
      expect(isUnderFrameworkTestRoots(testCase.implementation.file), `${testCase.id} の置き場(${FRAMEWORK_TEST_ROOTS.join(' / ')})`).toBe(true);
      expect(files.has(testCase.implementation.file), `${testCase.id} のテストファイルの実在`).toBe(true);
    }
  });

  it('この木の製品の台帳は、仕組みの予約(fw_ / TC-FW-)を 1 つも使っていない', () => {
    const catalog = productLedger()?.catalog;
    expect((catalog?.guarantees ?? []).filter((g) => g.id.startsWith(FRAMEWORK_GUARANTEE_ID_PREFIX))).toEqual([]);
    expect((catalog?.testCases ?? []).filter((t) => t.id.startsWith(FRAMEWORK_TC_ID_PREFIX))).toEqual([]);
  });

  it('実物の木に Z3 を当てると違反が 0 である(製品の台帳の宣言も含めた台帳で)', () => {
    if (ledger.state !== 'loaded') throw new Error('仕組みの台帳を読めていない');
    const registry = buildTcRegistry(
      collectTcEntries({ guarantees: productLedger(), frameworkGuarantees: ledger.model }),
    );

    const findings = verifyFrameworkGuarantees(registry, { available: false, testFiles: [], annotations: [], actionFiles: [], operationFiles: [], framework: scan }, ledger);

    expect(findings).toEqual([]);
  });
});
