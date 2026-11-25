/**
 * T 群の入力の状態(束 入力の状態-c の項目 1・3・4)を、実行口 `runDataTableVerification` と配線 `runDataTables` で確かめる。
 *
 *   1. **テーブル仕様の選択と阻害が end-to-end で伝わる**: 未選択は従来のスキップの行・阻害は「T1〜T18: 阻害 — …」で
 *      見ていないことを名指す(部分のモデルや、置き場に無いモデルで T 群を回さない)・読込済み(0 件含む)は実行する
 *   3. **T 群が裏づけに読むほかの種類**(T6 / T17 の actions・T11 の actions / jobs / usecases・T19 / T22 の jobs・T12 の usecases / external / surface):
 *      阻害なら依る判定を出さず段ごとに名指す・未選択なら裏づけが無い事実として判定する(行なし)・読込済みなら何も言わない
 *   4. **段が飛ぶ条件は入力の状態だけ**: 登録の段の `reads` の宣言が、報告の唯一の源である
 *
 * 読めているときの判定が変わっていないことは、製品と 6 題材の verify の全文比較で見る(行は 1 本も出ない)。
 */

import { describe, expect, it } from 'vitest';
import { runDataTables, type DataRunArgs } from '../../../lib/compose/verify-pipeline-groups.js';
import { DATA_STEPS, dataStepGaps } from '../../../lib/data/checks.js';
import { narrowStepInput, stepInputOf } from '../../../lib/data/input.js';
import { runDataTableVerification } from '../../../lib/data/run.js';
import type { CatalogInput } from '../../../lib/kernel/input-state.js';
import type { DataBackingKind } from '../../../lib/data/input.js';
import type { QuerySpecModel } from '../../../lib/model/query/types.js';
import { isSkipNote } from '../../../lib/verify/skip-notes.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { externalCatalog } from '../../helpers/external-builder.js';
import { jobCatalog } from '../../helpers/job-builder.js';
import { aggregate, entitySpec, field, role, roleSpec, specModel } from '../../helpers/model-builder.js';
import { TEST_LAYOUT, TEST_PLATFORM } from '../../helpers/platform.js';
import { QUERY_CTX } from '../../helpers/query-builder.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { scanResult, traceInput } from '../../helpers/trace-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../helpers/verify-inputs.js';

const domain = () =>
  specModel(
    [
      aggregate('workshop', {
        entity: entitySpec('workshop', {
          fields: [field('id', { kind: 'uuid' }, { auto: true }), field('starts_at', { kind: 'datetime' })],
        }),
      }),
    ],
    roleSpec(['member', role('organizer', 'workshop.organizer_id == actor.id')]),
  );

/** 実在する集約に結びつく表(T 群の判定が少なくとも 1 件は出る = 実行したかを見分けられる)と、実在しない集約に結びつく表(T1 の error)。 */
const goodTables = () => dataTableModel([dataTable('workshops', { entity: 'workshop' })]);
const brokenTables = () => dataTableModel([dataTable('ghosts', { entity: 'ghost' })]);

/** 採っていない裏づけの組(裏づけが無い事実)。 */
const NO_BACKING = { actions: UNSELECTED, jobs: UNSELECTED, usecases: UNSELECTED, external: UNSELECTED, surface: UNSELECTED } as const;

const queriesLoaded: CatalogInput<QuerySpecModel> = loadedInput({ available: true, queries: [] });

const actionsModel = () => traceInput({ domain: domain() }).actions;

const args = (overrides: Partial<DataRunArgs> = {}): DataRunArgs => ({
  model: domain(),
  dataTables: loadedInput(goodTables()),
  queries: queriesLoaded,
  guards: QUERY_CTX.guards,
  registry: buildTcRegistry([]),
  tests: scanResult({ available: true }),
  ...NO_BACKING,
  roots: TEST_ROOTS,
  platform: TEST_PLATFORM,
  layout: TEST_LAYOUT,
  repoRoot: '/nonexistent-repo-root',
  ...overrides,
});

const runInput = (overrides: Partial<DataRunArgs> = {}) => {
  const { model, ...rest } = args(overrides);
  return { domain: model, ...rest };
};

const logOf = (overrides: Partial<DataRunArgs> = {}): { readonly lines: string[]; readonly findings: ReturnType<typeof runDataTables> } => {
  const lines: string[] = [];
  const findings = runDataTables(args(overrides), (line) => lines.push(line));
  return { lines, findings };
};

describe('項目 1 — テーブル仕様の選択と阻害が end-to-end で伝わる', () => {
  it('読込済み(0 件も)は実行する: tablesGap は無く、要約行だけ(阻害の行は出ない)', () => {
    for (const tables of [goodTables(), dataTableModel([])]) {
      const result = runDataTableVerification(runInput({ dataTables: loadedInput(tables) }));
      const { lines } = logOf({ dataTables: loadedInput(tables) });

      expect(result).toMatchObject({ available: true, tablesGap: null, tableCount: tables.tables.length });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('T1〜T18 を実行しました');
    }
  });

  it('未選択: T 群は 1 本も実行せず(置き場に表があっても)、従来のスキップの行だけ(採っていないなら正しく飛んだ。阻害の行は出さない)', () => {
    const result = runDataTableVerification(runInput({ dataTables: UNSELECTED }));
    const { lines } = logOf({ dataTables: UNSELECTED });

    expect(result).toMatchObject({ available: false, findings: [], tablesGap: { input: 'data_tables', state: 'unselected' }, stepGaps: [], indexGaps: [] });
    expect(lines).toEqual(['T 群(テーブル仕様): specs/backend/data/tables が無いためスキップしました。']);
  });

  it.each([
    ['not-loaded', '読み込みが行われていない'],
    ['missing', '置き場に仕様が無い'],
    ['load-failed', '読めない・壊れている'],
    ['invalid', '読めなかった仕様があってモデルが欠けている、または欠けていないと言えない'],
  ] as const)('阻害(%s): T 群は 1 本も実行せず、「T1〜T18: 阻害 — …」の 1 行で見ていないことを名指す(範囲が縮んだ件数に数えられる形)', (reason, text) => {
    const { lines, findings } = logOf({ dataTables: blockedInput<never>(reason) });

    expect(findings).toEqual([]);
    expect(lines).toEqual([
      `T1〜T18: 阻害 — data_tables を採っているが検査へ渡せない(${text}。原因の error は各種類の読み込みの診断と P 群が出している)` +
        'ため、テーブル仕様の検査(T1〜T18)は見ていません。',
    ]);
    expect(isSkipNote(lines[0] ?? '')).toBe(true);
  });

  it('阻害のとき、部分のモデルの違反は出ない(読込済みなら T1 が error を出す同じ表でも)', () => {
    const loaded = runDataTableVerification(runInput({ dataTables: loadedInput(brokenTables()) }));
    const blocked = runDataTableVerification(runInput({ dataTables: blockedInput<never>('invalid') }));

    expect(loaded.findings.some((finding) => finding.verifier === 'T1')).toBe(true);
    expect(blocked.findings).toEqual([]);
    expect(blocked.tablesGap).toEqual({ input: 'data_tables', state: 'blocked', reason: 'invalid' });
  });
});

/** 裏づけの種類ごとに、阻害にした入力。 */
const blockedBacking = (kind: DataBackingKind): Partial<DataRunArgs> => ({ [kind]: blockedInput<never>('load-failed') });

/** 裏づけの種類ごとに、読込済みにした入力。 */
const loadedBacking: Readonly<Record<DataBackingKind, Partial<DataRunArgs>>> = {
  actions: { actions: loadedInput(actionsModel()) },
  jobs: { jobs: loadedInput(jobCatalog([])) },
  usecases: { usecases: loadedInput({ available: true, usecases: [] }) },
  external: { external: loadedInput(externalCatalog([])) },
  surface: { surface: loadedInput({ available: true, spec: null }) },
};

describe('項目 3 — T 群が裏づけに読むほかの種類', () => {
  /** 裏づけの種類 → 見ていないことが言われる段(登録の順)。 */
  const AFFECTED: Readonly<Record<DataBackingKind, readonly string[]>> = {
    actions: ['T6', 'T17', 'T11'],
    jobs: ['T19', 'T22', 'T28', 'T26', 'T24', 'T11'],
    usecases: ['T12', 'T11'],
    external: ['T12'],
    surface: ['T12'],
  };

  it.each(Object.entries(AFFECTED))('%s が阻害: 依る段 %j を名指す(段ごとに 1 件・阻害された入力として)', (kind, steps) => {
    const result = runDataTableVerification(runInput(blockedBacking(kind as DataBackingKind)));

    expect(result.stepGaps.map((entry) => [entry.id, entry.note.gap])).toEqual(
      steps.map((id) => [id, { input: kind, state: 'blocked', reason: 'load-failed' }]),
    );
  });

  it.each(Object.keys(AFFECTED))('%s が未選択: 裏づけが無い事実として判定し、行は出さない', (kind) => {
    const result = runDataTableVerification(runInput({ [kind]: UNSELECTED }));

    expect(result.stepGaps).toEqual([]);
    expect(logOf({ [kind]: UNSELECTED }).lines).toHaveLength(1);
  });

  it.each(Object.keys(AFFECTED))('%s が読込済み: 何も言わない', (kind) => {
    const overrides = loadedBacking[kind as DataBackingKind];

    expect(runDataTableVerification(runInput(overrides)).stepGaps).toEqual([]);
    expect(logOf(overrides).lines).toHaveLength(1);
  });

  it('実行ログは要約行の後に、段ごとの「阻害 — …は見ていません」を 1 行ずつ出す(範囲が縮んだ件数に数えられる)', () => {
    const { lines } = logOf({ actions: blockedInput<never>('invalid') });

    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(
      'T6: 阻害 — actions を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない。原因の error は各種類の読み込みの診断と P 群が出している)' +
        'ため、作成・編集の関数で、宣言した input の欄が本文に届くかは見ていません。',
    );
    expect(lines[2]).toContain('T17: 阻害 — actions を採っているが検査へ渡せない(');
    expect(lines[2]).toContain('ため、凍らせた列を作成でない操作の computes が書くかは見ていません。');
    expect(lines[3]).toContain('T11: 阻害 — actions を採っているが検査へ渡せない(');
    expect(lines[3]).toContain('ため、操作ごとの一致の証明(engine ⇔ RPC)を生成できるかは見ていません。');
    expect(lines.slice(1).every(isSkipNote)).toBe(true);
  });

  it('surface が阻害のとき、surface_spec の宣言が無いことを「grants_migration の宣言が無い」と誤報しない。未選択・宣言の無い読込済みは従来どおり事実として error', () => {
    const grantsMessages = (overrides: Partial<DataRunArgs>) =>
      runDataTableVerification(runInput(overrides))
        .findings.filter((finding) => finding.verifier === 'T12' && finding.message.includes('grants_migration'))
        .map((finding) => finding.message);

    expect(grantsMessages({ surface: blockedInput<never>('load-failed') })).toEqual([]);
    expect(grantsMessages({ surface: UNSELECTED })).toEqual(['表が 1 枚あるのに surface_spec の grants_migration の宣言がありません']);
    expect(grantsMessages({ surface: loadedInput({ available: true, spec: null }) })).toHaveLength(1);
  });

  it('T11 は action_spec が読込済みのときだけ回る(未選択も阻害も回さない。阻害のときだけ名指す)', () => {
    const t11 = DATA_STEPS.find((step) => step.id === 'T11');

    expect(t11?.reads?.map((read) => read.kind)).toEqual(['actions', 'jobs', 'usecases']);
    expect(dataStepGaps(runInput({ actions: UNSELECTED })).filter((entry) => entry.id === 'T11')).toEqual([]);
    expect(dataStepGaps(runInput({ actions: blockedInput<never>('missing') })).filter((entry) => entry.id === 'T11')).toHaveLength(1);
  });
});

/** 完全な段の入力(裏づけを全部読込済みにしたときの、実行口が配る前の入力)。 */
const fullStepInput = () => {
  const everything = runInput({ ...loadedBacking.actions, ...loadedBacking.jobs, ...loadedBacking.usecases, ...loadedBacking.external, ...loadedBacking.surface });
  return stepInputOf(everything, goodTables());
};

/** 裏づけの欄と、阻害の印の欄(段の入力のうち、宣言した種類に依って現れるもの)。 */
const BACKING_KEYS = ['actions', 'jobs', 'usecases', 'external', 'surface', 'jobsBlocked', 'surfaceBlocked'];

/** 種類を宣言したとき、段の入力に現れる欄(ジョブと surface は阻害の印も付く)。 */
const keysOf = (kind: DataBackingKind): string[] => [kind, ...(kind === 'jobs' ? ['jobsBlocked'] : []), ...(kind === 'surface' ? ['surfaceBlocked'] : [])];

describe('項目 1(c2) — 段へ渡る入力は reads に宣言した裏づけだけ(宣言と実際の読み取りが一致する)', () => {
  it('完全な入力は、裏づけの欄を全部持つ(絞る前の入力)', () => {
    expect(Object.keys(fullStepInput()).filter((key) => BACKING_KEYS.includes(key)).sort()).toEqual([...BACKING_KEYS].sort());
  });

  it.each(DATA_STEPS.map((step) => [step.id, step] as const))('%s: 絞った入力に現れる裏づけの欄は、宣言した種類(とその阻害の印)だけ', (_id, step) => {
    const narrowed = narrowStepInput(fullStepInput(), step.reads.map((read) => read.kind));

    const declared = step.reads.flatMap((read) => keysOf(read.kind)).sort();
    expect(Object.keys(narrowed).filter((key) => BACKING_KEYS.includes(key)).sort()).toEqual(declared);
  });

  it('宣言した種類が読込済みでなければ、その欄は渡らない(未選択も阻害も undefined。印だけが阻害を伝える)', () => {
    const blockedJobs = stepInputOf(runInput({ jobs: blockedInput<never>('missing') }), goodTables());
    const narrowed = narrowStepInput(blockedJobs, ['jobs', 'surface'] as const);

    expect(narrowed.jobs).toBeUndefined();
    expect(narrowed.jobsBlocked).toBe(true);
    expect(narrowed.surfaceBlocked).toBe(false);
  });

  it('宣言に無い裏づけを読もうとすると型が落ちる(型検査がこの行で赤くなる = 宣言を足し忘れて読めない)', () => {
    const narrowed = narrowStepInput(fullStepInput(), ['actions'] as const);

    expect(narrowed.actions).toBeDefined();
    // @ts-expect-error jobs は宣言していないので、段の入力の型にも実行時の欄にも無い
    expect(narrowed.jobs).toBeUndefined();
  });

  it('報告(dataStepGaps)の源も同じ宣言: 全部の裏づけが阻害のとき、段の並び・宣言の並びの順に 1 件ずつ', () => {
    const everything = runInput({
      actions: blockedInput<never>('missing'),
      jobs: blockedInput<never>('missing'),
      usecases: blockedInput<never>('missing'),
      external: blockedInput<never>('missing'),
      surface: blockedInput<never>('missing'),
    });
    const declared = DATA_STEPS.flatMap((step) => step.reads.map((read) => [step.id, read.kind]));

    expect(dataStepGaps(everything).map((entry) => [entry.id, entry.note.gap.input])).toEqual(declared);
    expect(declared).toEqual([
      ['T6', 'actions'],
      ['T12', 'usecases'],
      ['T12', 'external'],
      ['T12', 'surface'],
      ['T17', 'actions'],
      ['T19', 'jobs'],
      ['T22', 'jobs'],
      ['T28', 'jobs'],
      ['T26', 'jobs'],
      ['T24', 'jobs'],
      ['T11', 'actions'],
      ['T11', 'jobs'],
      ['T11', 'usecases'],
    ]);
  });

  it('台帳・走査結果・ガード式のパーサー・リポジトリルートは必須: T3 は「渡されなかったから飛ぶ」条件を持たず、台帳の宣言を見る', () => {
    // 台帳に無いテストケースの宣言(表が宣言する TC)は T3 が拾う = 段は台帳があれば常に回る。
    const result = runDataTableVerification(runInput({ dataTables: loadedInput(goodTables()) }));

    expect(result.findings.some((finding) => finding.verifier === 'T3')).toBe(true);
  });
});

/** 表ごとに自己完結の段(T17 は関数だけを見る)が拾う違反を持つ表と、全体を前提とする段(T1)が拾う違反を持つ表。 */
const TRIGGER_FN = { name: 'fire_it', args: [], params: [], kind: 'trigger', alsoWrites: [] } as const;
const partialTables = () => dataTableModel([dataTable('workshops', { entity: 'workshop', functions: [TRIGGER_FN] }), dataTable('ghosts', { entity: 'ghost' })]);
const partialInput = (): CatalogInput<ReturnType<typeof partialTables>> => ({ state: 'blocked', reason: 'invalid', findings: [], partial: partialTables() });

describe('項目 3(c2) — 仕様を落としたとき、自己完結の段は読めた分で回し、表の全体を前提とする段だけ止めて名指す', () => {
  const whole = DATA_STEPS.filter((step) => step.needsWhole).map((step) => step.id);
  const selfContained = DATA_STEPS.filter((step) => !step.needsWhole).map((step) => step.id);

  it('段の分類は登録の宣言(needsWhole)に乗り、T1(エンティティに表があるか)・T2・T3・T5〜T8・T11〜T14・T16・T19〜T28 は全体を前提とする', () => {
    expect([...whole].sort()).toEqual(['T1', 'T11', 'T12', 'T13', 'T14', 'T16', 'T19', 'T2', 'T20', 'T21', 'T22', 'T23', 'T24', 'T25', 'T26', 'T27', 'T28', 'T3', 'T5', 'T6', 'T7', 'T8']);
    expect([...selfContained].sort()).toEqual(['T10', 'T15', 'T17', 'T18', 'T4', 'T9']);
  });

  it('読込済みなら全段を回す(分類は読込済みの結果を変えない)。同じ表で T1 も T17 も出る', () => {
    const result = runDataTableVerification(runInput({ dataTables: loadedInput(partialTables()) }));

    expect(result.ranIds).toEqual(DATA_STEPS.map((step) => step.id));
    expect(result.wholeGaps).toEqual([]);
    expect(result.findings.some((finding) => finding.verifier === 'T1')).toBe(true);
    expect(result.findings.some((finding) => finding.verifier === 'T17')).toBe(true);
  });

  it('仕様を落とした阻害(partial つき): 自己完結の段だけ読めた表で回す(T17 は出る・T1 は偽の error を出さない)', () => {
    const result = runDataTableVerification(runInput({ dataTables: partialInput() }));

    expect(result).toMatchObject({ available: true, tableCount: 2, tablesGap: { input: 'data_tables', state: 'blocked', reason: 'invalid' }, indexGaps: [] });
    expect(result.ranIds).toEqual(DATA_STEPS.filter((step) => !step.needsWhole).map((step) => step.id));
    expect(result.findings.some((finding) => finding.verifier === 'T17')).toBe(true);
    expect(result.findings.filter((finding) => whole.includes(finding.verifier))).toEqual([]);
  });

  it('止めた段は 1 件ずつ名指す(止めた段の ID の並びは登録の順)。阻害の入力ごとの欠け(stepGaps)は回した段の分だけ', () => {
    const result = runDataTableVerification(runInput({ dataTables: partialInput(), actions: blockedInput<never>('missing') }));

    expect(result.wholeGaps.map((entry) => entry.id)).toEqual(DATA_STEPS.filter((step) => step.needsWhole).map((step) => step.id));
    expect(result.wholeGaps.every((entry) => entry.note.gap.state === 'blocked' && entry.note.gap.input === 'data_tables')).toBe(true);
    // actions に依る T6 / T11 は全体を前提とする段なので止めている。回した段で actions を読むのは T17(凍結の computes)だけで、その欠けを名指す。
    expect(result.stepGaps.map((entry) => [entry.id, entry.note.gap.input])).toEqual([['T17', 'actions']]);
  });

  it('partial の無い阻害(置き場が無い・読めない・構築できない)は従来どおり 1 本も回さない', () => {
    for (const reason of ['not-loaded', 'missing', 'load-failed', 'invalid'] as const) {
      const result = runDataTableVerification(runInput({ dataTables: blockedInput<never>(reason) }));

      expect(result).toMatchObject({ available: false, findings: [], ranIds: [], wholeGaps: [] });
    }
  });

  it('実行ログ: 要約行は回した段の ID を並べ、止めた段は「阻害 — …は見ていません」を 1 行ずつ(範囲が縮んだ件数に数えられる)', () => {
    const lines: string[] = [];
    runDataTables(args({ dataTables: partialInput() }), (line) => lines.push(line));

    expect(lines[0]).toBe(`T 群(テーブル仕様): 読めた data_table 2 件に対し ${selfContained.join('・')} を実行しました。`);
    expect(lines.slice(1).map((line) => line.slice(0, line.indexOf(':')))).toEqual(DATA_STEPS.filter((step) => step.needsWhole).map((step) => step.id));
    expect(lines[1]).toContain('阻害 — data_tables を採っているが検査へ渡せない(');
    expect(lines[1]).toContain('ため、表の全体を前提とする判定(欠けた表が偽の指摘を生む)は見ていません(表ごとに自己完結の検査は読めた分で実行済み)。');
    expect(lines.slice(1).every(isSkipNote)).toBe(true);
  });
});
