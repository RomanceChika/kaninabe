/**
 * ガード変数の軸を**成立 / 不成立の 2 側に畳む**(束 ⑳-5a-b)。
 *
 * 直積が上限を超えたとき、軸の値を減らすのは避けられない。問題は**どの値を残すか**である。
 * 宣言順の両端を残すと、「そのガードを成立させる値」がまるごと落ちることがある —— 実測では
 * 7 操作のうち 6 操作で、許可される組み合わせが 1 つも実行されなくなっていた(独立レビュー 2-b)。
 * 拒否の側だけを実行する差分テストは、**どちら向きの変異でも赤にならない**(engine も RPC も常に
 * 拒否するので差が出ない)。
 *
 * したがって残す 2 値は「成立させる値 1 つ + 不成立にする値 1 つ」である。どちらも
 * **V9 と同じ充足性判定**(`satisfiability` の witness)から採る ——
 *
 * - **成立側**: 規則ごとに(遷移はイベントのガード 1 本)witness を取り、その割当がその軸に
 *   与えた値を残す。規則が複数あるなら**規則の数だけ**残る(1 つに畳むと、その軸を別の値で
 *   成立させる規則の許可が実行されない)。
 * - **不成立側**: **どの規則も成立しない**割当(`not (g1 or … or gn)` の witness)が与えた値。
 *
 * 成立側が 1 つも無い式は**恒偽**であり、そのときは V9 が既に error を上げている(ここは
 * 宣言順の両端に戻すだけで、黙って緑にはしない —— 畳んだ内訳はテスト名に出る)。
 *
 * 畳める(= 値を減らせる)のは値が 3 つ以上ある軸だけであり、それは有限の型
 * (状態・列挙・真偽)か、リテラルの種が複数ある順序の型に限られる。どちらも
 * **軸の値の字面 = witness の値の字面**なので、突合は字面で足りる(日時の軸は候補が
 * 2 点しかないので畳みの対象にならない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DomainEnv, GuardExpr, VariableDomain } from '../guard/ast.js';
import type { FieldType, SpecModel } from '../model/types.js';
import { parseGuard } from '../guard/parser.js';
import { satisfiability } from '../guard/satisfiability.js';
import { collectMachineStates } from '../model/field-values.js';
import { domainOfFieldType } from '../semantics/domain-env.js';
import type { ScenarioContext } from '../usecase/plan-scenario-rows.js';
import type { EqAxis, EqAxisValue, EqFoldedGuard } from './eq-cases.js';

/** 畳んだ結果(軸と、テスト名に出す内訳)。 */
export interface EqFoldResult {
  readonly axes: readonly EqAxis[];
  /** 実際に値を減らした軸の内訳(減らせなかった軸は載らない)。 */
  readonly folded: readonly EqFoldedGuard[];
}

/**
 * ガード変数の軸を畳む。
 *
 * @param ctx 実行計画から取り出した場面の材料(規則とガードの出どころ)
 * @param axes 畳む前の軸
 * @returns 畳んだあとの軸と、その内訳
 */
export function foldGuardAxes(ctx: ScenarioContext, axes: readonly EqAxis[]): EqFoldResult {
  return foldAxes(guardsOf(ctx), guardEnv(ctx), axes);
}

/**
 * ガード変数の軸を、渡されたガード式の充足性から畳む。
 *
 * 単発の操作は 1 手順ぶんの式(`foldGuardAxes`)、保存点は全手順の式の和を渡す —— 畳み方は
 * どちらも同じである(成立側と不成立側を両方残す)。
 *
 * @param guards その操作 / 保存点が見るガード式の全数
 * @param env 変数のドメイン
 * @param axes 畳む前の軸
 * @returns 畳んだあとの軸と、その内訳
 */
export function foldAxes(
  guards: readonly GuardExpr[],
  env: DomainEnv,
  axes: readonly EqAxis[],
): EqFoldResult {
  const satisfying = satisfyingValues(guards, env);
  const refuting = refutingValues(guards, env);
  const folded: EqFoldedGuard[] = [];
  const next = axes.map((axis) => {
    if (axis.values.length <= 2) return axis;
    const values = keptValues(axis, satisfying.get(axis.key), refuting.get(axis.key));
    if (values.length >= axis.values.length) return axis;
    folded.push({
      key: axis.key,
      satisfying: labelsIn(values, satisfying.get(axis.key)),
      refuting: labelsIn(values, refuting.get(axis.key)),
    });
    return { ...axis, values };
  });
  return { axes: next, folded };
}

/**
 * 軸 1 本で残す値。
 *
 * 成立させる値と不成立にする値を宣言順に残す。どちらも引けなかった軸だけは宣言順の両端に
 * 戻す(恒偽の式は V9 が既に error にしている)。1 つしか引けなかったときは、もう片方に
 * 「残っていない最初の値」を足して 2 側を保つ。
 */
function keptValues(
  axis: EqAxis,
  satisfying: ReadonlySet<string> | undefined,
  refuting: ReadonlySet<string> | undefined,
): readonly EqAxisValue[] {
  const wanted = axis.values.filter(
    (value) => satisfying?.has(value.label) === true || refuting?.has(value.label) === true,
  );
  if (wanted.length === 0) return ends(axis.values);
  if (wanted.length > 1) return wanted;
  const other = axis.values.find((value) => !wanted.includes(value));
  return other === undefined ? wanted : axis.values.filter((value) => wanted.includes(value) || value === other);
}

/** 残した値のうち、その側に数えられるものの字面。 */
function labelsIn(values: readonly EqAxisValue[], side: ReadonlySet<string> | undefined): readonly string[] {
  return values.filter((value) => side?.has(value.label) === true).map((value) => value.label);
}

/** 両端 2 つ(2 つ以下ならそのまま)。 */
function ends(values: readonly EqAxisValue[]): readonly EqAxisValue[] {
  if (values.length <= 2) return values;
  const first = values[0];
  const last = values[values.length - 1];
  return first === undefined || last === undefined ? values : [first, last];
}

/**
 * その操作が見るガード式の全数(遷移はイベントのガード、それ以外は規則ごとの条件)。
 *
 * 読めなかった式は落とす —— 文法の誤りは V1 が既に error にしている。
 */
function guardsOf(ctx: ScenarioContext): readonly GuardExpr[] {
  const sources = [ctx.guardSource, ...ctx.rules.map((rule) => rule.when)];
  const parsed: GuardExpr[] = [];
  for (const source of sources) {
    if (source === undefined || source === null) continue;
    const result = parseGuard(source);
    if (result.ok) parsed.push(result.expr);
  }
  return parsed;
}

/**
 * 規則ごとの witness が軸に与えた値(= その規則を成立させる値)。
 *
 * **規則ごとに 1 回ずつ判定する。** 和を 1 度だけ判定すると、どれか 1 本の規則を満たす割当
 * しか出てこない —— 別の値でしか成立しない規則(「世話役は締切後だけ編集できる」)の許可が
 * 実行されなくなる。
 */
function satisfyingValues(
  guards: readonly GuardExpr[],
  env: DomainEnv,
): ReadonlyMap<string, ReadonlySet<string>> {
  const found = new Map<string, Set<string>>();
  for (const guard of guards) collectWitness(found, satisfiability(guard, env).witness);
  return found;
}

/** どの規則も成立しない割当が軸に与えた値。 */
function refutingValues(
  guards: readonly GuardExpr[],
  env: DomainEnv,
): ReadonlyMap<string, ReadonlySet<string>> {
  const found = new Map<string, Set<string>>();
  const any = guards.reduce<GuardExpr | null>(
    (left, right) => (left === null ? right : { kind: 'or', left, right }),
    null,
  );
  if (any === null) return found;
  collectWitness(found, satisfiability({ kind: 'not', operand: any }, env).witness);
  return found;
}

/** 割当 1 つを「変数 → 値の集合」に積む。 */
function collectWitness(
  into: Map<string, Set<string>>,
  witness: Readonly<Record<string, string>> | undefined,
): void {
  for (const [key, value] of Object.entries(witness ?? {})) {
    const values = into.get(key) ?? new Set<string>();
    values.add(value);
    into.set(key, values);
  }
}

/**
 * 充足性判定に渡す変数のドメイン。
 *
 * 鍵は**ガード式に書かれたパスそのもの**である(`state` のような接頭辞の無いパスは対象自身の
 * 欄であり、実行計画もその字面のまま運ぶ)。宣言の無いパスは判定器が用法から決める。
 */
function guardEnv(ctx: ScenarioContext): DomainEnv {
  return axisEnv(ctx.domain, ctx.variables, Object.keys(ctx.nowVariables));
}

/**
 * 充足性判定に渡す変数のドメイン(型の宣言から組む)。
 *
 * @param domain ドメイン仕様
 * @param variables ガード式の変数(鍵は式に書かれたパスそのもの)
 * @param nowKeys 予約語 `now` に当たる鍵(順序だけを持つ)
 * @returns 変数 → ドメイン
 */
export function axisEnv(
  domain: SpecModel,
  variables: readonly { readonly key: string; readonly type: FieldType | null }[],
  nowKeys: readonly string[],
): DomainEnv {
  const machineStates = collectMachineStates(domain);
  const env = new Map<string, VariableDomain>();
  for (const variable of variables) {
    if (variable.type === null) continue;
    env.set(variable.key, domainOfFieldType(variable.type, machineStates));
  }
  for (const key of nowKeys) env.set(key, { kind: 'ordered' });
  return env;
}
