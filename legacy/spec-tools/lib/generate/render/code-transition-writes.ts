/**
 * 状態機械 + データテーブル + 個人データ宣言 + 効果カタログ → 遷移が書いてよい列の期待表(`app/src/domain/generated/transition-writes.ts`)の生成器。
 *
 * ウォーカーのオラクル（`app/e2e/walker-oracle*.mts`）が「遷移に伴う列の書き込み」を
 * `access_spec.writes` の `writes[].violated` として誤検出しないために要る 2 つの期待を、
 * 手で書き写さずに仕様から機械的に引く。
 *
 *   (a) **状態列の完全集合**: 1 つのテーブルが直交する複数の状態機械を持つ場合
 *       (進行の状態と掲載の状態のように、同じ行で独立に動く 2 本)、entity_spec の
 *       `type: state(...)` フィールドがそれを宣言している。オラクルは `state` 列だけを
 *       特別扱いせず、ここに載る列は**すべて**「遷移でしか動かない列」として除外できる。
 *   (b)(c) **個人データの匿名化**: 効果カタログが `anonymizes: {集約}` で宣言した効果(job_spec。
 *       「この効果はその集約の `personal` 列を placeholder に書き換える」)を、その集約の状態機械の
 *       `effects` に持つ遷移だけが、(b) 自分の行の `personal` 列すべて(`anonymizedColumns`)と
 *       (c) その遷移の複合 RPC の `also_writes` が指す別テーブルのうち `personal` 列を持つもの
 *       **すべて**(`cascades`)を書いてよい。`also_writes` は仕様の宣言であり、オラクルはそれを
 *       信じてよい(裁定 2026-09-04)。連鎖先が `ref(この集約)` 型のフィールドを持てば `refColumn` を
 *       添えて「起点行を指す行だけ」に絞る。持たない表(例: `program_items` — `entry_id` の 2 段参照
 *       しか無い)は `refColumn` を持たせず、その手の間はテーブル全体で免除する(1 手ごとの差分なので
 *       精度の損失は小さい)。匿名化の効果を持たない遷移は両方とも空である。**かつては `by: system`
 *       行と「同一トランザクションで実現される効果」の種別から推測していた**(F-erase で宣言から読む形に置き換えた)。
 *   (d) **`ownColumns`(personal でない列の近似)**: `transition_writes` と、どれかの遷移の `computes` が書く自分の列
 *       (計算で決まる列。別の集約の遷移も含む)の和。DSL にイベント単位の「遷移が書く欄」が無いための近似で、
 *       集約単位(どのイベントでも同じ集合)。**免除の由来は 2 つ** —— personal 列 = 匿名化の宣言
 *       (`anonymizedColumns` / `cascades`)・それ以外 = `ownColumns`。計算で決まる列は以前 `writes` の `by: system` の
 *       行で近似していたが、その行は編集の経路を作るので computes の宣言から導く(2026-10-20。V18)。
 *
 * 複合 RPC がテーブルに 2 本以上ある集約は、どちらの RPC がこのイベントに対応するかを宣言から
 * 一意に決められないため、連鎖の対象にしない(黙って間違った表を連鎖させるより連鎖 0 件の安全側に
 * 倒す。`anonymizedColumns` は自分の行の話なので RPC の本数に依らない)。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である(scripts-code-quality.md)。
 */

import type { EntitySpec, EventDef, SpecModel, StateMachineSpec } from '../../model/types.js';
import { allMachines } from '../../model/types.js';
import { alsoWritesOf, findRealizedRpcs, realizingRpcName } from '../../model/data/realized-rpcs.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { ActionSpec } from '../../model/trace/types.js';
import { transitionComputedColumns } from '../../semantics/computed-columns.js';
import { groundOperation } from '../../semantics/operation-ground.js';
import { pluralizeEntity } from '../../model/table-name.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral, type LiteralValue } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 期待表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'transition-writes.ts');

/** エンティティの物理テーブル名(entity_spec の table 上書きが無ければ既定の複数形化)。 */
function tableOf(entity: EntitySpec): string {
  return entity.table ?? pluralizeEntity(entity.entity);
}

/** そのイベントに紐づく副作用(outbox ジョブ ID)。code-transitions.ts の同名ヘルパーと同じ規則。 */
function effectsFor(machine: StateMachineSpec, eventId: string): readonly string[] {
  const jobs: string[] = [];
  for (const effect of machine.effects) {
    if (effect.on !== eventId) continue;
    for (const job of effect.do) jobs.push(job);
  }
  return jobs;
}

/** 1 集約分の、事前計算しておく値。 */
interface AggregateContext {
  readonly entity: EntitySpec;
  readonly table: string;
  /** `transition_writes` と、遷移の `computes` が書くフィールド(personal でない列の近似。集約単位)。 */
  readonly ownSystemColumns: readonly string[];
  /** 自分の personal 列(entity_spec `personal: true`。宣言順)。匿名化の効果が書き換える列。 */
  readonly ownPersonalColumns: readonly string[];
}

/**
 * 全 entity_spec から状態列の期待表(table → state(...) フィールド)を組み立てる。
 * `type: state(...)` を持たないテーブルもキーを持つ(閉世界)。
 */
function stateColumnsLiteral(entities: readonly EntitySpec[]): Record<string, LiteralValue> {
  const byTable: Record<string, LiteralValue> = {};
  for (const entity of entities) {
    const columns: LiteralValue[] = [];
    for (const field of entity.fields) {
      if (field.type.kind !== 'state') continue;
      columns.push({ column: field.name, machine: field.type.machine });
    }
    byTable[tableOf(entity)] = columns;
  }
  return byTable;
}

/** 集約ごとの事前計算値(entity_spec を持つ集約だけ)。 */
function aggregateContextsByName(model: SpecModel, actions: readonly ActionSpec[]): ReadonlyMap<string, AggregateContext> {
  const result = new Map<string, AggregateContext>();
  for (const [aggregate, specs] of model.aggregates) {
    const entity = specs.entity;
    if (entity === undefined) continue;
    const computed = transitionComputedColumns(model, actions, entity.entity);
    const ownSystemColumns = [...new Set([...(specs.access?.transitionWrites ?? []), ...computed])];
    const ownPersonalColumns = entity.fields.filter((field) => field.personal).map((field) => field.name);
    result.set(aggregate, { entity, table: tableOf(entity), ownSystemColumns, ownPersonalColumns });
  }
  return result;
}

/**
 * 連鎖先候補(`also_writes` に載っているテーブルのうち `personal` 列を持つもの)を集める。
 *
 * `also_writes` は data_table の宣言であり、RPC が実際に書くと言っている表の全数
 * (オラクルはこれを信用してよい — 裁定 2026-09-04)。`ref(aggregate)` 型のフィールドを
 * 持つ表は `refColumn` を添えて「起点行を指す行だけ」に絞り込める(entries.owner_id 等)。
 * 持たない表(2 段以上の参照でしかつながらない。例: program_items は entry_id 経由でしか
 * member に届かない)は `refColumn` を持たせない — ウォーカー側はその場合、その手の間
 * テーブル全体でその列の書き込みを免除する(1 手ごとの粒度なので精度の損失は小さい)。
 */
function cascadeTargetsFor(
  aggregate: string,
  ownTable: string,
  alsoWrites: readonly string[],
  allEntities: readonly EntitySpec[],
): LiteralValue[] {
  const targets: LiteralValue[] = [];
  for (const other of allEntities) {
    const table = tableOf(other);
    if (table === ownTable) continue; // 自分の表は anonymizedColumns 側の管轄
    if (!alsoWrites.includes(table)) continue;
    const personalColumns = other.fields.filter((field) => field.personal).map((field) => field.name);
    if (personalColumns.length === 0) continue;
    const refField = other.fields.find((field) => field.type.kind === 'ref' && field.type.entity === aggregate);
    const target: Record<string, LiteralValue> = { table };
    if (refField !== undefined) target['refColumn'] = refField.name;
    target['columns'] = personalColumns;
    targets.push(target);
  }
  return targets;
}

/** 1 イベント分のエントリ。`anonymizing` = そのイベントに匿名化の効果が載っているか(`ownColumns` は依らない)。 */
function operationLiteral(
  event: EventDef,
  ctx: AggregateContext,
  anonymizing: boolean,
  cascades: readonly LiteralValue[],
): LiteralValue {
  return {
    ownTable: ctx.table,
    from: event.from,
    to: event.to,
    ownColumns: ctx.ownSystemColumns,
    anonymizedColumns: anonymizing ? ctx.ownPersonalColumns : [],
    cascades: anonymizing ? cascades : [],
  };
}

/** 集約 → その集約を匿名化する効果(カタログの `anonymizes`)のジョブ ID。 */
function anonymizeJobsByAggregate(ctx: GenerateContext): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, Set<string>>();
  if (ctx.jobs?.available !== true || ctx.jobs.catalog === null) return result;
  for (const job of ctx.jobs.catalog.jobs) {
    if (job.anonymizes === undefined) continue;
    const ids = result.get(job.anonymizes) ?? new Set<string>();
    ids.add(job.id);
    result.set(job.anonymizes, ids);
  }
  return result;
}

/** 全集約から遷移書き込み期待表を組み立てる。 */
function renderFile(model: SpecModel, ctx: GenerateContext, sourceFiles: readonly string[]): string {
  const allEntities = [...model.aggregates.values()]
    .map((specs) => specs.entity)
    .filter((entity): entity is EntitySpec => entity !== undefined);

  const stateColumnsByTable = stateColumnsLiteral(allEntities);

  const aggregateContexts = aggregateContextsByName(model, ctx.actions?.actions ?? []);
  const dataTables = ctx.dataTables?.available === true ? ctx.dataTables.tables : [];
  const anonymizeJobs = anonymizeJobsByAggregate(ctx);
  const jobsById = new Map((ctx.jobs?.available === true ? ctx.jobs.catalog?.jobs ?? [] : []).map((job) => [job.id, job]));

  const transitionWrites: Record<string, LiteralValue> = {};
  for (const { aggregate, machine } of allMachines(model)) {
    const aggCtx = aggregateContexts.get(aggregate);
    if (aggCtx === undefined) continue;

    const anonymizeIds = anonymizeJobs.get(aggregate) ?? new Set<string>();

    for (const event of machine.events) {
      const anonymizingJobs = effectsFor(machine, event.id).filter((id) => anonymizeIds.has(id));
      const anonymizing = anonymizingJobs.length > 0;
      // 連鎖（匿名化が書き換えてよい表）は、**匿名化の効果が名指しした RPC**（`realized_by[イベント]`）の also_writes だけから導く。
      // 免除の期待なので、匿名化でない効果の名指しは入れない（免除が広がり見張りが緩む）。操作の属性（危険の表示）は全部の名指しを見る。
      const rpcNames = anonymizingJobs.flatMap((id) => {
        const name = realizingRpcName(jobsById.get(id), `${machine.machine}.${event.id}`);
        return name === undefined ? [] : [name];
      });
      const cascades = cascadeTargetsFor(aggregate, aggCtx.table, alsoWritesOf(findRealizedRpcs(dataTables, rpcNames).found), allEntities);
      transitionWrites[`${machine.machine}.${event.id}`] = operationLiteral(event, aggCtx, anonymizing, cascades);
    }
  }

  return [
    generatedHeader(sourceFiles),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment(['状態列 1 本の期待(`entity_spec` の `type: state(machine)` フィールド)。']),
    'export interface StateColumnInfo {',
    '  readonly column: string;',
    '  readonly machine: string;',
    '}',
    '',
    docComment([
      'テーブル名 → 状態列の完全集合(閉世界)。',
      '',
      '1 つのテーブルが直交する複数の状態機械を持つことがある(同じ行で独立に動く 2 本以上の',
      '状態列)。ここに載る列はすべて「遷移でしか動かない列」であり、',
      '`writes` 規則との突合から常に除外してよい(除外しないと、遷移のたびに規則違反として',
      '誤検出される)。',
    ]),
    `export const stateColumnsByTable: Readonly<Record<string, readonly StateColumnInfo[]>> = ${frozen(renderLiteral(stateColumnsByTable, 0))};`,
    '',
    docComment([
      '連鎖の書き込み先 1 本(複合 RPC の `also_writes` が指す、`personal` 列を持つテーブル)。',
    ]),
    'export interface CascadeTarget {',
    '  readonly table: string;',
    '  /**',
    '   * この表からトリガー行を指す参照列(`ref(集約)` 型)。連鎖対象行の絞り込みに使う。',
    '   * 宣言が無ければ(2 段以上の参照でしかつながらない表)`undefined` — その場合、この',
    '   * 手の間はテーブル全体で `columns` の書き込みを免除する(行単位の絞り込みを諦める)。',
    '   */',
    '  readonly refColumn?: string;',
    '  /** 連鎖で書き換わってよい personal 列(personal-expectations と同じ列の集合)。 */',
    '  readonly columns: readonly string[];',
    '}',
    '',
    docComment([
      '操作(`{machine}.{event}`)1 件が書いてよい列の期待。',
      '',
      '`anonymizedColumns` は、この遷移が書き換える自分の行の personal 列。効果カタログの',
      '`anonymizes`(匿名化する効果)を、その集約の状態機械の `effects` に持つ遷移だけが持つ',
      '(それ以外は空配列)。`cascades` は複合 RPC が同一トランザクションで書く別テーブルの',
      'personal 列への連鎖(同じく匿名化の効果を持つ遷移だけ。通常は空配列)。',
      '`ownColumns` は `transition_writes` と、遷移の `computes` が書く列が近似する「遷移が書く自分の列」',
      '(personal でない列の近似。集約単位でどのイベントでも同じ集合 — DSL にイベント単位の',
      '宣言欄が無いための近似)。personal 列の由来は `anonymizedColumns` / `cascades` である。',
    ]),
    'export interface OperationWrites {',
    '  readonly ownTable: string;',
    '  readonly from: readonly string[];',
    '  readonly to: string;',
    '  readonly ownColumns: readonly string[];',
    '  readonly anonymizedColumns: readonly string[];',
    '  readonly cascades: readonly CascadeTarget[];',
    '}',
    '',
    docComment([
      '操作ID(`{machine}.{event}`) → 書いてよい列の完全集合(閉世界)。',
      '',
      'ウォーカーのオラクル(app/e2e/walker-oracle*.mts)はこの表と `stateColumnsByTable` だけを',
      '参照する。手で書き写した列名の一覧は持たない — 次に状態機械や連鎖が増えたときも',
      '`npm run generate` がここを更新するので、オラクル側の手直しが要らない。',
    ]),
    `export const transitionWrites: Readonly<Record<string, OperationWrites>> = ${frozen(renderLiteral(transitionWrites, 0))};`,
    '',
  ].join('\n');
}

/**
 * 状態機械・データテーブル・個人データ宣言から遷移書き込み期待表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/transition-writes.ts`(全体生成)。
 */
export const transitionWritesGenerator: DocGenerator = {
  id: 'code-transition-writes',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const entityFiles = [...model.aggregates.values()]
      .map((specs) => specs.entity)
      .filter((entity): entity is EntitySpec => entity !== undefined)
      .map((entity) => entity.location.file);
    const stateFiles = allMachines(model).map(({ machine }) => machine.location.file);
    const accessFiles = [...model.aggregates.values()]
      .map((specs) => specs.access)
      .filter((access): access is NonNullable<typeof access> => access !== undefined)
      .map((access) => access.location.file);
    const dataTableFiles =
      ctx.dataTables?.available === true ? ctx.dataTables.tables.map((table) => table.location.file) : [];
    const jobFile =
      ctx.jobs?.available === true && ctx.jobs.catalog !== null ? [ctx.jobs.catalog.location.file] : [];
    const computeFiles = (ctx.actions?.actions ?? []) // ownColumns の片方(計算で決まる列)の正
      .filter((action) => action.computes.length > 0 && groundOperation(model, action.handles.raw).kind === 'transition')
      .map((action) => action.location.file);
    const sourceFiles = [...new Set([...entityFiles, ...stateFiles, ...accessFiles, ...computeFiles, ...dataTableFiles, ...jobFile])].sort(
      (a, b) => a.localeCompare(b),
    );
    if (entityFiles.length === 0) return [];
    return [{ file: outputFile(ctx.roots), content: renderFile(model, ctx, sourceFiles), wholeFile: true }];
  },
};
