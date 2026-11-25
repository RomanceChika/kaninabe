/**
 * A11(操作の閉世界)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「`app/src/operation/{aggregate}/{event}.ts` の
 * 実装ファイルは、すべて仕様に宣言された操作に対応する」。
 *
 * 既知解テスト: 調査(spec-impl-bijection-survey.md)で実測された穴
 * 「`operation/entry/teleport.ts` を置いても全検査が緑のまま通る」を fixture として固定し、
 * この検査が赤を出すことを確かめる。
 */

import { describe, expect, it } from 'vitest';
import { undeclaredOperationsVerifier } from '../../../../lib/trace/verifiers/a11-undeclared-operations.js';
import {
  accessSpec,
  aggregate,
  createRule,
  event,
  machine,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { FOREIGN_LAYOUT } from '../../../helpers/platform.js';
import { scanResult, traceInput, unhandled } from '../../../helpers/trace-builder.js';

/** submit(遷移)・create(予約 ID)・update(予約 ID)を宣言したドメイン。 */
function domain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'entry',
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['performer'] })],
          }),
        ],
        access: accessSpec('entry', {
          creates: [createRule('performer')],
          writes: [writeRule('performer', ['title'])],
        }),
      }),
    ],
  });
}

/** operation の実装ファイル一覧を持つ走査結果。 */
function withOps(...files: readonly string[]) {
  return scanResult({ operationFiles: files });
}

describe('A11 操作の閉世界', () => {
  it('宣言済みの操作(遷移・予約 ID)に対応するファイルは通る', () => {
    const input = traceInput({
      domain: domain(),
      tests: withOps(
        'app/src/operation/entry/submit.ts',
        'app/src/operation/entry/create.ts',
        'app/src/operation/entry/update.ts',
      ),
    });

    expect(undeclaredOperationsVerifier.verify(input)).toEqual([]);
  });

  it('仕様に無い操作の実装ファイルは違反になる(teleport 見張りテスト)', () => {
    const findings = undeclaredOperationsVerifier.verify(
      traceInput({
        domain: domain(),
        tests: withOps('app/src/operation/entry/submit.ts', 'app/src/operation/entry/teleport.ts'),
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A11');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.location.file).toBe('app/src/operation/entry/teleport.ts');
    expect(findings[0]?.counterexample).toMatchObject({ operation: 'entry.teleport' });
  });

  it('操作ではないファイル(横断・定型・jobs・テスト補助・ports)は対象外', () => {
    const input = traceInput({
      domain: domain(),
      tests: withOps(
        'app/src/operation/logging.ts',
        'app/src/operation/ports.ts',
        'app/src/operation/shared/helper.ts',
        'app/src/operation/jobs/handlers.ts',
        'app/src/operation/__tests__/fakes/ports.ts',
        'app/src/operation/entry/ports.ts',
      ),
    });

    expect(undeclaredOperationsVerifier.verify(input)).toEqual([]);
  });

  it('集約ディレクトリ名でもエンティティ名でも予約 ID を引ける(S10 の canonical 化と同じ規則)', () => {
    // 集約ディレクトリ program にエンティティ program_item が属する構成。
    const model = specModel({
      aggregates: [
        aggregate({
          name: 'program',
          access: accessSpec('program_item', { creates: [createRule('organizer')] }),
        }),
      ],
    });
    const input = traceInput({
      domain: model,
      tests: withOps(
        'app/src/operation/program_item/create.ts',
        'app/src/operation/program/create.ts',
      ),
    });

    expect(undeclaredOperationsVerifier.verify(input)).toEqual([]);
  });

  it('深すぎる配置(3 階層)は規約のパスから ID を導けないので違反になる', () => {
    const findings = undeclaredOperationsVerifier.verify(
      traceInput({ domain: domain(), tests: withOps('app/src/operation/entry/sub/submit.ts') }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A11');
  });

  it('app/ を走査できない構成では何も言わない(A2 の実装側と同じ扱い)', () => {
    const input = traceInput({
      domain: domain(),
      tests: scanResult({
        available: false,
        operationFiles: ['app/src/operation/entry/teleport.ts'],
      }),
    });

    expect(undeclaredOperationsVerifier.verify(input)).toEqual([]);
  });

  it('Finding は 3 点セット(message / location / suggestion)を必ず持つ', () => {
    const findings = undeclaredOperationsVerifier.verify(
      traceInput({ domain: domain(), tests: withOps('app/src/operation/entry/teleport.ts') }),
    );

    for (const finding of findings) {
      expect(finding.message).not.toBe('');
      expect(finding.suggestion).not.toBe('');
      expect(finding.location.file).not.toBe('');
    }
  });
});

describe('A11 unhandled なのに operation が実装済み(既知解テスト)', () => {
  it('unhandled で「まだ作らない」と宣言したイベントの operation が置かれていたら違反になる', () => {
    const findings = undeclaredOperationsVerifier.verify(
      traceInput({
        domain: domain(),
        unhandled: [unhandled('entry.submit', 'まだ画面が無いため')],
        tests: withOps('app/src/operation/entry/submit.ts'),
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A11');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.location.file).toBe('app/src/operation/entry/submit.ts');
    expect(findings[0]?.counterexample).toMatchObject({
      file: 'app/src/operation/entry/submit.ts',
      operation: 'entry.submit',
      unhandled_reason: 'まだ画面が無いため',
    });
  });

  it('unhandled で宣言した予約 ID(create)の operation が置かれていても違反になる', () => {
    const findings = undeclaredOperationsVerifier.verify(
      traceInput({
        domain: domain(),
        unhandled: [unhandled('entry.create', 'まだ画面が無いため')],
        tests: withOps('app/src/operation/entry/create.ts'),
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ operation: 'entry.create' });
  });

  it('unhandled が無ければこの検査は何も言わない', () => {
    const findings = undeclaredOperationsVerifier.verify(
      traceInput({ domain: domain(), tests: withOps('app/src/operation/entry/submit.ts') }),
    );

    expect(findings).toEqual([]);
  });

  it('unhandled に挙がっていても operation がまだ無ければ違反にならない', () => {
    const findings = undeclaredOperationsVerifier.verify(
      traceInput({
        domain: domain(),
        unhandled: [unhandled('entry.submit', 'まだ画面が無いため')],
        tests: withOps(),
      }),
    );

    expect(findings).toEqual([]);
  });

  it('app/ を走査できない構成では何も言わない(A2 の実装側と同じ扱い)', () => {
    const findings = undeclaredOperationsVerifier.verify(
      traceInput({
        domain: domain(),
        unhandled: [unhandled('entry.submit', 'まだ画面が無いため')],
        tests: scanResult({ available: false, operationFiles: ['app/src/operation/entry/submit.ts'] }),
      }),
    );

    expect(findings).toEqual([]);
  });

  it('別の配置(架空の値)では、その配置の操作の本体の置き場の下の実装だけを閉世界で見る(Next.js の綴りの置き場は対象外)', () => {
    const findings = undeclaredOperationsVerifier.verify(
      traceInput({
        layout: FOREIGN_LAYOUT,
        domain: domain(),
        tests: withOps('app/server_code/rules/entry__submit.rule.ts', 'app/server_code/rules/entry__teleport.rule.ts', 'app/src/operation/entry/teleport.ts'),
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.file).toBe('app/server_code/rules/entry__teleport.rule.ts');
    expect(findings[0]?.counterexample).toMatchObject({ operation: 'entry.teleport' });
  });
});
