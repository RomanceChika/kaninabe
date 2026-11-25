/**
 * 実行計画（`run-plan.ts`）の**定型 RPC へ渡す名前付き引数**を組み立てる部分。
 *
 * 仕様: docs/rules/process/frontend/specification/standards/usecase-spec-writing.md
 *       §引数名 → 供給元（供給元の値域の正）
 *
 * 引数名も供給元も計画（`call.params`）が運ぶ。ここにあるのは「その供給元から値を取る」写像
 * だけであり、**どの引数に何を渡すかの判断は 1 つも無い** —— 判断は仕様から導出され、
 * 決まらないものは生成の段でエラーになっている（A15）。
 *
 * **入力は平たい**（`{ id, ... }`）。名前付きで呼ぶのは単発の操作だけであり、手順が 1 つしか
 * 無いので別名で包む理由が無い（生成される入力スキーマ `operation-inputs.ts` もその形である）。
 */

import type { RunParam, RunParamSource, RunPlan } from '@kaninabe/runtime/plan';
import type { Json, RpcArg } from '@kaninabe/runtime/ports';
import type { FactMap, PlanInputMap, Resolution } from './run-plan-facts';
import { changeOf, collapsePresence, presenceOf, rpcArgsToJson, toWire } from './wire';

/** 計算値の純関数 1 本（読んだ事実と入力だけから値を出す）。 */
type ComputeFn = (facts: FactMap, input: PlanInputMap) => unknown;

/**
 * 計算値（action_spec の `computes`）の純関数の表。
 *
 * 鍵は計画が名指しした純関数名（`TRefs`）である。**計画の型から鍵の全数が導かれる**
 * （`ComputeRefsOf`）ので、計算値を宣言したのに関数を配線し忘れる、という状態になれない
 * （不変条件の hooks と同じ構え）。計画が名指ししていない関数が余分に載るのは許す（宣言だけが
 * あって RPC が受け取らない計算値は、配線だけが残る）。
 */
export type PlanComputes<TRefs extends string> = Readonly<Record<TRefs, ComputeFn>> &
  Readonly<Record<string, ComputeFn>>;

/**
 * 計画が要求する純関数名の合併型（`source.kind === 'computed'` の `ref` を全部集める）。
 *
 * 計画が `as const`（生成物の `operationPlans` / `usecasePlans`）のリテラル型なら具体的な
 * 名前の合併になり、要求が無ければ `never` になる。**型が `RunPlan` そのものに広がっている
 * ときは `string`** になる（静的には分からない。その場合は組み立て時の検証が拒む）。
 */
export type ComputeRefsOf<TPlan extends RunPlan> = RefsOfCall<TPlan['call']>;

type RefsOfCall<TCall> = TCall extends { readonly kind: 'named'; readonly params: infer TParams }
  ? TParams extends readonly (infer TParam)[]
    ? RefOfParam<TParam>
    : never
  : never;

type RefOfParam<TParam> = TParam extends { readonly source: infer TSource }
  ? TSource extends { readonly kind: 'computed'; readonly ref: infer TRef extends string }
    ? TRef
    : never
  : never;

/**
 * 第 3 引数（計算値の表）の型。**要求が 1 つでもある計画では必須**、要求が無い計画では省略できる。
 *
 * 要求が具体的に分かる計画（`string` に広がっていない）だけが必須になる。広がった型は何も
 * 要求できないので省略を許すが、要求があれば組み立て時に拒まれる。
 */
export type ComputesArgs<TRefs extends string> = [TRefs] extends [never]
  ? [computes?: PlanComputes<never>]
  : string extends TRefs
    ? [computes?: PlanComputes<string>]
    : [computes: PlanComputes<TRefs>];

/** 計算値の純関数が無いときの例外の文面（組み立て時と実行時で同じ文にする）。 */
function missingMessage(refs: readonly string[]): string {
  return `計算値の純関数が配線されていません: ${refs.join(', ')}（計画が名指ししたものは全部 computes に渡す）`;
}

/** 表に**自前の鍵**として載っている純関数（`toString` のような継承物は配線とは言わない）。 */
function wired(computes: PlanComputes<string>, ref: string): ComputeFn | undefined {
  return Object.hasOwn(computes, ref) ? computes[ref] : undefined;
}

/**
 * 計画が要求する純関数が**全部**表にあることを確かめる（無ければ例外）。
 *
 * 型（`ComputesArgs`）は計画が具体的なリテラル型のときだけ配線漏れを拒める。型が広がった呼び出し
 * （テスト・動的な計画）の漏れは、ここが**配線時に 1 回**拒む —— 呼び出しごとに RPC の引数が
 * 黙って落ちる（JSON 化で `undefined` は消える）のを許さない。`ActionResult` の業務上の拒否では
 * なく**配線のバグ**なので、例外にする（DB の想定外の失敗と同じ扱い）。
 *
 * @param plan - 実行計画
 * @param computes - 配線された純関数の表
 */
export function assertComputesWired(plan: RunPlan, computes: PlanComputes<string>): void {
  if (plan.call.kind !== 'named') return;
  const missing = new Set<string>();
  for (const param of plan.call.params) {
    if (param.source.kind === 'computed' && wired(computes, param.source.ref) === undefined) {
      missing.add(param.source.ref);
    }
  }
  if (missing.size > 0) throw new Error(missingMessage([...missing]));
}

/** 引数を組み立てるのに要るもの。 */
export interface ArgsContext {
  readonly resolution: Resolution;
  /** 呼び出しごとに 1 回だけ作る冪等キー。 */
  readonly idempotencyKey: string;
  /**
   * 実行者に立つロール（`p_actor_roles`。束 ⑳-3）。
   *
   * **DB が `by` を照合するのに使う**（先読みの engine と同じ 1 つの解決結果）。`implies` で
   * 閉じていることが DB 側の契約であり、閉じるのは `./actor.ts` の `resolveActorRoles` である。
   */
  readonly actorRoles: readonly string[];
  /** 編集の判断が集めた副作用（それ以外の形では空）。 */
  readonly writeEffects: readonly string[];
  /** 計算値の純関数（計画が要求する名前の全数。組み立て時に検証済み）。 */
  readonly computes: PlanComputes<string>;
}

/**
 * 定型 RPC に渡す名前付き引数を、**意味のまま**（`RpcArg`）組み立てる。
 *
 * 入力・計算値・読んだ事実は `unknown` で入ってくるので、運べない値（`NaN`・`BigInt`・配列の中の
 * `undefined` 等）はここで `ProgrammingError` になる（`./wire.ts`）。
 *
 * @param params - 計画が運ぶ引数の並び（宣言順）
 * @param ctx - 読んだ事実・入力・実行者・冪等キー・副作用・計算値
 * @returns 引数名 → 引数の意味
 */
export function namedRpcArgs(params: readonly RunParam[], ctx: ArgsContext): Readonly<Record<string, RpcArg>> {
  const args: Record<string, RpcArg> = {};
  for (const param of params) args[param.name] = argValue(param.source, ctx);
  return args;
}

/**
 * 定型 RPC に渡す名前付き引数を組み立てる（PostgREST に渡る JSON）。
 *
 * 意味（`namedRpcArgs`）を、今の口（`rpc.call` の引数は JSON）へ運ぶ形に符号化する。
 * 符号化は `./wire.ts` の 1 か所である。
 *
 * @param params - 計画が運ぶ引数の並び（宣言順）
 * @param ctx - 読んだ事実・入力・実行者・冪等キー・副作用・計算値
 * @returns 引数名 → 値
 */
export function namedArgs(params: readonly RunParam[], ctx: ArgsContext): Readonly<Record<string, Json>> {
  return rpcArgsToJson(namedRpcArgs(params, ctx));
}

/** 最上位の引数（署名が固定で、未指定を持てない）。 */
function top(value: Json): RpcArg {
  return { kind: 'value', value };
}

/** 供給元 1 つを引数の意味にする（この 14 種以外の供給元は存在しない）。 */
function argValue(source: RunParamSource, ctx: ArgsContext): RpcArg {
  switch (source.kind) {
    case 'idempotency_key':
      return top(ctx.idempotencyKey);
    case 'actor':
      return top(ctx.resolution.actorId);
    case 'actor_roles':
      return top([...ctx.actorRoles]);
    case 'expected_state':
      return top(toWire(ctx.resolution.facts[source.ref] ?? null, `expected_state:${source.ref}`));
    case 'next_state':
      return top(source.state);
    case 'effects':
      return top([...source.effects]);
    case 'write_effects':
      return top([...ctx.writeEffects]);
    case 'event_id':
      return top(source.event);
    // 送られていない任意の欄は **null** で渡す。`undefined` のままにすると PostgREST が
    // その引数ごと落とし、署名の違う関数を探して「関数が見つからない」になる（実測: 任意の欄を
    // 送らない作成の操作。例: `entry.create`）。列そのものに「送られていない」という値は無いので、空で渡す。
    case 'input_field':
      return top(collapsePresence(presenceOf(ctx.resolution.input[source.field], `input.${source.field}`)));
    // 対象の識別子は必須である。無ければ（`undefined`）引数ごと落ちる代わりに、呼び出し側の誤りとして止める。
    case 'input_target_id':
      return top(toWire(ctx.resolution.input['id'], 'input.id'));
    case 'input_values':
      return {
        kind: 'record',
        fields: Object.fromEntries(
          source.fields.map((field) => [field, presenceOf(ctx.resolution.input[field], `input.${field}`)]),
        ),
      };
    case 'input_changes':
      return {
        kind: 'patch',
        changes: Object.fromEntries(
          source.fields.map((field) => [field, changeOf(ctx.resolution.input[field], `input.${field}`)]),
        ),
      };
    // この遷移が書かない列。空が「触れない」か「空にする」かは RPC の契約であり、
    // ここは計画が言うとおり空を渡すだけである（run-plan-args の判断は 0 個）。
    case 'not_written':
      return top(null);
    default: {
      // 組み立て時（`runPlanOperation`）に検証済みなので通常は来ない。`namedArgs` を直に使う
      // 呼び出しでも、`undefined` で黙って RPC の引数ごと落とさない。
      const compute = wired(ctx.computes, source.ref);
      if (compute === undefined) throw new Error(missingMessage([source.ref]));
      return top(toWire(compute(ctx.resolution.facts, ctx.resolution.input), `computed:${source.ref}`));
    }
  }
}
