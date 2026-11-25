/**
 * **参照の欄が指す行の列を見る条件**(`formal.type: check` / `state_dependency` の式が、自表の行が必須の参照の欄で指す別の集約の
 * 列を見るもの)の**判定の 1 本**と、その条件が**参照される表の側で破れる端**(相手の端)の計画(fix25s)。
 *
 * 例: 「部屋が閉じていれば、予約の客は確認済み」(`if room.state == closed then guest.status == verified`)。
 * 自表の行(予約)は部屋と客をどちらも必須の参照の欄で指すので、挿入・付け替えの時点で 2 つの行を読めば条件が言い切れる。
 *
 * ## 置き場(前段 = model の層)
 *
 * 本文の字面は SQL の層(`sql/ddl-ref-check-body.ts` が自表の執行点・`sql/ddl-ref-check-ends.ts` が相手の端)が持つ。ここに置くのは、
 * 宣言から読める**形**(どの行を読むか・相手の端の名前・発火・掴む錨の行)だけである。文書の生成器(data_table の md の「トリガ(全数)」の表・
 * 一覧の数・ハンドブックの章の数え)も相手の端を宣言されたものと同じ形で数えなければならず、それらは SQL の層を読まない
 * (`gen → db` の辺を増やさない。天井の `ceiling-plan.ts`・一致の形の `cross-check-shape.ts` と同じ置き場の理由)。
 *
 * ## 読み方(DSL の解釈。曖昧なら最も厳しい側に倒す)
 *
 * - 宣言は**自表の行の側**の執行点である(`deferred` でない BEFORE の `insert`(と `update`))。
 * - 式は自表の欄と、**必須の参照の欄 1 本**で届く別の集約の欄だけを読む(`context` の 1 段。`ref-path.ts` の `refColumn`)。
 * - 別の集約の欄を**欄と等号で**比べる形(`==` / `!=`。2 つの集約の列どうしの一致)は `cross-check-shape.ts` の担当なので、ここでは
 *   形にしない。順序の比較(`<` / `<=` / `>` / `>=`。例: 部の開始は催しの開演以降)と定数との比較はここの形である。
 * - 空にできる自表の欄(例: 部の開始時刻)は、式が `{欄} is null or …` と空のときを言い切る(言わなければ `COALESCE(…, false)` で拒否になる)。
 * - 参照の欄を別のトリガ(`supplies`)が埋めるなら、そのトリガが**名前の順で先に**発火しなければならない(BEFORE トリガは名前の順)。
 * - `state_dependency` は `not (前提) or (帰結)` と読む(`formal-expr.ts`)。
 *
 * ## 相手の端
 *
 * 自表の行の側の執行点は、作る・付け替える行しか見ない。読む行の列が後から変わると、既に在る自表の行が条件を破る。だから計画の読む行の
 * それぞれの表に、**その表の更新で発火するコミット時の制約トリガ**を 1 本ずつ立てる(宣言は足さない。自表の執行点の宣言と不変条件の
 * `formal` から全部が決まる)。
 *
 * - 名前は `{自表の執行点}_on_{相手の集約}`。63 バイトを超える・その表の既存のトリガ / 関数と重なるなら生成しない(覆いの検査
 *   `sql/ddl-ref-check-edges.ts` が端を名指す)。
 * - 発火は `after update of {式がその表で読む列}`(その列を書き換える別トリガの発火列も足す = `watchedColumnsOf`)の
 *   `deferrable initially deferred`。挿入は条件を破らない(まだ誰も指していない)。削除は必須の参照の欄の外部キーが自表の行を
 *   先に消すか止める。
 * - 読む行は 2 つまで(3 つ以上は断る。D25s3-1)。**掴むのは錨の行だけ**(読む行のうち表名のバイト順で最初の表の行。点検 D25s2-1)。錨の表の端は自分の更新が行を掴んでいるので掴まず、
 *   ほかの表の端は発火の最初に錨の行を掴む(`anchorOf`。本文と理由は `sql/ddl-ref-check-ends.ts`、先掴みは `sql/rpc-anchor-locks.ts`)。
 * - 自表の執行点の関数が手書き(`functions[].handwritten`)なら、相手の端も生成しない(動いている執行点の読み方を宣言から
 *   言えないので、移す判断を人に残す)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr, PathRef } from '../../guard/ast.js';
import { collectPaths } from '../../guard/services.js';
import { formalExpr } from '../formal-expr.js';
import { findEntity } from '../path-hops.js';
import { refColumn } from '../ref-path.js';
import { MAX_IDENTIFIER_BYTES } from '../sql-fragment.js';
import { parseFires } from '../trigger-fires.js';
import type { EntitySpec, InvariantDef, SpecModel } from '../types.js';
import { watchedColumnsOf } from './cross-check-shape.js';
import type { DataFunctionDecl, DataTableSpec, DataTriggerDecl } from './types.js';
import type { LockStrength } from './types-locks.js';

/** 読む別の集約の行 1 つ。 */
export interface RefCheckRow {
  readonly entity: EntitySpec;
  /** その集約の物理テーブル。 */
  readonly table: string;
  /** 自表の行がその行を指す必須の参照の欄。 */
  readonly column: string;
  /** 本文で行を受ける変数(`v_{表}`)。 */
  readonly variable: string;
  /** 式の中でその集約を指す語(パスの先頭)。 */
  readonly root: string;
}

/** 生成できる宣言から決まる計画。 */
export interface RefCheckPlan {
  readonly invariant: InvariantDef;
  /** 読む行(表名のバイト順)。 */
  readonly rows: readonly RefCheckRow[];
  /** 自表の真偽の欄だけで条件が言い切れる門(式の最上段の `or` の `{自表}.{欄} == true|false`。成り立てば読まずに通す。無ければ null)。 */
  readonly gate: { readonly column: string; readonly passes: boolean } | null;
}

/** 判定の結果(この形でない / 出せる / 出せない理由つき)。 */
export type RefCheckJudgement =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly plan: RefCheckPlan }
  | { readonly kind: 'refused'; readonly reason: string };

/** 相手の端 1 本の計画。 */
export interface RefCounterpart {
  /** トリガ名(= 関数名)。 */
  readonly name: string;
  readonly invariant: InvariantDef;
  /** 自表(参照の欄を持つ行の表)。 */
  readonly hostTable: string;
  readonly hostEntity: EntitySpec;
  /** 自表の執行点の計画(読む行の全部)。 */
  readonly plan: RefCheckPlan;
  /** この端の表の行。 */
  readonly row: RefCheckRow;
  /** 発火の宣言の字面。 */
  readonly fires: string;
  /** 発火の最初に掴む錨の行(錨の表の端・読む行が 1 つなら null。D25s2-1)。 */
  readonly anchor: CounterpartAnchor | null;
}

/** 相手の端が掴む錨(読む行のうち表名のバイト順で最初の行と、掴む強さ。D25s2-1)。 */
export interface CounterpartAnchor {
  readonly row: RefCheckRow;
  readonly strength: LockStrength;
}

/** 式の予約語のルート(欄の持ち主ではない)。 */
const RESERVED = new Set(['actor', 'now']);
/** 読む行の上限(3 つ以上は錨でない端の発火ごとの掴みが輪を作り 40P01 になる。安全と言える設計が揃うまで断る。点検 D25s3-1)。 */
const MAX_READ_ROWS = 2;
/** 行を受ける変数の前置。 */
const VARIABLE_PREFIX = 'v_';
/** 相手の端の名前の中置(`{自表の執行点}_on_{相手の集約}`)。 */
const COUNTERPART_INFIX = '_on_';
/** 相手の端の発火の後置(コミット時評価の制約トリガ)。 */
const DEFERRED_SUFFIX = ' (constraint trigger, deferrable initially deferred)';

/** 不変条件を、住む集約の名前とともに引く。 */
function locate(id: string, domain: SpecModel): { readonly invariant: InvariantDef; readonly aggregate: string } | null {
  for (const [aggregate, specs] of domain.aggregates) {
    const invariant = specs.invariants?.invariants.find((candidate) => candidate.id === id);
    if (invariant !== undefined) return { invariant, aggregate };
  }
  return null;
}

/** 欄を欄と等号で比べているか(2 つの集約の列どうしの一致は `cross-check-shape.ts` の担当。順序の比較はここの形)。 */
function equatesColumns(expr: GuardExpr): boolean {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return equatesColumns(expr.left) || equatesColumns(expr.right);
    case 'not':
      return equatesColumns(expr.operand);
    case 'compare':
      return expr.rhs.kind === 'path' && (expr.op === '==' || expr.op === '!=');
    case 'contains':
      return true;
    default:
      return false;
  }
}

/**
 * 式の最上段の `or` のうち、自表の真偽の欄を定数と比べる 1 つ(`{自表}.{欄} == true|false`)。それが成り立てば条件全体が成り立つので、
 * 本文は別の集約の行を読まずに(掴まずに)通してよい(fix25s。手書きの本文が元からそう読んでいた。条件を緩めない門だけを作る)。
 */
function gateOf(expr: GuardExpr, hostNames: ReadonlySet<string>, host: EntitySpec): RefCheckPlan['gate'] {
  if (expr.kind === 'or') return gateOf(expr.left, hostNames, host) ?? gateOf(expr.right, hostNames, host);
  if (expr.kind !== 'compare' || expr.op !== '==' || expr.rhs.kind !== 'symbol' || expr.path.segments.length !== 2) return null;
  const [root, column] = expr.path.segments;
  const field = host.fields.find((candidate) => candidate.name === column);
  const literal = expr.rhs.value;
  if (!hostNames.has(root ?? '') || field?.type.kind !== 'boolean' || field.required !== true || (literal !== 'true' && literal !== 'false')) return null;
  return { column: column ?? '', passes: literal === 'true' };
}

/**
 * トリガ 1 本について、参照の欄が指す行の列を見る条件として生成できるかを判定する(生成する側 `sql/ddl-check-triggers.ts`・
 * 生成できないことを報告する側 T17・相手の端の計画が同じ 1 本を呼ぶ)。
 *
 * @param trigger トリガの宣言
 * @param table そのトリガを宣言した表
 * @param domain ドメイン仕様
 * @param tables 全 data_table(相手の物理テーブル名を引く)
 * @returns この形でない(`none`)・生成できる(`ok`)・生成できない理由(`refused`)
 */
export function refCheckOf(trigger: DataTriggerDecl, table: DataTableSpec, domain: SpecModel, tables: readonly DataTableSpec[]): RefCheckJudgement {
  if (trigger.invariant === undefined || trigger.deferred || table.entity === undefined) return { kind: 'none' };
  const found = locate(trigger.invariant, domain);
  const host = found === null ? null : domain.aggregates.get(found.aggregate)?.entity;
  if (found === null || host === undefined || host === null || host.entity !== table.entity) return { kind: 'none' };
  const formal = found.invariant.formal;
  if (formal?.kind !== 'check' && formal?.kind !== 'state_dependency') return { kind: 'none' };
  const parsed = formalExpr(formal);
  if (!parsed.ok || equatesColumns(parsed.expr)) return { kind: 'none' };
  const hostNames = new Set([found.aggregate, host.entity]);
  const roots = [
    ...new Set(
      collectPaths(parsed.expr)
        .filter((path) => path.segments.length >= 2 && !RESERVED.has(path.segments[0] ?? ''))
        .map((path) => path.segments[0] ?? '')
        .filter((root) => !hostNames.has(root)),
    ),
  ];
  if (roots.length === 0) return { kind: 'none' };
  const refuse = (reason: string): RefCheckJudgement => ({ kind: 'refused', reason });
  const fires = parseFires(trigger.fires ?? '');
  if (fires.timing !== 'before' || !fires.events.includes('insert') || fires.events.some((event) => event !== 'insert' && event !== 'update')) {
    return refuse('参照の欄が指す行を読む条件のトリガは before insert(と update)で発火しなければならない(作る行が条件を満たすかを、書く前に確かめる)');
  }
  const rows: RefCheckRow[] = [];
  for (const root of roots) {
    const other = findEntity(domain, root);
    if (other === null) return refuse(`式が読む集約 ${root} の entity_spec が無い`);
    const column = refColumn(domain, host.entity, root);
    if (column === null) {
      return refuse(`${host.entity} の context が ${root} へ 1 段の参照の欄で届かない(\`${root}: ${host.entity}.{列}\` の宣言と、その列が ref(${other.entity}) であることが要る)`);
    }
    if (host.fields.find((field) => field.name === column)?.required !== true) {
      return refuse(`${host.entity}.${column} は空にできる参照の欄である(空のとき条件が適用されないのか拒否なのかが宣言から読めない。required にする)`);
    }
    const supplier = table.triggers.find((candidate) => candidate.name !== trigger.name && candidate.supplies.includes(column));
    if (supplier !== undefined && !(supplier.name < trigger.name)) {
      return refuse(`参照の欄 ${column} はトリガ ${supplier.name} が埋めるが、${trigger.name} の方が名前の順で先に発火する(埋まる前の空の欄で読む)`);
    }
    const otherTable = tables.find((candidate) => candidate.entity === other.entity)?.table;
    if (otherTable === undefined) return refuse(`${other.entity} の data_table が無いので、読む表の名前を引けない`);
    rows.push({ entity: other, table: otherTable, column, variable: `${VARIABLE_PREFIX}${otherTable}`, root });
  }
  rows.sort((left, right) => (left.table < right.table ? -1 : left.table > right.table ? 1 : 0));
  if (rows.length > MAX_READ_ROWS) return refuse(`読む行が ${rows.length} つ(${rows.map((row) => row.table).join(' / ')})の条件は生成しない —— 錨でない相手の端どうしの掴みが輪になり、害のない更新どうしでも 40P01 になる(点検 D25s3-1)。条件を 2 行ずつの不変条件に分ける`);
  return { kind: 'ok', plan: { invariant: found.invariant, rows, gate: gateOf(parsed.expr, hostNames, host) } };
}

/** 式がその集約の表で読む列(パスの 2 段目。昇順。覆いの判定 `sql/ddl-ref-check-edges.ts` も同じ読み方を使う)。 */
export function columnsOfRoot(paths: readonly PathRef[], roots: ReadonlySet<string>): readonly string[] {
  const columns = paths.filter((path) => roots.has(path.segments[0] ?? '')).map((path) => path.segments[1] ?? '');
  return [...new Set(columns)].filter((column) => column !== '').sort();
}

/** 更新で見る列の発火の字面。 */
function updateFires(watched: readonly string[] | 'all'): string {
  return `${watched === 'all' ? 'after update' : `after update of ${[...watched].sort().join(', ')}`}${DEFERRED_SUFFIX}`;
}

/** 相手の端が掴む錨(読む行の最初 = 表名のバイト順。錨の表の端は null。読む行は 2 つまで = 錨でない端は 1 本なので共有。D25s2-1 / D25s3-1)。 */
export function anchorOf(plan: RefCheckPlan, row: RefCheckRow): CounterpartAnchor | null {
  const anchor = plan.rows[0];
  if (anchor === undefined || (anchor.table === row.table && anchor.column === row.column)) return null;
  return { row: anchor, strength: 'share' };
}

/** その表に名前が既に在るか(トリガか関数として)。 */
function taken(table: DataTableSpec, name: string): boolean {
  return table.triggers.some((trigger) => trigger.name === name || trigger.functionName === name) || table.functions.some((fn) => fn.name === name);
}

/**
 * 全 data_table のうち、**その表を相手の端とする**計画(自表の執行点の宣言順・読む行の順)。
 *
 * @param table 相手の端の表
 * @param domain ドメイン仕様
 * @param tables 全 data_table
 * @returns 計画(無ければ空)
 */
export function refCounterpartsOf(table: DataTableSpec, domain: SpecModel, tables: readonly DataTableSpec[]): readonly RefCounterpart[] {
  const found: RefCounterpart[] = [];
  for (const host of tables) {
    for (const trigger of host.triggers) {
      if (host.functions.some((fn) => fn.name === trigger.functionName && fn.handwritten !== undefined)) continue;
      const judged = refCheckOf(trigger, host, domain, tables);
      if (judged.kind !== 'ok') continue;
      const hostEntity = host.entity === undefined ? null : findEntity(domain, host.entity);
      const formal = judged.plan.invariant.formal;
      const parsed = formal?.kind === 'check' || formal?.kind === 'state_dependency' ? formalExpr(formal) : null;
      if (hostEntity === null || parsed === null || !parsed.ok) continue;
      const paths = collectPaths(parsed.expr);
      for (const row of judged.plan.rows) {
        if (row.table !== table.table) continue;
        const name = `${trigger.name}${COUNTERPART_INFIX}${row.entity.entity}`;
        if (Buffer.byteLength(name, 'utf8') > MAX_IDENTIFIER_BYTES || taken(table, name)) continue;
        const columns = columnsOfRoot(paths, new Set([row.root, row.entity.entity]));
        if (columns.length === 0) continue;
        const fires = updateFires(watchedColumnsOf(table, columns));
        found.push({ name, invariant: judged.plan.invariant, hostTable: host.table, hostEntity, plan: judged.plan, row, fires, anchor: anchorOf(judged.plan, row) });
      }
    }
  }
  return found;
}

/**
 * 相手の端を **data_table の宣言の形**に写す(突合・文書・ハンドブックが宣言されたものと同じ形で読む。天井の `ceilingDeclsOf` と同じ扱い)。
 *
 * @param table 相手の端の表
 * @param domain ドメイン仕様
 * @param tables 全 data_table
 * @returns トリガと関数の宣言(無ければ空)
 */
export function refCounterpartDeclsOf(
  table: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[],
): { readonly triggers: readonly DataTriggerDecl[]; readonly functions: readonly DataFunctionDecl[] } {
  const counterparts = refCounterpartsOf(table, domain, tables);
  return {
    triggers: counterparts.map((end) => ({
      name: end.name,
      functionName: end.name,
      fires: end.fires,
      deferred: true,
      supplies: [],
      params: {},
      invariant: end.invariant.id,
    })),
    functions: counterparts.map((end) => ({ name: end.name, args: [], params: [], kind: 'trigger', alsoWrites: [], security: 'definer', lookup: [] })),
  };
}
