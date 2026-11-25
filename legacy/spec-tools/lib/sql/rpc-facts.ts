/**
 * 定型 RPC の本文が要る**事実**を、仕様から 1 か所に集める。
 *
 * 集めるのは 6 つ —— 引数の役目 / 入れる列 / 書き換えてよい列 / 条件にする集約 /
 * 監査ログの語彙 / 効果の門である。どれも既にある導出(実行計画・access_spec・entity_spec・
 * data_table)の**引き当て**であり、ここが新しい判断をすることは無い。
 *
 * 純関数であり throw しない(前提が破れたら理由つきの `RpcBodyProblem`)。
 *
 * @oversize 超える理由: 事実の束の型(`RpcBodyFacts`)・集める入力の型・組み立ての手順が、同じ型の契約を共有する。
 * @split-review 割る案と結果: 列の写像は `rpc-columns.ts`、遷移の列は `rpc-transition-columns.ts`、掴む行は `rpc-guard-locks.ts` と
 *   `rpc-closure-locks.ts` に割ってある。残る束の型と組み立ては、割ると同じ型を 2 つのファイルで読み合わせることになるので 1 本のままにした。
 */

import type { DataTableSpec } from '../model/data/types.js';
import type { FieldDef, SpecModel } from '../model/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import { findEntityFields } from '../semantics/domain-index.js';
import { actorEntity, stateFieldOf } from '../usecase/param-source-facts.js';
import { TARGET_ALIAS, buildGuardRows, changedValue, type GuardRow } from './rpc-parts.js';
import type { GuardLockRow } from './rpc-guard-locks.js';
import { closureLockRows, type ClosureLockRow } from './rpc-closure-locks.js';
import { erasedRefusalsOf, frozenOwnersOf, type ErasedRefusal, type FrozenOwner } from './rpc-erased-refusal.js';
import type { RpcBodyProblem, RpcParam } from './rpc-params.js';
import { classifyRpcParams } from './rpc-params.js';
import { transitionTargetOf } from './rpc-transition-machine.js';
import { insertColumns, updateColumns, valueFields, writeColumns } from './rpc-columns.js';
import { transitionColumns } from './rpc-transition-columns.js';
import type { AuthzPredicates } from './rpc-authz.js';
import { authzOf } from './rpc-authz-build.js';
import { columnType } from './sql-types.js';
import type { ResendPolicy } from '../usecase/resend-policy.js';
import { resendOf } from './rpc-resend.js';
import type { ActorBinding } from './rpc-actor-binding.js';
import { actorBindingOf } from './rpc-actor-binding.js';

/** 作成が入れる 1 列。 */
export interface InsertColumn {
  readonly name: string;
  /** insert 文に書く式。 */
  readonly expression: string;
  /** 1 欄ずつ受ける引数から来たか(`p_values` 由来ではない)。 */
  readonly fromParam: boolean;
  /** 実行者そのものが入る列か(監査ログには二度書かない)。 */
  readonly actor: boolean;
}

/** 遷移が状態のほかに書く 1 列。 */
export interface TransitionColumn {
  readonly name: string;
  readonly expression: string;
  /** 書き込みの前に引数を縛る代入文(`records_actor` の列だけ。rpc-transition-columns.ts)。 */
  readonly bind?: string;
}

/** 本文の組み立てに要る事実の束。 */
export interface RpcBodyFacts {
  readonly fn: string;
  readonly table: string;
  readonly entity: string;
  readonly params: readonly RpcParam[];
  readonly guardRows: readonly GuardRow[];
  /**
   * ガード式が読む親集約の行(書き込みの前に共有ロックで掴む相手)。
   * `guardRows`(楽観的並行制御の join)とは別の経路であり、重なる分は掴む側が畳む。
   */
  readonly guardLockRows: readonly GuardLockRow[];
  /** 書き込みがトリガと外部キーの連鎖を通して掴む行(`rpc-closure-locks.ts`。点検 18 回目 O18-1)。全 data_table を渡さない呼び手では空。 */
  readonly closureLockRows: readonly ClosureLockRow[];
  /** 消去された行への紐づけの関所(`rpc-erased-refusal.ts`。点検 19 回目 A19-4)。 */
  readonly erasedRefusals: readonly ErasedRefusal[];
  /** 消去済みを指したままの行の個人列の凍結(`rpc-erased-refusal.ts`。点検 20 回目 A20-1。編集・遷移が自表の個人列を書くときだけ)。 */
  readonly frozenOwners: readonly FrozenOwner[];
  /** 書き込む対象の行の id を与える式(作成では使わない)。 */
  readonly targetId: string;
  /** 楽観的並行制御に使う自分の状態列(無ければ null)。 */
  readonly expectedSelf: string | null;
  /** 遷移が動かす状態列。 */
  readonly stateColumn: string;
  /** 監査ログに刻むドメインイベント ID(遷移は引数で受けるので空文字)。 */
  readonly eventId: string;
  /** 実行者を受け取るか。 */
  readonly hasActor: boolean;
  /**
   * 実行者の集約の物理テーブル名(スキーマ修飾なし。引けなければ null)。
   *
   * **ロールの根拠はこの行にある**(`claim` の欄・既定のログインロールの実在)。0 行の理由を
   * 聞き直す文は書き込みとは別の snapshot でこの行を読むので、書き込みの前に掴む相手である。
   */
  readonly actorTable: string | null;
  readonly insertColumns: readonly InsertColumn[];
  readonly transitionColumns: readonly TransitionColumn[];
  /**
   * 編集が**変更集合とは別に**書く列(`p_{列}` の引数。値は `computes` の純関数が決める)。
   *
   * 遷移の `transitionColumns` と同じ形であり、違うのは形(`shape`)だけである。
   */
  readonly updateColumns: readonly TransitionColumn[];
  /** 作成の `p_values` が運ぶ欄。 */
  readonly valueFields: readonly FieldDef[];
  /** 書き換えてよい列(access_spec の writes の和。entity_spec の宣言順)。 */
  readonly writeColumns: readonly FieldDef[];
  /** 効果を積む門になる列(writes[].effects を宣言した規則の列)。 */
  readonly effectColumns: readonly FieldDef[];
  /** DB が決める列(`supplied_by: db`)。 */
  readonly dbSuppliedColumns: readonly FieldDef[];
  /**
   * `by`(ロール)とガードの述語(束 ⑳-3)。書き込みの `where` に積み、0 行の理由を分類する。
   */
  readonly authz: AuthzPredicates;
  /** 実行者のロール配列の引数を受け取るか。 */
  readonly hasActorRoles: boolean;
  /** 作成の冪等な再送の方針(作成以外は null。表の `resend` から。引けなければ事実が集まらず T6 が名指す)。 */
  readonly resend: ResendPolicy | null;
  /** 再送の入力の比べ方(作成が入力から入れる列と式。`rpc-resend.ts` の `resendComparedColumns`。作成以外は空)。 */
  readonly resendCompared: readonly { readonly name: string; readonly expression: string }[];
  /** 作成の規則ごとの実行者の縛り(`rpc-actor-binding.ts`。作成以外・縛る欄が無いなら null)。 */
  readonly actorBinding: ActorBinding | null;
  readonly isPersonal: (column: string) => boolean;
  readonly personalIn: (columns: readonly string[]) => readonly string[];
  readonly columnType: (field: FieldDef) => string;
}

/** 述語・再送の方針・実行者への縛りより前に決まる事実(それらを導く材料)。 */
export type RpcFactsBase = Omit<RpcBodyFacts, 'authz' | 'guardLockRows' | 'resend' | 'resendCompared' | 'actorBinding'>;

/** 事実を集めた結果。 */
export type RpcBodyFactsResult =
  | { readonly ok: true; readonly facts: RpcBodyFacts }
  | { readonly ok: false; readonly problems: readonly RpcBodyProblem[] };

/** 事実を集めるのに要る入力。 */
export interface RpcFactsInput {
  readonly name: string;
  readonly params: readonly string[];
  readonly args: readonly string[];
  readonly shape: 'create' | 'update' | 'delete' | 'transition';
  readonly table: DataTableSpec;
  readonly domain: SpecModel;
  /** 集約名 → 物理テーブル名。 */
  readonly tableOf: (entity: string) => string | null;
  /** action_spec(作成が受け取る入力欄と、実行者そのものが入る列の判定に使う)。 */
  readonly actions: ActionSpecModel | undefined;
  /** 全 data_table(`closureLockRows` を引く)。本文を書き出す生成器は必ず渡す。可否だけを見る T6 / T14 は省いてよい(掴む行は可否を変えない)。 */
  readonly tables?: readonly DataTableSpec[];
}

/**
 * 1 本の定型 RPC について、本文に要る事実を集める。
 *
 * @param input 関数の宣言・表・ドメイン仕様・呼ぶ操作
 * @returns 事実の束、または理由つきの失敗
 */
export function collectRpcFacts(input: RpcFactsInput): RpcBodyFactsResult {
  const entity = input.table.entity;
  if (entity === undefined) {
    return {
      ok: false,
      problems: [
        {
          message: `${input.name} の表 ${input.table.table} は entity を持ちません`,
          suggestion: '内部テーブル(internal: true)の関数は定型に乗らない。shape: composite を宣言する',
          counterexample: { function: input.name, table: input.table.table },
        },
      ],
    };
  }
  const state = stateFieldFor(input, entity);
  if (!state.ok) return { ok: false, problems: [state.problem] };
  const stateField = state.field;
  const classified = classifyRpcParams(input.params, input.args, {
    fn: input.name,
    entity,
    domain: input.domain,
    stateField,
  });
  if (!classified.ok) return classified;
  const params = classified.params;
  const targetId = input.shape === 'create' ? 'p_id' : `p_${entity}_id`;
  const guards = buildGuardRows(
    params
      .filter((param) => param.role.kind === 'expected_other')
      .map((param) => ({
        entity: param.role.kind === 'expected_other' ? param.role.entity : '',
        column: param.role.kind === 'expected_other' ? param.role.column : '',
        param: param.name,
      })),
    {
      fn: input.name,
      entity,
      domain: input.domain,
      tableOf: input.tableOf,
      ownRefs: ownRefs(input, params, entity),
    },
  );
  if (!guards.ok) return guards;
  const base = factsOf(input, entity, params, guards.rows, targetId, stateField, eventIdOf(input, entity));
  const resend = resendOf(input, base);
  if (!resend.ok) return resend;
  const binding = actorBindingOf(input, entity, base);
  if (!binding.ok) return binding;
  const facts = { ...base, resend: resend.policy, resendCompared: resend.compared, actorBinding: binding.binding };
  const authz = authzOf(input, entity, facts);
  if (!authz.ok) return authz;
  return {
    ok: true,
    facts: { ...facts, authz: authz.predicates, guardLockRows: authz.guardLockRows },
  };
}

/** 事実の束を組み立てる(判断はここまでで終わっており、ここは詰め替えだけ)。 */
function factsOf(
  input: RpcFactsInput,
  entity: string,
  params: readonly RpcParam[],
  guardRows: readonly GuardRow[],
  targetId: string,
  stateField: FieldDef | null,
  eventId: string,
): RpcFactsBase {
  const fields = findEntityFields(input.domain, entity) ?? [];
  const personal = new Set(fields.filter((field) => field.personal || field.bearer !== undefined).map((field) => field.name)); // 監査ログに値を載せない欄(個人の欄と bearer の欄)
  const writes = writeColumns(input, entity, fields);
  const closure = closureContext(input, entity, params, stateField, writes.all);
  const expectedSelf = params.find((param) => param.role.kind === 'expected_self');
  return {
    fn: input.name,
    table: input.table.table,
    entity,
    params,
    guardRows,
    targetId,
    expectedSelf: expectedSelf?.role.kind === 'expected_self' ? expectedSelf.role.column : null,
    stateColumn: stateField?.name ?? '',
    eventId,
    closureLockRows: input.tables === undefined ? [] : closureLockRows({ ...input, tables: input.tables, targetId, ...closure }),
    erasedRefusals: erasedRefusalsOf(input.table, params, closure.writtenColumns ?? closure.insertedColumns),
    // 凍結は指したままの行(既にある行)だけ —— 作成の新しい行の紐づけは上の紐づけの関所が見る。
    frozenOwners: frozenOwnersOf(input.table, (closure.writtenColumns ?? []).filter((column) => fields.some((field) => field.name === column && field.personal))),
    hasActor: params.some((param) => param.role.kind === 'actor'),
    actorTable: actorTableOf(input),
    hasActorRoles: params.some((param) => param.role.kind === 'actor_roles'),
    insertColumns: insertColumns(input, entity, params),
    transitionColumns: transitionColumns(input, entity, params),
    updateColumns: updateColumns(input, params),
    valueFields: valueFields(input, entity, params),
    writeColumns: writes.all,
    effectColumns: writes.gated,
    dbSuppliedColumns: fields.filter((field) => field.suppliedBy === 'db'),
    isPersonal: (column) => personal.has(column),
    personalIn: (columns) => columns.filter((column) => personal.has(column)),
    columnType: (field) => columnType(field.type),
  };
}

/** 掴みの宣言の引き当てに要る、自表への書き込みの列(遷移・編集)と作成が入れる式。 */
function closureContext(
  input: RpcFactsInput,
  entity: string,
  params: readonly RpcParam[],
  stateField: FieldDef | null,
  writes: readonly FieldDef[],
): {
  readonly writtenColumns: readonly string[] | null;
  readonly insertedColumns: readonly string[];
  readonly insertExpression: (column: string) => string | null;
  readonly updateExpression: (column: string) => string | null;
} {
  const inserted = input.shape === 'create' ? insertColumns(input, entity, params) : [];
  const computed = input.shape === 'update' ? updateColumns(input, params) : [];
  const written =
    input.shape === 'transition'
      ? [...(stateField === null ? [] : [stateField.name]), ...transitionColumns(input, entity, params).map((column) => column.name)]
      : input.shape === 'update'
        ? [...writes.map((field) => field.name), ...updateColumns(input, params).map((column) => column.name)]
        : null;
  return {
    writtenColumns: written,
    insertedColumns: inserted.filter((entry) => entry.fromParam).map((entry) => entry.name),
    insertExpression: (column) => inserted.find((entry) => entry.name === column)?.expression ?? null,
    // 編集が列に入れる値(本文の代入と同じ字面。書き換えた参照の欄が指す親を先に掴む。fix25s)。
    updateExpression: (column) => {
      const byParam = computed.find((entry) => entry.name === column)?.expression;
      const field = writes.find((candidate) => candidate.name === column);
      return field !== undefined ? changedValue(field, byParam ?? `${TARGET_ALIAS}.${column}`) : (byParam ?? null);
    },
  };
}

/**
 * 作成 RPC が `p_values` から入れる列(本文の生成と**同じ写像**から引く)。
 *
 * 列の既定値の突合を**双方向**にするための母集合である —— 「宣言した既定値が DB にあるか」
 * だけでなく、「DB に既定値があるのに宣言が無い列を `p_values` から素で入れていないか」を
 * 統合テストが見られるようにする(宣言を書き忘れた列は本文から `coalesce` が消え、鍵の無い
 * 日に NULL が入る。束 ⑳-2 の独立レビュー 1-D)。
 *
 * @param input 関数の宣言・表・ドメイン仕様(`shape: create` のもの)
 * @returns 列名の並び。本文が組み立てられない宣言では空(その手当ては T6 の仕事)
 */
export function rpcValueColumns(input: RpcFactsInput): readonly string[] {
  const collected = collectRpcFacts(input);
  return collected.ok ? collected.facts.valueFields.map((field) => field.name) : [];
}

/** 実行者の集約の物理テーブル名(引けなければ null)。 */
function actorTableOf(input: RpcFactsInput): string | null {
  const entity = actorEntity(input.domain);
  return entity === null ? null : input.tableOf(entity);
}

/**
 * その RPC が見る自分の状態列。
 *
 * - **遷移**は関数名の機械の列(`transitionTargetOf`)。名前・集約・列から 1 つに決まらなければ理由つきで失敗する
 *   (別の機械や `state` という名前の列に倒さない)。
 * - **それ以外**(作成・編集・削除)は引数名の規約どおり —— `p_expected_state` は名前が `state` の状態列を指す
 *   (`usecase/param-source-facts.ts` の `stateFieldOf`。呼ぶ側の供給元と同じ 1 本)。無ければ null で、
 *   `p_expected_state` を受け取る宣言は `classifyRpcParams` が名指して落とす。
 */
function stateFieldFor(
  input: RpcFactsInput,
  entity: string,
): { readonly ok: true; readonly field: FieldDef | null } | { readonly ok: false; readonly problem: RpcBodyProblem } {
  if (input.shape !== 'transition') return { ok: true, field: stateFieldOf(input.domain, entity) };
  const resolved = transitionTargetOf(input.name, entity, input.domain);
  return resolved.ok ? { ok: true, field: resolved.target.field } : resolved;
}

/** 自分の側から他の集約を指す列の、値の出どころ(作成は引数・それ以外は対象の行)。 */
function ownRefs(input: RpcFactsInput, params: readonly RpcParam[], entity: string): ReadonlyMap<string, string> {
  const refs = new Map<string, string>();
  if (input.shape === 'create') {
    for (const param of params) {
      if (param.role.kind !== 'column' || param.role.field.type.kind !== 'ref') continue;
      refs.set(param.role.field.name, param.name);
    }
    return refs;
  }
  for (const field of findEntityFields(input.domain, entity) ?? []) {
    if (field.type.kind === 'ref') refs.set(field.name, `t.${field.name}`);
  }
  return refs;
}

/**
 * 監査ログに刻むイベント ID(遷移は引数で受けるので空文字)。
 *
 * 作成・編集・削除は**予約 ID**(`{entity}.{create|update|delete}`)であり、action_spec の
 * 有無に依らず決まる(action-spec-writing.md §予約 ID)——RPC が保存点や受信の中からしか
 * 呼ばれない場合でも、刻む語は同じである。
 */
function eventIdOf(input: RpcFactsInput, entity: string): string {
  return input.shape === 'transition' ? '' : `${entity}.${input.shape}`;
}
