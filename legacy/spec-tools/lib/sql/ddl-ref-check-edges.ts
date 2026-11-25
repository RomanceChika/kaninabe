/**
 * **全部の不変条件の書き込みの端の覆い**の判定(片側しか見ない執行点を機械で見つける。fix25s)。
 *
 * `formal` が `check` / `state_dependency` の不変条件ごとに、式が読む表の**書き込みの端**(自表の挿入・自表の読む列と参照の欄の
 * 更新・相手の表の読む列の更新(状態の遷移を含む)。読む列を書き換える別トリガの発火列も足す = `watchedColumnsOf`)を数え、
 * どの DB の執行点(`db_constraint` = 自表の CHECK・`trigger` = `enforced_by` と `invariant` の名指し・`model/data/ref-check-shape.ts` が
 * 計画する相手の端・凍らせた列の `update of`(`triggers[].freezes`))も発火しない端を返す。`guard` / `application` は直の書き込みを止めないので数えない。挿入は相手の表では
 * 条件を破らない(まだ誰も指していない)。削除は必須の参照の欄の外部キーが自表の行を先に消すか止めるので数えない。
 * 突合(data-table-parity)が、製品の理由つきの閉じた表と両方向に照らす。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { collectPaths } from '../guard/services.js';
import type { DataTableSpec } from '../model/data/types.js';
import { findEntity } from '../model/path-hops.js';
import { refColumn } from '../model/ref-path.js';
import { watchedColumnsOf } from '../model/data/cross-check-shape.js';
import { columnsOfRoot, refCounterpartDeclsOf } from '../model/data/ref-check-shape.js';
import { formalExpr } from '../model/formal-expr.js';
import type { EntitySpec, InvariantDef, SpecModel } from '../model/types.js';
import { parseFires, updatedColumnsOf } from '../model/trigger-fires.js';
import { freezeProblemsOf } from './ddl-freeze-triggers.js';

/** 式の予約語のルート(欄の持ち主ではない)。 */
const RESERVED = new Set(['actor', 'now']);

/** 書き込みの端 1 つが、どの執行点にも覆われていない。 */
export interface InvariantEdgeGap {
  readonly invariant: string;
  /** 端の表。 */
  readonly table: string;
  /** 端(`insert` / `update of {列}` / `update`(列を絞れない) / `unreadable multi-hop {集約}`(2 段以上の道で読む) / `unreadable no-ref {集約}`(1 段の参照の欄と表で届かない))。 */
  readonly edge: string;
}

/** 表ごとの要る端(挿入と更新の列)。 */
interface Needs {
  insert: boolean;
  readonly columns: Set<string>;
  all: boolean;
}

/** 表ごとの覆い(発火する挿入と更新の列)。 */
type Covers = Map<string, Needs>;

/** 覆い・要るの空の値。 */
function emptyNeeds(): Needs {
  return { insert: false, columns: new Set(), all: false };
}

/** 発火の宣言を覆いに足す。 */
function addFires(covers: Covers, table: string, fires: string | undefined): void {
  const entry = covers.get(table) ?? emptyNeeds();
  covers.set(table, entry);
  if (fires === undefined) return;
  if (parseFires(fires).events.includes('insert')) entry.insert = true;
  const updated = updatedColumnsOf(fires);
  if (updated === 'all') entry.all = true;
  else for (const column of updated ?? []) entry.columns.add(column);
}

/** 不変条件 1 本の執行点の覆い(DB の執行点だけ。`guard` / `application` は直の書き込みを止めないので数えない)。 */
function coversOf(invariant: InvariantDef, hostTable: string, domain: SpecModel, tables: readonly DataTableSpec[]): Covers {
  const covers: Covers = new Map();
  const refs = new Set(invariant.enforcedBy.filter((point) => point.kind === 'trigger').map((point) => point.ref));
  if (invariant.enforcedBy.some((point) => point.kind === 'db_constraint')) {
    // 行の CHECK はその表のどの挿入・更新でも評価される。
    covers.set(hostTable, { insert: true, columns: new Set(), all: true });
  }
  for (const table of tables) {
    const triggers = [...table.triggers, ...refCounterpartDeclsOf(table, domain, tables).triggers];
    for (const trigger of triggers) {
      if (trigger.invariant === invariant.id || refs.has(trigger.functionName) || refs.has(trigger.name)) addFires(covers, table.table, trigger.fires);
      // 凍らせた列(`freezes`)はどの更新でも変わらない —— その列の `update of` の端は、どの不変条件でも覆われている(`ddl-freeze-triggers.ts`)。
      // 覆いに数えるのは本文を生成できる凍結の宣言だけ(通らない宣言・手書きの関数の凍結は DB に凍結が無いか本文を照らせない。点検 fix26 3 回目 D26c-4)。
      if (trigger.freezes !== undefined && freezeProblemsOf(trigger, table, domain).length === 0) addFires(covers, table.table, `update of ${trigger.freezes.join(', ')}`);
    }
  }
  return covers;
}

/** 要る端のうち覆われていないもの。 */
function uncovered(invariant: string, table: DataTableSpec, needs: Needs, covers: Covers): readonly InvariantEdgeGap[] {
  const have = covers.get(table.table) ?? emptyNeeds();
  const gaps: InvariantEdgeGap[] = [];
  if (needs.insert && !have.insert) gaps.push({ invariant, table: table.table, edge: 'insert' });
  if (have.all) return gaps;
  const watched = watchedColumnsOf(table, [...needs.columns]);
  if (watched === 'all' || needs.all) gaps.push({ invariant, table: table.table, edge: 'update' });
  else for (const column of [...watched].sort()) if (!have.columns.has(column)) gaps.push({ invariant, table: table.table, edge: `update of ${column}` });
  return gaps;
}

/** 不変条件 1 本の覆われていない端。 */
function gapsOf(invariant: InvariantDef, aggregate: string, host: EntitySpec, domain: SpecModel, tables: readonly DataTableSpec[]): readonly InvariantEdgeGap[] {
  const hostTable = tables.find((table) => table.entity === host.entity);
  const formal = invariant.formal;
  if (hostTable === undefined || (formal?.kind !== 'check' && formal?.kind !== 'state_dependency')) return [];
  const parsed = formalExpr(formal);
  if (!parsed.ok) return []; // 読めない式は T16 が名指す
  const paths = collectPaths(parsed.expr).filter((path) => path.segments.length >= 2 && !RESERVED.has(path.segments[0] ?? ''));
  const hostNames = new Set([aggregate, host.entity]);
  const unreadable = (reason: string): InvariantEdgeGap => ({ invariant: invariant.id, table: hostTable.table, edge: `unreadable ${reason}` });
  const gaps: InvariantEdgeGap[] = [];
  const hostNeeds: Needs = { insert: true, columns: new Set(columnsOfRoot(paths, hostNames)), all: false };
  const others: { readonly table: DataTableSpec; readonly needs: Needs }[] = [];
  for (const root of [...new Set(paths.map((path) => path.segments[0] ?? ''))].filter((name) => !hostNames.has(name)).sort()) {
    if (paths.some((path) => path.segments[0] === root && path.segments.length > 2)) {
      gaps.push(unreadable(`multi-hop ${root}`));
      continue;
    }
    const other = findEntity(domain, root);
    const column = other === null ? null : refColumn(domain, host.entity, root);
    const otherTable = other === null ? undefined : tables.find((table) => table.entity === other.entity);
    if (column === null || otherTable === undefined) {
      gaps.push(unreadable(`no-ref ${root}`));
      continue;
    }
    hostNeeds.columns.add(column);
    others.push({ table: otherTable, needs: { insert: false, columns: new Set(columnsOfRoot(paths, new Set([root]))), all: false } });
  }
  const covers = coversOf(invariant, hostTable.table, domain, tables);
  gaps.push(...uncovered(invariant.id, hostTable, hostNeeds, covers));
  for (const other of others) gaps.push(...uncovered(invariant.id, other.table, other.needs, covers));
  return gaps;
}

/**
 * 全部の不変条件(`formal` が `check` / `state_dependency`)について、式が読む表の書き込みの端のうち、どの DB の執行点も
 * 発火しないもの(不変条件 ID・表・端の順)。
 *
 * @param domain ドメイン仕様
 * @param tables 全 data_table
 * @returns 覆われていない端(無ければ空)
 */
export function invariantEdgeGapsOf(domain: SpecModel, tables: readonly DataTableSpec[]): readonly InvariantEdgeGap[] {
  const gaps: InvariantEdgeGap[] = [];
  for (const [aggregate, specs] of domain.aggregates) {
    if (specs.entity === undefined || specs.entity === null) continue;
    for (const invariant of specs.invariants?.invariants ?? []) gaps.push(...gapsOf(invariant, aggregate, specs.entity, domain, tables));
  }
  const key = (gap: InvariantEdgeGap): string => `${gap.invariant}\u0000${gap.table}\u0000${gap.edge}`;
  return gaps.sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0));
}
