/**
 * 仕組みの根の走査(`scanFrameworkTests`)と、製品の走査との分け方(`scanAppTests`)のテスト。
 *
 * 見るのは 5 つ。
 *   - 仕組みの根の見張りテストが `framework` に入れ子で集まり、パスは仕組みの根からの相対である
 *   - 製品の木が無くても仕組みの走査は行われ、`available`(製品だけの意味)は仕組みの存在で true にならない
 *   - 根を渡したら製品の走査は仕組みの置き場を読まない・渡さなければ従来どおり読む(移行中の互換)
 *   - 根を渡さない(`not_requested`)/ 置き場が無い・テストが 1 本も無い・読めないファイルがある(`blocked`)
 *   - `repoRoot` は必須で、作業ディレクトリに依らない
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanAppTests, scanProductTests } from '../../../lib/trace/scan.js';
import { scanFrameworkTests } from '../../../lib/trace/scan-framework.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';

const RUNTIME_TEST = 'framework/runtime/src/domain/__tests__/engine.test.ts';
const TOOL_TEST = 'legacy/spec-tools/__tests__/guarantees/parity.test.ts';
const APP_TEST = 'app/src/operation/__tests__/entry/submit.test.ts';

/** 注釈つきのテスト 1 本の本文。 */
function tagged(tcId: string, name: string): string {
  return [`// @spec framework-guarantee-catalog @tc ${tcId}`, `it('${name}', () => { expect(1).toBe(1); });`, ''].join('\n');
}

const made: string[] = [];

/** 一時の木を作り、(相対パス → 本文)を置く。 */
function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'scan-framework-'));
  made.push(root);
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('scanFrameworkTests', () => {
  it('実行時パッケージと見張りテストの置き場の注釈を、仕組みの根からの相対パスで集める', () => {
    const root = tree({
      [RUNTIME_TEST]: tagged('TC-FW-ENGINE-001', '許可なしでは遷移しない'),
      [TOOL_TEST]: tagged('TC-FW-PARITY-001', '写しと一致する'),
      // 検証器の単体テストは fixture として `@tc` の文字列を書くので、母集合に入れない。
      'legacy/spec-tools/__tests__/unit/other.test.ts': tagged('TC-FW-NOPE-001', '読まれない'),
    });

    const { scan, findings } = scanFrameworkTests(root);

    expect(findings).toEqual([]);
    expect(scan.state).toEqual({ state: 'scanned' });
    expect([...scan.testFiles].sort()).toEqual([RUNTIME_TEST, TOOL_TEST].sort());
    expect(scan.annotations.map((annotation) => annotation.tcId).sort()).toEqual(['TC-FW-ENGINE-001', 'TC-FW-PARITY-001']);
    expect(scan.annotations.find((annotation) => annotation.tcId === 'TC-FW-ENGINE-001')).toMatchObject({
      file: RUNTIME_TEST,
      testName: '許可なしでは遷移しない',
    });
  });

  it('assert を含むハーネスのヘルパ名を集める(注釈の中身の検査の許容)', () => {
    const root = tree({
      [RUNTIME_TEST]: tagged('TC-FW-ENGINE-001', '遷移'),
      'framework/runtime/testing/expect-parity.mts': 'export function expectParity(a: unknown): void { expect(a).toBe(a); }\n',
    });

    expect(scanFrameworkTests(root).scan.assertionHelpers).toContain('expectParity');
  });

  it('根を渡さなければ not_requested(呼び手が根を渡さない単体テスト用。未実施として名指しされる)', () => {
    const { scan, findings } = scanFrameworkTests(undefined);

    expect(findings).toEqual([]);
    expect(scan.state.state).toBe('not_requested');
    expect(scan.annotations).toEqual([]);
  });

  it('根の下にテストの置き場が 1 つも無ければ blocked(空の走査で緑にならない)', () => {
    const root = tree({ 'README.md': '# 空\n' });

    const { scan } = scanFrameworkTests(root);

    expect(scan.state.state).toBe('blocked');
    expect(scan.state).toMatchObject({ reason: expect.stringContaining('置き場が 1 つもありません') });
  });

  it('置き場はあってもテストファイルが 1 本も無ければ blocked', () => {
    const root = tree({ 'framework/runtime/src/domain/engine.ts': 'export {};\n' });

    expect(scanFrameworkTests(root).scan.state).toMatchObject({ state: 'blocked', reason: expect.stringContaining('1 本も見つかりません') });
  });

  it('読めないテストファイルがあれば blocked にして、読み取り失敗を Finding に積む', () => {
    const root = tree({ [RUNTIME_TEST]: tagged('TC-FW-ENGINE-001', '遷移') });
    // 宙ぶらりんの別名は、テストファイルとして列挙されるが読めない。
    symlinkSync(path.join(root, 'no-such-target'), path.join(root, 'framework/runtime/src/domain/__tests__/dangling.test.ts'));

    const { scan, findings } = scanFrameworkTests(root);

    expect(scan.state.state).toBe('blocked');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'A0', severity: 'error' });
  });
});

describe('scanAppTests(製品の走査と仕組みの走査の分け方)', () => {
  it('製品の木が無くても仕組みの走査は行う。available は製品だけの意味で、仕組みの存在では true にならない', () => {
    const root = tree({ [RUNTIME_TEST]: tagged('TC-FW-ENGINE-001', '遷移') });

    const { scan } = scanAppTests(null, TEST_LAYOUT, { repoRoot: root, frameworkRoot: root });

    expect(scan.available).toBe(false);
    expect(scan.testFiles).toEqual([]);
    expect(scan.framework?.state.state).toBe('scanned');
    expect(scan.framework?.annotations.map((annotation) => annotation.tcId)).toEqual(['TC-FW-ENGINE-001']);
  });

  it('製品の木があって仕組みの根を渡したとき、仕組みの置き場のテストは仕組みの走査だけに入る(製品の走査へ二重に入らない)', () => {
    const root = tree({
      [APP_TEST]: tagged('TC-ENTRY-SUBMIT-001', '提出できる'),
      [RUNTIME_TEST]: tagged('TC-FW-ENGINE-001', '遷移'),
      [TOOL_TEST]: tagged('TC-FW-PARITY-001', '写し'),
    });

    const { scan } = scanAppTests(path.join(root, 'app'), TEST_LAYOUT, { repoRoot: root, frameworkRoot: root });

    expect(scan.available).toBe(true);
    expect(scan.testFiles).toEqual([APP_TEST]);
    expect(scan.annotations.map((annotation) => annotation.tcId)).toEqual(['TC-ENTRY-SUBMIT-001']);
    expect([...(scan.framework?.testFiles ?? [])].sort()).toEqual([RUNTIME_TEST, TOOL_TEST].sort());
  });

  it('仕組みの根を渡さなければ、仕組みの置き場のテストは誰も読まず、framework は not_requested', () => {
    const root = tree({
      [APP_TEST]: tagged('TC-ENTRY-SUBMIT-001', '提出できる'),
      [RUNTIME_TEST]: tagged('TC-FW-ENGINE-001', '遷移'),
    });

    const { scan } = scanAppTests(path.join(root, 'app'), TEST_LAYOUT, { repoRoot: root });

    expect(scan.testFiles).toEqual([APP_TEST]);
    expect(scan.framework?.state.state).toBe('not_requested');
    expect(scan.framework?.annotations).toEqual([]);
  });

  it('製品の木が無ければ、製品の部分だけが止まる(仕組みの根を渡さなければ、仕組みの置き場も読まない)', () => {
    const root = tree({ [RUNTIME_TEST]: tagged('TC-FW-ENGINE-001', '遷移') });

    const unrequested = scanAppTests(null, TEST_LAYOUT, { repoRoot: root }).scan;

    expect(unrequested.available).toBe(false);
    expect(unrequested.testFiles).toEqual([]);
    expect(unrequested.framework?.state.state).toBe('not_requested');
  });

  it('scanProductTests は仕組みの走査を持たない(製品の部分だけ)', () => {
    const root = tree({ [APP_TEST]: tagged('TC-ENTRY-SUBMIT-001', '提出できる') });

    const { scan } = scanProductTests(path.join(root, 'app'), TEST_LAYOUT, { repoRoot: root, frameworkRoot: root });

    expect(scan.available).toBe(true);
    expect('framework' in scan).toBe(false);
  });

  it('結果は作業ディレクトリに依らない(cwd を別の場所に差し替えても同じ)', () => {
    const root = tree({ [RUNTIME_TEST]: tagged('TC-FW-ENGINE-001', '遷移') });
    const elsewhere = tree({ 'x.txt': 'x' });
    const before = scanAppTests(null, TEST_LAYOUT, { repoRoot: root, frameworkRoot: root }).scan;

    vi.spyOn(process, 'cwd').mockReturnValue(elsewhere);
    const after = scanAppTests(null, TEST_LAYOUT, { repoRoot: root, frameworkRoot: root }).scan;

    expect(after).toEqual(before);
  });

  it('repoRoot は必須である(型の検査。以前は省くと実装の木から上へ製品の根の宣言を探した)', () => {
    const cwd = vi.spyOn(process, 'cwd');

    // @ts-expect-error repoRoot を省いた呼び出しはコンパイルできない
    const result = scanAppTests(null, TEST_LAYOUT, {});

    // 実装の木が無ければ、作業ディレクトリを一度も読まずに製品の部分だけが止まる。
    expect(cwd).not.toHaveBeenCalled();
    expect(result.scan.available).toBe(false);
  });
});
