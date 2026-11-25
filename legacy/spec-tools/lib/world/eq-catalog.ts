/**
 * 一致の証明(engine ⇔ RPC)の**対象の目録**(束 ⑳-5a)。
 *
 * 生成物は 3 つ(world と組み合わせの設計図 / 集約ごとのテスト / data_table の `test_cases`)、
 * 検査は 1 つ(T11)あり、どれも「どの操作を実行するか」と「実行できない操作はなぜか」を同じ答えで
 * 知らなければならない —— 4 か所が別々に判定すると「テストは生成されたのにテストケースの宣言が無い」
 * 「検査は通ったのに生成されない」という静かな割れ方が入る。目録はここ 1 つである。
 *
 * 対象は**実行計画が導出できた単発の操作**に限る(`runner: manual` の操作は計画を持たない
 * ので、engine が判定を下す形そのものが無い)。集約ごとにまとめるのは、world(実行者と行)が
 * 集約で決まるからである —— 同じ集約の操作は同じ world の上で実行できる。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { DataTableSpec, DataTableSpecModel } from '../model/data/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import type { BuiltOperation } from '../usecase/operation-plan.js';
import { buildOperationPlans } from '../usecase/operation-plan.js';
import { contextOf } from '../usecase/plan-scenario-rows.js';
import { roleClaimOf } from '../usecase/plan-facts-parts.js';
import type { RlsWorldProblem } from './rls-world-derivable.js';
import type { EqEnforcement, EqOperationCases } from './eq-cases.js';
import { eqCasesOf } from './eq-cases.js';
import type { EqWorld } from './eq-world-types.js';
import { buildEqWorld } from './eq-world.js';

/** 集約 1 つぶんの結果。 */
export type EqCatalogResult =
  | { readonly ok: true; readonly world: EqWorld; readonly operations: readonly EqOperationCases[] }
  | { readonly ok: false; readonly problems: readonly RlsWorldProblem[] };

/** 目録の 1 行。 */
export interface EqCatalogEntry {
  readonly aggregate: string;
  /** その集約のテーブル仕様(注釈の置き場。無ければ `undefined`)。 */
  readonly table: DataTableSpec | undefined;
  /** その集約の操作 ID(操作 ID 順)。 */
  readonly ops: readonly string[];
  /**
   * 組み立て済みの操作(`ops` と同じ並び)。
   *
   * 結果表(束 ⑳-5b)が engine に照会するのに要る —— 手順の形・規則の表・事実の供給元は
   * すべてここにある。目録が運ぶのは「どれを実行するか」であり、**そこに材料も同じ順で乗せる**
   * ことで、表と証明が別の計画を読む形を塞ぐ。
   */
  readonly built: readonly BuiltOperation[];
  readonly result: EqCatalogResult;
}

/** 目録を作るのに要る入力(生成器と検査器が同じものを渡す)。 */
export interface EqCatalogInput {
  readonly domain: SpecModel;
  readonly guards: GuardServices;
  readonly actions: ActionSpecModel | undefined;
  readonly dataTables: DataTableSpecModel | undefined;
  readonly jobs: JobSpecModel | undefined;
  /**
   * ジョブカタログを採っているのに渡せない(阻害)。true のとき、副作用を持つ操作は目録に載せない
   * (`jobs` が undefined でも「ジョブが無い」とは読まない。実行計画の導出と同じ規約)。省略は false。
   */
  readonly jobsBlocked?: boolean;
}

/**
 * 実行計画が導出できた全操作について、集約ごとの world と組み合わせを組み立てる。
 *
 * @param input ドメイン仕様・ガード解析・action_spec・data_table・ジョブカタログ
 * @returns 集約名順の目録
 */
export function eqCatalog(input: EqCatalogInput): readonly EqCatalogEntry[] {
  const built = buildOperationPlans({
    domain: input.domain,
    guards: input.guards,
    actions: input.actions,
    dataTables: input.dataTables,
    jobs: input.jobs,
    ...(input.jobsBlocked === true ? { jobsBlocked: true } : {}),
  });
  const tables = input.dataTables?.tables ?? [];
  const grouped = groupByAggregate(built.operations);
  return [...grouped.keys()]
    .sort()
    .map((aggregate) => entryOf(aggregate, grouped.get(aggregate) ?? [], input, tables));
}

/** 集約 → その集約を動かす操作(操作 ID 順)。 */
function groupByAggregate(
  operations: readonly BuiltOperation[],
): ReadonlyMap<string, readonly BuiltOperation[]> {
  const grouped = new Map<string, BuiltOperation[]>();
  for (const operation of [...operations].sort((a, b) => a.op.localeCompare(b.op))) {
    const entity = operation.plan.steps[0]?.entity;
    if (entity === undefined) continue;
    grouped.set(entity, [...(grouped.get(entity) ?? []), operation]);
  }
  return grouped;
}

/** 集約 1 つぶんの目録の行。 */
function entryOf(
  aggregate: string,
  operations: readonly BuiltOperation[],
  input: EqCatalogInput,
  tables: readonly DataTableSpec[],
): EqCatalogEntry {
  const table = tables.find((candidate) => candidate.entity === aggregate);
  const ops = operations.map((operation) => operation.op);
  const built = operations;
  const contexts = operations.map((operation) => contextOf(operation, input.domain, input.guards));
  const bindingRoles = new Map<string, string>();
  const claimRoles: string[] = [];
  for (const ctx of contexts) {
    for (const [role, ref] of ctx.roleRefs) bindingRoles.set(role, ref);
    for (const role of claimRolesOf(input.domain, ctx.claimFields)) {
      if (!claimRoles.includes(role)) claimRoles.push(role);
    }
  }
  const world = buildEqWorld(aggregate, { domain: input.domain, tables, bindingRoles, claimRoles });
  if (!world.ok) return { aggregate, table, ops, built, result: world };
  return {
    aggregate,
    table,
    ops,
    built,
    result: {
      ok: true,
      world: world.world,
      operations: contexts.map((ctx) => eqCasesOf(world.world, ctx, enforcementOf(tables, ctx.rpc))),
    },
  };
}

/**
 * その RPC が拒否をどこまで返すか(data_table の宣言から決まる)。
 *
 * 宣言を読むだけであり、ここに操作ごとの例外は無い —— `handwritten:` を外せば `unnamed` は
 * `named` に戻り、`shape` を 5 形のどれかに直せば `none` も `named` に戻る。
 *
 * 保存点(複合 RPC)も**手順ごとに**同じ問いを立てる —— 複合 RPC は手順の定型 RPC を呼ぶので、
 * その手順で何が返されるかはその関数の宣言で決まる(`eq-save-inputs.ts`)。
 *
 * @param tables 全 data_table
 * @param rpc 関数名
 * @returns 拒否をどこまで返すか
 */
export function enforcementOf(tables: readonly DataTableSpec[], rpc: string): EqEnforcement {
  for (const table of tables) {
    const found = table.functions.find((candidate) => candidate.name === rpc);
    if (found === undefined) continue;
    if (found.shape === 'composite') return 'none';
    return found.handwritten === undefined ? 'named' : 'unnamed';
  }
  return 'named';
}

/** その欄を根拠にする役(`claim` の宣言から引く)。 */
function claimRolesOf(domain: SpecModel, fields: readonly string[]): readonly string[] {
  const found: string[] = [];
  for (const role of domain.roles.roles) {
    const claim = roleClaimOf(domain, role.id);
    if (claim !== null && fields.includes(claim.field)) found.push(role.id);
  }
  return found;
}

/** その集約の n 番目のテストケース ID(1 始まり)。 */
export function eqTestCaseIdOf(aggregate: string, index: number): string {
  return `TC-EQ-${aggregate.toUpperCase()}-${String(index).padStart(4, '0')}`;
}
