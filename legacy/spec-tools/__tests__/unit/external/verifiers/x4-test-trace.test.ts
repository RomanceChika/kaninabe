/**
 * X4(テスト突合)の規約網羅テスト。
 * 対象の要求: external-spec-writing.md「test_cases[].implementation が実在し、テスト側の
 * @tc と一致する(書けば)」。突合そのものは Z1 / H3 / A6 / Q6 と共通実装
 * (lib/testcase/test-trace-match.ts)なので、ここでは X4 として動くこと・spec_ids の実在
 * (ドメイン ID + external-catalog)・**test_cases を書かなければ何も見ないこと**を確かめる。
 */

import { describe, expect, it } from 'vitest';
import { verifyExternalTestTrace } from '../../../../lib/external/verifiers/x4-test-trace.js';
import { buildTcRegistry } from '../../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../../lib/spec-index/sources.js';
import { annotation, scanResult } from '../../../helpers/trace-builder.js';
import { aggregate, event, machine, specModel } from '../../../helpers/model-builder.js';
import { externalModel, externalTestCase, integration } from '../../../helpers/external-builder.js';

const TEST_FILE = 'app/src/infrastructure/__tests__/external/webhook.test.ts';
const TC = 'TC-EXT-WEBHOOK-001';
const NAME = '未設定なら not_configured を返す';

/** 台帳を外部連携カタログだけから構築する。 */
function registryOf(model: ReturnType<typeof externalModel>) {
  return buildTcRegistry(collectTcEntries({ external: model }));
}

/** 標準的な入力(1 連携 + それを指す 1 テストケース)。 */
function standard(specIds: readonly string[] = ['external-catalog']) {
  return externalModel([integration('discord_webhook')], {
    testCases: [{ ...externalTestCase(TC, `${TEST_FILE}::${NAME}`), specIds }],
  });
}

describe('X4 テスト突合', () => {
  it('test_cases を書かなければ何も見ない(このカタログだけ任意)', () => {
    const model = externalModel([integration('discord_webhook')]);
    const findings = verifyExternalTestTrace(specModel([]), registryOf(model), scanResult({ testFiles: [] }));

    expect(findings).toEqual([]);
  });

  it('実在するテストに @tc が付いていれば通る', () => {
    const findings = verifyExternalTestTrace(
      specModel([]),
      registryOf(standard()),
      scanResult({ testFiles: [TEST_FILE], annotations: [annotation({ tcId: TC, file: TEST_FILE, testName: NAME })] }),
    );

    expect(findings).toEqual([]);
  });

  it('テストファイルが無ければ X4 の違反になる', () => {
    const findings = verifyExternalTestTrace(specModel([]), registryOf(standard()), scanResult({ testFiles: [] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('X4');
    expect(findings[0]?.message).toContain('implementation が指すテストファイルがありません');
  });

  it('テスト名の食い違いを検出する', () => {
    const findings = verifyExternalTestTrace(
      specModel([]),
      registryOf(standard()),
      scanResult({ testFiles: [TEST_FILE], annotations: [annotation({ tcId: TC, file: TEST_FILE, testName: '別の名前' })] }),
    );

    expect(findings.some((f) => f.message.includes('テスト名が implementation と一致しません'))).toBe(true);
  });

  it('spec_ids が実在しない ID を指すと違反になる', () => {
    const findings = verifyExternalTestTrace(
      specModel([]),
      registryOf(standard(['nowhere.event'])),
      scanResult({ testFiles: [TEST_FILE], annotations: [annotation({ tcId: TC, file: TEST_FILE, testName: NAME })] }),
    );

    expect(findings.map((f) => f.message)).toContain(`${TC} の spec_ids nowhere.event に対応する仕様がありません`);
  });

  it('spec_ids にはドメインイベント ID も書ける', () => {
    const domain = specModel([
      aggregate('entry', {
        stateMachines: [
          machine('entry', {
            states: ['draft', 'submitted'],
            initial: 'draft',
            events: [event('submit', { from: ['draft'], to: 'submitted' })],
          }),
        ],
      }),
    ]);
    const findings = verifyExternalTestTrace(
      domain,
      registryOf(standard(['entry.submit'])),
      scanResult({ testFiles: [TEST_FILE], annotations: [annotation({ tcId: TC, file: TEST_FILE, testName: NAME })] }),
    );

    expect(findings).toEqual([]);
  });

  it('app/ を走査できていなくても、宣言だけで分かる検査(spec_ids)は行う', () => {
    const findings = verifyExternalTestTrace(specModel([]), registryOf(standard(['nowhere.event'])), scanResult({ available: false }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('spec_ids nowhere.event に対応する仕様がありません');
  });
});
