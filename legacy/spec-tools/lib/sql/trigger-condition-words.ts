/**
 * **宣言した不変条件の条件を、トリガの本文と `when (…)` で照らせる語に割る**(点検 20 回目の後の P3。data-table-parity の目)。
 *
 * data-table-parity は、トリガが在ること・発火の細部・効いていること(`tgenabled` と `when (…)`。点検 20 回目 C20-7)までは
 * 実 DB と照らしていたが、**宣言した不変条件の前提・条件と、トリガが実際に見ている条件**は誰も照らしていなかった。手書きの本文の
 * トリガ(`functions[].handwritten`)は実在までしか見ないので、宣言が「催しがプログラム公開済みなら枠は確定済み」(前提つき)で
 * 本文が「枠は確定済み」(前提なし)のまま、宣言と本文が食い違って緑だった(INV-PROGRAM-003。2026-08-09 から)。
 *
 * ここは宣言の側を割るだけである: 形式定義の式の中で**列挙・状態の欄と比べている記号**(SQL では文字列のリテラルになる値)を、
 * 前提(`state_dependency` の `if`・`cardinality` の `where`)と課す条件(`then`・`check` の `expr`)に分けて拾い、
 * 本文に現れてはいけない語の範囲(`vocabulary` = その表と不変条件が名指す集約の列挙・状態の値の全部)を添える。
 * 実 DB の本文との照らしは突合テスト data-table-parity(の `diffConditions`)が行う(期待表 `data-table-expectations.ts` の
 * `triggers[].conditions` がこの戻り値を運ぶ)。
 *
 * **語の水準で照らす。列までは見ない。** plpgsql の本文を構文として読むことはせず、「宣言の語が本文(`raise` の文を除く)か
 * `when (…)` に現れること」と「範囲の語のうち宣言に無いものが現れないこと」だけを見る。同じ語が別の欄の値でもある
 * (例: 催しの状態にも枠の状態にも `confirmed` がある)とき、どちらの欄と比べたかまでは区別しない —— 前提の取り落としと
 * 宣言に無い条件の足し込みは語の出入りで必ず見える。値が 2 つしかない欄では補集合の語を言い換えとして認める(`ConditionWord`)。
 *
 * **真偽・数・欄どうしの比較の欄は、欄の名前で照らす**(点検 21 回目 C21-4)。それらは文字列のリテラルにならないので語が無く、
 * 前提が真偽の欄(`学割を申告した`)だけの不変条件は、本文が前提を落としても緑だった。そこで列挙・状態以外の欄を見る比較・`in`・
 * `is null` は、その欄の名前(パスの最後の語)を前提・課す条件の**列**として運び、照らしの側(`diffConditions`)が本文の識別子に
 * 現れることを見る(数の上限 `cardinality` は、上限の欄と数える鍵の欄を課す条件の列に数える)。列の名前は宣言の欄の名前と同じ綴りで
 * 本文に現れる(表の列名 = 欄の名前)。前提と課す条件が同じ欄を見るときは、前提だけを落としても名前は残る(下限として注記する)。
 *
 * **照らせない不変条件は黙って外さない**(点検 21 回目 C21-4)。トリガが不変条件を名指すのに、その不変条件が見つからない・形式定義が
 * 無い・形式定義の種類が語に割れない(一意・排他)・式が読めない・語も列も無いときは、理由つきの「照らせない」を返す
 * (`unreadable`。理由の語は `data/check-reasons.ts` の `T17_REASONS`)。期待表はそれを運び、verify の T17 が警告で名指す
 * (形式定義が DSL の外のものだけが拡張候補の台帳 `X-trigger-condition-words` に当たり、それ以外は未分類 = 赤)。
 *
 * 新しい宣言の種類は足していない(既存の `triggers[].invariant` と invariant_spec の `formal` から導く)。
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr, PathRef } from '../guard/ast.js';
import { parseFormalGuard } from '../guard/parser.js';
import type { InvariantDef, SpecModel } from '../model/types.js';
import type { DataTableSpec, DataTriggerDecl } from '../model/data/types.js';
import { findEntitySpec, findStateMachines } from '../semantics/domain-lookup.js';
import { T17_REASONS } from '../data/check-reasons.js';

/**
 * 宣言の語 1 つと、本文でそれを言い換えられる語(`[語, …言い換え]`)。言い換えは**値が 2 つしかない欄の補集合**だけである
 * (`kind == performance` を本文が `kind <> 'audience'` と書く)。値が 3 つ以上の欄の補集合は別の条件になりうるので言い換えに数えない。
 */
export type ConditionWord = readonly string[];

/** 1 本のトリガについて、本文と照らす語。 */
export interface TriggerConditionWords {
  /** 由来する不変条件 ID。 */
  readonly invariant: string;
  /** 照らせない理由(読めたときは null)。 */
  readonly unreadable: null;
  /** 前提の語(`state_dependency` の `if`・`cardinality` の `where`)。どれも、語か言い換えが本文か `when (…)` に現れなければならない。 */
  readonly premise: readonly ConditionWord[];
  /** 課す条件の語(`state_dependency` の `then`・`check` の `expr`)。どれも、語か言い換えが本文か `when (…)` に現れなければならない。 */
  readonly requires: readonly ConditionWord[];
  /** 前提が見る列挙・状態以外の欄の名前(真偽・数・欄どうし・null)。どれも本文か `when (…)` の識別子に現れなければならない。 */
  readonly premiseColumns: readonly string[];
  /** 課す条件が見る列挙・状態以外の欄の名前(数の上限の上限の欄と数える鍵を含む)。 */
  readonly requiresColumns: readonly string[];
  /** 照らす語の範囲(宣言に無いのに本文に現れたら、本文が宣言に無い条件を見ている)。 */
  readonly vocabulary: readonly string[];
}

/** 照らせない理由の語(`T17_REASONS` の照らしの分)。 */
export type ConditionUnreadableReason =
  | typeof T17_REASONS.conditionMissingInvariant
  | typeof T17_REASONS.conditionNoFormal
  | typeof T17_REASONS.conditionFormalMissing
  | typeof T17_REASONS.conditionKindOutside
  | typeof T17_REASONS.conditionUnparsable
  | typeof T17_REASONS.conditionNoWords;

/** 不変条件を名指すのに、本文と照らせないトリガ(理由つき)。 */
export interface TriggerConditionsUnreadable {
  readonly invariant: string;
  readonly unreadable: ConditionUnreadableReason;
  /** DSL の外である理由(不変条件の `formal_outside`。`conditionNoFormal` のときだけ)。 */
  readonly outside?: string;
}

/**
 * トリガの宣言から、本文と照らす語を割る。
 *
 * @param trigger トリガの宣言
 * @param table そのトリガの表
 * @param domain ドメイン仕様
 * @returns 照らす語・照らせない理由(不変条件を名指さないトリガだけ null)
 */
export function conditionWordsOf(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  domain: SpecModel,
): TriggerConditionWords | TriggerConditionsUnreadable | null {
  const id = trigger.invariant;
  if (id === undefined) return null;
  const invariant = invariantById(id, domain);
  if (invariant === null) return { invariant: id, unreadable: T17_REASONS.conditionMissingInvariant };
  const formal = invariant.formal;
  // 形式定義が無いのは、DSL の外である理由を宣言したときだけ仕組みの宿題(点検 22 回目 C22-3。宣言が無ければ製品が直す側)。
  if (formal === undefined) {
    if (invariant.formalOutside === undefined) return { invariant: id, unreadable: T17_REASONS.conditionFormalMissing };
    return { invariant: id, unreadable: T17_REASONS.conditionNoFormal, outside: invariant.formalOutside };
  }
  if (formal.kind !== 'state_dependency' && formal.kind !== 'cardinality' && formal.kind !== 'check') {
    return { invariant: id, unreadable: T17_REASONS.conditionKindOutside };
  }
  const premiseSource = formal.kind === 'state_dependency' ? formal.if : formal.kind === 'cardinality' ? formal.where : undefined;
  const requiresSource = formal.kind === 'state_dependency' ? formal.then : formal.kind === 'check' ? formal.expr : undefined;
  const premise = premiseSource === undefined ? emptyRead() : readSource(premiseSource, domain);
  const requires = requiresSource === undefined ? emptyRead() : readSource(requiresSource, domain);
  if (premise === null || requires === null) return { invariant: id, unreadable: T17_REASONS.conditionUnparsable };
  const limitColumns = formal.kind === 'cardinality' ? cardinalityColumns(formal.keys, formal.max) : [];
  const requiresColumns = [...new Set([...requires.columns, ...limitColumns])].sort();
  if (premise.words.length + requires.words.length + premise.columns.length + requiresColumns.length === 0) {
    return { invariant: id, unreadable: T17_REASONS.conditionNoWords };
  }
  return {
    invariant: id,
    unreadable: null,
    premise: premise.words,
    requires: requires.words,
    premiseColumns: premise.columns,
    requiresColumns,
    vocabulary: vocabularyOf(invariant, table, domain),
  };
}

/** 式 1 本の読み(語と列)。 */
interface SourceRead {
  readonly words: ConditionWord[];
  readonly columns: string[];
}

/** 式の無い側(前提の無い check など)。 */
function emptyRead(): SourceRead {
  return { words: [], columns: [] };
}

/** 数の上限が課す条件の列(数える鍵と、上限が欄なら上限の欄。パスは最後の語)。 */
function cardinalityColumns(keys: readonly string[], max: number | string): string[] {
  const names = [...keys, ...(typeof max === 'string' ? [max] : [])].map((path) => path.split('.').pop() ?? path);
  return names.filter((name) => /^[a-z_][a-z0-9_]*$/u.test(name));
}

/** 不変条件 1 本を引く(どの集約に住んでいるかは問わない)。 */
function invariantById(id: string, domain: SpecModel): InvariantDef | null {
  for (const specs of domain.aggregates.values()) for (const invariant of specs.invariants?.invariants ?? []) if (invariant.id === id) return invariant;
  return null;
}

/** 式 1 本の語と列(読めなければ null)。 */
function readSource(source: string, domain: SpecModel): SourceRead | null {
  const parsed = parseFormalGuard(source);
  if (!parsed.ok) return null;
  const found = new Map<string, readonly string[]>();
  const columns = new Set<string>();
  collect(parsed.expr, domain, found, columns);
  const words = [...found.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([word, values]) => [word, ...(values.length === 2 ? values.filter((value) => value !== word) : [])]);
  return { words, columns: [...columns].sort() };
}

/** 列挙・状態の欄と比べている記号を、その欄の値の全部と一緒に集める。それ以外の欄を見る原子は欄の名前を列に集める。 */
function collect(expr: GuardExpr, domain: SpecModel, found: Map<string, readonly string[]>, columns: Set<string>): void {
  switch (expr.kind) {
    case 'and':
    case 'or':
      collect(expr.left, domain, found, columns);
      collect(expr.right, domain, found, columns);
      return;
    case 'not':
      collect(expr.operand, domain, found, columns);
      return;
    case 'compare': {
      const values = valuesOfPath(expr.path, domain);
      if (expr.rhs.kind === 'symbol' && values?.includes(expr.rhs.value) === true) found.set(expr.rhs.value, values);
      else addColumn(expr.path, columns);
      if (expr.rhs.kind === 'path') addColumn(expr.rhs.path, columns);
      return;
    }
    case 'in': {
      const values = valuesOfPath(expr.path, domain);
      const symbols = expr.values.flatMap((literal) => (literal.kind === 'symbol' && values?.includes(literal.value) === true ? [literal.value] : []));
      for (const symbol of symbols) found.set(symbol, values ?? []);
      if (symbols.length === 0) addColumn(expr.path, columns);
      return;
    }
    case 'null':
      addColumn(expr.path, columns);
      return;
    case 'contains':
      addColumn(expr.path, columns);
      addColumn(expr.ref, columns);
      return;
  }
}

/** 欄の名前(パスの最後の語。`{集約}.{欄}` の形のパスだけ。予約語の 1 語のパス `now` などは数えない)。 */
function addColumn(path: PathRef, columns: Set<string>): void {
  if (path.segments.length < 2) return;
  const name = path.segments[path.segments.length - 1];
  if (name !== undefined) columns.add(name);
}

/** パスが指す欄が列挙・状態なら、その値の全部(参照の欄を辿る。辿れなければ null)。 */
function valuesOfPath(path: PathRef, domain: SpecModel): readonly string[] | null {
  const [head, ...rest] = path.segments;
  if (head === undefined || rest.length === 0) return null;
  let entity = head;
  for (const [index, name] of rest.entries()) {
    const field = findEntitySpec(domain, entity)?.fields.find((candidate) => candidate.name === name);
    if (field === undefined) return null;
    if (index === rest.length - 1) return valuesOfField(entity, field.type, domain);
    if (field.type.kind !== 'ref') return null;
    entity = field.type.entity;
  }
  return null;
}

/** 欄の型が列挙・状態なら値の全部。 */
function valuesOfField(entity: string, type: { readonly kind: string; readonly values?: readonly string[]; readonly machine?: string }, domain: SpecModel): readonly string[] | null {
  if (type.kind === 'enum') return type.values ?? [];
  if (type.kind === 'state') return findStateMachines(domain, entity).find((machine) => machine.machine === type.machine)?.states ?? [];
  return null;
}

/** 照らす語の範囲: 表の集約・その集約が参照する集約・不変条件が名指す集約の、列挙・状態の値の全部。 */
function vocabularyOf(invariant: InvariantDef, table: DataTableSpec, domain: SpecModel): string[] {
  const entities = new Set<string>(invariant.entities);
  const own = table.entity === undefined ? null : findEntitySpec(domain, table.entity);
  if (table.entity !== undefined) entities.add(table.entity);
  for (const field of own?.fields ?? []) if (field.type.kind === 'ref') entities.add(field.type.entity);
  const words = new Set<string>();
  for (const entity of entities) {
    for (const field of findEntitySpec(domain, entity)?.fields ?? []) for (const value of valuesOfField(entity, field.type, domain) ?? []) words.add(value);
  }
  return [...words].sort();
}
