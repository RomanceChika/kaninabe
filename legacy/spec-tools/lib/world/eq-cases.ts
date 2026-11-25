/**
 * 操作 1 つを実行する**組み合わせの軸**(束 ⑳-5a)。
 *
 * 実行するのは標本ではない。engine と RPC が同じ判定を下すことを言うには、**判定が分岐しうる軸の
 * 値を全部踏む**しかない —— 当たらなかった腕は「守っていることを実測していない」に等しい
 * (⑳-3 の独立レビュー 3-A が名指しした形)。軸は 5 本ある。
 *
 * | 軸 | 値 | どこから来るか |
 * |---|---|---|
 * | 対象の状態 | 状態機械の全状態 | `state_spec`(遷移だけが持つ) |
 * | 実行者 | world の実行者(役ごとに 1 人 + 既定 + 行が無い人) | `@kaninabe/runtime/testing/equivalence/world` |
 * | ロール配列 | 解決済み / システム / 渡さない | `roles.md` |
 * | ガード変数 | 型ごとの境界値(列挙は全値・日時は前後 2 点・真偽は 2 値) | ガード式の変数の型 |
 * | 入力 | 編集で動かす欄(`canWrite` は欄ごとに判定する) | `access_spec` の `writes` |
 *
 * **直積そのものは設計図に書かない。** 何千行もの組み合わせを並べても、そこに書いてあるのは
 * 5 本の軸を掛けたという事実だけである(生成物が読めなくなるうえ、軸を 1 本足すたびに差分が
 * 数万行になる)。設計図は軸と、その直積の**大きさ**を運び、掛け算は実行する側が行う ——
 * 大きさを持つことで「組み合わせが 0 件になった日に黙って緑になる」形も塞げる。
 *
 * ## 畳むとき
 *
 * 直積が上限(`CASE_LIMIT`)を超えたら、**畳んだことを示してから**畳む。順は「ガード変数の
 * 境界値を 2 側に → ロール配列を 2 通りに → 状態を両端に → 編集の欄を両端に」である。値を
 * 減らす前に軸そのものを落とすことはしない —— 落とした軸は「実行されていない」であり、畳んだ
 * 軸は「代表値で実行した」である。
 *
 * **ガード変数の畳み方は宣言順の両端ではない**(`eq-fold.ts`)。残すのは「そのガードを
 * 成立させる値 + 不成立にする値」であり、どちらも V9 と同じ充足性判定の witness から採る ——
 * 宣言順で採ると成立側がまるごと落ち、許可される組み合わせを 1 つも実行しないテストになる
 * (独立レビュー 2-b の実測)。残した値は**テスト名に出る**。
 *
 * ## 日時は行ぜんたいで置き直す
 *
 * 日時のガード変数を「締切の前 / 後」に置くとき、**同じ行の日時の欄は全部置き直す**。1 列
 * だけ動かすと、宣言された欄どうしの順序(`workshop.entry_deadline < workshop.starts_at` の
 * ような行内比較)が落ちて行そのものが DB に入らない。順序の正は invariant_spec であり、
 * ここはその写像(`fieldOrder`)を使うだけである。したがって軸の値 1 つが運ぶのは**置き直す
 * 値の並び**であり、単独の値ではない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr } from '../guard/ast.js';
import { parseGuard } from '../guard/parser.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { ScenarioContext } from '../usecase/plan-scenario-rows.js';
import type { ScenarioValue } from '../usecase/plan-scenario-values.js';
import { placeholderOf } from '../usecase/plan-scenario-values.js';
import { guardAxesOf } from './eq-placements.js';
import { foldGuardAxes } from './eq-fold.js';
import type { EqRoleArrayName, EqWorld } from './eq-world-types.js';
import { actorArrayPairs, actorReadsOf, actorsOf, arrayNamesOf, boundAxesOf, fieldsOf, statesOf } from './eq-case-axes.js';
import { crossActorsOf, crossTenantOf } from './eq-cross-tenant.js';
import { freshInputsOf } from './eq-fresh.js';

/** 1 操作あたりの上限(超えたらガード変数の境界値を 2 値に畳む。設計 §1)。 */
export const CASE_LIMIT = 200;

/**
 * それでも収まらないときの上限(残りの軸を代表値に畳む)。
 *
 * ガード変数を畳んでもまだ大きいのは「欄が多い編集」である。欄の軸は `canWrite` が欄ごとに
 * 判定する以上いちばん落としたくないので、**ロール配列 → 状態 → 欄**の順に畳む。
 * 保存点(`eq-save-fold.ts`)も同じ二段である。
 */
export const HARD_LIMIT = 1_000;

/** 畳める軸(畳んだ軸はテスト名に出る。`input` = 繰り返しの件数は保存点だけが持つ)。 */
export type EqFoldedAxis = 'guard' | 'array' | 'state' | 'field' | 'input';

/**
 * 畳んだガード変数 1 本の内訳(テスト名に出る)。
 *
 * 「どの変数を、どの値に畳んだか」が読めないと、**成立側が消えていても人は気づけない**
 * (独立レビュー 2-b)。したがって残した値を両側とも示す。
 */
export interface EqFoldedGuard {
  /** ガード式の変数名。 */
  readonly key: string;
  /** その値ならどれかの規則が成立する、という値の字面。 */
  readonly satisfying: readonly string[];
  /** どの規則も成立しない値の字面。 */
  readonly refuting: readonly string[];
}

/**
 * その操作の RPC が**拒否をどこまで返すか**(data_table の宣言から決まる)。
 *
 * | 値 | 宣言 | 実 DB に言えること |
 * |---|---|---|
 * | `named` | 本文が生成物(5 形) | 拒否の**理由まで**一致する(errcode の 3 分類) |
 * | `unnamed` | `handwritten:` を宣言 | 述語は手で写してあるので**可否は**一致する。理由は返さず 0 行で返る |
 * | `none` | `shape: composite` | RPC は判定しない —— 守っているのは engine だけである(許可された組み合わせが通ることだけを見る) |
 *
 * **免除リストではない。** どれも data_table の宣言そのものであり、宣言を外せば `named` に
 * 戻って理由まで見られる(ADR-0012 が認めた「5 形に乗らない合成」の範囲がそのまま出る)。
 */
export type EqEnforcement = 'named' | 'unnamed' | 'none';

/** 置き直す値 1 つ。 */
export interface EqPlacement {
  /** どの集約の行(実行者の系統から引く)。 */
  readonly entity: string;
  readonly column: string;
  readonly value: ScenarioValue;
  /** 行に置くか、作成の入力に載せるか。 */
  readonly into: 'row' | 'input';
}

/** ガード変数 1 本の値(その値にするために置き直すもの)。 */
export interface EqAxisValue {
  /** 値の字面(食い違いの報告に出る)。 */
  readonly label: string;
  readonly placements: readonly EqPlacement[];
  /**
   * 作成の入力の欄に**実行者の id**(`self`)か**実行者でない人の id**(`other`)を置く(作成の規則の縛り。
   * `usecase/actor-bound.ts`)。値が実行時の実行者で決まるので、固定の値の置き直し(`placements`)とは別に運ぶ。
   */
  readonly actorInputs?: readonly EqActorInput[];
}

/** 作成の入力の欄に置く実行者(本人か、それ以外か)。 */
export interface EqActorInput {
  readonly column: string;
  readonly who: 'self' | 'other';
}

/** ガード変数 1 本の軸。 */
export interface EqAxis {
  /** ガード式の変数名(`{集約}.{欄}`)。 */
  readonly key: string;
  readonly values: readonly EqAxisValue[];
}

/** 操作 1 つぶんの軸。 */
export interface EqOperationCases {
  readonly op: string;
  readonly label: string;
  /** 動かす集約(作成が「行ではなく入力を見る」判定に使う)。 */
  readonly aggregate: string;
  readonly kind: ScenarioContext['kind'];
  /** 対象の状態が載る列(遷移だけ。それ以外は `null`)。 */
  readonly stateColumn: string | null;
  /** 対象の状態の並び(遷移だけ。それ以外は `[null]`)。 */
  readonly states: readonly (string | null)[];
  /**
   * 実行する実行者の並び(world の実行者の名前)。
   *
   * **判断材料として実行者自身の行を読む操作からは、行が無い人を外す。** その人には engine の
   * 判定そのものが無い —— 実行器は読み取りの段で止まり、RPC までたどり着かない
   * (`run-plan.ts` の `reads`)。外したことは軸が示す(黙って飛ばしてはいない)。
   */
  readonly actors: readonly string[];
  /** ロール配列の種類の並び。 */
  readonly arrays: readonly EqRoleArrayName[];
  /** 編集で動かす欄の並び(編集以外は `[null]`)。 */
  readonly fields: readonly (string | null)[];
  readonly axes: readonly EqAxis[];
  /** 直積の大きさ(実行する側が同じ数だけ回す)。 */
  readonly count: number;
  readonly folded: readonly EqFoldedAxis[];
  /** 畳んだガード変数の内訳(畳んでいなければ空)。 */
  readonly foldedGuards: readonly EqFoldedGuard[];
  /** その操作の RPC が拒否をどこまで返すか(data_table の宣言から決まる)。 */
  readonly enforcement: EqEnforcement;
  /**
   * 判断材料として**実行者自身の行**から読む集約(対象の集約は除く)。
   *
   * 実行者の集約が対象の行の祖先でもあるとき(束縛の列のために分けた別人の行)、集約の名前だけで引くと
   * 別人の行を実行者の行として読んでしまう。ここに挙げた集約は、実行者の行で引く。
   */
  readonly actorReads: readonly string[];
  /**
   * 入力の欄の**既定値**(型から決まる。対象の行の雛形に無い欄の受け皿)。
   *
   * 雛形(world が置いた行)は「テストが値を置く欄」しか持たない —— DB が決める欄
   * (`auto` / `state(...)` / `supplied_by: db` / data_table の `defaults`)は空である。
   * 入力として渡さなければならない欄がそこに落ちたとき、型から決めた値で埋める。
   */
  readonly inputs: Readonly<Record<string, ScenarioValue>>;
  /**
   * 作成のとき、雛形の値の上から置き直す入力の欄(world の行と一意の鍵で当たらない値。`eq-fresh.ts`)。作成以外と、置き直す欄が
   * 無い作成は空である。
   */
  readonly fresh: Readonly<Record<string, ScenarioValue>>;
  /**
   * **他の系統(= 他のテナント)の対象の行でも実行するか**(`crossTenantOf`)。真なら、行を持つ実行者ごとに
   * 他の系統の行でも同じ軸を掛け(件数に足してある)、実行する側が「engine も RPC も拒否する」を表明する。
   */
  readonly crossTenant: boolean;
  /** そのうち他の系統の行の組み合わせの数(`count` に含まれる。結果表は並べない —— どれも拒否を表明するだけである)。 */
  readonly crossCount: number;
}

/**
 * 操作 1 つぶんの軸を組み立てる。
 *
 * @param world その集約の world(実行者の並び)
 * @param ctx 実行計画から取り出した場面の材料
 * @param enforcement その操作の RPC が拒否をどこまで返すか
 * @returns 軸と直積の大きさ
 */
export function eqCasesOf(
  world: EqWorld,
  ctx: ScenarioContext,
  enforcement: EqEnforcement,
): EqOperationCases {
  const folded: EqFoldedAxis[] = [];
  let states = statesOf(ctx);
  let arrays = arrayNamesOf(world);
  let fields = fieldsOf(ctx);
  let axes: readonly EqAxis[] = [...guardAxesOf(ctx, parseAny(ctx)), ...boundAxesOf(ctx)];
  const actors = actorsOf(world, ctx);
  let foldedGuards: readonly EqFoldedGuard[] = [];
  const size = (): number => states.length * actorArrayPairs(world, actors, arrays) * fields.length * product(axes);
  if (size() > CASE_LIMIT && axes.some((axis) => axis.values.length > 2)) {
    const result = foldGuardAxes(ctx, axes);
    axes = result.axes;
    foldedGuards = result.folded;
    if (foldedGuards.length > 0) folded.push('guard');
  }
  if (size() > HARD_LIMIT && arrays.length > 2) {
    arrays = ends(arrays);
    folded.push('array');
  }
  if (size() > HARD_LIMIT && states.length > 2) {
    states = ends(states);
    folded.push('state');
  }
  if (size() > HARD_LIMIT && fields.length > 2) {
    fields = ends(fields);
    folded.push('field');
  }
  const cross = crossTenantOf(world, ctx, enforcement) ? crossActorsOf(world, actors) : [];
  const crossSize = states.length * actorArrayPairs(world, cross, arrays) * fields.length * product(axes);
  return {
    op: ctx.op,
    label: ctx.label,
    aggregate: ctx.entity,
    kind: ctx.kind,
    stateColumn: ctx.stateVariable === null ? null : (ctx.stateVariable.ref.split('.')[1] ?? null),
    states,
    actors,
    arrays,
    fields,
    axes,
    count: size() + crossSize,
    folded,
    foldedGuards,
    enforcement,
    actorReads: actorReadsOf(ctx),
    inputs: inputsOf(ctx),
    fresh: ctx.kind === 'create' ? freshInputsOf(world, { domain: ctx.domain, entity: ctx.entity, inputKeys: ctx.inputKeys }) : {},
    crossTenant: crossSize > 0,
    crossCount: crossSize,
  };
}

/** 入力の欄の既定値(型から決まる。雛形に無い欄の受け皿)。 */
function inputsOf(ctx: ScenarioContext): Readonly<Record<string, ScenarioValue>> {
  const inputs: Record<string, ScenarioValue> = {};
  for (const key of ctx.inputKeys) {
    if (key === 'id') continue;
    inputs[key] = placeholderOf(findEntitySpec(ctx.domain, ctx.entity)?.fields.find((f) => f.name === key) ?? null);
  }
  return inputs;
}

/** 直積の大きさ。 */
function product(axes: readonly EqAxis[]): number {
  return axes.reduce((total, axis) => total * Math.max(axis.values.length, 1), 1);
}

/** 両端 2 つ(2 つ以下ならそのまま)。 */
function ends<T>(values: readonly T[]): readonly T[] {
  if (values.length <= 2) return values;
  const first = values[0];
  const last = values[values.length - 1];
  return first === undefined || last === undefined ? values : [first, last];
}

/** その操作のガード式のどれか(数値リテラルの種を集めるためだけに読む)。 */
function parseAny(ctx: ScenarioContext): GuardExpr | null {
  for (const source of [ctx.guardSource, ...ctx.rules.map((rule) => rule.when)]) {
    if (source === undefined || source === null) continue;
    const parsed = parseGuard(source);
    if (parsed.ok) return parsed.expr;
  }
  return null;
}

