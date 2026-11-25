/**
 * `access_spec.writes[]` のうち、**執行する生成物が 1 つも無い書き込み規則**の判定(意味解析の層)。
 *
 * 規則を SQL の執行点に落とすのは **`shape: update` の生成 RPC の本文だけ**である
 * (`lib/sql/rpc-authz-build.ts` の `updateAuthz`)。その形の関数を宣言していない表では、`writes[]` は
 * 読み物になる。**遷移が書く列の規則**(`by: system` かつ `when` 無し・全列が遷移の書き込みとして宣言済み)は、
 * `shape: transition` の RPC が執行点になる。**`composite` の関数が `enforces` で名指しした規則**
 * (見張りテストが実在するもの。ADR-0014)も執行点を持つものとして数える。
 *
 * **A18(検査器)と、変異の目録(`lib/mutation/exemptions.ts`。「この穴は A18 が報告しているか」)が、
 * 同じこの 1 本を読む。** 同じ判定を 2 か所に書くと片方だけが直る。ここが返すのは**事実**
 * (どの規則が・どの理由で執行点を持たないか)で、日本語の文面は持たない —— 理由の文面は文言の層
 * (`lib/messages/messages-enforcement.ts` の `enforcementGapWords`)が組む。判定の根拠の全文は A18 のファイル冒頭にある。
 */

import type { DataTableSpec, DataTableSpecModel } from '../model/data/types.js';
import { systemRoleId } from '../model/role-hierarchy.js';
import type { AccessSpec, AggregateSpecs, SpecModel, WriteRule } from '../model/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import { compositeEnforcements, enforcementOf } from './composite-enforces.js';

/** 人が編集する規則を執行する定型 RPC の形。 */
const ENFORCING_SHAPE = 'update';

/** 遷移が書く列の規則を執行する定型 RPC の形。 */
const TRANSITION_SHAPE = 'transition';

/** 執行点が無い理由(事実。文面は持たない)。 */
export type EnforcementGap =
  /** その集約に帰属する data_table が無い。 */
  | { readonly kind: 'no_table' }
  /** その形の `kind: rpc` の関数が宣言されていない。 */
  | { readonly kind: 'no_function'; readonly table: string; readonly shape: string }
  /** 関数は手書き(`migration:` 無し)で、見張る `test_cases` も無い。 */
  | { readonly kind: 'unwatched_handwritten'; readonly table: string; readonly shape: string };

/** 執行点を持たない書き込み規則 1 本(判定の中身を他からも引けるようにした形)。 */
export interface UnenforcedWriteRule {
  readonly entity: string;
  readonly rule: WriteRule;
  readonly table: DataTableSpec | undefined;
  /** 執行点が無い理由。 */
  readonly gap: EnforcementGap;
  readonly access: AccessSpec;
}

/**
 * 執行点を持たない `writes` の規則をすべて挙げる(A18 の判定そのもの)。
 *
 * @param domain ドメイン仕様
 * @param tables 読み込み済みの data_table(読めない構成では undefined)
 * @param actions 読み込み済みの action_spec(`computes` を「遷移が書く列」として数えるために使う)
 * @returns 執行点を持たない規則(集約の宣言順)
 */
export function unenforcedWriteRules(
  domain: SpecModel,
  tables: DataTableSpecModel | undefined,
  actions?: ActionSpecModel,
): readonly UnenforcedWriteRule[] {
  if (tables === undefined || !tables.available) return [];
  const found: UnenforcedWriteRule[] = [];
  const system = systemRoleId(domain.roles.roles);
  const enforcements = compositeEnforcements(tables.tables);
  for (const specs of domain.aggregates.values()) {
    const access = specs.access;
    if (access === undefined || access.writes.length === 0) continue;
    const table = tables.tables.find((candidate) => candidate.entity === access.entity);
    const gap = missingEnforcement(table, ENFORCING_SHAPE);
    if (gap === null) continue;
    const byTransition = transitionWrittenFields(specs, access.entity, actions);
    const transitionGap = missingEnforcement(table, TRANSITION_SHAPE);
    for (const rule of access.writes) {
      const written =
        rule.by === system &&
        rule.when === undefined &&
        rule.fields.every((field) => byTransition.has(field));
      if (written && transitionGap === null) continue;
      if (enforcementOf(enforcements, access.entity, rule.by) !== undefined) continue;
      found.push({ entity: access.entity, rule, table, gap, access });
    }
  }
  return found;
}

/**
 * その集約の欄のうち、**遷移が書くと宣言されている**もの
 * (`records_actor` / `records_time` / `clears` / `computes`)。
 *
 * `computes` を数えるのはその集約の**遷移**に接地する action_spec のものだけである —— 作成や
 * 編集の計算値は `shape: create` / `shape: update` の RPC が書くので、遷移の RPC は執行点にならない。
 *
 * @param specs その集約の仕様一式
 * @param entity エンティティ名(`computes` の左辺の照合に使う)
 * @param actions 読み込み済みの action_spec(読めない構成では undefined)
 * @returns 遷移が書くと宣言されている欄
 */
function transitionWrittenFields(
  specs: AggregateSpecs,
  entity: string,
  actions: ActionSpecModel | undefined,
): ReadonlySet<string> {
  const written = new Set<string>();
  const machines = new Set(specs.stateMachines.map((machine) => machine.machine));
  for (const machine of specs.stateMachines) {
    for (const event of machine.events) {
      for (const field of event.recordsActor ?? []) written.add(field);
      for (const field of event.recordsTime ?? []) written.add(field);
      for (const field of event.clears ?? []) written.add(field);
    }
  }
  for (const action of actions?.actions ?? []) {
    if (!machines.has(action.handles.machine)) continue;
    for (const compute of action.computes) if (compute.entity === entity) written.add(compute.field);
  }
  return written;
}

/**
 * その表に「`writes` を執行する生成物」が無い理由(あれば null)。
 *
 * @param table その集約のテーブル仕様(帰属が無ければ undefined)
 * @param shape 執行点として探す定型 RPC の形
 * @returns 執行点が無い理由。執行点があれば null
 */
function missingEnforcement(table: DataTableSpec | undefined, shape: string): EnforcementGap | null {
  if (table === undefined) return { kind: 'no_table' };
  const found = table.functions.filter((fn) => fn.kind === 'rpc' && fn.shape === shape);
  if (found.length === 0) return { kind: 'no_function', table: table.table, shape };
  if (found.some((fn) => fn.migration !== undefined)) return null;
  if (table.testCases.length > 0) return null;
  return { kind: 'unwatched_handwritten', table: table.table, shape };
}
