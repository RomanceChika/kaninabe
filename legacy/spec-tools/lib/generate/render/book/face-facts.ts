/**
 * 人向けの表示の章が出す**数と範囲**を、1 か所で数える。
 *
 * 読む量の 4 枚・本文に並ぶ項目・「数の出どころ」の表が**同じ集計**から出るので、
 * 食い違いようがない(見本 v7 の約束: 4 枚の数は本文に並ぶ項目の数と一致する)。
 * どの数も仕様の宣言を数えたもので、数えられないものは「未集計」と書く。
 */

import type { Finding } from '../../../kernel/finding.js';
import type { AggregateSpecs, InvariantDef, SpecModel } from '../../../model/types.js';
import { systemRoleId } from '../../../model/role-hierarchy.js';
import {
  accessTable,
  accessUnits,
  computeItems,
  stateMeanings,
  summarySentences,
  type AccessTable,
  type AxiomParts,
  type ComputeItem,
} from '../../../semantics/reading-axioms.js';
import { computeExampleCount, computeExampleSets, type ComputeExampleSet } from '../../../semantics/compute-examples.js';
import { acceptCounts, type AcceptCounts } from '../../../semantics/reading-load.js';
import type { ReadingChange } from '../../../semantics/reading-change.js';
import type { ActionSpec } from '../../../model/trace/types.js';
import type { ActionTestCase } from '../../../testcase/types.js';
import type { DataTableSpec } from '../../../model/data/types.js';
import type { UsecaseSpec } from '../../../model/usecase/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { collectSigns } from '../../prose.js';
import { bookFile } from './chapters.js';
import { pendingFindings, pendingInFiles, pendingOfChapter } from './finding-placement.js';
import {
  bookLayout,
  carriedInvariants,
  scopeActions,
  scopeTables,
  scopeUsecases,
  subordinates,
  type CarriedInvariant,
  type SubordinateBasis,
} from './face-scope.js';

/** 集約 1 つ分の公理(章の範囲の中)。 */
export interface OwnAxioms {
  readonly specs: AggregateSpecs;
  readonly invariants: readonly InvariantDef[];
}

/** 範囲の集約 1 つぶんのアクセスの宣言(必読に数える公理。数える単位は表の行)。 */
export interface AccessGroup {
  readonly specs: AggregateSpecs;
  readonly table: AccessTable;
}

/** テストの件数 1 行(出どころごと)。 */
export interface TestRow {
  readonly source: string;
  readonly unit: number;
  readonly integration: number;
}

/** 人向けの表示の章 1 本が使う集計。 */
export interface FaceFacts {
  readonly specs: AggregateSpecs;
  /** 章の重さの順位(章を持つ集約のうち、重い順で何番目か。1 始まり)。 */
  readonly rank: number;
  /** 章を持つ集約の数(順位の母数)。 */
  readonly aggregateCount: number;
  readonly basis: SubordinateBasis;
  /** 範囲の集約(親 + 畳んだ従属。この順)。 */
  readonly scope: readonly AggregateSpecs[];
  readonly own: readonly OwnAxioms[];
  readonly carried: readonly CarriedInvariant[];
  /** アクセスの宣言(範囲の集約ごと。親が先)。必読に数える公理。 */
  readonly access: readonly AccessGroup[];
  /** 計算される欄(範囲の操作の `computes`)。必読には数えない導出(下段の表)。 */
  readonly computes: readonly ComputeItem[];
  /** 計算の例の表(範囲の操作の `computes[].examples`)。必読に数える公理(上段の早見表)。 */
  readonly computeExamples: readonly ComputeExampleSet[];
  /** 不変条件のほかに必読に数える公理の内訳(アクセスの宣言の行・状態の意味・要約の文・計算の例の表の行)。 */
  readonly axiomParts: AxiomParts;
  readonly actions: readonly ActionSpec[];
  readonly tables: readonly DataTableSpec[];
  readonly usecases: readonly UsecaseSpec[];
  /** 遷移の数(範囲の状態機械の events)。 */
  readonly transitions: number;
  /** マトリクスのマスの数(状態 × イベント。機械ごとに掛けて足す。範囲の状態機械すべて)。 */
  readonly matrixCells: number;
  /** 公理の執行点の数(範囲の公理の `enforced_by` の要素数)。 */
  readonly enforcementOwn: number;
  /** 写した公理の執行点の数。 */
  readonly enforcementCarried: number;
  readonly accept: AcceptCounts;
  /**
   * まだ通していない受け入れ = 章の範囲に配られた検証器の警告。検証の結果が渡されていなければ null
   * (0 件とは別。章は「未集計」と書く)。
   */
  readonly pending: readonly Finding[] | null;
  /** この章が出す標識の本数(公理の側 = ドメインの 4 ファイル / 受け入れの側 = 操作などの置き場)。 */
  readonly signs: SignCounts;
  /** 章の遷移が積むジョブの数(ジョブカタログにあるもの)。 */
  readonly jobs: number;
  /** 基点つきで読むときの、章の範囲の公理の側の差分。基点なしは null(0 件とは別)。 */
  readonly changes: ChapterChanges | null;
  readonly tests: readonly TestRow[];
}

/** 章が出す標識の本数。 */
export interface SignCounts {
  /** 公理の側(ドメインの 4 ファイルに残された判断)。 */
  readonly axiom: number;
  /** 受け入れの側(操作の仕様に残された判断)。 */
  readonly decision: number;
}

/** 章の範囲の公理の側の差分(基点つき)。 */
export interface ChapterChanges {
  /** 基点(コミットの参照)。 */
  readonly ref: string;
  /** 章の範囲に配られた差分。 */
  readonly items: readonly ReadingChange[];
}

/** テストケースを種類ごとに数える。 */
function tally(cases: readonly ActionTestCase[]): { unit: number; integration: number } {
  return {
    unit: cases.filter((testCase) => testCase.type === 'unit').length,
    integration: cases.filter((testCase) => testCase.type === 'integration').length,
  };
}

/** 集約の表示名(label があれば日本語名、無ければ内部名)。 */
export function aggregateLabel(specs: AggregateSpecs): string {
  return specs.entity?.label ?? specs.name;
}

/** テストの件数を出どころごとに数える(範囲の集約ごとに操作仕様とテーブル仕様を合わせ、タスクを足す)。 */
function testRows(
  model: SpecModel,
  scope: readonly AggregateSpecs[],
  actions: readonly ActionSpec[],
  tables: readonly DataTableSpec[],
  usecases: readonly UsecaseSpec[],
  ctx: GenerateContext,
): TestRow[] {
  const rows: TestRow[] = scope.map((specs) => {
    const own = scopeActions(model, ctx, [specs]).filter((action) => actions.includes(action));
    const ownTables = tables.filter((table) => table.entity === specs.entity?.entity);
    const counts = tally([...own.flatMap((action) => action.testCases), ...ownTables.flatMap((table) => table.testCases)]);
    return { source: `${aggregateLabel(specs)}(操作仕様 ${own.length} 本・テーブル仕様 ${ownTables.length} 表)`, ...counts };
  });
  for (const usecase of usecases) rows.push({ source: `タスク「${usecase.goal}」`, ...tally(usecase.testCases) });
  return rows;
}

/** 章の範囲の仕様ファイル(集約の 4 ファイル・操作・表・タスク)。警告をこの章に配る単位である。 */
function scopeFiles(
  scope: readonly AggregateSpecs[],
  actions: readonly ActionSpec[],
  tables: readonly DataTableSpec[],
  usecases: readonly UsecaseSpec[],
): Set<string> {
  const files = new Set<string>();
  for (const specs of scope) {
    for (const file of [
      specs.entity?.location.file,
      specs.access?.location.file,
      specs.invariants?.location.file,
      ...specs.stateMachines.map((machine) => machine.location.file),
    ]) {
      if (file !== undefined) files.add(file);
    }
  }
  for (const item of [...actions, ...tables, ...usecases]) files.add(item.location.file);
  return files;
}

/** 章の遷移が積むジョブの数(範囲の状態機械。ジョブカタログにあるものだけ。`do` が指す ID の重複は 1 つ)。 */
function jobCount(scope: readonly AggregateSpecs[], ctx: GenerateContext): number {
  const catalog = new Set((ctx.jobs?.catalog?.jobs ?? []).map((job) => job.id));
  const used = new Set<string>();
  for (const specs of scope) {
    for (const machine of specs.stateMachines) {
      for (const effect of machine.effects) for (const id of effect.do) if (catalog.has(id)) used.add(id);
    }
  }
  return used.size;
}

/** 章の範囲に配られる公理の側の差分(不変条件は範囲の公理と写した公理、状態・イベントは範囲の状態機械)。 */
function chapterChanges(
  ctx: GenerateContext,
  scope: readonly AggregateSpecs[],
  carried: readonly CarriedInvariant[],
): ChapterChanges | null {
  const base = ctx.readingBase;
  if (base === undefined) return null;
  const invariants = new Set([
    ...scope.flatMap((specs) => specs.invariants?.invariants.map((invariant) => invariant.id) ?? []),
    ...carried.map((entry) => entry.invariant.id),
  ]);
  const machines = new Set(scope.flatMap((specs) => specs.stateMachines.map((machine) => machine.machine)));
  const entities = new Set(scope.flatMap((specs) => (specs.entity === undefined ? [] : [specs.entity.entity])));
  const items = base.changes.filter((change) => {
    if (change.element === 'invariant.statement') return invariants.has(change.key);
    if (change.element === 'entity.summary') return entities.has(change.key);
    if (change.element === 'machine.summary') return machines.has(change.key);
    return machines.has(change.key.split('.')[0] ?? '');
  });
  return { ref: base.ref, items };
}

/** 標識の本数(公理の側 = 範囲のドメインの 4 ファイル、受け入れの側 = 範囲の操作と表)。 */
function signCounts(
  scope: readonly AggregateSpecs[],
  actions: readonly ActionSpec[],
  tables: readonly DataTableSpec[],
  ctx: GenerateContext,
): SignCounts {
  const count = (file: string | undefined): number =>
    file === undefined ? 0 : collectSigns(ctx.specSources?.get(file) ?? '').length;
  const domainFiles = scope.flatMap((specs) => [
    specs.entity?.location.file,
    specs.access?.location.file,
    specs.invariants?.location.file,
    ...specs.stateMachines.map((machine) => machine.location.file),
  ]);
  const placed = [...actions.map((action) => action.location.file), ...tables.map((table) => table.location.file)];
  return {
    axiom: [...new Set(domainFiles)].reduce((sum, file) => sum + count(file), 0),
    decision: [...new Set(placed)].reduce((sum, file) => sum + count(file), 0),
  };
}

/**
 * 章 1 本ぶんの集計を作る。
 *
 * @param model ドメイン仕様全体
 * @param ctx 生成コンテキスト
 * @param specs 章の集約
 */
export function faceFacts(model: SpecModel, ctx: GenerateContext, specs: AggregateSpecs): FaceFacts {
  const layout = bookLayout(model, ctx);
  const basis = subordinates(model, ctx, specs);
  const scope = [specs, ...basis.folded];
  const actions = scopeActions(model, ctx, scope);
  const tables = scopeTables(ctx, scope);
  const usecases = scopeUsecases(model, ctx, scope);
  const own = scope
    .map((member) => ({ specs: member, invariants: member.invariants?.invariants ?? [] }))
    .filter((group) => group.invariants.length > 0);
  const carried = carriedInvariants(model, specs, scope);
  const system = systemRoleId(model.roles.roles);
  const access = scope.map((member) => ({ specs: member, table: accessTable(member.access, system) }));
  const computes = computeItems(actions);
  const computeExamples = computeExampleSets(actions);
  const scopeMachines = scope.flatMap((member) => member.stateMachines);
  const all = pendingFindings(ctx);
  const files = scopeFiles(scope, actions, tables, usecases);
  const chapterFile = bookFile(ctx.roots, `domain/${specs.name}.md`);
  const pending =
    all === null
      ? null
      : [...new Set([...pendingInFiles(all, files), ...pendingOfChapter(all, model, ctx.roots, chapterFile, layout)])];
  const enforcement = (invariants: readonly InvariantDef[]): number =>
    invariants.reduce((sum, invariant) => sum + invariant.enforcedBy.length, 0);
  return {
    specs,
    rank: layout.roots.indexOf(specs.name) + 1,
    aggregateCount: layout.roots.length,
    basis,
    scope,
    own,
    carried,
    access,
    computes,
    computeExamples,
    axiomParts: {
      access: access.reduce((sum, group) => sum + accessUnits(group.table), 0),
      states: stateMeanings(scopeMachines).length,
      summaries: scope.reduce((sum, member) => sum + summarySentences(member).length, 0),
      examples: computeExampleCount(computeExamples),
    },
    actions,
    tables,
    usecases,
    transitions: scopeMachines.reduce((sum, machine) => sum + machine.events.length, 0),
    matrixCells: scopeMachines.reduce((sum, machine) => sum + machine.states.length * machine.events.length, 0),
    enforcementOwn: own.reduce((sum, group) => sum + enforcement(group.invariants), 0),
    enforcementCarried: enforcement(carried.map((entry) => entry.invariant)),
    // 集約の章は画面を持たない(画面の受け入れは「UX 原則」の章が数える)ので screens は空で渡す。
    accept: acceptCounts(actions, tables, usecases, []),
    pending,
    signs: signCounts(scope, actions, tables, ctx),
    jobs: jobCount(scope, ctx),
    changes: chapterChanges(ctx, scope, carried),
    tests: testRows(model, scope, actions, tables, usecases, ctx),
  };
}
