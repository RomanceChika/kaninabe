/**
 * **別の集約の列との等式**の不変条件(`formal.type: check` で、式がもう 1 つの集約の欄を読むもの)の**形**の判定。
 *
 * 形とは、トリガの発火や遅延の約束(`lib/sql/cross-check-plan.ts` が持つ)より前の、宣言から読める事実である —— 式が読む 2 つの集約
 * (不変条件が住む `host` と、もう 1 つの `other`)・`host` が `other` を指す参照の欄(`context` の 1 段・required)・宣言した表がどちらの端か。
 * 生成するトリガ(`lib/sql/`)と、そのトリガが引く索引を導く側(`lib/relations/index-requirements/`)が**同じ形の判定**を読む
 * (索引の導出は種類の層より下にあるので、判定はここ=前段に置く。`ceiling-plan.ts` と同じ置き場の理由)。
 *
 * ## 読み方(DSL の解釈。曖昧なら最も厳しい側に倒す)
 *
 * - 式は **2 つの集約**だけを読む。3 つ以上の集約を読む式は形にならない(理由を報告する)。
 * - `host` から `other` へ届く道は `context` の**1 段の参照の欄**(`{other}: {host}.{列}`)だけ。2 段の中継は形にならない。
 * - その参照の欄は **required(NOT NULL)**でなければならない。空にできる欄は「空のとき条件が適用されない」のか
 *   「空なら拒否」なのかが宣言から読めないので形にならない(曖昧さを許す側に倒さない)。例外は、式の最上段の `or` が
 *   `{host}.{参照の欄} is null` を持つとき(空なら条件を課さない、と式が言い切っている。本文の内部結合の読み方と一致する。fix25s)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr } from '../../guard/ast.js';
import { parseFormalGuard } from '../../guard/parser.js';
import { collectPaths } from '../../guard/services.js';
import type { DataTableSpec, DataTriggerDecl } from './types.js';
import { findEntity } from '../path-hops.js';
import { refColumn } from '../ref-path.js';
import type { EntitySpec, InvariantDef, SpecModel } from '../types.js';
import { updatedColumnsOf } from '../trigger-fires.js';

/** 両端の表のうち、どちら側の宣言か。 */
export type CrossSide = 'host' | 'referenced';

/** 端 1 つ(集約と、その物理テーブル)。 */
export interface CrossEnd {
  readonly entity: EntitySpec;
  readonly table: string;
}

/** 形が読めたときの事実。 */
export interface CrossShape {
  readonly side: CrossSide;
  readonly invariant: InvariantDef;
  /** 不変条件が住む集約の側(参照の欄を持つ側)。 */
  readonly host: CrossEnd;
  /** 式が読むもう 1 つの集約(参照される側)。 */
  readonly other: CrossEnd;
  /** `host` が `other` を指す参照の欄(`context` が名指した 1 本)。 */
  readonly refColumn: string;
  /** 式が読む `host` の列(参照の欄を含まない)。 */
  readonly hostColumns: readonly string[];
  /** 式が読む `other` の列。 */
  readonly otherColumns: readonly string[];
}

/** 形の判定の結果(別の集約の等式でない / 形が読めた / 読めない理由つき)。 */
export type CrossShapeJudgement =
  | { readonly kind: 'none' }
  | { readonly kind: 'shape'; readonly shape: CrossShape }
  | { readonly kind: 'refused'; readonly reason: string };

/** 式の予約語のルート(欄の持ち主ではない)。 */
const RESERVED = new Set(['actor', 'now']);

/** 不変条件を、住む集約の entity とともに引く。 */
function locate(id: string, domain: SpecModel): { invariant: InvariantDef; entity: EntitySpec | undefined; aggregate: string } | null {
  for (const [aggregate, specs] of domain.aggregates) {
    const invariant = specs.invariants?.invariants.find((candidate) => candidate.id === id);
    if (invariant !== undefined) return { invariant, entity: specs.entity, aggregate };
  }
  return null;
}

/**
 * 式の最上段の `or` のどれかが `{自表}.{参照の欄} is null` か(空の参照の欄では条件を課さない、と式が言い切っている)。
 *
 * 本文は相手の行と内部結合で読むので、参照の欄が空の行は結合に現れず、条件を課さない —— 式がそう言い切ったときだけ、その読み方が
 * 宣言と一致する。言い切らない空にできる欄は、曖昧さを許す側に倒さず形にしない。
 */
function nullGuarded(expr: GuardExpr, hostNames: ReadonlySet<string>, column: string): boolean {
  if (expr.kind === 'or') return nullGuarded(expr.left, hostNames, column) || nullGuarded(expr.right, hostNames, column);
  return expr.kind === 'null' && expr.path.segments.length === 2 && hostNames.has(expr.path.segments[0] ?? '') && expr.path.segments[1] === column;
}

/** 式が読む `{集約}.{欄}` のパス(予約語を除く、2 語以上のもの)。 */
function ownedPaths(expr: GuardExpr): readonly { readonly root: string; readonly field: string }[] {
  return collectPaths(expr)
    .filter((path) => path.segments.length >= 2 && !RESERVED.has(path.segments[0] ?? ''))
    .map((path) => ({ root: path.segments[0] ?? '', field: path.segments[path.segments.length - 1] ?? '' }));
}

/**
 * トリガ 1 本について、別の集約の列との等式の**形**が読めるかを判定する。
 *
 * @param trigger トリガの宣言
 * @param table そのトリガを宣言した表
 * @param domain ドメイン仕様
 * @param tables 全 data_table(相手の物理テーブル名を引く)
 * @returns 別の集約の等式でない(`none`)・形が読めた(`shape`)・読めない理由(`refused`)
 */
export function crossShapeOf(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[],
): CrossShapeJudgement {
  if (trigger.invariant === undefined) return { kind: 'none' };
  const found = locate(trigger.invariant, domain);
  const host = found?.entity;
  const formal = found?.invariant.formal;
  if (found === null || host === undefined || formal === undefined || formal.kind !== 'check') return { kind: 'none' };
  const parsed = parseFormalGuard(formal.expr);
  if (!parsed.ok) return { kind: 'none' };
  const hostNames = new Set([found.aggregate, host.entity]);
  const paths = ownedPaths(parsed.expr);
  const roots = [...new Set(paths.map((path) => path.root).filter((root) => !hostNames.has(root)))];
  if (roots.length === 0) return { kind: 'none' };
  const refuse = (reason: string): CrossShapeJudgement => ({ kind: 'refused', reason });
  const root = roots[0] ?? '';
  if (roots.length > 1) {
    return refuse(`式が 3 つ以上の集約(${[found.aggregate, ...roots].join(' / ')})の欄を読む(生成できるのは 2 つの集約の一致だけ)`);
  }
  const other = findEntity(domain, root);
  if (other === null) return refuse(`式が読む集約 ${root} の entity_spec が無い`);
  const column = refColumn(domain, host.entity, root);
  if (column === null) {
    return refuse(
      `${host.entity} の context が ${root} へ 1 段の参照の欄で届かない(\`${root}: ${host.entity}.{列}\` の宣言と、その列が ref(${other.entity}) であることが要る。中継を挟む道は生成しない)`,
    );
  }
  const refField = host.fields.find((field) => field.name === column);
  if (refField?.required !== true && !nullGuarded(parsed.expr, hostNames, column)) {
    return refuse(
      `${host.entity}.${column} は空にできる参照の欄である(空のとき条件が適用されないのか拒否なのかが宣言から読めない。required にするか、` +
        `式を \`${host.entity}.${column} is null or …\` と書いて空のときを言い切る)`,
    );
  }
  const side: CrossSide | null =
    table.entity === host.entity ? 'host' : table.entity === other.entity ? 'referenced' : null;
  if (side === null) {
    return refuse(`表 ${table.table} は ${trigger.invariant} の両端(${host.entity} / ${other.entity})のどちらの表でもない`);
  }
  const hostTable = tables.find((candidate) => candidate.entity === host.entity)?.table;
  const otherTable = tables.find((candidate) => candidate.entity === other.entity)?.table;
  if (hostTable === undefined || otherTable === undefined) {
    return refuse(`${hostTable === undefined ? host.entity : other.entity} の data_table が無いので、結合する表の名前を引けない`);
  }
  return {
    kind: 'shape',
    shape: {
      side,
      invariant: found.invariant,
      host: { entity: host, table: hostTable },
      other: { entity: other, table: otherTable },
      refColumn: column,
      hostColumns: [...new Set(paths.filter((path) => hostNames.has(path.root)).map((path) => path.field))],
      otherColumns: [...new Set(paths.filter((path) => path.root === root).map((path) => path.field))],
    },
  };
}

/**
 * 更新で見るべき列(式が読む列に、それを書き換える別トリガの発火列を足す)。
 *
 * `update of {列}` は UPDATE の SET に書かれた列でしか発火せず、BEFORE トリガが書き換えた列は数えない。
 * 列を供給するトリガが「どの更新でも」発火するなら、列を絞れない(`'all'`)。
 */
export function watchedColumnsOf(table: DataTableSpec, columns: readonly string[]): readonly string[] | 'all' {
  const watched = new Set(columns);
  let grown = true;
  while (grown) {
    grown = false;
    for (const trigger of table.triggers) {
      if (!trigger.supplies.some((column) => watched.has(column))) continue;
      const updated = updatedColumnsOf(trigger.fires ?? '');
      if (updated === null) continue;
      if (updated === 'all') return 'all';
      for (const column of updated) {
        if (!watched.has(column)) {
          watched.add(column);
          grown = true;
        }
      }
    }
  }
  return [...watched];
}
