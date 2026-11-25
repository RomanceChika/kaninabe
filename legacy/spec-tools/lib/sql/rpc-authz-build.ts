/**
 * 集めた事実(`rpc-facts.ts`)から **`by` とガードの述語**を組み立てる糊(束 ⑳-3)。
 *
 * 3 つのモジュールの境界にあたる —— 届き方の解決(`rpc-reach.ts`)・規則の重ね方
 * (`rpc-authz.ts`)・事実の引き当て(`rpc-facts.ts`)。この 3 つをつなぐ 1 点だけを持ち、
 * どれにも判断を足さない。
 *
 * ここが決めるのは 1 つだけ、**自集約の 1 欄がどの式に落ちるか**である。編集・削除・遷移は
 * 対象の行の列(`t.{欄}`)、作成は insert に書く式(引数か `p_values` の取り出し)—— 同じ
 * 「自分の欄」でも、行がまだ無い形では値の出どころが違う。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { findAccessSpec } from '../semantics/domain-lookup.js';
import { findEntityFields, findField } from '../semantics/domain-index.js';
import type { AuthzPredicates } from './rpc-authz.js';
import { createAuthz, deleteAuthz, transitionAuthz, updateAuthz } from './rpc-authz.js';
import type { RpcBodyFacts, RpcFactsBase, RpcFactsInput } from './rpc-facts.js';
import { machineOf } from './rpc-transition-columns.js';
import type { GuardLockRow } from './rpc-guard-locks.js';
import { guardLockRows } from './rpc-guard-locks.js';
import { ACTOR_ID_PARAM, ACTOR_ROLES_PARAM, createRpcBindings } from './rpc-reach.js';
import type { ReachInput, RpcSqlBindings } from './rpc-reach.js';
import type { RpcBodyProblem } from './rpc-params.js';
import { TARGET_ALIAS } from './rpc-parts.js';

/** 変更集合の引数名(編集の照会が「その欄が送られたか」を見るのに使う)。 */
const CHANGES_PARAM = 'p_changes';

/** 遷移の分岐に使う引数名。 */
const EVENT_PARAM = 'p_event_id';
const EXPECTED_STATE_PARAM = 'p_expected_state';
const NEXT_STATE_PARAM = 'p_next_state';

/** 組み立ての結果(述語と、ガードが読む親の行 = 書き込みの前に掴む相手)。 */
export type AuthzBuildResult =
  | {
      readonly ok: true;
      readonly predicates: AuthzPredicates;
      readonly guardLockRows: readonly GuardLockRow[];
    }
  | { readonly ok: false; readonly problems: readonly RpcBodyProblem[] };

/**
 * 3 本の述語を組み立てる。
 *
 * @param input 関数の宣言・表・ドメイン仕様
 * @param entity 自集約
 * @param facts 集め終えた事実(述語より前に決まるものだけ)
 * @returns 述語、または理由つきの失敗
 */
export function authzOf(
  input: RpcFactsInput,
  entity: string,
  facts: Omit<RpcBodyFacts, 'authz' | 'guardLockRows'>,
): AuthzBuildResult {
  const reach = reachOf(input, entity, facts);
  const bindings = createRpcBindings(reach);
  const access = findAccessSpec(input.domain, entity);
  const result = byShape(input, entity, facts, access, bindings);
  if (result.ok) {
    const locks = guardLockRows(input, entity, reach);
    if (!locks.ok) return locks;
    return (
      missingActorRoles(input, facts, result.predicates) ??
      missingActorId(input, facts, result.predicates) ?? {
        ok: true,
        predicates: result.predicates,
        guardLockRows: locks.rows,
      }
    );
  }
  return {
    ok: false,
    problems: [
      {
        message:
          `${input.name} の by / ガードを SQL に写せません` +
          `(${[...result.unresolved, ...result.rejected].join(', ')})`,
        suggestion:
          '条件に使う欄まで参照(ref)が辿れるかを entity_spec で確かめる。' +
          '辿れない事実を条件にした規則は DB では守れないので、規則か参照のどちらかを直す' +
          '(意味の正は TS の評価器。domain-spec-writing.md §ガード式の文法)',
        counterexample: {
          function: input.name,
          entity,
          unresolved: result.unresolved.join(' / '),
          rejected: result.rejected.join(' / '),
        },
      },
    ],
  };
}

/** 述語の届き方の文脈(自集約の欄の式・参照の出どころ)。 */
function reachOf(input: RpcFactsInput, entity: string, facts: RpcFactsBase): ReachInput {
  return {
    entity,
    domain: input.domain,
    tableOf: input.tableOf,
    ownColumn: (field: string) => ownColumn(input, entity, facts, field),
    ownRefs: ownRefs(input, entity, facts),
  };
}

/**
 * `by` の述語を組み立てるための SQL の束縛(述語の届き方は `authzOf` と同じ 1 本)。
 *
 * `rpc-actor-binding.ts` が「一部の規則だけのロールの述語」を作るのに使う —— 届き方を
 * 写し直すと、同じロールが本文の 2 か所で別の式になる。
 *
 * @param input 関数の宣言・表・ドメイン仕様
 * @param entity 自集約
 * @param facts 集め終えた事実(述語より前に決まるものだけ)
 * @returns SQL の束縛
 */
export function rpcSqlBindingsOf(
  input: RpcFactsInput,
  entity: string,
  facts: RpcFactsBase,
): RpcSqlBindings {
  return createRpcBindings(reachOf(input, entity, facts));
}

/**
 * グローバルロールを見る述語ができたのに、その引数を受け取っていない宣言を止める。
 *
 * `by` に**束縛でないロール**(role_spec の `kind` / 素のロール)が 1 つでも並べば、述語は
 * `p_actor_roles` を読む。引数が無ければ SQL は「そんな列は無い」で落ちる —— 生成物が
 * 構文として壊れるのは**適用したとき**であり、それは遅すぎる(T6 が verify で止める)。
 */
function missingActorRoles(
  input: RpcFactsInput,
  facts: Omit<RpcBodyFacts, 'authz' | 'guardLockRows'>,
  predicates: AuthzPredicates,
): AuthzBuildResult | null {
  const used = [predicates.role, predicates.guard].some((sql) => sql.includes(ACTOR_ROLES_PARAM));
  if (!used || facts.hasActorRoles) return null;
  return {
    ok: false,
    problems: [
      {
        message: `${input.name} は by にグローバルロールを持ちますが引数 ${ACTOR_ROLES_PARAM} がありません`,
        suggestion:
          `data_table の ${input.name} の params に ${ACTOR_ROLES_PARAM} を、args に "text[]" を同じ位置で足す` +
          '(実行者のロールは DB では引数でしか分からない。server-actions.md §定型 RPC の引数名)',
        counterexample: { function: input.name, param: ACTOR_ROLES_PARAM },
      },
    ],
  };
}

/**
 * 実行者の行を見る述語ができたのに、その引数を受け取っていない宣言を止める。
 *
 * `claim` のロールと**既定のログインロール**(`kind: authenticated_default`)の述語は、
 * 実行者自身の行を `p_actor_id` で引く —— どちらも「実行者の集約にその人の行がある」ことを
 * 根拠にしているからである(domain-spec-writing.md §role_spec)。引数が無ければ SQL は
 * 「そんな列は無い」で落ちる。`p_actor_roles` と同じ理由で、verify の側で止める。
 */
function missingActorId(
  input: RpcFactsInput,
  facts: Omit<RpcBodyFacts, 'authz' | 'guardLockRows'>,
  predicates: AuthzPredicates,
): AuthzBuildResult | null {
  const used = [predicates.role, predicates.guard].some((sql) => sql.includes(ACTOR_ID_PARAM));
  if (!used || facts.hasActor) return null;
  return {
    ok: false,
    problems: [
      {
        message: `${input.name} は実行者の行を見る by を持ちますが引数 ${ACTOR_ID_PARAM} がありません`,
        suggestion:
          `data_table の ${input.name} の params に ${ACTOR_ID_PARAM} を、args に "uuid" を同じ位置で足す` +
          '(実行者の集約に行があることは DB では実行者の id でしか引けない。' +
          'server-actions.md §定型 RPC の引数名)',
        counterexample: { function: input.name, param: ACTOR_ID_PARAM },
      },
    ],
  };
}

/** 形ごとの組み立て(規則の重ね方は `rpc-authz.ts` が持つ)。 */
function byShape(
  input: RpcFactsInput,
  entity: string,
  facts: Omit<RpcBodyFacts, 'authz' | 'guardLockRows'>,
  access: ReturnType<typeof findAccessSpec>,
  bindings: ReturnType<typeof createRpcBindings>,
): ReturnType<typeof createAuthz> {
  switch (input.shape) {
    case 'create':
      return createAuthz(access?.creates ?? [], input.domain, bindings, facts.actorBinding?.ruleConditions ?? []);
    case 'delete':
      return deleteAuthz(access?.deletes ?? [], input.domain, bindings);
    case 'update':
      return updateAuthz(
        access?.writes ?? [],
        facts.writeColumns.map((field) => field.name),
        CHANGES_PARAM,
        input.domain,
        bindings,
      );
    default: {
      const machine = machineOf(input, entity);
      if (machine === null) return { ok: false, unresolved: ['machine'], rejected: [] };
      return transitionAuthz(machine, input.domain, bindings, {
        event: EVENT_PARAM,
        from: EXPECTED_STATE_PARAM,
        to: NEXT_STATE_PARAM,
      });
    }
  }
}

/**
 * 自集約の 1 欄の SQL の式。
 *
 * 作成は「insert に書く式」——その欄の値がまだ行になっていないので、引数か `p_values` の
 * 取り出しをそのまま使う。それ以外は対象の行の列である。
 */
function ownColumn(
  input: RpcFactsInput,
  entity: string,
  facts: RpcFactsBase,
  field: string,
): string | null {
  if (input.shape !== 'create') {
    return findField(input.domain, entity, field) === null && field !== 'id'
      ? null
      : `${TARGET_ALIAS}.${field}`;
  }
  const column = facts.insertColumns.find((candidate) => candidate.name === field);
  return column === undefined ? null : `(${column.expression})`;
}

/** 自集約が他の集約を指す列の値の出どころ(作成は引数、それ以外は対象の行)。 */
function ownRefs(
  input: RpcFactsInput,
  entity: string,
  facts: RpcFactsBase,
): ReadonlyMap<string, string> {
  const refs = new Map<string, string>();
  for (const candidate of facts.params) {
    if (candidate.role.kind !== 'column' || candidate.role.field.type.kind !== 'ref') continue;
    if (input.shape === 'create') refs.set(candidate.role.field.name, candidate.name);
  }
  if (input.shape === 'create') {
    for (const column of facts.insertColumns) {
      if (refs.has(column.name)) continue;
      const field = findField(input.domain, entity, column.name);
      if (field?.type.kind === 'ref') refs.set(column.name, `(${column.expression})`);
    }
    return refs;
  }
  for (const field of findEntityFields(input.domain, entity) ?? []) {
    if (field.type.kind === 'ref') refs.set(field.name, `${TARGET_ALIAS}.${field.name}`);
  }
  return refs;
}
