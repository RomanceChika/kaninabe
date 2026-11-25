/**
 * トレース検証の実行口(A0 + A1〜A8)の結合テスト。
 *
 * わざと壊した fixture ツリーに対して A1〜A8 がすべて発火すること、
 * app/ が無い環境でも壊れないことを確かめる。個々のチェックの規約網羅は
 * verifiers/ 配下のユニットテストが担う。
 * 台帳検査(A9)は仕様種に依存しない別群なので unit/spec-index/ のテストが担う。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTraceVerification, type TraceRunOptions } from '../../../lib/trace/run.js';
import { loadActionSpecModel } from '../../../lib/model/trace/loader.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../lib/spec-index/sources.js';
import type { JobCatalogSpec } from '../../../lib/model/job/types.js';
import type { DataTableSpecModel } from '../../../lib/model/data/types.js';
import type { ExternalCatalogSpec } from '../../../lib/model/external/types.js';
import { catalogInput } from '../../../lib/kernel/input-state.js';
import { jobCatalog, notScheduledJob } from '../../helpers/job-builder.js';
import { aggregate, entitySpec, event, field, machine, specModel } from '../../helpers/model-builder-v8plus.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { blockedInput, loadedInput } from '../../helpers/verify-inputs.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures');

/** entry.submit / entry.withdraw を持ち、entry エンティティは id だけを持つドメイン。 */
function domain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [field('id', { kind: 'uuid' }, { auto: true })]),
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted', 'withdrawn'],
            events: [
              event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['performer'] }),
              event({ id: 'withdraw', from: ['submitted'], to: 'withdrawn', by: ['performer'] }),
            ],
          }),
        ],
      }),
    ],
  });
}

/**
 * fixture ツリーに対してトレース検証を実行する。
 *
 * 本番(CLI)と同じ順序 — action_spec を読み(A0)、テストケース ID 台帳を作り、
 * それを実行口に渡す — を再現する。A0 の指摘はローダーが返すのでここで束ねる。
 */
function run(actionsDir: string, appDir = 'app-sample', jobs: TraceRunOptions['jobs'] = catalogInput<JobCatalogSpec>('unselected')) {
  const loaded = loadActionSpecModel(path.join(FIXTURES, actionsDir), { repoRoot: FIXTURES });
  const registry = buildTcRegistry(collectTcEntries({ actions: loaded.model }));
  const result = runTraceVerification(domain(), {
    actions: actionsInputOf(loaded.model),
    appRoot: path.join(FIXTURES, appDir),
    repoRoot: FIXTURES,
    roots: TEST_ROOTS,
    layout: TEST_LAYOUT,
    registry,
    jobs,
    dataTables: catalogInput<DataTableSpecModel>('unselected'),
    external: catalogInput<ExternalCatalogSpec>('unselected'),
  });
  return { ...result, findings: [...loaded.findings, ...result.findings] };
}

/** 読み込んだモデルを入力の状態へ写す(モデルが無ければ阻害 = 採ったのに無い)。 */
function actionsInputOf(model: ActionSpecModel | null): TraceRunOptions['actions'] {
  return model === null ? blockedInput<ActionSpecModel>('missing') : loadedInput(model);
}

/** 発火した検証器 ID の集合。 */
function verifiers(findings: readonly { verifier: string }[]): Set<string> {
  return new Set(findings.map((f) => f.verifier));
}

describe('runTraceVerification', () => {
  it('わざと壊した仕様では A1〜A8 がすべて発火する', () => {
    const result = run('actions-broken');

    expect(verifiers(result.findings)).toEqual(new Set(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']));
    expect(result.actionsAvailable).toBe(true);
    expect(result.appAvailable).toBe(true);
    expect(result.actionCount).toBe(3);
  });

  it('壊れた仕様の Finding はすべて 3 点セットを持つ', () => {
    for (const finding of run('actions-broken').findings) {
      expect(finding.message).not.toBe('');
      expect(finding.suggestion).not.toBe('');
      expect(finding.location.file).not.toBe('');
    }
  });

  it('app/ が無い環境では A6 と A2 の実装側をスキップする', () => {
    const result = run('actions-broken', 'no-such-app');

    expect(result.appAvailable).toBe(false);
    expect(verifiers(result.findings).has('A6')).toBe(false);
    expect(result.findings.filter((f) => f.verifier === 'A2')).toHaveLength(1);
  });

  it('specs/backend/actions が無い環境ではトレース検証を実行しない', () => {
    const result = run('actions-nonexistent');

    expect(result.actionsAvailable).toBe(false);
    expect(result.actionCount).toBe(0);
    expect(verifiers(result.findings)).toEqual(new Set(['A0']));
  });

  it('スキーマ違反のツリーでは A0 が出て、その仕様は A1 以降の対象にならない', () => {
    const result = run('actions-invalid');

    expect(result.actionCount).toBe(0);
    expect(verifiers(result.findings).has('A0')).toBe(true);
    expect(verifiers(result.findings).has('A1')).toBe(false);
  });

  it('入力の状態を報告する検査は、未選択なら未実施・読込済みなら実行として結果に載る(A13)', () => {
    const skipped = run('actions-broken').checkRuns;
    const executed = run('actions-broken', 'app-sample', catalogInput<JobCatalogSpec>('selected', { model: { available: true, catalog: jobCatalog([]) }, findings: [], dropped: 0 })).checkRuns;

    expect(skipped.map((entry) => [entry.id, entry.kind, entry.run.status])).toEqual([['A13', 'jobs', 'skipped']]);
    expect(executed.map((entry) => [entry.id, entry.kind, entry.run.status])).toEqual([['A13', 'jobs', 'executed']]);
  });

  it('阻害でも A13 の違反は出ず、読み込みの診断を全体の Finding へ足し直さない', () => {
    const loaderError = {
      verifier: 'J0',
      severity: 'error' as const,
      message: 'jobs.md を読めません',
      location: { file: 'jobs.md' },
      suggestion: '直す',
    };
    const blocked = run(
      'actions-broken',
      'app-sample',
      catalogInput<JobCatalogSpec>('selected', { model: { available: true, catalog: null }, findings: [loaderError], dropped: 0 }),
    );

    expect(blocked.checkRuns.map((entry) => entry.run.status)).toEqual(['blocked']);
    expect(blocked.findings.filter((finding) => finding.verifier === 'A13' || finding.verifier === 'J0')).toEqual([]);
  });

  it('読込済みなら違反がそのまま全体の Finding に載る(実行は合格ではない)', () => {
    const result = run(
      'actions-broken',
      'app-sample',
      catalogInput<JobCatalogSpec>('selected', { model: { available: true, catalog: jobCatalog([notScheduledJob('scan_due', '結線前')]) }, findings: [], dropped: 0 }),
    );

    expect(result.findings.filter((finding) => finding.verifier === 'A13')).toHaveLength(1);
  });

  it('specs/backend/actions が無くても、前提が action_spec でない検査(A13)は未選択なら未実施・読込済みなら実行として載る', () => {
    const skipped = run('actions-nonexistent');
    const executed = run(
      'actions-nonexistent',
      'app-sample',
      catalogInput<JobCatalogSpec>('selected', { model: { available: true, catalog: jobCatalog([]) }, findings: [], dropped: 0 }),
    );

    expect(skipped.actionsAvailable).toBe(false);
    expect(skipped.checkRuns.map((entry) => [entry.id, entry.kind, entry.run.status])).toEqual([['A13', 'jobs', 'skipped']]);
    expect(executed.checkRuns.map((entry) => [entry.id, entry.kind, entry.run.status])).toEqual([['A13', 'jobs', 'executed']]);
    expect(executed.gapRuns).toEqual([]);
  });

  it('specs/backend/actions が無くても A13 の違反は全体の Finding に載り、action_spec が前提の検査は走らない', () => {
    const result = run(
      'actions-nonexistent',
      'app-sample',
      catalogInput<JobCatalogSpec>('selected', {
        model: { available: true, catalog: jobCatalog([notScheduledJob('scan_due', '結線前')]) },
        findings: [],
        dropped: 0,
      }),
    );

    expect(result.findings.filter((finding) => finding.verifier === 'A13')).toHaveLength(1);
    expect([...verifiers(result.findings)]).toEqual(['A0', 'A13']);
    // 実装の木のテストの走査は action_spec に依らない(走査できている)。A2 の実装側・A6 は action_spec が前提なので走っていない
    expect(result.appAvailable).toBe(true);
    expect(result.actionsAvailable).toBe(false);
  });

  it('specs/backend/actions が無く jobs が阻害なら、A13 は阻害で違反を出さない', () => {
    const result = run(
      'actions-nonexistent',
      'app-sample',
      catalogInput<JobCatalogSpec>('selected', { model: { available: true, catalog: null }, findings: [], dropped: 0 }),
    );

    expect(result.checkRuns.map((entry) => entry.run.status)).toEqual(['blocked']);
    expect(result.findings.filter((finding) => finding.verifier === 'A13')).toEqual([]);
  });

  it('テーブル仕様が使えないとき、見ていない検査が gapRuns に載る(外部連携が未選択なら A10 は載らない = 第 3 の発火元は事実として無い)', () => {
    const result = run('actions-broken');

    expect(result.gapRuns.map((entry) => [entry.id, entry.note.gap])).toEqual([
      ['A15', { input: 'data_tables', state: 'unselected' }],
      ['A18', { input: 'data_tables', state: 'unselected' }],
    ]);
  });

  it('action_spec が無ければ action_spec が前提の検査は走らないので、gapRuns も空', () => {
    expect(run('actions-nonexistent').gapRuns).toEqual([]);
  });
});

describe('runTraceVerification — action_spec の入力の状態(未選択と阻害を区別する)', () => {
  const loadedModel = () => loadActionSpecModel(path.join(FIXTURES, 'actions-broken'), { repoRoot: FIXTURES }).model as ActionSpecModel;
  const runWith = (actions: TraceRunOptions['actions']) =>
    runTraceVerification(domain(), {
      actions,
      appRoot: path.join(FIXTURES, 'app-sample'),
      repoRoot: FIXTURES,
      roots: TEST_ROOTS,
    layout: TEST_LAYOUT,
      registry: buildTcRegistry(collectTcEntries({})),
      jobs: catalogInput<JobCatalogSpec>('unselected'),
      dataTables: catalogInput<DataTableSpecModel>('unselected'),
      external: catalogInput<ExternalCatalogSpec>('unselected'),
    });

  it.each([
    ['未選択', catalogInput<ActionSpecModel>('unselected')],
    ['阻害(採ったのに無い)', blockedInput<ActionSpecModel>('missing')],
    ['阻害(読めずに捨てた仕様がある)', blockedInput<ActionSpecModel>('invalid')],
  ] as const)('action_spec が使えなくても(%s)、実装の木のテストの走査は行い、読込済みのときと同じ結果を渡す(Q / T / H / Z / X / S / Y の @tc 突合の材料)', (_label, actions) => {
    const unusable = runWith(actions);
    const usable = runWith(loadedInput(loadedModel()));

    expect(unusable.actionsAvailable).toBe(false);
    expect(unusable.appAvailable).toBe(true);
    expect(unusable.tests.available).toBe(true);
    expect(unusable.tests.annotations.length).toBeGreaterThan(0);
    expect(unusable.tests).toEqual(usable.tests);
  });

  it('実装の木を宣言していなければ(appRoot: null)、action_spec が使えても使えなくても走査は行われず、tests は同じく available: false', () => {
    const base = {
      repoRoot: FIXTURES,
      roots: TEST_ROOTS,
    layout: TEST_LAYOUT,
      registry: buildTcRegistry(collectTcEntries({})),
      jobs: catalogInput<JobCatalogSpec>('unselected'),
      dataTables: catalogInput<DataTableSpecModel>('unselected'),
      external: catalogInput<ExternalCatalogSpec>('unselected'),
      appRoot: null,
    };

    const unusable = runTraceVerification(domain(), { ...base, actions: catalogInput<ActionSpecModel>('unselected') });
    const usable = runTraceVerification(domain(), { ...base, actions: loadedInput(loadedModel()) });

    expect(unusable.tests.available).toBe(false);
    expect(unusable.tests).toEqual(usable.tests);
    expect(unusable.appAvailable).toBe(false);
  });

  it('読込済み: 実行し、渡せなかった入力は無い', () => {
    const result = runWith(loadedInput(loadedModel()));

    expect(result.actionsAvailable).toBe(true);
    expect(result.actionsGap).toBeNull();
  });

  it('未選択: action_spec が前提の検査は実行せず、理由は「採っていない」。前提が action_spec でない A13 は実行している', () => {
    const result = runWith(catalogInput<ActionSpecModel>('unselected'));

    expect(result.actionsAvailable).toBe(false);
    expect(result.actionsGap).toEqual({ input: 'actions', state: 'unselected' });
    expect(result.findings).toEqual([]);
    expect(result.checkRuns.map((entry) => entry.id)).toEqual(['A13']);
  });

  it('阻害(採ったのに無い・読めずに捨てた仕様がある): 実行せず、理由は「採っているが渡せない」(読めた部分のモデルでは回さない)', () => {
    const missing = runWith(catalogInput<ActionSpecModel>('selected', { model: { available: false, catalog: null }, findings: [], dropped: 0 }));
    const invalid = runWith(
      catalogInput<ActionSpecModel>('selected', {
        model: { available: true, catalog: loadedModel() },
        findings: [{ verifier: 'A0', severity: 'error', message: '壊れている', location: { file: 'x.md' }, suggestion: '直す' }],
        dropped: 1,
      }),
    );

    expect(missing.actionsGap).toEqual({ input: 'actions', state: 'blocked', reason: 'missing' });
    expect(invalid.actionsGap).toEqual({ input: 'actions', state: 'blocked', reason: 'invalid' });
    expect(invalid.actionsAvailable).toBe(false);
    expect(invalid.findings).toEqual([]);
  });
});
