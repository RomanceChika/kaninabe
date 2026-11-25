/**
 * 必読に数える公理(不変条件の言明のほかに、人が意味を判定するもの)の導出。
 *
 * 分類(`reading-class.ts`)では次のものも公理である。数える単位を **1 か所で**決める —— 章(`face-facts`)も
 * 手引きのブロック表(`block-reading`)も、この関数から数えるので、数は食い違わない:
 *
 * - **アクセスの宣言** … `access_spec` の `reads`(内部実行のロールは除く)・`creates`・`writes`・`deletes`。
 *   「誰が・何を・どの条件で」は、保証マップでは人の判断である(`filters` / `when` の意図を含む)。
 *   **数える単位は表の行**で、宣言 1 本ずつではない(判断ポイントの台帳は 1 本 1 件で、数え方が違う):
 *   読むは「集約 × 役」の表の行(集約 1 つにつき 1 行)、作る・書く・消すは、種類と欄と条件が同じ宣言の
 *   役を 1 行にまとめた行(世話役と運営スタッフの代理は 1 行になる)
 * - **状態の意味** … `states[].summary` を持つ状態 1 つ
 * - **要約の文** … 章頭の 1 文(`entity_spec.summary`)と節の要約(状態機械ごとの `summary`)。書かれているものだけ
 * - **計算の例の表** … `computes[].examples` の行。数える単位は**行**(「この入力ならこの値」の主張 1 つ)で、
 *   式の代わりに人が外の世界(業務の規則)と照らして判定するもの(`computeExampleSets`。`semantics/compute-examples.ts`)
 *
 * **計算される欄(`computes`)の宣言は数えない**。宣言は欄と、それを決める純関数の名前だけで、式は宣言に無い
 * (DSL の外の純関数の中)ので、人が判定する対象が無い。書き手の側は access の「システムが書く欄」で既に
 * 必読に入る。宣言は導出として下段に「欄 → 純関数」の表で出す(`computeItems`)。
 *
 * 純粋関数だけ(意味解析の層)。**アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, AggregateSpecs, ReadFilter, ReadScope, SpecModel, StateMachineSpec } from '../model/types.js';
import type { ActionSpec } from '../model/trace/types.js';
import { computeExampleTable } from './compute-examples.js';

/** アクセスの宣言 1 本。 */
export interface AccessRuleItem {
  /** 読む / 作る / 書く / 消す。 */
  readonly kind: 'read' | 'create' | 'write' | 'delete';
  /** 誰が(ロール ID)。 */
  readonly by: string;
  /** 読める範囲(`read` だけ)。 */
  readonly scope?: ReadScope;
  /** 書ける欄(`write` だけ)。 */
  readonly fields?: readonly string[];
  /** 実行者の属性で行を絞る条件(`read` だけ。無ければ空)。 */
  readonly filters: readonly ReadFilter[];
  /** 条件の式(ガード式の生文字列。省略は常に許可)。 */
  readonly when?: string;
}

/**
 * アクセスの宣言を、宣言の並び(読む → 作る → 書く → 消す)で返す。内部実行のロールの読み取りは除く
 * (判断ポイントの台帳と同じ数え方)。作る・書く・消すは内部実行のものも数える(人の操作ではない列を書く許可も、
 * 書いてよい根拠として人が読む)。
 *
 * @param access 集約のアクセス仕様
 * @param system 内部実行のロール ID
 */
export function accessRules(access: AccessSpec | undefined, system: string | undefined): AccessRuleItem[] {
  if (access === undefined) return [];
  const withWhen = (when: string | undefined): { readonly when?: string } => (when === undefined ? {} : { when });
  return [
    ...access.reads
      .filter((rule) => rule.by !== system)
      .map((rule): AccessRuleItem => ({ kind: 'read', by: rule.by, scope: rule.scope, filters: rule.filters ?? [], ...withWhen(rule.when) })),
    ...access.creates.map((rule): AccessRuleItem => ({ kind: 'create', by: rule.by, filters: [], ...withWhen(rule.when) })),
    ...access.writes.map((rule): AccessRuleItem => ({ kind: 'write', by: rule.by, fields: rule.fields, filters: [], ...withWhen(rule.when) })),
    ...access.deletes.map((rule): AccessRuleItem => ({ kind: 'delete', by: rule.by, filters: [], ...withWhen(rule.when) })),
  ];
}

/** 作る・書く・消すの 1 行(種類・書ける欄・条件が同じ宣言の役をまとめたもの)。 */
export interface AccessWriteRow {
  readonly kind: 'create' | 'write' | 'delete';
  /** 誰が(ロール ID。宣言の並び)。 */
  readonly roles: readonly string[];
  /** 書ける欄(`write` だけ)。 */
  readonly fields?: readonly string[];
  /** 条件の式(ガード式の生文字列。省略は常に許可)。 */
  readonly when?: string;
}

/** 集約 1 つのアクセスの宣言を、数える単位(表の行)にまとめたもの。 */
export interface AccessTable {
  /** 読むの宣言(内部実行のロールを除く)。「集約 × 役」の表の 1 行になる。 */
  readonly reads: readonly AccessRuleItem[];
  /** 作る・書く・消すの行(種類 → 宣言の並びの順)。 */
  readonly rows: readonly AccessWriteRow[];
}

/**
 * アクセスの宣言を、表の行にまとめる。作る・書く・消すは、**種類・書ける欄・条件が同じ**宣言の役を 1 行にする
 * (役の並びは宣言の並び。欄の並び違いは別の行)。
 *
 * @param access 集約のアクセス仕様
 * @param system 内部実行のロール ID
 */
export function accessTable(access: AccessSpec | undefined, system: string | undefined): AccessTable {
  const rules = accessRules(access, system);
  const rows = new Map<string, AccessWriteRow>();
  for (const rule of rules) {
    if (rule.kind === 'read') continue;
    const key = JSON.stringify([rule.kind, rule.fields ?? null, rule.when ?? null]);
    const known = rows.get(key);
    if (known !== undefined) {
      rows.set(key, { ...known, roles: [...known.roles, rule.by] });
      continue;
    }
    rows.set(key, {
      kind: rule.kind,
      roles: [rule.by],
      ...(rule.fields === undefined ? {} : { fields: rule.fields }),
      ...(rule.when === undefined ? {} : { when: rule.when }),
    });
  }
  return { reads: rules.filter((rule) => rule.kind === 'read'), rows: [...rows.values()] };
}

/** 数える行の数(読むの表の行 1 + 作る・書く・消すの行)。 */
export function accessUnits(table: AccessTable): number {
  return (table.reads.length === 0 ? 0 : 1) + table.rows.length;
}

/** 状態の意味 1 つ(`states[].summary` を持つ状態)。 */
export interface StateMeaning {
  readonly machine: string;
  readonly state: string;
  readonly summary: string;
}

/** 状態の意味を、状態機械の並び → 状態の宣言順で返す(`summary` を持つ状態だけ)。 */
export function stateMeanings(machines: readonly StateMachineSpec[]): StateMeaning[] {
  return machines.flatMap((machine) =>
    machine.states.flatMap((state) => {
      const summary = machine.stateSummaries[state];
      return summary === undefined ? [] : [{ machine: machine.machine, state, summary }];
    }),
  );
}

/** 要約の文 1 つ(章頭の 1 文か、節の要約)。 */
export interface SummarySentence {
  /** 章頭(`entity`)か節(`machine`)か。 */
  readonly kind: 'entity' | 'machine';
  /** エンティティ名か状態機械名。 */
  readonly key: string;
  readonly text: string;
}

/** 要約の文を、章頭 → 節の順で返す(書かれているものだけ)。 */
export function summarySentences(specs: AggregateSpecs): SummarySentence[] {
  return [
    ...(specs.entity?.summary === undefined ? [] : [{ kind: 'entity' as const, key: specs.entity.entity, text: specs.entity.summary }]),
    ...specs.stateMachines.flatMap((machine) =>
      machine.summary === undefined ? [] : [{ kind: 'machine' as const, key: machine.machine, text: machine.summary }],
    ),
  ];
}

/** 計算される欄 1 本(`computes` の宣言。必読には数えない導出)。 */
export interface ComputeItem {
  /** `{entity}.{field}`。 */
  readonly target: string;
  /** 値を決める純関数の名前。 */
  readonly ref: string;
  /** 宣言のある操作(`{machine}.{event}` など)。 */
  readonly operation: string;
  /** 宣言のある仕様ファイル。 */
  readonly file: string;
}

/** 操作の `computes` を、操作の並び → 宣言順で返す。 */
export function computeItems(actions: readonly ActionSpec[]): ComputeItem[] {
  return actions.flatMap((action) =>
    action.computes.map((compute) => ({
      target: compute.raw,
      ref: compute.ref,
      operation: action.handles.raw,
      file: action.location.file,
    })),
  );
}

/** 公理の本数の内訳(不変条件のほか、必読に数えるもの)。 */
export interface AxiomParts {
  /** アクセスの宣言。 */
  readonly access: number;
  /** 状態の意味。 */
  readonly states: number;
  /** 要約の文。 */
  readonly summaries: number;
  /** 計算の例の表の行。 */
  readonly examples: number;
}

/** 内訳の合計(不変条件は含まない)。 */
export function axiomPartsTotal(parts: AxiomParts): number {
  return parts.access + parts.states + parts.summaries + parts.examples;
}

/**
 * 要約の文と計算の例の写し(エンティティ名 / 状態機械名 / `{状態機械}.{状態}` → 文、例の行 → 「入力 → 値」)。
 *
 * 人が書いた文・例を書き換えたかを、2 つの版の生成物から比べるための写しである(`docs/book/assets/summaries.json`)。
 * `spec:diff` の基点の側は git の生成物からしか読めず、仕様の本文を直接読むと書き方の差が混ざるので、
 * 意味だけを取り出した写しを生成物に持つ。例の表は公理(人が外の世界と照らして判定する)なので、
 * 要約の文と同じ写しに載せて、変わったかどうかを公理の側の差分に出す。
 */
export interface SummaryTable {
  readonly entity: Readonly<Record<string, string>>;
  readonly machine: Readonly<Record<string, string>>;
  readonly state: Readonly<Record<string, string>>;
  /** 計算の例の行(鍵は `computeExampleKey`)。 */
  readonly example: Readonly<Record<string, string>>;
}

/** 仕様モデルと action_spec から、要約の文と計算の例の写しを作る(書かれているものだけ。集約の並び → 宣言順)。 */
export function summaryTableOf(model: SpecModel, actions: readonly ActionSpec[]): SummaryTable {
  const entity: Record<string, string> = {};
  const machine: Record<string, string> = {};
  const state: Record<string, string> = {};
  for (const specs of model.aggregates.values()) {
    for (const sentence of summarySentences(specs)) (sentence.kind === 'entity' ? entity : machine)[sentence.key] = sentence.text;
    for (const meaning of stateMeanings(specs.stateMachines)) state[`${meaning.machine}.${meaning.state}`] = meaning.summary;
  }
  return { entity, machine, state, example: computeExampleTable(actions) };
}
