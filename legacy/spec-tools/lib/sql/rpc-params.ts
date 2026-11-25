/**
 * 定型 RPC の**引数名 → 本文での役目**の写像(束 ⑳-2)。
 *
 * `usecase/param-source.ts` が持つのは「呼ぶ側が何を渡すか」であり、ここが持つのは
 * **呼ばれた側が受け取った値で何をするか**である。同じ引数名の規約(`usecase-spec-writing.md`
 * §引数名 → 供給元)の裏返しなので、名前の解釈は 1 か所に閉じている。
 *
 * 純関数であり throw しない(前提が破れたら理由つきの `RpcBodyProblem` を返す。
 * scripts-code-quality.md)。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, SpecModel } from '../model/types.js';
import { findField } from '../semantics/domain-index.js';
import { splitExpectedParam } from '../usecase/param-source-facts.js';

/** 引数名の前置(T1 が形を見ている)。 */
export const PARAM_PREFIX = 'p_';

/** 意味が固定されている引数名(param-source.ts と同じ表の裏返し)。 */
const ID = 'p_id';
const ACTOR_ID = 'p_actor_id';
const ACTOR_ROLES = 'p_actor_roles';
const NEXT_STATE = 'p_next_state';
const EFFECTS = 'p_effects';
const EVENT_ID = 'p_event_id';
const VALUES = 'p_values';
const CHANGES = 'p_changes';
const EXPECTED_STATE = 'p_expected_state';

/** `p_expected_{集約}_{状態列}`(自表以外の状態を条件にする形)の前置。 */
const EXPECTED_PREFIX = 'p_expected_';

/** 引数 1 本が本文で果たす役目(値域)。 */
export type RpcParamRole =
  /** 作成する行の id(冪等キー)。 */
  | { readonly kind: 'new_id' }
  /** 書き込む対象の行の id。 */
  | { readonly kind: 'target_id' }
  /** 監査ログに刻む実行者。 */
  | { readonly kind: 'actor' }
  /** 実行者に立つグローバルロール(`by` の照合。束 ⑳-3)。 */
  | { readonly kind: 'actor_roles' }
  /** 自分の状態列を条件にする(楽観的並行制御)。 */
  | { readonly kind: 'expected_self'; readonly column: string }
  /** 他の集約の状態を条件にする(ガード付きの書き込み)。 */
  | { readonly kind: 'expected_other'; readonly entity: string; readonly column: string }
  /** 遷移先の状態。 */
  | { readonly kind: 'next_state' }
  /** 積む副作用(outbox ジョブ)の並び。 */
  | { readonly kind: 'effects' }
  /** 監査ログに刻むドメインイベント ID。 */
  | { readonly kind: 'event_id' }
  /** 作成の値(jsonb)。 */
  | { readonly kind: 'values' }
  /** 編集の変更集合(jsonb)。 */
  | { readonly kind: 'changes' }
  /** その集約の 1 列に直に入る値。 */
  | { readonly kind: 'column'; readonly field: FieldDef };

/** 引数 1 本(名前・型・役目)。 */
export interface RpcParam {
  readonly name: string;
  /** pg_catalog の型名(data_table の `args` の写し)。 */
  readonly type: string;
  readonly role: RpcParamRole;
}

/** 本文を組み立てられなかった理由(3 点セット)。 */
export interface RpcBodyProblem {
  readonly message: string;
  readonly suggestion: string;
  readonly counterexample: Readonly<Record<string, string>>;
}

/** 引数の解釈の結果。 */
export type RpcParamsResult =
  | { readonly ok: true; readonly params: readonly RpcParam[] }
  | { readonly ok: false; readonly problems: readonly RpcBodyProblem[] };

/** 解釈に要る文脈。 */
export interface RpcParamContext {
  readonly fn: string;
  readonly entity: string;
  readonly domain: SpecModel;
  /** 自分の状態列(遷移は機械が決める。それ以外は既定の `state`)。null なら状態を持たない。 */
  readonly stateField: FieldDef | null;
}

/**
 * 定型 RPC の全引数を役目に写す。
 *
 * @param names 引数名(`params` の宣言順)
 * @param types 引数型(`args` の宣言順。`names` と同じ長さ)
 * @param ctx 自集約とドメイン仕様
 * @returns 役目つきの引数、または理由つきの失敗
 */
export function classifyRpcParams(
  names: readonly string[],
  types: readonly string[],
  ctx: RpcParamContext,
): RpcParamsResult {
  if (names.length !== types.length) {
    return {
      ok: false,
      problems: [
        {
          message: `${ctx.fn} の params(${names.length} 本)と args(${types.length} 本)の長さが違います`,
          suggestion: 'params は args と同じ順・同じ長さで並べる(T1 が形を見る)',
          counterexample: { function: ctx.fn, params: String(names.length), args: String(types.length) },
        },
      ],
    };
  }
  const problems: RpcBodyProblem[] = [];
  const params: RpcParam[] = [];
  names.forEach((name, index) => {
    const role = roleOf(name, ctx, problems);
    if (role === null) return;
    params.push({ name, type: types[index] ?? 'unknown', role });
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, params };
}

/** 引数 1 本の役目。決まらなければ problems に積んで null を返す。 */
function roleOf(name: string, ctx: RpcParamContext, problems: RpcBodyProblem[]): RpcParamRole | null {
  if (name === ID) return { kind: 'new_id' };
  if (name === ACTOR_ID) return { kind: 'actor' };
  if (name === ACTOR_ROLES) return { kind: 'actor_roles' };
  if (name === NEXT_STATE) return { kind: 'next_state' };
  if (name === EFFECTS) return { kind: 'effects' };
  if (name === EVENT_ID) return { kind: 'event_id' };
  if (name === VALUES) return { kind: 'values' };
  if (name === CHANGES) return { kind: 'changes' };
  if (name === EXPECTED_STATE) return expectedSelf(ctx, problems);
  if (name.startsWith(EXPECTED_PREFIX)) {
    const split = splitExpectedParam(ctx.domain, name.slice(EXPECTED_PREFIX.length));
    if (split !== null) return { kind: 'expected_other', entity: split.entity, column: split.field.name };
  }
  if (name === `${PARAM_PREFIX}${ctx.entity}_id`) return { kind: 'target_id' };
  const field = findField(ctx.domain, ctx.entity, name.slice(PARAM_PREFIX.length));
  if (field !== null) return { kind: 'column', field };
  problems.push({
    message: `${ctx.fn} の引数 ${name} の役目が規約から決まりません`,
    suggestion:
      '定型 RPC の引数名は閉じた規約である(server-actions.md §定型 RPC の引数名)。' +
      `${ctx.entity} のフィールド名にするか、定型に乗らない関数として shape: composite を宣言する`,
    counterexample: { function: ctx.fn, param: name, entity: ctx.entity },
  });
  return null;
}

/** `p_expected_state` の指す自分の状態列。 */
function expectedSelf(ctx: RpcParamContext, problems: RpcBodyProblem[]): RpcParamRole | null {
  const field = ctx.stateField;
  if (field !== null) return { kind: 'expected_self', column: field.name };
  problems.push({
    message: `${ctx.fn} は ${EXPECTED_STATE} を受け取りますが ${ctx.entity} に状態列がありません`,
    suggestion: 'entity_spec に state(...) 型のフィールドを足すか、RPC の引数から外す',
    counterexample: { function: ctx.fn, entity: ctx.entity },
  });
  return null;
}
