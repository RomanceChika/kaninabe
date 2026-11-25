/**
 * 期待スキーマ表(生成物 data-table-expectations)のうち、**製品の閉じた受け入れの表を照らす材料**の部分
 * (試験の登録簿と、隔離の門の 1 行目)。本体の組み立て `code-data-table-expectations.ts` が呼ぶ。責務は「製品の受け入れの表を照らす
 * 材料の写し」の 1 つで、表ごとの期待(本体)とは読む宣言が違う(test_cases と不変条件 ID・拒否の本体の字面)。
 *
 * ## 試験の登録簿(表 → 不変条件 → 試験の ID。点検 D25s-4 → D25s2-3 → D25s3-5)
 *
 * 受け入れの行は表と不変条件を名指す。試験の ID は、**その表の data_table の md の test_cases のうち、その不変条件の ID を
 * `spec_ids` に持つもの**に実在しなければならない。以前は表ごとの「covers に invariant を持つもの」で近似していたので、
 * 同じ表の別の不変条件の試験の ID の打ち間違いが緑だった。`spec_ids` は元から不変条件 ID を書ける欄(T3 が実在を見る)で、
 * 新しい宣言の種類は足さない。
 *
 * ## 表の集約の不変条件(表 → 不変条件。点検 D25s4-4)
 *
 * 登録簿は表に載る試験の `spec_ids` から作るので、**別の集約の不変条件**も載る(メンバーの不変条件を見る試験が ai_usage の表にある等)。
 * 受け入れの行の不変条件がその表の集約のものであることは、表の entity を持つ集約の invariants で別に照らす。
 *
 * ## 受け入れの行(表の `parity_accepts`。点検 26 回目 A26-1)
 *
 * 天井のトリガの鍵の受け入れだけは、手で書かずに宣言(`creates[].abuse` と天井を名指す不変条件)から導いて同じ並びに入れる
 * (`model/data/ceiling-plan.ts` の `ceilingAdvisoryAcceptOf`)。
 *
 * 突合の照らし(不変条件の書き込みの端・トリガの advisory lock・隔離の門)の受け入れは、表の data_table の宣言が正である。ここはそれを
 * 照らしの種類ごとに表名を添えて写すだけで、突合の部品は受け入れを文字列で持たない(持つと題材の通し実行で突合ごと外れた)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../../model/types.js';
import type { DataTableSpec } from '../../model/data/types.js';
import { ISOLATION_GATE_HEAD } from '../../sql/ddl-isolation-guard.js';
import { docComment, renderLiteral } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import { ceilingAdvisoryAcceptOf } from '../../model/data/ceiling-plan.js';
import { CEILING_WORDS } from '../../messages/messages-ddl.js';

/** バイト順の比べ。 */
function byBytes(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 表 → 不変条件 ID → その不変条件を `spec_ids` に持つ試験の ID(どれも昇順・重複なし。試験の無い表・不変条件は載せない)。
 *
 * @param tables 全 data_table
 * @param domain ドメイン仕様(不変条件 ID の母集合)
 * @returns 登録簿
 */
export function invariantTestCaseIdsOf(tables: readonly DataTableSpec[], domain: SpecModel): Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> {
  const invariants = new Set([...domain.aggregates.values()].flatMap((specs) => (specs.invariants?.invariants ?? []).map((invariant) => invariant.id)));
  const registry: Record<string, Record<string, readonly string[]>> = {};
  for (const table of [...tables].sort((left, right) => byBytes(left.table, right.table))) {
    const byInvariant = new Map<string, Set<string>>();
    for (const testCase of table.testCases) {
      for (const id of testCase.specIds.filter((specId) => invariants.has(specId))) byInvariant.set(id, (byInvariant.get(id) ?? new Set()).add(testCase.id));
    }
    if (byInvariant.size === 0) continue;
    registry[table.table] = Object.fromEntries([...byInvariant.entries()].sort(([left], [right]) => byBytes(left, right)).map(([id, tests]) => [id, [...tests].sort(byBytes)]));
  }
  return registry;
}

/**
 * 表 → その表の集約の不変条件 ID(表の entity を持つ集約の invariants。昇順。entity の無い表・不変条件の無い集約は載せない)。
 *
 * @param tables 全 data_table
 * @param domain ドメイン仕様
 * @returns 表 → 不変条件 ID
 */
export function ownInvariantsOf(tables: readonly DataTableSpec[], domain: SpecModel): Readonly<Record<string, readonly string[]>> {
  const byEntity = new Map<string, readonly string[]>();
  for (const specs of domain.aggregates.values()) {
    const ids = (specs.invariants?.invariants ?? []).map((invariant) => invariant.id);
    if (specs.entity !== undefined && ids.length > 0) byEntity.set(specs.entity.entity, [...new Set(ids)].sort(byBytes));
  }
  const own: Record<string, readonly string[]> = {};
  for (const table of [...tables].sort((left, right) => byBytes(left.table, right.table))) {
    const ids = table.entity === undefined ? undefined : byEntity.get(table.entity);
    if (ids !== undefined) own[table.table] = ids;
  }
  return own;
}

/** 端の受け入れ 1 行(生成物の形)。 */
interface EdgeAcceptRow {
  readonly invariant: string;
  readonly table: string;
  readonly edge: string;
  readonly reason: string;
  readonly test: string;
}

/** トリガ関数の受け入れ 1 行(生成物の形)。 */
interface FunctionAcceptRow {
  readonly function: string;
  readonly reason: string;
  readonly table: string;
  readonly invariant: string;
  readonly test: string;
}

/** 照らしの種類ごとの受け入れ(生成物の形)。 */
export interface ParityAcceptRows {
  readonly invariantEdges: readonly EdgeAcceptRow[];
  readonly triggerAdvisory: readonly FunctionAcceptRow[];
  readonly isolationGate: readonly FunctionAcceptRow[];
}

/**
 * 全表の `parity_accepts` を照らしの種類ごとに集める(端は 不変条件・表・端 の順、関数は 関数・表 の順)。
 *
 * @param tables 全 data_table
 * @param domain ドメイン仕様(天井の鍵の受け入れを導く)
 * @returns 照らしの種類ごとの受け入れ
 */
export function parityAcceptRowsOf(tables: readonly DataTableSpec[], domain: SpecModel): ParityAcceptRows {
  const edges: EdgeAcceptRow[] = [];
  const advisory: FunctionAcceptRow[] = [];
  const gate: FunctionAcceptRow[] = [];
  const tests = invariantTestCaseIdsOf(tables, domain);
  for (const table of tables) {
    // 天井の鍵の受け入れは宣言から導く(手で書いた行は R5-4 が止める。判定は ceiling-plan.ts の 1 本)。
    const ceiling = ceilingAdvisoryAcceptOf(table, domain, tests);
    if (ceiling !== null) {
      advisory.push({ function: ceiling.function, reason: CEILING_WORDS.advisoryAccept(ceiling.lockKey), table: ceiling.table, invariant: ceiling.invariant, test: ceiling.test });
    }
    for (const accept of table.parityAccepts ?? []) {
      if (accept.check === 'invariant_edge') {
        edges.push({ invariant: accept.invariant, table: table.table, edge: accept.edge, reason: accept.reason, test: accept.test });
        continue;
      }
      const row = { function: accept.function, reason: accept.reason, table: table.table, invariant: accept.invariant, test: accept.test };
      (accept.check === 'trigger_advisory' ? advisory : gate).push(row);
    }
  }
  const edgeKey = (row: EdgeAcceptRow): string => `${row.invariant}\u0000${row.table}\u0000${row.edge}`;
  const functionKey = (row: FunctionAcceptRow): string => `${row.function}\u0000${row.table}`;
  return {
    invariantEdges: edges.sort((left, right) => byBytes(edgeKey(left), edgeKey(right))),
    triggerAdvisory: advisory.sort((left, right) => byBytes(functionKey(left), functionKey(right))),
    isolationGate: gate.sort((left, right) => byBytes(functionKey(left), functionKey(right))),
  };
}

/**
 * 照らしの材料の行(登録簿・表の集約の不変条件・門の 1 行目)。
 *
 * @param tables 全 data_table
 * @param domain ドメイン仕様
 * @returns 生成物の行
 */
export function registryLines(tables: readonly DataTableSpec[], domain: SpecModel): readonly string[] {
  return [
    docComment([
      '試験の登録簿: 表 → 不変条件 ID → その data_table の md の test_cases のうち、その不変条件の ID を `spec_ids` に持つものの ID(昇順)。',
      '受け入れの表(不変条件の書き込みの端・隔離の門・トリガの advisory lock)の試験の ID が、**その行の表と不変条件の**この範囲に実在することを製品の照らしが見る',
      '(点検 D25s-4 → D25s2-3 → D25s3-5。表の範囲だけで照らすと、同じ表の別の不変条件の試験の ID の打ち間違いが緑だった)。',
    ]),
    `export const dataTableInvariantTestCaseIds: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = ${frozen(renderLiteral(invariantTestCaseIdsOf(tables, domain)))};`,
    '',
    docComment([
      '表 → その表の集約の不変条件 ID(表の entity を持つ集約の invariants。昇順)。受け入れの表(隔離の門・トリガの advisory lock)の行の不変条件が、',
      '行の表の集約のものであることを製品の照らしが見る(点検 D25s4-4。登録簿には試験の spec_ids に載る別の集約の不変条件も入る)。',
    ]),
    `export const dataTableOwnInvariants: Readonly<Record<string, readonly string[]>> = ${frozen(renderLiteral(ownInvariantsOf(tables, domain)))};`,
    '',
    docComment([
      '隔離の水準の拒否の門の 1 行目(拒否の本体 legacy/spec-tools/lib/sql/ddl-isolation-guard.ts の写し)。',
      '行の集合を数える・確かめる条件のトリガ(手書きも)がこの門を持つことを、製品の isolation-gate-parity が実 DB の全部のトリガ関数で照らす(観察 O2-1)。',
    ]),
    `export const isolationGateHead: string = ${renderLiteral(ISOLATION_GATE_HEAD)};`,
    '',
    docComment([
      '構造の突合の照らしの受け入れ(表の data_table の `parity_accepts` の写し。照らしの種類ごと)。突合の部品(不変条件の書き込みの端・',
      'トリガの advisory lock・隔離の門)はこれを読むだけで、受け入れを文字列で持たない(点検 26 回目 A26-1)。',
    ]),
    `export const dataTableParityAccepts: {`,
    '  readonly invariantEdges: readonly { readonly invariant: string; readonly table: string; readonly edge: string; readonly reason: string; readonly test: string }[];',
    '  readonly triggerAdvisory: readonly { readonly function: string; readonly reason: string; readonly table: string; readonly invariant: string; readonly test: string }[];',
    '  readonly isolationGate: readonly { readonly function: string; readonly reason: string; readonly table: string; readonly invariant: string; readonly test: string }[];',
    `} = ${frozen(renderLiteral(parityAcceptRowsOf(tables, domain)))};`,
    '',
  ];
}
