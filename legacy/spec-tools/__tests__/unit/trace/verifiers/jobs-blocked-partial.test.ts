/**
 * ジョブカタログが阻害のとき、A15 / A19 は**ジョブに依る部分の判定だけ**を出さない(部品化 ②-b2)。
 *
 * 副作用(`effects`)を持つ操作は、その副作用が「書き込みと同一トランザクションで実現される種別」のジョブかどうかで、
 * 定型 RPC で組めるか(= 実行計画が決まるか・`runner: manual` が要るか)が変わる。前の版は阻害のカタログを
 * 「ジョブが無い」と読んで空集合で判定していたので、欠けた事実から「導出できる」「manual は要らない」が出た
 * (Q3)。
 *
 * 確かめるのは 4 つ。
 *   1. 阻害のとき、副作用を持つ操作の判定(計画が組めない指摘・manual が要らない指摘・計算の材料の到達)を出さず、報告する
 *   2. 同じ入力でカタログが読込済みなら、判定は従来どおり出る(出さないのは阻害のときだけ)
 *   3. ジョブに依らない判定(副作用を持たない操作・前の段の問題・綴りの誤り)は阻害でも出る
 *   4. 未選択(製品がジョブを採っていない)は阻害ではない —— 「ジョブが無い」という事実どおりに判定する
 */

import { describe, expect, it } from 'vitest';
import { runTraceVerification } from '../../../../lib/trace/run.js';
import { runTrace } from '../../../../lib/verify/pipeline-trace.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import type { CatalogInput } from '../../../../lib/kernel/input-state.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import type { JobCatalogSpec } from '../../../../lib/model/job/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { computeFactsVerifier } from '../../../../lib/trace/verifiers/a19-compute-facts.js';
import { operationPlanVerifier } from '../../../../lib/trace/verifiers/a15-operation-plan.js';
import { eqCatalog } from '../../../../lib/world/index.js';
import { describeInputGapNote } from '../../../../lib/verify/check-run-report.js';
import type { PartialRun } from '../../../../lib/trace/verifier.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';
import { jobCatalog, outboxJob } from '../../../helpers/job-builder.js';
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
} from '../../../helpers/model-builder-v8plus.js';
import { actionSpec, traceInput } from '../../../helpers/trace-builder.js';

/** 実行結果のうち、ジョブの阻害のために判定を出さなかった記録(`gaps` の 1 本の口。理由と対象だけ取り出す)。 */
function jobGaps(run: PartialRun): readonly { readonly reason: string; readonly subjects: readonly string[] | undefined }[] {
  return run.gaps.flatMap((note) => (note.gap.input === 'jobs' && note.gap.state === 'blocked' ? [{ reason: note.gap.reason, subjects: note.subjects }] : []));
}

/** widget.send(副作用 notify を持つ)と widget.touch(副作用なし)の 2 遷移を持つドメイン。 */
function domain(): SpecModel {
  return specModel({
    roles: [role('anonymous'), role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'widget',
        entity: entitySpec('widget', [
          field('state', { kind: 'state', machine: 'widget' }, { required: true }),
          field('amount', { kind: 'integer' }),
        ]),
        stateMachines: [
          {
            ...machine({
              machine: 'widget',
              states: ['draft', 'sent'],
              initial: 'draft',
              events: [
                event({ id: 'send', from: ['draft'], to: 'sent', by: ['member'] }),
                event({ id: 'touch', from: ['sent'], to: 'sent', by: ['member'] }),
              ],
            }),
            effects: [{ on: 'send', do: ['notify'], location: { file: 'docs/specs/domain/widget/states.md' } }],
          },
        ],
        // `amount` は遷移が書く列(transition_writes)。send は計算値として書き、touch は触れない(空を渡す)。
        access: accessSpec('widget', { transitionWrites: ['amount'] }),
      }),
    ],
  });
}

/** 遷移 RPC 1 本(規約に載る引数 + 計算値の `p_amount`。`extra` を足すと規約に載らない引数になる)。 */
function tables(extra: readonly string[] = []): DataTableSpecModel {
  const params = ['p_widget_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_amount', ...extra];
  return dataTableModel([
    dataTable('widgets', {
      entity: 'widget',
      functions: [
        { name: 'apply_widget_transition', args: params.map(() => 'text'), params, kind: 'rpc', shape: 'transition', alsoWrites: [] },
      ],
    }),
  ]);
}

/** 副作用 notify が「同一トランザクションで実現される」種別のジョブを持つ、読込済みのカタログ。 */
const inTransactionJobs: CatalogInput<JobCatalogSpec> = {
  state: 'loaded',
  value: jobCatalog([outboxJob('notify', { kind: 'transaction_effect', inTransaction: true })]),
  findings: [],
};

/** 副作用 notify がキューに積まれる(同一トランザクションではない)ジョブを持つ、読込済みのカタログ。 */
const queuedJobs: CatalogInput<JobCatalogSpec> = {
  state: 'loaded',
  value: jobCatalog([outboxJob('notify')]),
  findings: [],
};

/** 採っているのに渡せない(読めない・壊れている)。 */
const blockedJobs: CatalogInput<JobCatalogSpec> = { state: 'blocked', reason: 'load-failed', findings: [] };

/** 採っていない。 */
const unselectedJobs: CatalogInput<JobCatalogSpec> = { state: 'unselected', findings: [] };

/** 検査の入力(`widget.send` と `widget.touch`)。 */
function inputWith(
  jobs: CatalogInput<JobCatalogSpec>,
  init: {
    readonly manual?: readonly string[];
    readonly computes?: boolean;
    readonly extraParams?: readonly string[];
    readonly computeReads?: readonly string[];
  } = {},
) {
  const manual = new Set(init.manual ?? []);
  const spec = (handles: string) =>
    actionSpec({
      handles,
      input: ['widget.id'],
      ...(manual.has(handles) ? { runner: { reason: '定型に乗らない' } } : {}),
      ...(init.computes === true && handles === 'widget.send'
        ? { computes: { 'widget.amount': 'computeAmount' }, computeReads: { 'widget.amount': init.computeReads ?? ['widget.amount'] } }
        : {}),
    });
  return traceInput({
    domain: domain(),
    guards: stubContext().guards,
    dataTables: tables(init.extraParams),
    actions: [spec('widget.send'), spec('widget.touch')],
    jobs,
  });
}

describe('A15 — ジョブが阻害のとき、副作用を持つ操作の判定を出さない', () => {
  it('読込済み(同一トランザクションの副作用)なら、計画が組めない指摘が出る(比較の基準)', () => {
    const run = operationPlanVerifier.runPartial(inputWith(inTransactionJobs));

    expect(run.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('widget.send の実行計画が仕様から決まりません')]);
    expect(jobGaps(run)).toEqual([]);
  });

  it('阻害なら、その指摘は出さず、判定を出さなかった操作を理由つきで報告する(欠けた事実で「組める」とも「組めない」とも言わない)', () => {
    const run = operationPlanVerifier.runPartial(inputWith(blockedJobs));

    expect(run.findings).toEqual([]);
    expect(jobGaps(run)).toEqual([{ reason: 'load-failed', subjects: ['widget.send'] }]);
  });

  it('runner: manual の操作: 読込済み(キューに積む)なら「manual は要らない」の error・阻害ならこの逆向きの判定を出さない', () => {
    const loaded = operationPlanVerifier.runPartial(inputWith(queuedJobs, { manual: ['widget.send'] }));
    const blocked = operationPlanVerifier.runPartial(inputWith(blockedJobs, { manual: ['widget.send'] }));

    expect(loaded.findings.map((finding) => finding.message)).toEqual([
      'widget.send は実行計画が導出できるのに runner: manual を宣言しています',
    ]);
    // 前の版は阻害のカタログを空として読み、同じ誤報(manual は要らない)を欠けた事実から出していた。
    expect(blocked.findings).toEqual([]);
    expect(jobGaps(blocked)).toEqual([{ reason: 'load-failed', subjects: ['widget.send'] }]);
  });

  it('副作用を持たない操作の判定は、阻害でも出る(ジョブに依らない判定を巻き込んで止めない)', () => {
    const run = operationPlanVerifier.runPartial(inputWith(blockedJobs, { manual: ['widget.touch'] }));

    expect(run.findings.map((finding) => finding.message)).toEqual([
      'widget.touch は実行計画が導出できるのに runner: manual を宣言しています',
    ]);
    expect(jobGaps(run)).toEqual([{ reason: 'load-failed', subjects: ['widget.send'] }]);
  });

  it('前の段(引数)の問題は、ジョブに依らないので阻害でも従来どおり出る', () => {
    const run = operationPlanVerifier.runPartial(inputWith(blockedJobs, { extraParams: ['p_whatever'] }));

    expect(run.findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('widget.send の実行計画が仕様から決まりません'),
      expect.stringContaining('widget.touch の実行計画が仕様から決まりません'),
    ]);
    // 引数の段で落ちた操作は、ジョブを見る段に届かない = ジョブに依る判定は元から無い
    expect(jobGaps(run)).toEqual([]);
  });

  it('未選択(製品がジョブを採っていない)は阻害ではない: 「ジョブが無い」事実どおりに判定し、何も出さなかったとは報告しない', () => {
    const run = operationPlanVerifier.runPartial(inputWith(unselectedJobs, { manual: ['widget.send'] }));

    expect(run.findings.map((finding) => finding.message)).toEqual([
      'widget.send は実行計画が導出できるのに runner: manual を宣言しています',
    ]);
    expect(jobGaps(run)).toEqual([]);
  });

  it('verify は runPartial と同じ違反だけを返す(呼び口が 2 つでも検査の本体は 1 つ)', () => {
    const input = inputWith(blockedJobs, { manual: ['widget.touch'] });

    expect(operationPlanVerifier.verify(input)).toEqual(operationPlanVerifier.runPartial(input).findings);
  });
});

describe('A19 — ジョブが阻害のとき、副作用を持つ操作の「材料が届くか」を出さない', () => {
  it('読込済み(キューに積む)なら、届かない材料は error になる(比較の基準)', () => {
    const run = computeFactsVerifier.runPartial(inputWith(queuedJobs, { computes: true, computeReads: ['widget.amount', 'widget.nowhere'] }));

    expect(run.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('widget.nowhere は entity_spec に実在しません')]);
    expect(jobGaps(run)).toEqual([]);
  });

  it('阻害でも、綴りの誤り(欄の実在)は計画に依らないので出る。計画に依る判定は出さず、対象を報告する', () => {
    const run = computeFactsVerifier.runPartial(inputWith(blockedJobs, { computes: true, computeReads: ['widget.nowhere'] }));

    expect(run.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('widget.nowhere は entity_spec に実在しません')]);
    expect(jobGaps(run)).toEqual([{ reason: 'load-failed', subjects: ['widget.send'] }]);
  });

  it('材料の宣言が 1 本も無い警告(計画に依る)も、阻害のあいだ副作用を持つ操作では出さない', () => {
    const loaded = computeFactsVerifier.runPartial(inputWith(queuedJobs, { computes: true, computeReads: [] }));
    const blocked = computeFactsVerifier.runPartial(inputWith(blockedJobs, { computes: true, computeReads: [] }));

    expect(loaded.findings.map((finding) => finding.severity)).toEqual(['warning']);
    expect(blocked.findings).toEqual([]);
    expect(jobGaps(blocked).map((gap) => gap.subjects)).toEqual([['widget.send']]);
  });

  it('computes を持たない製品・runner: manual の操作は、出さなかった判定が無いので何も報告しない', () => {
    expect(jobGaps(computeFactsVerifier.runPartial(inputWith(blockedJobs)))).toEqual([]);
    // manual は計画を持たないので、この検査は元から計画の到達を見ない
    expect(jobGaps(computeFactsVerifier.runPartial(inputWith(blockedJobs, { computes: true, manual: ['widget.send'] })))).toEqual([]);
  });

  it('data_table が使えない環境では計画が組めず、ジョブに依る判定もない(ジョブの記録は無い。見ていないことはテーブル仕様の gaps が言う)', () => {
    const input = { ...inputWith(blockedJobs, { computes: true }), dataTables: { state: 'blocked', reason: 'missing', findings: [] } } as const;
    const run = computeFactsVerifier.runPartial(input);

    expect(jobGaps(run)).toEqual([]);
    expect(run.gaps.map((note) => [note.gap, note.subjects])).toEqual([[{ input: 'data_tables', state: 'blocked', reason: 'missing' }, ['widget.send']]]);
    expect(computeFactsVerifier.verify(input)).toEqual([]);
  });
});

describe('T11 の目録 — ジョブが阻害のとき、副作用を持つ操作は目録に載せない(欠けた事実で一致の証明を組まない)', () => {
  const opsOf = (extra: { readonly jobsBlocked?: boolean }) => {
    const input = inputWith(queuedJobs);
    return eqCatalog({ domain: input.domain, guards: stubContext().guards, actions: input.actions, dataTables: tables(), jobs: undefined, ...extra }).flatMap((entry) => entry.ops);
  };

  it('阻害でない(印なし)なら副作用を持つ操作も載り、阻害の印があれば副作用を持つ操作だけが外れる(ジョブに依らない操作は載る)', () => {
    expect(opsOf({})).toEqual(expect.arrayContaining(['widget.send', 'widget.touch']));
    expect(opsOf({ jobsBlocked: false })).toEqual(opsOf({}));
    expect(opsOf({ jobsBlocked: true })).toContain('widget.touch');
    expect(opsOf({ jobsBlocked: true })).not.toContain('widget.send');
  });
});

describe('一部の判定を出さなかった検査の報告の文面(使えなかった入力の行の書き方 1 本)', () => {
  const jobsGap = (reason: 'invalid' | 'missing', subjects: readonly string[]) => ({
    gap: { input: 'jobs', state: 'blocked', reason } as const,
    consequence: 'jobs に依る判定は出していません(ほかの判定は実行済み)',
    subjects,
  });

  it('対象を名指しして、ほかの判定は実行済みと言う(阻害の語なので範囲が縮んだ件数に数えられる)', () => {
    const line = describeInputGapNote('A15', jobsGap('invalid', ['a.x', 'b.y']));

    expect(line).toBe(
      'A15: 阻害 — jobs を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない。' +
        '原因の error は各種類の読み込みの診断と P 群が出している)ため、jobs に依る判定は出していません(ほかの判定は実行済み)(対象 2 件: a.x・b.y)。',
    );
  });

  it('対象が多いときは先頭だけ並べて残りは件数で言う', () => {
    const subjects = ['a.1', 'a.2', 'a.3', 'a.4', 'a.5', 'a.6', 'a.7'];
    const line = describeInputGapNote('A19', jobsGap('missing', subjects));

    expect(line).toContain('対象 7 件: a.1・a.2・a.3・a.4・a.5 ほか 2 件');
    expect(line).not.toContain('a.6');
  });
});

describe('実行口と実行ログ — 一部の判定を出さなかった検査が結果と行に載る', () => {
  /** 実行口を通す(app/ は無い環境。ここで見るのは検査の起動と報告だけ)。 */
  function runWith(jobs: CatalogInput<JobCatalogSpec>) {
    const input = inputWith(jobs, { manual: ['widget.send'] });
    const options = {
      actions: loadedInput(input.actions),
      appRoot: null,
      repoRoot: '/nonexistent',
      roots: TEST_ROOTS,
      layout: TEST_LAYOUT,
      registry: input.registry,
      jobs,
      dataTables: input.dataTables,
      external: UNSELECTED,
      guards: stubContext().guards,
    };
    return { input, options, result: runTraceVerification(input.domain, options) };
  }

  it('阻害なら gapRuns に A15 が載り(検査全体の阻害ではないので checkRuns の阻害は A13 だけ)、読込済みなら載らない', () => {
    const blocked = runWith(blockedJobs).result;
    const loaded = runWith(queuedJobs).result;

    expect(blocked.gapRuns.map((entry) => [entry.id, entry.note.gap.input, entry.note.subjects])).toEqual([['A15', 'jobs', ['widget.send']]]);
    expect(blocked.checkRuns.map((entry) => [entry.id, entry.run.status])).toEqual([['A13', 'blocked']]);
    expect(blocked.findings.filter((finding) => finding.verifier === 'A15')).toEqual([]);
    expect(loaded.gapRuns).toEqual([]);
    expect(loaded.findings.filter((finding) => finding.verifier === 'A15')).toHaveLength(1);
  });

  it('実行ログは A13 の阻害と A15 の一部阻害を 1 行ずつ出す(どちらも範囲が縮んだ報告として数えられる形)', () => {
    const { input, options } = runWith(blockedJobs);
    const lines: string[] = [];

    runTrace(
      {
        model: input.domain,
        domainRoot: '/nonexistent/docs/specs/domain',
        actions: loadedInput(input.actions),
        registry: options.registry,
        jobs: blockedJobs,
        dataTables: options.dataTables,
        guards: options.guards,
        external: UNSELECTED,
        roots: TEST_ROOTS,
        layout: TEST_LAYOUT,
        usecases: UNSELECTED,
      },
      (line) => lines.push(line),
    );

    expect(lines.filter((line) => /^A\d+: 阻害 — /.test(line)).map((line) => line.slice(0, 4))).toEqual(['A13:', 'A15:']);
  });
});
