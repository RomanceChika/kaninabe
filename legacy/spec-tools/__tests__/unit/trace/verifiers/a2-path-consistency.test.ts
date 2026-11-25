/**
 * A2(パスとの一致)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「ファイルパス actions/{aggregate}/{event}.md が handles と一致する」
 * および server-actions.md の実装配置 app/src/app/_actions/{aggregate}/{event}.ts。
 */

import { describe, expect, it } from 'vitest';
import { pathConsistencyVerifier } from '../../../../lib/trace/verifiers/a2-path-consistency.js';
import { FOREIGN_LAYOUT } from '../../../helpers/platform.js';
import { actionSpec, scanResult, traceInput } from '../../../helpers/trace-builder.js';

const IMPL = 'app/src/app/_actions/entry/submit.ts';

describe('A2 パスとの一致', () => {
  it('仕様も実装も handles どおりの場所にあれば通る', () => {
    const input = traceInput({
      actions: [actionSpec({ handles: 'entry.submit' })],
      tests: scanResult({ actionFiles: [IMPL] }),
    });

    expect(pathConsistencyVerifier.verify(input)).toEqual([]);
  });

  it('仕様ファイルの置き場所が handles と食い違うと違反になる', () => {
    const input = traceInput({
      actions: [actionSpec({ handles: 'entry.submit', relPath: 'entry/send.md' })],
      tests: scanResult({ actionFiles: [IMPL] }),
    });

    const findings = pathConsistencyVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A2');
    expect(findings[0]?.counterexample).toMatchObject({
      expected_path: 'entry/submit.md',
      actual_path: 'entry/send.md',
    });
  });

  it('集約ディレクトリが違う場合も違反になる', () => {
    const input = traceInput({
      actions: [actionSpec({ handles: 'entry.submit', relPath: 'workshop/submit.md' })],
      tests: scanResult({ actionFiles: [IMPL] }),
    });

    expect(pathConsistencyVerifier.verify(input)).toHaveLength(1);
  });

  it('Server Action の実装ファイルが無いと違反になる', () => {
    const input = traceInput({
      actions: [actionSpec({ handles: 'entry.submit' })],
      tests: scanResult({ actionFiles: ['app/src/app/_actions/entry/revise.ts'] }),
    });

    const findings = pathConsistencyVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('実装がありません');
    expect(findings[0]?.counterexample?.['expected_impl']).toBe(IMPL);
  });

  it('境界: app/ を走査できない環境では実装側の検査をしない', () => {
    const input = traceInput({
      actions: [actionSpec({ handles: 'entry.submit' })],
      tests: scanResult({ available: false }),
    });

    expect(pathConsistencyVerifier.verify(input)).toEqual([]);
  });

  it('境界: app/ が無くても仕様側のパス不一致は検出する', () => {
    const input = traceInput({
      actions: [actionSpec({ handles: 'entry.submit', relPath: 'submit.md' })],
      tests: scanResult({ available: false }),
    });

    expect(pathConsistencyVerifier.verify(input)).toHaveLength(1);
  });

  it('別の配置(架空の値)では、Server Action の実在の位置がその配置の値になる(Next.js の綴りの位置にあっても、無いものとして咎める)', () => {
    const foreign = 'app/server_code/handlers/ops/entry__submit.action.ts';
    const found = traceInput({
      layout: FOREIGN_LAYOUT,
      actions: [actionSpec({ handles: 'entry.submit' })],
      tests: scanResult({ actionFiles: [foreign] }),
    });
    expect(pathConsistencyVerifier.verify(found)).toEqual([]);

    const nextjsSpelling = traceInput({
      layout: FOREIGN_LAYOUT,
      actions: [actionSpec({ handles: 'entry.submit' })],
      tests: scanResult({ actionFiles: [IMPL] }),
    });
    const findings = pathConsistencyVerifier.verify(nextjsSpelling);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['expected_impl']).toBe(foreign);
  });

  it('境界: 実装の木を持たない製品(roots.app が null)・配置にキーが合わない handles は、実装側の位置を決められないので咎めない', () => {
    const noApp = { ...traceInput({ actions: [actionSpec({ handles: 'entry.submit' })], tests: scanResult({ actionFiles: [] }) }), roots: { ...traceInput().roots, app: null } };
    expect(pathConsistencyVerifier.verify(noApp)).toEqual([]);
  });
});
