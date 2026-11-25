/**
 * 書く参照の列の親と先掴みの照合(`rpc-fk-check-order.ts`)を、製品か題材の仕様の木の生成 RPC の全部に掛ける試験の支援コード
 * (題材の表は unit/sql/rpc-fk-check-order.test.ts・製品の表は dev-repo/unit/sql/rpc-fk-check-order-product.test.ts)。
 */

import path from 'node:path';
import { fkCheckOrderProblems, fkCheckPairs, writtenRefs } from '../../lib/sql/rpc-fk-check-order.js';
import { lockPlan, type LockTarget } from '../../lib/sql/rpc-body-lock.js';
import { collectRpcFacts } from '../../lib/sql/rpc-facts.js';
import { loadProductRoots } from '../../lib/model/product/loader.js';
import { specPath } from '../../lib/model/product/paths.js';
import { loadSpecModel } from '../../lib/model/loader.js';
import { loadDataTableSpecModel } from '../../lib/model/data/loader.js';
import { loadActionSpecModel } from '../../lib/model/trace/loader.js';

/** 製品か題材の生成 RPC の全部(入力と事実。事実が集まらなければ名前だけ)。 */
function rpcsOf(root: string): readonly { readonly input: Parameters<typeof fkCheckOrderProblems>[0]; readonly facts: Parameters<typeof fkCheckOrderProblems>[1] | null }[] {
  const roots = loadProductRoots(root).model?.roots;
  if (roots === undefined || roots === null) throw new Error(`product.md が読めない: ${root}`);
  const spec = (...segments: string[]): string => path.join(root, specPath(roots, ...segments));
  const domain = loadSpecModel(spec('domain'), { repoRoot: root }).model;
  if (domain === null || domain === undefined) throw new Error(`ドメインが読めない: ${root}`);
  const tables = loadDataTableSpecModel(spec('backend/data/tables'), { repoRoot: root }).model?.tables ?? [];
  const actions = loadActionSpecModel(spec('backend/actions'), { repoRoot: root }).model ?? undefined;
  return tables.flatMap((table) =>
    table.functions.flatMap((fn) => {
      const shape = fn.shape;
      if (fn.kind !== 'rpc' || fn.migration === undefined || (shape !== 'create' && shape !== 'update' && shape !== 'delete' && shape !== 'transition')) return [];
      const input = { name: fn.name, params: fn.params, args: fn.args, shape, table, domain, tableOf: (entity: string) => tables.find((candidate) => candidate.entity === entity)?.table ?? null, actions, tables };
      const facts = collectRpcFacts(input);
      return [{ input, facts: facts.ok ? facts.facts : null }];
    }),
  );
}

/**
 * 断り(事実が集まらない関数も名指す)。
 *
 * @param root 仕様の木の根(product.md のある場所)
 * @returns 断りの文の並び
 */
export function fkCheckRefusalsOf(root: string): readonly string[] {
  return rpcsOf(root).flatMap(({ input, facts }) => (facts === null ? [`${input.name} 事実が集まらない`] : fkCheckOrderProblems(input, facts).map((problem) => problem.message)));
}

/**
 * 覆いのある組。
 *
 * @param root 仕様の木の根
 * @returns `{関数} {排他の表}←{列}:{親} by {覆う行の別名}` の並び
 */
export function fkCheckCoveredOf(root: string): readonly string[] {
  return rpcsOf(root).flatMap(({ input, facts }) => {
    if (facts === null) return [];
    const create = input.shape === 'create';
    return fkCheckPairs(writtenRefs(input, facts), lockPlan(facts, !create, create))
      .filter((pair) => pair.coveredBy !== null)
      .map((pair) => `${input.name} ${pair.exclusive}←${pair.column}:${pair.parent} by ${pair.coveredBy ?? ''}`);
  });
}


/**
 * 先掴みの計画で、同じ表に文が 2 つ以上ある関数(強さを問わず。点検 fix26 5 回目 D26e-1・6 回目 D26f-1。計画は同じ表を 1 文に畳むので、無いのが期待)。
 *
 * @param root 仕様の木の根
 * @returns `{関数} {表} {別名:強さ…}` の並び
 */
export function sameTableStatementsOf(root: string): readonly string[] {
  return rpcsOf(root).flatMap(({ input, facts }) => {
    if (facts === null) return [];
    const create = input.shape === 'create';
    const byTable = new Map<string, LockTarget[]>();
    for (const lock of lockPlan(facts, !create, create)) byTable.set(lock.table, [...(byTable.get(lock.table) ?? []), lock]);
    return [...byTable].filter(([, locks]) => locks.length > 1).map(([table, locks]) => `${input.name} ${table} ${locks.map((lock) => `${lock.alias}:${lock.mode}`).join(' ')}`);
  });
}

/**
 * 表名の並びのうち、バイト順に並んでいない隣り合い(`{前} → {後}`)。同じ表の続きは {@link sameTableStatementsOf} が見るので、ここは逆順だけを返す。
 *
 * @param tables 先掴みの計画の表名の並び
 * @returns 逆順の隣り合い
 */
export function outOfOrder(tables: readonly string[]): readonly string[] {
  return tables.flatMap((table, index) => {
    const previous = tables[index - 1];
    return previous !== undefined && Buffer.compare(Buffer.from(previous), Buffer.from(table)) > 0 ? [`${previous} → ${table}`] : [];
  });
}

/**
 * 先掴みの計画が表名のバイト順に並んでいない関数(点検 27 回目の決め: 生成物の掴む順は生成器の性質の試験が全題材で守る。手書きはやり直しに頼る)。
 *
 * @param root 仕様の木の根
 * @returns `{関数} {前の表} → {後の表}` の並び(事実が集まらない関数も名指す)
 */
export function outOfOrderLocksOf(root: string): readonly string[] {
  return rpcsOf(root).flatMap(({ input, facts }) => {
    if (facts === null) return [`${input.name} 事実が集まらない`];
    const create = input.shape === 'create';
    return outOfOrder(lockPlan(facts, !create, create).map((lock) => lock.table)).map((pair) => `${input.name} ${pair}`);
  });
}

/**
 * 先掴みの計画を持つ関数の数(照らす相手が無いまま緑にしないため)。
 *
 * @param root 仕様の木の根
 * @returns 計画の表が 2 つ以上ある関数の数
 */
export function multiTableLockPlansOf(root: string): number {
  return rpcsOf(root).filter(({ input, facts }) => facts !== null && new Set(lockPlan(facts, input.shape !== 'create', input.shape === 'create').map((lock) => lock.table)).size > 1).length;
}
