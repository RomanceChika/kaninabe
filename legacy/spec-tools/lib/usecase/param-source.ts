/**
 * 引数名 → 供給元の規約(束 ⑯c 設計 §2)。**複合 RPC を生成する唯一の知識**であり、値域である。
 *
 * 複合 RPC の本文は各手順の既存 RPC を**名前付き記法**で呼ぶ。どの引数に何を渡すかは、
 * data_table が宣言した引数名(`functions[].params`)だけから決まる —— 決まらない名前が 1 つでも
 * あれば **生成時エラー**にして仕様の問題として止める(実行時に推測しない)。
 *
 * ここは純粋な「名前 → 供給元」の写像であり、SQL の字面は持たない
 * (SQL の組み立ては generate/render/code-usecase-rpc.ts。検査 Y8 は同じ写像を使って
 * 「全手順の全引数が解決できるか」だけを見る)。
 */

import type { FieldDef, SpecModel } from '../model/types.js';
import type { PlanProblem, SavePlan, SaveStepPlan } from './step-plan.js';
import { anchorStep, at, checkSelf, reachedFields, reorder, splitExpectedParam, stateFieldOf } from './param-source-facts.js';
import { predictState } from './plan-facts-parts.js';
import { changesSource, refOrFieldSource, valuesSource } from './param-source-fields.js';

/** 引数名の前置(T1 が形を見ている)。 */
const PREFIX = 'p_';

/** 意味が固定されている引数名(§2 の上 6 行)。 */
const ID = 'p_id';
const ACTOR_ID = 'p_actor_id';
const ACTOR_ROLES = 'p_actor_roles';
const NEXT_STATE = 'p_next_state';
const EFFECTS = 'p_effects';
const EVENT_ID = 'p_event_id';
const VALUES = 'p_values';
const CHANGES = 'p_changes';
const EXPECTED_STATE = 'p_expected_state';

/** 残りの入力欄が決まってからでないと組み立てられない引数(宣言順は `reorder` が戻す)。 */
const DEFERRED = [VALUES, CHANGES];

/** `p_expected_{集約}_{状態列}`(自表以外の状態を条件にする形)の前置。 */
const EXPECTED_PREFIX = 'p_expected_';

/** 引数 1 本の供給元(値域)。 */
export type ParamSource =
  /** 複合 RPC の引数 `p_id`(呼び側が作った冪等キー)。保存点の最初の create だけ。 */
  | { readonly kind: 'idempotency_key' }
  /** その場で採番する(2 本目以降の create)。 */
  | { readonly kind: 'new_id' }
  /** 複合 RPC の引数 `p_actor_id`。 */
  | { readonly kind: 'actor' }
  /**
   * 実行者に立つロールの配列(`p_actor_roles`。束 ⑳-3)。
   *
   * **app が session から解決した閉包**である —— グローバルロール(role_spec の `kind`)と
   * `claim` で立つロールを、`implies` の推移閉包で閉じたもの(`roles-to-sql.ts` の契約)。
   * DB はこの配列を `by` の照合に使う(束縛のロールは配列ではなく行から立つ)。
   */
  | { readonly kind: 'actor_roles' }
  /**
   * 予測した状態(ADR-0011 §4)。`literal` があればそれを埋め、無ければ `p_expected` から読む。
   * `entity` / `field` は `p_expected` のキー(`{entity}.{field}`)を組み立てるのに使う。
   */
  | { readonly kind: 'expected_state'; readonly entity: string; readonly field: string; readonly literal: string | null }
  /** 遷移先(state_spec の `to`)。 */
  | { readonly kind: 'next_state'; readonly state: string }
  /** 副作用 ID の配列(state_spec の `effects[].do`)。 */
  | { readonly kind: 'effects'; readonly effects: readonly string[] }
  /**
   * 編集が積む副作用(`access_spec` の `writes[].effects`)。
   *
   * 遷移の `effects` と違い**判断の結果から決まる** —— 許可を返した規則が宣言していたものだけを、
   * 変更された欄の並びで集める(`_template` の編集の定型と同じ規則)。したがって値は計画に
   * 載らず、実行器が `canWrite` の結果から組む。
   */
  | { readonly kind: 'write_effects' }
  /** ドメインイベント ID(= その手順の op)。 */
  | { readonly kind: 'event_id'; readonly event: string }
  /**
   * 保存点の中で先に作った行の id(plpgsql 変数)。
   * `column` はこの手順のテーブル側でその参照を保持する列(自分自身を指すときは `id`)であり、
   * 再送のときに既存の行を読み直す絞り込みに使う。
   */
  | { readonly kind: 'step_result_id'; readonly step: number; readonly column: string }
  /** 入力から読む 1 欄(`{型}` は entity_spec のフィールド型)。 */
  | { readonly kind: 'input_field'; readonly field: string; readonly type: FieldDef['type'] }
  /** 入力から読む「この手順の対象の id」(action_spec の `{entity}.id`)。 */
  | { readonly kind: 'input_target_id' }
  /** 入力から組み立てる jsonb(親 ID・実行者由来を除いた残り)。 */
  | { readonly kind: 'input_values'; readonly fields: readonly FieldDef[] }
  /**
   * 編集の**変更集合** jsonb(`p_changes`)。入力欄のうち対象の識別子と他の引数が受けた分を除く。
   *
   * `input_values`(作成)と別の語にしてあるのは意味が違うからである —— 作成は「全部入れる」、
   * 編集は「**送られた鍵だけ**書き換える」(鍵が無い = 変えない / `null` = 空にする)。
   */
  | { readonly kind: 'input_changes'; readonly fields: readonly FieldDef[] }
  /**
   * 実行時に純関数が決める値(action_spec の `computes`)。
   *
   * 入力にも実行者にも DB にも無い欄を RPC が要求するときの、宣言された唯一の逃げ道である
   * (束 ⑰ 設計 §3-2)。`ref` は純関数名で、実行器は hooks からその関数を引く。
   */
  | { readonly kind: 'computed'; readonly field: string; readonly ref: string }
  /**
   * **この遷移は自分でその列を決めない**(空を渡す)。
   *
   * 遷移の RPC が自集約の列 `p_{欄}` を受け取るとき、その値を決めるのはイベント単位の宣言
   * (state_spec の `records_actor` / `clears`)である。どちらにも無い遷移は**その列に触れない**
   * という意味で空を渡し、`clears` に並ぶ遷移は**空にする**という意味で空を渡す。
   *
   * 値はどちらも空だが、**RPC に要求する契約が違う** —— 触れないなら `coalesce(p_x, x)`、
   * 空にするならそのまま代入である。`contract` はその要求そのものであり、rpc-parity が実 DB の
   * 本文と突き合わせる(束 ⑰-3。それまでは同じ宣言の不在が正反対の結果を生んでいた)。
   */
  | { readonly kind: 'not_written'; readonly field: string; readonly contract: NotWrittenContract };

/** 空を渡された列に RPC が要求される扱い(値域)。 */
export type NotWrittenContract =
  /** 触れない(`coalesce(p_x, x)`)。宣言が無いときの既定。 */
  | 'untouched'
  /** 空にする(そのまま代入)。state_spec の `clears` で宣言する。 */
  | 'cleared';

/** 1 手順ぶんの解決結果(引数名 → 供給元。宣言順)。 */
export interface ResolvedParam {
  readonly name: string;
  readonly source: ParamSource;
}

/** 解決の結果。1 本でも決まらなければ `problems` を返す。 */
export type ResolveResult =
  | { readonly ok: true; readonly params: readonly ResolvedParam[] }
  | { readonly ok: false; readonly problems: readonly PlanProblem[] };

/**
 * 保存点の全手順の全引数を解決する。
 *
 * @param plan 接地済みの保存点
 * @param domain ドメイン仕様(フィールド型・状態機械の初期状態を引く)
 * @returns 手順ごとの解決結果(宣言順)、または理由つきの失敗
 */
export function resolveSaveParams(
  plan: SavePlan,
  domain: SpecModel,
): { readonly ok: true; readonly steps: readonly (readonly ResolvedParam[])[] } | { readonly ok: false; readonly problems: readonly PlanProblem[] } {
  const problems: PlanProblem[] = [];
  const steps: (readonly ResolvedParam[])[] = [];
  for (const step of plan.steps) {
    const result = resolveStepParams(plan, step, domain);
    if (result.ok) steps.push(result.params);
    else problems.push(...result.problems);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, steps };
}

/**
 * 1 手順の引数を解決する。
 *
 * @param plan 接地済みの保存点
 * @param step その手順
 * @param domain ドメイン仕様
 * @returns 引数名 → 供給元(宣言順)、または理由つきの失敗
 */
function resolveStepParams(plan: SavePlan, step: SaveStepPlan, domain: SpecModel): ResolveResult {
  const problems: PlanProblem[] = [];
  const params: ResolvedParam[] = [];
  const consumed = new Set<string>();
  for (const name of step.fn.params) {
    if (DEFERRED.includes(name)) continue; // 残りの入力欄が決まってからでないと組み立てられない。
    const source = resolveOne(name, plan, step, domain, problems);
    if (source === null) continue;
    params.push({ name, source });
    const rest = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
    consumed.add(rest);
  }
  if (step.fn.params.includes(VALUES)) {
    params.push({ name: VALUES, source: valuesSource(step, domain, consumed) });
  }
  if (step.fn.params.includes(CHANGES)) {
    params.push({ name: CHANGES, source: changesSource(step, domain, consumed) });
  }
  if (step.defaultsSelf) problems.push(...checkSelf(plan, step, domain, reachedFields(step, params)));
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, params: reorder(step.fn.params, params) };
}

/** 引数 1 本を解決する。決まらなければ problems に積んで null を返す。 */
function resolveOne(
  name: string,
  plan: SavePlan,
  step: SaveStepPlan,
  domain: SpecModel,
  problems: PlanProblem[],
): ParamSource | null {
  if (name === ID) return idSource(plan, step, problems);
  if (name === ACTOR_ID) return { kind: 'actor' };
  if (name === ACTOR_ROLES) return { kind: 'actor_roles' };
  if (name === NEXT_STATE) return nextStateSource(step, problems);
  // 編集の副作用は判断の結果から決まる(遷移は宣言そのもの)。
  if (name === EFFECTS) return step.kind === 'update' ? { kind: 'write_effects' } : { kind: 'effects', effects: step.effects };
  if (name === EVENT_ID) return { kind: 'event_id', event: step.op };
  if (name === EXPECTED_STATE) {
    const own = stateFieldOf(domain, step.entity, step.machine?.machine ?? null);
    return expectedSource(plan, step, domain, step.entity, own, problems);
  }
  if (name.startsWith(EXPECTED_PREFIX)) {
    const split = splitExpectedParam(domain, name.slice(EXPECTED_PREFIX.length));
    if (split !== null) return expectedSource(plan, step, domain, split.entity, split.field, problems);
  }
  return refOrFieldSource(name, plan, step, domain, problems);
}

/** `p_id`: 保存点の最初の create だけが冪等キーを受け取る(§3-4)。 */
function idSource(plan: SavePlan, step: SaveStepPlan, problems: PlanProblem[]): ParamSource | null {
  const first = anchorStep(plan);
  if (first === undefined || first.index !== step.index) return { kind: 'new_id' };
  if (!step.repeat) return { kind: 'idempotency_key' };
  problems.push({
    message: `保存点の最初の作成手順 ${step.op} が repeat: true なので冪等キーの置き場が決まりません`,
    suggestion:
      '保存点の冪等は「最初に作る 1 行」で担保する(ADR-0011 §4)。繰り返す作成の前に、' +
      '繰り返さない作成(親の行)を 1 手順置くか、保存点を分ける',
    counterexample: at(plan, step),
  });
  return null;
}

/** `p_next_state`: 遷移の `to`。 */
function nextStateSource(step: SaveStepPlan, problems: PlanProblem[]): ParamSource | null {
  if (step.event !== null) return { kind: 'next_state', state: step.event.to };
  problems.push({
    message: `作成手順 ${step.op} の RPC が ${NEXT_STATE} を要求しています`,
    suggestion: '作成は初期状態のまま 1 行入れる形である(server-actions.md)。RPC の引数か、手順の種別のどちらかを直す',
    counterexample: { function: step.fn.name, param: NEXT_STATE, step: step.op },
  });
  return null;
}

/**
 * `p_expected_state` / `p_expected_{集約}_{状態列}`: その集約の状態を**仕様から予測**する。
 *
 * 保存点の中で作った → `initial` / 保存点の中で遷移した → 直前の `to` / どちらでもない →
 * 呼び側が読んだ値(`p_expected`)。予測が実際と食い違えば既存 RPC が 0 行を返し全体が戻る。
 */
function expectedSource(
  plan: SavePlan,
  step: SaveStepPlan,
  domain: SpecModel,
  entity: string,
  field: FieldDef | null,
  problems: PlanProblem[],
): ParamSource | null {
  if (field === null) {
    problems.push({
      message: `${entity} に状態フィールドが無いため、予測すべき状態が決まりません`,
      suggestion: 'state(...) 型のフィールドを持たない集約の状態は条件にできない。RPC の引数名か entity_spec を直す',
      counterexample: { ...at(plan, step), entity },
    });
    return null;
  }
  return {
    kind: 'expected_state',
    entity,
    field: field.name,
    literal: predictState(plan, step, domain, entity, field),
  };
}

// 供給元を決めるための事実の引き当て(checkSelf / createdRef / stateFieldOf / actorEntity /
// entityOf / at)は param-source-facts.ts にある。状態の予測
// (predictState)は同じ規則を最後の手順まで当てる finalStateOf の隣(plan-facts-parts.ts)に置いた。
export { actorEntity } from './param-source-facts.js';
export { predictState } from './plan-facts-parts.js';
