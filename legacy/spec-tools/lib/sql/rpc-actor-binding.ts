/**
 * 作成の RPC が**実行者の参照の欄**を実行者そのもの(`p_actor_id`)に縛る、の SQL 側。
 *
 * 何を縛るか(欄の種類 A / B と、規則ごとに縛る欄)は `usecase/actor-bound.ts` の 1 本が決める ——
 * engine の作成規則表(`self`)と実行計画の事実も同じ関数を読むので、TS(意味の正)と SQL(写し)で
 * 縛りがずれない。ここが持つのは 2 つだけである。
 *
 *   1. **規則ごとのロールの述語に足す条件**(`coalesce(({欄の式}) = p_actor_id, false)`)。縛りは `by` の段の一部で、
 *      0 行の理由の分類ではロールの段(`UC403`)に入る —— engine の `canCreate` が縛りの成り立たない規則を
 *      「当てはまらない」(`role_forbidden`)に数えるのと同じ順である(ロール → 再送 → 前提 → ガード)。
 *      規則の `when` はガードの段のままで、縛りと混ぜない(規則をまたいで条件が混ざらない)。
 *   2. **宣言の問題**(T6 が名指す):入力に出した欄を解く規則が 1 つも無い / 縛る欄が作成の本文に入らない /
 *      実行者を受け取らない。
 *
 * `p_actor_id` が null のとき `=` は null になり、`coalesce(…, false)` で不成立になる(実行者のいない呼び出しを
 * 「誰でも」と読まない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { CreateRule } from '../model/types-access.js';
import { findAccessSpec } from '../semantics/domain-lookup.js';
import { actorBoundFields, relaxesBinding, ruleBoundFields } from '../usecase/actor-bound.js';
import { inputFieldNames } from './rpc-columns.js';
import type { RpcFactsBase, RpcFactsInput } from './rpc-facts.js';
import type { RpcBodyProblem } from './rpc-params.js';

/** 実行者への縛り(`access_spec` の `creates` の並びと同じ順に、規則ごとの条件)。 */
export interface ActorBinding {
  /** 規則ごとに `by` の述語へ足す条件(縛る欄が無い規則は null)。 */
  readonly ruleConditions: readonly (string | null)[];
}

/** 導出の結果(縛る欄が無いなら null)。 */
export type ActorBindingResult =
  | { readonly ok: true; readonly binding: ActorBinding | null }
  | { readonly ok: false; readonly problems: readonly RpcBodyProblem[] };

/** 実行者の引数。 */
const ACTOR_PARAM = 'p_actor_id';

/**
 * 作成の RPC の、実行者への縛りを導く。
 *
 * @param input 関数の宣言・表・ドメイン仕様(作成以外は縛りを持たない)
 * @param entity 自集約
 * @param facts 集め終えた事実(入れる列が要る)
 * @returns 規則ごとの条件、または宣言の問題
 */
export function actorBindingOf(input: RpcFactsInput, entity: string, facts: RpcFactsBase): ActorBindingResult {
  if (input.shape !== 'create') return { ok: true, binding: null };
  const inputFields = input.actions === undefined ? [] : inputFieldNames(input, entity);
  const fields = actorBoundFields(input.domain, entity, inputFields);
  const rules = findAccessSpec(input.domain, entity)?.creates ?? [];
  const roles = input.domain.roles.roles;
  const problems: RpcBodyProblem[] = [];
  for (const field of fields) {
    const strict = rules.filter((rule) => !relaxesBinding(rule, roles, field));
    if (field.inInput && strict.length > 0 && strict.length === rules.length) {
      problems.push(deadInput(input, entity, field.name, strict));
    }
  }
  const bound = new Set(rules.flatMap((rule) => ruleBoundFields(rule, roles, fields)));
  if (bound.size === 0) return problems.length > 0 ? { ok: false, problems } : { ok: true, binding: null };
  const expressions = new Map(facts.insertColumns.map((column) => [column.name, column.expression]));
  for (const name of bound) {
    if (!expressions.has(name)) problems.push(notInserted(input, entity, name));
  }
  if (!facts.hasActor) problems.push(noActor(input));
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    binding: { ruleConditions: rules.map((rule) => conditionOf(ruleBoundFields(rule, roles, fields), expressions)) },
  };
}

/** 規則 1 本の縛りの条件(縛る欄が無ければ null)。 */
function conditionOf(names: readonly string[], expressions: ReadonlyMap<string, string>): string | null {
  if (names.length === 0) return null;
  const terms = names.map((name) => `coalesce((${expressions.get(name) ?? 'null'}) = ${ACTOR_PARAM}, false)`);
  return terms.length === 1 ? (terms[0] ?? null) : `(${terms.join(' and ')})`;
}

/** 入力に出した欄を、解く規則が 1 つも無い(誰が自分以外を選んでも必ず UC403)。 */
function deadInput(input: RpcFactsInput, entity: string, field: string, strict: readonly CreateRule[]): RpcBodyProblem {
  const by = strict.map((rule) => rule.by);
  return {
    message:
      `${entity}.create の input に実行者の参照の欄 ${field} があります ——作成の規則(by: ${by.join(' / ')})は` +
      `どれも代理を宣言していないので、${input.name} は ${field} を実行者そのものに縛ります(自分以外を入れると必ず UC403)`,
    suggestion:
      `自分の行だけを作るなら action_spec の input から ${field} を外し、"owner: ${entity}.${field}" を宣言する(作成者で埋まる)。` +
      `別の人を選んで作る業務なら、access_spec の creates のその規則の delegate にその欄と理由を名指す(- field: ${entity}.${field} / reason: {理由})` +
      '(delegate が開けるのは input に出した欄だけで、input に無い持ち主の欄は縛ったまま)',
    counterexample: { function: input.name, entity, field, by: by.join(', ') },
  };
}

/** 縛る欄が作成の本文に入らない(engine は縛るのに DB は値を見られない)。 */
function notInserted(input: RpcFactsInput, entity: string, field: string): RpcBodyProblem {
  return {
    message: `${input.name} は実行者の参照の欄 ${entity}.${field} を縛るはずですが、その欄を行に入れていません`,
    suggestion: `data_table の ${input.name} の params に p_${field} を足すか、p_values で受ける(必須の欄・入力の欄は行に入る)`,
    counterexample: { function: input.name, entity, field },
  };
}

/** 縛る相手(実行者)を受け取っていない。 */
function noActor(input: RpcFactsInput): RpcBodyProblem {
  return {
    message: `${input.name} は実行者の参照の欄を縛りますが、引数 ${ACTOR_PARAM} がありません(実行者に縛れません)`,
    suggestion: `data_table の ${input.name} の params に ${ACTOR_PARAM} を、args に "uuid" を同じ位置で足す`,
    counterexample: { function: input.name, param: ACTOR_PARAM },
  };
}

