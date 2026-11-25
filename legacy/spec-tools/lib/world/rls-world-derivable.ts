/**
 * その表の**world を宣言から作れるか**の判定(束 ⑳-4b)。
 *
 * RLS の挙動テストは「行を置いて実行する」ので、行が DB に入らなければ 1 行も検査できない。行が
 * 入るかを決めているのは entity_spec の型だけではなく、**執行点**(トリガ・CHECK・排他制約)
 * である。したがって生成の可否は「執行点の条件が宣言から読めるか」で決まる。
 *
 * | 執行点 | 判定 |
 * |---|---|
 * | 挿入で実行されないトリガ(`fires` に insert が無い) | 行の作成に効かないので無視する(**未ログインの作成の天井**の生成トリガは access_spec 由来だが、挿入で他の行を数えるので宣言されたトリガと同じに見る) |
 * | 値を供給するトリガ(`supplies`) | その列に値を置かない(DB が決める)—— ただし**必須の参照列**を供給するものは作れない(行の置き場をトリガが決める = world の形が宣言から決まらない)。例外は**祖先の列の写し**(そのトリガが宣言する不変条件が `{自表}.{列} == {別の集約}.{列}`)で、値の出どころが world の中にあるので置かずに挿入する |
 * | 条件を課すトリガ / CHECK | 由来の不変条件の `formal` が **行内比較(check)・一意(uniqueness)・排他(exclusion)** のいずれかであること。値の写像はこの 3 つを満たすように置く |
 * | `cardinality` / `state_dependency` / `formal` 無し | 作れない。数の上限は他の行の数に依り、状態依存は初期状態でない状態を要求し、DSL 外の条件は読めない。**ただし前提が world の値で偽になる数の上限**(`cardinality` の `where`)と、天井が world の行を収める**未ログインの作成の天井**は当たらないので作れる(`rls-world-vacuous.ts`。点検 20 回目 B20-1 の残り 3) |
 * | `pattern` を宣言した欄 | 機械的に置いた値がその形に合うことを実際に照合する(合わなければ作れない) |
 *
 * 作れないと分かった表は**生成しない**。生成器が黙って飛ばすのではなく、同じ判定を T8 が
 * warning の Finding にするので、「なぜこの表に挙動テストが無いのか」が verify の出力に残る。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { InvariantFormal, SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import { ceilingDeclsOf } from '../model/data/ceiling-plan.js';
import { copiedColumnsOf, formalOf } from './copied-columns.js';
import { effectivePattern, isValueSupplied, valueOfField } from './rls-world-values.js';
import { ceilingRoomy, vacuousInWorld } from './rls-world-vacuous.js';

/** world を作れない理由 1 件(Finding の 3 点セットに写る形)。 */
export interface RlsWorldProblem {
  readonly message: string;
  /**
   * 執行点の事実と宣言の側の直し方(**どのテストが受け持つかは含まない**)。同じ判定を 2 つの
   * 検査が使う(T8 = RLS / T11 = 一致の証明)ので、受け持ちの一文は呼び側が継ぐ。
   */
  readonly fact: string;
  /** T8(RLS)が出す対処(`fact` + RLS の受け持ち)。 */
  readonly suggestion: string;
  readonly counterexample: Readonly<Record<string, string>>;
}

/** 対処の一文(RLS の挙動テスト側)。 */
const RLS_REMEDY = 'この表の RLS は生成した挙動テストでは実行しない —— 手書きの RLS テストが受け持つ';

/**
 * 事実に対処の一文を継ぐ。
 *
 * @param fact 執行点の事実と宣言の側の直し方
 * @param remedy 代わりに何が受け持つか
 * @returns Finding の suggestion
 */
export function remedyOf(fact: string, remedy: string): string {
  return `${fact}。${remedy}`;
}

/** 値の写像が置く行だけで必ず満たせる形式定義の種別(T8 / T11 の理由の軸。`extension/scope.ts` も読む)。 */
export const SATISFIABLE_FORMALS: readonly InvariantFormal['kind'][] = ['check', 'uniqueness', 'exclusion'];

/** 執行点の事実(理由ごとに 1 本。受け持ちの一文は呼び側が継ぐ)。 */
const SUPPLIED_FACT = '宣言から world を作れるようにするなら、参照列を入力で渡す形にして supplied_by: db を外す';
const SATISFIABLE_FACT =
  '値の写像が満たせるのは行内比較(check)・一意(uniqueness)・排他(exclusion)だけである' +
  '(数の上限は他の行の数に依り、状態依存は初期状態でない状態を要求する)';
const BASIS_FACT = '実行者の集約は entity_spec の session: true が示す 1 つであり、その集約にも data_table が要る';
const REACH_FACT =
  'その集約に data_table があること、行内比較の不変条件が欄の順序として循環していないことを確かめる';
const PATTERN_FACT = '値の写像は「欄名 + 連番」しか作らない';

/**
 * その表に行を置けるか(置けない理由をすべて挙げる)。
 *
 * @param table 対象の data_table
 * @param domain ドメイン仕様(不変条件の形式定義と欄の宣言を引く)
 * @param tables 全テーブル仕様(前提の評価で、既定値を宣言した欄を world の値から外すため)
 * @returns 置けない理由。置けるなら空配列
 */
export function rowProblems(table: DataTableSpec, domain: SpecModel, tables: readonly DataTableSpec[]): readonly RlsWorldProblem[] {
  return [
    ...[...table.triggers, ...ceilingDeclsOf(table, domain).triggers].flatMap((trigger) => triggerProblems(table, trigger, domain, tables)),
    ...table.checks.flatMap((check) => enforcementProblems(table, `CHECK ${check.name}`, check.invariant, domain, tables)),
    ...patternProblems(table, domain),
  ];
}

/** 挿入で実行されるトリガ 1 本の判定。 */
function triggerProblems(table: DataTableSpec, trigger: DataTableSpec['triggers'][number], domain: SpecModel, tables: readonly DataTableSpec[]): readonly RlsWorldProblem[] {
  if (!firesOnInsert(trigger.fires)) return [];
  if (trigger.supplies.length > 0) return suppliedRefProblems(table, trigger, domain);
  if (ceilingRoomy(table, trigger.name, domain)) return [];
  return enforcementProblems(table, `トリガ ${trigger.name}`, trigger.invariant, domain, tables);
}

/** `fires` の宣言が挿入を含むか(宣言が無ければ「実行されうる」側に倒す)。 */
function firesOnInsert(fires: string | undefined): boolean {
  return fires === undefined || fires.toLowerCase().includes('insert');
}

/**
 * 値を供給するトリガのうち、**必須の参照列**を供給するもの。
 *
 * ただし「祖先の列の写し」は止めない —— そのトリガが宣言する不変条件の形式定義が
 * `{自表}.{列} == {別の集約}.{列}`(行内比較として書かれた**写しの宣言**)なら、値の出どころは
 * world が既に置いている祖先の行であり、**列を置かずに挿入すればトリガが正しく埋める**。world の形が
 * 宣言から決まらないのは「行の置き場をトリガが決める」ときだけであって、写しの列はそうではない。
 *
 * 宣言する不変条件が無いトリガ(何を供給するのか宣言が無い)は従来どおり止める —— 置き場が
 * 宣言から読めないことと区別できないからである。
 *
 * **写しかどうかの判定は `copied-columns.ts` の 1 本である**(表の DDL がトリガ本文を出す
 * ときと同じ判定)。別々に持つと「world は置かないのにトリガは埋めない」列が作れる。
 */
function suppliedRefProblems(
  table: DataTableSpec,
  trigger: DataTableSpec['triggers'][number],
  domain: SpecModel,
): readonly RlsWorldProblem[] {
  const spec = findEntitySpec(domain, table.entity ?? '');
  const copies = copiedColumnsOf(domain, table.entity ?? '', trigger.invariant).map((copy) => copy.column);
  const refs = trigger.supplies.filter((name) => {
    const field = spec?.fields.find((candidate) => candidate.name === name);
    return field !== undefined && field.required && field.type.kind === 'ref' && !copies.includes(name);
  });
  if (refs.length === 0) return [];
  return [
    {
      message: `${table.table} の行の参照先(${refs.join(' / ')})をトリガ ${trigger.name} が決めるので、world の形を宣言から決められません`,
      fact: SUPPLIED_FACT,
      suggestion: remedyOf(SUPPLIED_FACT, RLS_REMEDY),
      counterexample: { table: table.table, trigger: trigger.name, supplies: refs.join(', ') },
    },
  ];
}

/** 執行点 1 つの由来(不変条件)の形式定義が、値の写像で満たせるか。 */
function enforcementProblems(table: DataTableSpec, at: string, invariant: string | undefined, domain: SpecModel, tables: readonly DataTableSpec[]): readonly RlsWorldProblem[] {
  const formal = invariant === undefined ? null : formalOf(domain, invariant);
  if (formal !== null && SATISFIABLE_FORMALS.includes(formal.kind)) return [];
  if (formal !== null && vacuousInWorld(formal, domain, tables)) return [];
  if (formal?.kind === 'cardinality' && groupsPerBranch(formal, table, domain)) return [];
  const reason =
    invariant === undefined
      ? '由来の不変条件が宣言されていない'
      : formal === null
        ? `${invariant} が形式定義(formal)を持たない(DSL 外)`
        : `${invariant} の形式定義が ${formal.kind} である`;
  return [
    {
      message: `${table.table} の ${at} の条件を宣言から満たせません(${reason})`,
      fact: SATISFIABLE_FACT,
      suggestion: remedyOf(SATISFIABLE_FACT, RLS_REMEDY),
      counterexample: { table: table.table, at, invariant: invariant ?? '', formal: formal?.kind ?? '' },
    },
  ];
}

/**
 * 数の上限(`cardinality`)が、**系統ごとに 1 行しか置かない world**では必ず満たされるか。
 *
 * 満たされる条件は 2 つある。
 *
 * - **群の鍵がすべて参照の列であること。** 系統ごとに参照先の行が別なので、系統が違えば群も違う ——
 *   1 群 1 行になる。鍵に固定値の列(enum の先頭・真偽値の false)が混じると、系統をまたいで
 *   同じ群に入るので数が積み上がる。
 * - **上限が 1 以上であること。** 数値なら値そのもの、親の欄を指すならその欄に置かれる値
 *   (`min` の宣言が無ければ 1 から数える)で見る。上限 0 は「1 行も置けない」の宣言であり、
 *   条件つき(`where`)で逃げられるかは宣言から決まらない。
 *
 * @param formal 数の上限の宣言
 * @param table 対象の表
 * @param domain ドメイン仕様
 * @returns world が必ず満たすなら true
 */
function groupsPerBranch(
  formal: Extract<InvariantFormal, { kind: 'cardinality' }>,
  table: DataTableSpec,
  domain: SpecModel,
): boolean {
  const spec = findEntitySpec(domain, table.entity ?? '');
  if (spec === null) return false;
  const byRef = formal.keys.every(
    (key) => spec.fields.find((field) => field.name === key)?.type.kind === 'ref',
  );
  return byRef && maxAtLeastOne(formal.max, domain);
}

/** 上限が 1 以上か(数値ならその値、`{集約}.{欄}` なら置かれる値の下限で見る)。 */
function maxAtLeastOne(max: number | string, domain: SpecModel): boolean {
  if (typeof max === 'number') return max >= 1;
  const dot = max.indexOf('.');
  if (dot < 0) return false;
  const field = findEntitySpec(domain, max.slice(0, dot))?.fields.find(
    (candidate) => candidate.name === max.slice(dot + 1),
  );
  return field !== undefined && (field.min ?? 1) >= 1;
}

/** `pattern` を宣言した欄に、機械的に置いた値が実際に合うか。 */
function patternProblems(table: DataTableSpec, domain: SpecModel): readonly RlsWorldProblem[] {
  const spec = findEntitySpec(domain, table.entity ?? '');
  const problems: RlsWorldProblem[] = [];
  for (const field of spec?.fields ?? []) {
    const pattern = effectivePattern(field);
    if (pattern === undefined || !isValueSupplied(field, table.defaults)) continue;
    const value = valueOfField(field, { rowIndex: 0, next: () => 1, order: new Map() });
    if (new RegExp(pattern, 'u').test(String(value))) continue;
    problems.push({
      message: `${table.table} の列 ${field.name} は pattern を宣言しており、型から機械的に置いた値(${String(value)})が合いません`,
      fact: PATTERN_FACT,
      suggestion: remedyOf(PATTERN_FACT, RLS_REMEDY),
      counterexample: { table: table.table, field: field.name, pattern, value: String(value) },
    });
  }
  return problems;
}

/**
 * world の土台(実行者の集約・access_spec)が無いときの理由。
 *
 * @param table 対象の表(読むのは表名と集約名だけ。data_table が無い集約でも報告できるよう欄を絞る)
 * @param actor 実行者の集約(引けなかったなら `null`)
 * @returns 作れない理由 1 件
 */
export function missingBasis(table: Pick<DataTableSpec, 'table' | 'entity'>, actor: string | null): RlsWorldProblem {
  return {
    message: `${table.table} の world を組み立てる土台がありません(実行者の集約か access_spec が引けません)`,
    fact: BASIS_FACT,
    suggestion: remedyOf(BASIS_FACT, RLS_REMEDY),
    counterexample: { table: table.table, actor_entity: actor ?? '', entity: table.entity ?? '' },
  };
}

/** 状態の条件の反例を決められないときの事実。 */
const WHEN_FACT =
  '反例の行は「その条件を偽にする状態」から決まる —— その条件を偽にする状態がその機械にあることを確かめる';

/** 反例の行に置く欄を埋められないときの事実。 */
const WHEN_ROW_FACT =
  '状態を差し替えた行が不変条件に当たっている —— その状態で値が要る欄を、world の中の行から' +
  '埋められるかを確かめる(参照の欄は同じ系統の行を指せなければ置けない)';

/**
 * **状態の条件(`reads[].when`)の反例を宣言から決められない**ときの理由(束 §14)。
 *
 * 反例の行が無い world では、ポリシーから条件を丸ごと落としても挙動テストが緑になる —— だから
 * 「決められないなら world を作らない」に倒し、その判定を **T8** が報告する(T11 = 一致の証明は
 * 読み取りの可視性を見ないので何も言わない)。**多くは V2 が先に error で落とす**(`checkReadWhenShape`)。
 *
 * @param table 対象の表
 * @param reasons 決められなかった `when`(ロールと式)
 * @returns 作れない理由 1 件
 */
export function undecidableWhen(table: DataTableSpec, reasons: readonly string[]): RlsWorldProblem {
  return {
    message: `${table.table} の可視性の条件を偽にする行を宣言から決められません(${reasons.join(' / ')})`,
    fact: WHEN_FACT,
    suggestion: remedyOf(WHEN_FACT, RLS_REMEDY),
    counterexample: { table: table.table, undecidable: reasons.join(', ') },
  };
}

/**
 * 反例の行に置く欄を、world の中から埋められないときの理由(束 §14)。
 *
 * @param table 対象の表
 * @param fields 埋められなかった欄
 * @returns 作れない理由 1 件
 */
export function unplaceableWhenRow(
  table: DataTableSpec,
  fields: readonly string[],
): RlsWorldProblem {
  return {
    message: `${table.table} の可視性の条件を偽にする行に置く欄(${fields.join(' / ')})を埋められません`,
    fact: WHEN_ROW_FACT,
    suggestion: remedyOf(WHEN_ROW_FACT, RLS_REMEDY),
    counterexample: { table: table.table, unplaceable: fields.join(', ') },
  };
}

/**
 * 参照を辿れなかったときの理由。
 *
 * @param table 対象の表
 * @param entity 辿り着けなかった集約
 * @returns 作れない理由 1 件
 */
export function unreachable(table: DataTableSpec, entity: string): RlsWorldProblem {
  return {
    message: `${table.table} の world に要る集約 ${entity} の行を作れません(テーブル仕様が無い・参照の欄の順序が循環している)`,
    fact: REACH_FACT,
    suggestion: remedyOf(REACH_FACT, RLS_REMEDY),
    counterexample: { table: table.table, unreachable: entity },
  };
}
