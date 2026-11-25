/**
 * テーブル仕様(`dataTables`)と外部連携(`external`)が使えないとき、A10 / A15 / A18 / A19 は依る判定だけを出さず、
 * 見ていないことを `gaps` で返す(部品化 ②-i)。
 *
 * 確かめるのは入力ごとの 3 つの状態(未選択 / 阻害 / 読込済み 0 件)。区別が要である:
 *   - 外部連携の**未選択は事実**(受信を採っていなければ第 3 の発火元は無い)。A10 は 2 本の母集合で判定し、gaps は出さない。
 *   - 外部連携の**阻害は分からない**。受信が起こしているかもしれないイベントに「起こす口が無い」と誤報を出さず、gaps に対象を挙げる。
 *   - テーブル仕様は**未選択も阻害も見ていない**(A15 / A18 / A19 の判定は表の宣言を読む)。どちらも gaps で報告する。
 * 読めているとき(0 件も含む)の判定は従来どおりである。
 */

import { describe, expect, it } from 'vitest';
import { systemScanCoverageVerifier } from '../../../../lib/trace/verifiers/a10-system-scan-coverage.js';
import { operationPlanVerifier } from '../../../../lib/trace/verifiers/a15-operation-plan.js';
import { writeRuleEnforcementVerifier } from '../../../../lib/trace/verifiers/a18-write-rule-enforcement.js';
import { computeFactsVerifier } from '../../../../lib/trace/verifiers/a19-compute-facts.js';
import type { PartialInputTraceVerifier } from '../../../../lib/trace/verifier.js';
import type { CatalogInput } from '../../../../lib/kernel/input-state.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import type { ExternalCatalogSpec } from '../../../../lib/model/external/types.js';
import { dataTableModel } from '../../../helpers/data-builder.js';
import { externalModel, integration } from '../../../helpers/external-builder.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  role,
  specModel,
  stubContext,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { actionSpec, scanDecl, scanResult, traceInput, unscanned } from '../../../helpers/trace-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** system が起こす `entry.close` を持つドメイン(A10 の材料)。 */
const SYSTEM_DOMAIN = specModel({
  aggregates: [
    aggregate({
      name: 'entry',
      stateMachines: [
        machine({
          machine: 'entry',
          states: ['draft', 'closed'],
          events: [event({ id: 'close', from: ['draft'], to: 'closed', by: ['system'] })],
        }),
      ],
    }),
  ],
});

/** 受信が `entry.close` を起こす外部連携カタログ(読込済みの値)。 */
const INBOUND: ExternalCatalogSpec = (() => {
  const catalog = externalModel([
    integration('billing_hook', {
      direction: 'inbound',
      degrade: 'refuse',
      signature: 'hmac_sha256',
      eventIdTable: 'table-billing_events',
      emits: 'entry.close',
    }),
  ]).catalog;
  if (catalog === null) throw new Error('テストの材料が組めない');
  return catalog;
})();

/** 受信が 0 件の外部連携カタログ(読込済みの値)。 */
const NO_INTEGRATIONS: ExternalCatalogSpec = { ...INBOUND, integrations: [] };

const BLOCKED_EXTERNAL = blockedInput<ExternalCatalogSpec>('load-failed');

/** 走査の宣言(実装の実在を含む)が `entry.close` にある入力に足す部品。 */
const SCANNED = { scans: [scanDecl('entry.close', 'app/src/operation/entry/close.ts')], tests: scanResult({ operationFiles: ['app/src/operation/entry/close.ts'] }) };

describe('A10 — 外部連携(第 3 の発火元)', () => {
  const run = (external: CatalogInput<ExternalCatalogSpec>, extra: Parameters<typeof traceInput>[0] = {}) =>
    systemScanCoverageVerifier.runPartial(traceInput({ domain: SYSTEM_DOMAIN, externalInput: external, ...extra }));

  it('未選択: 第 3 の発火元は事実として無いので、2 本の母集合で判定する(違反が出る・gaps は無い)', () => {
    const result = run(UNSELECTED);

    expect(result.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('entry.close は system が起こすイベントですが')]);
    expect(result.gaps).toEqual([]);
  });

  it('阻害: 「起こす口が無い」の判定を出さず、gaps が出さなかったイベントを名指す', () => {
    const result = run(BLOCKED_EXTERNAL);

    expect(result.findings).toEqual([]);
    expect(result.gaps).toEqual([
      {
        gap: { input: 'external', state: 'blocked', reason: 'load-failed' },
        consequence: expect.stringContaining('第 3 の発火元'),
        subjects: ['entry.close'],
      },
    ]);
  });

  it('阻害でも、external に依らない判定(用済みの宣言・走査の宣言の食い違い)は従来どおり出す', () => {
    const result = run(BLOCKED_EXTERNAL, { scans: [scanDecl('entry.close', 'app/x.ts'), scanDecl('entry.nowhere', 'app/y.ts')], tests: scanResult({ operationFiles: ['app/x.ts', 'app/y.ts'] }) });

    expect(result.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('entry.nowhere は state_spec に存在しないイベント')]);
    expect(result.gaps).toEqual([]);
  });

  it('阻害でも、走査の宣言か免除が全部のイベントにあれば、出さなかった判定が無いので gaps も出ない', () => {
    expect(run(BLOCKED_EXTERNAL, SCANNED).gaps).toEqual([]);
    expect(run(BLOCKED_EXTERNAL, { unscanned: [unscanned('entry.close', 'まだ実装しない')] }).gaps).toEqual([]);
  });

  it('読込済み(受信が 0 件): 判定は従来どおり(違反が出る・gaps は無い)', () => {
    const result = run(loadedInput(NO_INTEGRATIONS));

    expect(result.findings).toHaveLength(1);
    expect(result.gaps).toEqual([]);
  });

  it('読込済み(受信が emits している): そのイベントは走査の宣言も免除も要らない', () => {
    expect(run(loadedInput(INBOUND))).toEqual({ findings: [], gaps: [] });
  });

  it('verify は runPartial と同じ違反だけを返す(呼び口が 2 つでも検査の本体は 1 つ)', () => {
    const input = traceInput({ domain: SYSTEM_DOMAIN, externalInput: BLOCKED_EXTERNAL, ...SCANNED });

    expect(systemScanCoverageVerifier.verify(input)).toEqual(systemScanCoverageVerifier.runPartial(input).findings);
  });
});

/** 表が 1 つも無い(読込済み・0 件)。 */
const NO_TABLES = dataTableModel([]);

const BLOCKED_TABLES = blockedInput<DataTableSpecModel>('invalid');

describe('テーブル仕様(A15 / A18 / A19)— 未選択も阻害も、見ていないことを gaps で返す', () => {
  const verifiers: readonly [string, PartialInputTraceVerifier][] = [
    ['A15', operationPlanVerifier],
    ['A18', writeRuleEnforcementVerifier],
  ];

  it.each(verifiers)('%s: 未選択なら判定を出さず、未選択の gaps を返す(採っていない製品の事実ではなく、検査の範囲の縮み)', (_id, verifier) => {
    const result = verifier.runPartial(traceInput({ domain: SYSTEM_DOMAIN, guards: stubContext().guards, dataTablesInput: UNSELECTED }));

    expect(result.findings).toEqual([]);
    expect(result.gaps).toEqual([{ gap: { input: 'data_tables', state: 'unselected' }, consequence: expect.any(String) }]);
  });

  it.each(verifiers)('%s: 阻害なら判定を出さず、阻害の gaps を理由つきで返す', (_id, verifier) => {
    const result = verifier.runPartial(traceInput({ domain: SYSTEM_DOMAIN, guards: stubContext().guards, dataTablesInput: BLOCKED_TABLES }));

    expect(result.findings).toEqual([]);
    expect(result.gaps).toEqual([{ gap: { input: 'data_tables', state: 'blocked', reason: 'invalid' }, consequence: expect.any(String) }]);
  });

  it.each(verifiers)('%s: 読込済み(0 件)なら実行し、gaps は無い(0 件を検査したことは、検査しなかったことと違う)', (_id, verifier) => {
    const result = verifier.runPartial(traceInput({ domain: SYSTEM_DOMAIN, guards: stubContext().guards, dataTablesInput: loadedInput(NO_TABLES) }));

    expect(result.findings).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it('A15: ガード式のパーサーが無い環境は、カタログではないので gaps を出さず黙って何もしない', () => {
    const result = operationPlanVerifier.runPartial(traceInput({ domain: SYSTEM_DOMAIN, dataTablesInput: loadedInput(NO_TABLES) }));

    expect(result).toEqual({ findings: [], gaps: [] });
  });

  it('A18: 読込済みなら、執行点の無い書き込みの規則を従来どおり警告する(表が無い集約にも出る)', () => {
    const domain = specModel({
      roles: [role('member')],
      aggregates: [
        aggregate({
          name: 'doc',
          entity: entitySpec('doc', [field('title', { kind: 'text' })]),
          access: accessSpec('doc', { writes: [writeRule('member', ['title'])] }),
        }),
      ],
    });

    const loaded = writeRuleEnforcementVerifier.runPartial(traceInput({ domain, dataTablesInput: loadedInput(NO_TABLES) }));
    const unselectedRun = writeRuleEnforcementVerifier.runPartial(traceInput({ domain, dataTablesInput: UNSELECTED }));

    expect(loaded.findings).toHaveLength(1);
    expect(unselectedRun.findings).toEqual([]);
    expect(writeRuleEnforcementVerifier.verify(traceInput({ domain, dataTablesInput: loadedInput(NO_TABLES) }))).toEqual(loaded.findings);
  });
});

describe('A19 — 計画の組み立てがテーブル仕様に依る', () => {
  const widgetDomain = specModel({
    aggregates: [aggregate({ name: 'widget', entity: entitySpec('widget', [field('amount', { kind: 'integer' })]) })],
  });

  const inputWith = (tables: CatalogInput<DataTableSpecModel>, init: { reads?: readonly string[]; manual?: boolean; computes?: boolean } = {}) =>
    traceInput({
      domain: widgetDomain,
      guards: stubContext().guards,
      dataTablesInput: tables,
      actions: [
        actionSpec({
          handles: 'widget.send',
          input: ['widget.id'],
          ...(init.computes === false
            ? {}
            : { computes: { 'widget.amount': 'computeAmount' }, computeReads: { 'widget.amount': init.reads ?? ['widget.amount'] } }),
          ...(init.manual === true ? { runner: { reason: '定型に乗らない' } } : {}),
        }),
      ],
    });

  it('未選択 / 阻害: 材料が計画に届くかの判定は出さず、計算を持つ操作を名指して報告する。綴りの誤りは計画に依らないので出す', () => {
    for (const [tables, gap] of [
      [UNSELECTED, { input: 'data_tables', state: 'unselected' }],
      [BLOCKED_TABLES, { input: 'data_tables', state: 'blocked', reason: 'invalid' }],
    ] as const) {
      const result = computeFactsVerifier.runPartial(inputWith(tables, { reads: ['widget.nowhere'] }));

      expect(result.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('widget.nowhere は entity_spec に実在しません')]);
      expect(result.gaps).toEqual([{ gap, consequence: expect.stringContaining('reads の到達'), subjects: ['widget.send'] }]);
    }
  });

  it('runner: manual の操作は計画を持たないので、対象に挙げない(出さなかった判定が無い)', () => {
    expect(computeFactsVerifier.runPartial(inputWith(UNSELECTED, { manual: true })).gaps).toEqual([]);
  });

  it('computes を持つ操作が無ければ、見ていないことが無いので gaps は出ない(未選択でも)', () => {
    expect(computeFactsVerifier.runPartial(inputWith(UNSELECTED, { computes: false })).gaps).toEqual([]);
  });

  it('読込済みなら計画を組み、gaps は無い', () => {
    const result = computeFactsVerifier.runPartial(inputWith(loadedInput(NO_TABLES), { reads: ['widget.amount'] }));

    expect(result.gaps).toEqual([]);
  });

  it('verify は runPartial と同じ違反だけを返す', () => {
    const input = inputWith(UNSELECTED, { reads: ['widget.nowhere'] });

    expect(computeFactsVerifier.verify(input)).toEqual(computeFactsVerifier.runPartial(input).findings);
  });
});
