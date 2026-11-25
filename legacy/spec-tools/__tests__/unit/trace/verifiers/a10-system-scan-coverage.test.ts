/**
 * A10(走査の網羅)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「`by` に `system` を含む全イベントに、走査実装の宣言
 * (`scans`)か理由つきの免除(`unscanned`)がある」。
 */

import { describe, expect, it } from 'vitest';
import { systemScanCoverageVerifier } from '../../../../lib/trace/verifiers/a10-system-scan-coverage.js';
import { aggregate, event, machine, specModel } from '../../../helpers/model-builder-v8plus.js';
import { externalModel, integration } from '../../../helpers/external-builder.js';
import {
  annotation,
  scanDecl,
  scanResult,
  testCase,
  traceInput,
  unscanned,
} from '../../../helpers/trace-builder.js';

/** 走査モジュールの既定のパス(fixture ではなくリテラル。実在は scanResult で表す)。 */
const IMPL = 'app/src/operation/entry/close.ts';

/** submit(performer)・close(system)を持つドメイン。 */
function domain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'entry',
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted', 'closed'],
            events: [
              event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['performer'] }),
              event({ id: 'close', from: ['submitted'], to: 'closed', by: ['system'] }),
            ],
          }),
        ],
      }),
    ],
  });
}

/** 実装ファイルが実在する走査結果。 */
function withImpl(...files: readonly string[]) {
  return scanResult({ operationFiles: files });
}

describe('A10 走査の網羅', () => {
  it('走査実装が宣言され実在すれば通る', () => {
    const input = traceInput({
      domain: domain(),
      scans: [scanDecl('entry.close', IMPL)],
      tests: withImpl(IMPL),
    });

    expect(systemScanCoverageVerifier.verify(input)).toEqual([]);
  });

  it('受信の連携が emits するイベントは、走査の宣言も免除も要らない(第 3 の発火元)', () => {
    const input = traceInput({
      domain: domain(),
      external: externalModel([
        integration('billing_hook', {
          direction: 'inbound',
          degrade: 'refuse',
          signature: 'hmac_sha256',
          eventIdTable: 'table-billing_events',
          emits: 'entry.close',
        }),
      ]),
    });

    expect(systemScanCoverageVerifier.verify(input)).toEqual([]);
  });

  it('受信の連携があっても、別のイベントを emits しているだけなら違反は残る', () => {
    const input = traceInput({
      domain: domain(),
      external: externalModel([
        integration('billing_hook', {
          direction: 'inbound',
          degrade: 'refuse',
          signature: 'hmac_sha256',
          eventIdTable: 'table-billing_events',
          emits: 'entry.reopen',
        }),
      ]),
    });

    expect(systemScanCoverageVerifier.verify(input)).toHaveLength(1);
  });

  it('宣言が無いと違反になる(わざと壊す確認: 宣言を消すと落ちる)', () => {
    const findings = systemScanCoverageVerifier.verify(
      traceInput({ domain: domain(), tests: withImpl(IMPL) }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A10');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.counterexample).toMatchObject({ event: 'entry.close', by: 'system' });
  });

  it('理由を宣言すれば免除される', () => {
    const input = traceInput({
      domain: domain(),
      unscanned: [unscanned('entry.close', '自動締切は次のバッチで実装する')],
      tests: withImpl(),
    });

    expect(systemScanCoverageVerifier.verify(input)).toEqual([]);
  });

  it('人間ロールだけのイベントは走査の対象にしない', () => {
    const findings = systemScanCoverageVerifier.verify(
      traceInput({
        domain: domain(),
        unscanned: [unscanned('entry.close')],
        tests: withImpl(),
      }),
    );

    expect(findings.some((f) => f.message.includes('entry.submit'))).toBe(false);
  });

  it('境界: 人間ロールとシステムロールが混在するイベントも対象になる', () => {
    const mixed = specModel({
      aggregates: [
        aggregate({
          name: 'workshop',
          stateMachines: [
            machine({
              machine: 'workshop',
              states: ['open', 'finished'],
              events: [
                event({ id: 'finish', from: ['open'], to: 'finished', by: ['organizer', 'system'] }),
              ],
            }),
          ],
        }),
      ],
    });

    const findings = systemScanCoverageVerifier.verify(traceInput({ domain: mixed }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ event: 'workshop.finish' });
  });

  it('宣言した実装が存在しないと違反になる', () => {
    const input = traceInput({
      domain: domain(),
      scans: [scanDecl('entry.close', 'app/src/operation/entry/nope.ts')],
      tests: withImpl(IMPL),
    });

    const findings = systemScanCoverageVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('nope.ts');
  });

  it('app/ を走査できていない環境では実装の実在を見ない', () => {
    const input = traceInput({
      domain: domain(),
      scans: [scanDecl('entry.close', 'app/src/operation/entry/nope.ts')],
      tests: scanResult({ available: false }),
    });

    expect(systemScanCoverageVerifier.verify(input)).toEqual([]);
  });

  it('走査ができたのに免除が残っていると警告する', () => {
    const input = traceInput({
      domain: domain(),
      scans: [scanDecl('entry.close', IMPL)],
      unscanned: [unscanned('entry.close')],
      tests: withImpl(IMPL),
    });

    const findings = systemScanCoverageVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('unscanned の理由宣言が残っています');
  });

  it('system が起こさないイベントの宣言は警告する', () => {
    const input = traceInput({
      domain: domain(),
      unscanned: [unscanned('entry.submit')],
      tests: withImpl(),
    });

    const findings = systemScanCoverageVerifier.verify(input);

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.severity)).toContain('warning');
    expect(findings.some((f) => f.message.includes('by に system がありません'))).toBe(true);
  });

  it('実在しないイベントの宣言は警告する', () => {
    const input = traceInput({
      domain: domain(),
      scans: [scanDecl('entry.typo', IMPL)],
      unscanned: [unscanned('entry.close')],
      tests: withImpl(IMPL),
    });

    const findings = systemScanCoverageVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('state_spec に存在しないイベントです');
  });
});

describe('A10 scans[].test_cases — テスト義務の 3 段突合(A6 と同型)', () => {
  const TEST_FILE = 'app/src/operation/__tests__/entry/close.test.ts';

  it('test_cases を書いていない scan は突合の対象にならない(従来どおり)', () => {
    const input = traceInput({
      domain: domain(),
      scans: [scanDecl('entry.close', IMPL)],
      tests: withImpl(IMPL),
    });

    expect(systemScanCoverageVerifier.verify(input)).toEqual([]);
  });

  it('宣言どおりの注釈が実装にあれば通る', () => {
    const tc = testCase({ id: 'TC-ENTRY-CLOSE-001', implementation: `${TEST_FILE}::締切で自動的に閉じる` });
    const input = traceInput({
      domain: domain(),
      scans: [scanDecl('entry.close', IMPL, [tc])],
      tests: scanResult({
        operationFiles: [IMPL],
        testFiles: [TEST_FILE],
        annotations: [annotation({ tcId: 'TC-ENTRY-CLOSE-001', file: TEST_FILE, testName: '締切で自動的に閉じる' })],
      }),
    });

    expect(systemScanCoverageVerifier.verify(input)).toEqual([]);
  });

  it('宣言した実装ファイルが無ければ A10 の違反になる', () => {
    const tc = testCase({ id: 'TC-ENTRY-CLOSE-001', implementation: `${TEST_FILE}::締切で自動的に閉じる` });
    const input = traceInput({
      domain: domain(),
      scans: [scanDecl('entry.close', IMPL, [tc])],
      tests: scanResult({ operationFiles: [IMPL], testFiles: [] }),
    });

    const findings = systemScanCoverageVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A10');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.counterexample).toMatchObject({ test_case: 'TC-ENTRY-CLOSE-001' });
  });

  it('@tc は付いているがテスト名が違えば A10 の違反になる', () => {
    const tc = testCase({ id: 'TC-ENTRY-CLOSE-001', implementation: `${TEST_FILE}::締切で自動的に閉じる` });
    const input = traceInput({
      domain: domain(),
      scans: [scanDecl('entry.close', IMPL, [tc])],
      tests: scanResult({
        operationFiles: [IMPL],
        testFiles: [TEST_FILE],
        annotations: [annotation({ tcId: 'TC-ENTRY-CLOSE-001', file: TEST_FILE, testName: '別の名前' })],
      }),
    });

    const findings = systemScanCoverageVerifier.verify(input);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('A10');
    expect(findings[0]?.message).toContain('テスト名が implementation と一致しません');
  });

  it('この注釈は A6(orphan)の視界には現れない(台帳の外にある)', () => {
    const tc = testCase({ id: 'TC-ENTRY-CLOSE-001', implementation: `${TEST_FILE}::締切で自動的に閉じる` });
    const input = traceInput({
      domain: domain(),
      scans: [scanDecl('entry.close', IMPL, [tc])],
      tests: scanResult({
        operationFiles: [IMPL],
        testFiles: [TEST_FILE],
        annotations: [annotation({ tcId: 'TC-ENTRY-CLOSE-001', file: TEST_FILE, testName: '締切で自動的に閉じる' })],
      }),
    });

    expect(input.registry.find('TC-ENTRY-CLOSE-001')).toEqual([]);
  });
});
