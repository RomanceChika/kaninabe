/**
 * 受信の行(`direction: inbound`)を「**1 トランザクションで実行する 2 手順**」に接地させる純粋関数。
 *
 * 受信 Webhook の並びは連携によらず同じである —— 外部イベント ID を冪等に**記録**し、写像された
 * ドメインイベントへ**遷移**する。ADR-0011 §4「保存点の内側は全部か無しか」がそのまま当てはまる
 * ので、2 つは 1 つの RPC の中で起こす(束 ⑲-2b-b)。
 *
 * **記録だけが成功して遷移が落ちると、その通知は永久に失われる。** 相手が再送しても、記録済みの
 * 外部イベント ID が「反映済み」と判定されて no-op になるからである。記録と遷移が同じ
 * トランザクションにあれば、遷移が落ちたときに記録も戻る = 相手の再送でそのまま再試行される。
 *
 * 接地(どの RPC を・どんな引数名で呼ぶか)だけをここで行い、SQL の字面は
 * generate/render/code-inbound-rpc.ts が、宣言の妥当性は X5 が、同じこの関数を通して見る
 * (検査と生成が同じ導出を共有する。step-plan.ts / param-source.ts と同じ構え)。
 *
 * **アプリの語彙は 1 語も持たない。** 関数名は server-actions.md「5 形の定型」の命名規約から
 * 組み立て、実在は data_table の `functions` に問い合わせる。
 *
 * **受信の 2 手順の引数 1 本ごとの供給元**(`recordCall` ・`transitionCall`)も同じファイルにある。
 * ここが受信の RPC を生成する唯一の知識であり、値域である。宣言された引数名から渡す式が
 * 決まらなければ、決まらない名前を反例に載せて止める(実行時に推測しない。同じ問いを X5 が
 * 先に立てている)。表名・列名・状態名はすべて引数で渡る。
 *
 * @oversize 超える理由: 受信の行を「記録と遷移の 2 手順」に接地する導出は 1 本の写像で、手順の組み立てと
 *   引数の供給元を決める値域が同じ結果の型(`InboundCall`)を共有する。検査 X5 と生成が同じこの
 *   導出を通して見るので、入口を 1 つにしてある。
 * @split-review 割る案と結果: 手順の接地(`planInbound`)と、引数の供給元を決める側(`recordCall` ・`transitionCall` ・
 *   `systemRolesExpression`。以前の `inbound-plan-args.ts`)に割る案を検討した(以前はそう割っていた)。供給元の
 *   側は `planInbound` の 2 手順の組み立てからだけ呼ばれ、ほかのファイルは直接読まない(外から読まれる
 *   `INBOUND_PARAMS` などは本体側にある)。一方向の依存で使い手が 1 人なので、手順と引数を 1 枚で追える形に
 *   した。保存点側の接地(`step-plan.ts`)は別の導出で、RPC 名の引き当て(`step-plan-rpc.ts`)だけを借りる。
 */

import { sqlStringLiteral } from '../kernel/safe-text.js';
import type { EventDef, SpecModel, StateMachineSpec, RoleDef } from '../model/types.js';
import type { DataFunctionDecl, DataTableSpec, DataTableSpecModel } from '../model/data/types.js';
import { findStepRpc, rpcNameCandidates, effectsOf } from '../usecase/step-plan-rpc.js';
import type { PlanProblem } from '../usecase/step-plan.js';
import { entityNameOfAggregate } from '../semantics/domain-index.js';
import { tableOf } from '../semantics/query-window-columns.js';
import { groundOperation } from '../semantics/operation-ground.js';
import type { InboundIntegrationDecl } from '../model/external/types.js';
import { specPath } from '../model/product/paths.js';
import type { ProductRoots } from '../model/product/types.js';
import { impliedRoles, systemRoleId } from '../model/role-hierarchy.js';

/** 受信の RPC の固定の引数名(どの連携でも同じ形)。 */
export const INBOUND_PARAMS: readonly string[] = ['p_event_id', 'p_actor_id', 'p_payload'];

/** 受信の RPC の固定の引数型(`INBOUND_PARAMS` と同じ順)。 */
export const INBOUND_ARGS: readonly string[] = ['text', 'uuid', 'jsonb'];

/** 受信の RPC の名前(`inbound_{連携 id}`)。 */
export function inboundRpcName(integration: string): string {
  return `inbound_${integration}`;
}

/** 呼ぶ RPC 1 本と、その引数に渡す SQL の式(宣言順)。 */
export interface InboundCall {
  /** 呼ぶ RPC の宣言(data_table の `functions`)。 */
  readonly fn: DataFunctionDecl;
  /** 結果を受ける行変数の型になる表。 */
  readonly table: string;
  /** 引数名 → 渡す式(宣言順)。 */
  readonly args: readonly InboundArg[];
}

/** 受信 1 本を「記録 → 遷移」の 2 手順に接地させた結果。 */
export interface InboundPlan {
  readonly integration: InboundIntegrationDecl;
  /** 生成する RPC の名前(`api.{name}`)。 */
  readonly rpcName: string;
  /** 外部イベント ID を載せる列(`event_id_table` の単一列の一意索引)。 */
  readonly eventIdColumn: string;
  /** ① 記録(外部イベント ID の表への作成)。 */
  readonly record: InboundCall;
  /** ② 遷移(`emits` のドメインイベント)。 */
  readonly transition: InboundCall;
  /** 遷移が起こされる前の状態(`from` はちょうど 1 つ)。 */
  readonly expectedState: string;
  /** 遷移先(`to`)。 */
  readonly nextState: string;
}

/** 接地の結果。1 つでも決まらなければ理由を返し、部分的な計画は返さない。 */
export type InboundPlanResult =
  | { readonly ok: true; readonly plan: InboundPlan }
  | { readonly ok: false; readonly problems: readonly PlanProblem[] };

/** 接地に要る入力。 */
export interface InboundPlanInput {
  readonly domain: SpecModel;
  readonly dataTables: DataTableSpecModel | undefined;
  /** 製品が宣言した根(道案内のパスを組み立てる)。 */
  readonly roots: ProductRoots;
}

/**
 * 受信の行 1 本を接地させる。
 *
 * @param integration 受信の連携(`direction: inbound`)
 * @param input ドメイン仕様と data_table
 * @returns 接地できた計画、または理由つきの失敗
 */
export function planInbound(integration: InboundIntegrationDecl, input: InboundPlanInput): InboundPlanResult {
  const problems: PlanProblem[] = [];
  const table = recordTable(integration, input.dataTables, problems, input.roots);
  const target = transitionTarget(integration, input.domain, problems);
  if (table === null || target === null) return { ok: false, problems };

  const column = eventIdColumnOf(integration, table, problems);
  // 表が集約に属さない(`entity` を持たない)ときは作成 RPC の名前が導けない。命名規約の
  // 候補が空になるので、下の `missingRpc` が「その名前の RPC がありません」で止める。
  const recordEntity = table.entity ?? '';
  const recordFn = findStepRpc(input.dataTables, 'create', recordEntity, null, input.domain);
  if (recordFn === null) problems.push(missingRpc(integration, 'create', recordEntity, null, table.table, input.domain));
  const targetEntity = entityNameOfAggregate(input.domain, target.aggregate);
  const targetTable = tableOf(input.domain, targetEntity);
  const transitionFn = findStepRpc(input.dataTables, 'transition', targetEntity, target.machine.machine, input.domain);
  if (transitionFn === null) {
    problems.push(missingRpc(integration, 'transition', targetEntity, target.machine.machine, targetTable, input.domain));
  }
  const expectedState = singleFromState(integration, target.event, problems);
  problems.push(...guardFree(integration, target.event));
  if (column === null || recordFn === null || transitionFn === null || expectedState === null) {
    return { ok: false, problems };
  }

  const roles = input.domain.roles.roles;
  const record = recordCall(integration, recordFn, table.table, column, roles, problems);
  const transition = transitionCall(integration, transitionFn, targetEntity, target, expectedState, roles, problems);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    plan: {
      integration,
      rpcName: inboundRpcName(integration.id),
      eventIdColumn: column,
      record: { fn: recordFn, table: table.table, args: record },
      transition: { fn: transitionFn, table: targetTable, args: transition },
      expectedState,
      nextState: target.event.to,
    },
  };
}

/** `event_id_table` が指す data_table。 */
function recordTable(
  integration: InboundIntegrationDecl,
  dataTables: DataTableSpecModel | undefined,
  problems: PlanProblem[],
  roots: ProductRoots,
): DataTableSpec | null {
  const id = integration.eventIdTable;
  const table = dataTables?.tables.find((spec) => spec.id === id);
  if (table !== undefined) return table;
  problems.push({
    message: `連携 ${integration.id} の event_id_table ${id} に対応する data_table がありません`,
    suggestion:
      `${specPath(roots, 'backend/data/tables/{表}.md')} の id(例: table-webhook_events)を書く。` +
      '受信した外部イベント ID を残す表が無いなら、まずその表を宣言する',
    counterexample: { integration: integration.id, event_id_table: id },
  });
  return null;
}

/** 外部イベント ID を載せる列(単一列の一意索引が**ちょうど 1 本**であること)。 */
function eventIdColumnOf(integration: InboundIntegrationDecl, table: DataTableSpec, problems: PlanProblem[]): string | null {
  const unique = table.indexes.filter((index) => index.unique && index.on.length === 1);
  const only = unique.length === 1 ? unique[0]?.on[0] : undefined;
  if (only !== undefined) return only;
  problems.push({
    message:
      `連携 ${integration.id} の event_id_table ${table.id} の単一列の一意索引が ` +
      `${unique.length} 本です(ちょうど 1 本であること)`,
    suggestion:
      `${table.table} の indexes に "- name: {表}_{列}_unique / on: [{外部イベント ID の列}] / unique: true" を` +
      'ちょうど 1 本置く。同じ通知を 2 度反映しないことの実体はこの一意制約であり、' +
      '生成される受信の RPC がその列に外部イベント ID を載せるので、どの列かが 1 意に決まっていなければならない',
    counterexample: {
      integration: integration.id,
      table: table.table,
      unique_indexes: unique.map((index) => index.name).join(', ') || '(なし)',
    },
  });
  return null;
}

/** `emits` が指す遷移(状態機械とイベント)。 */
function transitionTarget(
  integration: InboundIntegrationDecl,
  domain: SpecModel,
  problems: PlanProblem[],
): { readonly aggregate: string; readonly machine: StateMachineSpec; readonly event: EventDef } | null {
  const emits = integration.emits;
  const grounding = groundOperation(domain, emits);
  if (grounding.kind === 'transition') {
    return { aggregate: grounding.entry.aggregate, machine: grounding.entry.machine, event: grounding.entry.event };
  }
  problems.push({
    message: `連携 ${integration.id} の emits ${emits} に対応するドメインイベントがありません`,
    suggestion: 'states.md の state_machine とイベント ID を {machine}.{event} で書く(綴りを確認する)',
    counterexample: { integration: integration.id, emits },
  });
  return null;
}

/**
 * 遷移の条件になる `from`(ちょうど 1 つであること)。
 *
 * 受信口は**判断材料を読まない** —— 人のセッションが無く、読んでから実行するまでの間に相手の
 * 次の通知が入りうるからである。したがって「その行がどの状態なら実行してよいか」は宣言された
 * `from` そのものであり、それが複数あると RPC の `p_expected_state`(1 つの値)に写せない。
 */
function singleFromState(integration: InboundIntegrationDecl, event: EventDef, problems: PlanProblem[]): string | null {
  const only = event.from.length === 1 ? event.from[0] : undefined;
  if (only !== undefined) return only;
  problems.push({
    message: `連携 ${integration.id} が emits する ${integration.emits} の from が ${event.from.length} 個です`,
    suggestion:
      'from がちょうど 1 つのイベントを emits に書く(受信口は状態を読まずに実行するので、' +
      '「どの状態なら実行してよいか」は宣言された from そのものになる)。' +
      '複数の状態から起こせる必要があるなら、状態ごとにイベントを分ける',
    counterexample: { integration: integration.id, emits: integration.emits, from: event.from.join(', ') },
  });
  return null;
}

/**
 * ガード式を持たないこと。
 *
 * ガードは判断材料(読んだ事実・時刻・実行者)を要求する式であり、受信口はそのどれも持たない
 * (人のセッションが無く、状態も読まずに実行する)。ガード付きのイベントを受信から起こせる形にすると、
 * **宣言された条件を誰も評価しないまま**書き込みが通ることになる。
 */
function guardFree(integration: InboundIntegrationDecl, event: EventDef): readonly PlanProblem[] {
  if (event.guard === undefined) return [];
  return [
    {
      message: `連携 ${integration.id} が emits する ${integration.emits} にガード式があります`,
      suggestion:
        'ガードの無いイベントを emits に書く(受信口は判断材料を読まないので、ガード式を評価できない)。' +
        '条件が要るなら from の状態で表すか、人の入口から実行する操作にする',
      counterexample: { integration: integration.id, emits: integration.emits, guard: event.guard },
    },
  ];
}

/** 命名規約の候補が data_table の functions に無い。 */
function missingRpc(
  integration: InboundIntegrationDecl,
  kind: 'create' | 'transition',
  entity: string,
  machine: string | null,
  table: string,
  domain: SpecModel,
): PlanProblem {
  const names = rpcNameCandidates(kind, entity, machine, domain);
  return {
    message: `連携 ${integration.id} が呼ぶはずの RPC ${names.join(' / ')} が data_table の functions にありません`,
    suggestion:
      `${table}.md の functions に "- name: ${names[0] ?? ''}" を kind: rpc として宣言する` +
      '(名前は server-actions.md「5 形の定型」の命名規約から導かれる)',
    counterexample: { integration: integration.id, function: names.join(' / ') },
  };
}

/** 引数 1 本と、そこに渡す SQL の式。 */
export interface InboundArg {
  readonly name: string;
  readonly expression: string;
}

/** 記録の RPC に渡せる引数名(ここに無い引数を要求する作成 RPC は受信から呼べない)。 */
const RECORD_PARAMS: readonly string[] = ['p_id', 'p_values', 'p_actor_id', 'p_actor_roles'];

/**
 * 受信口が渡すロール配列(`p_actor_roles`。束 ⑳-3)。
 *
 * 受信は**システム起点**である —— 人のセッションが無いので、実行器が解決する余地が無い。
 * 渡すのは `kind: system` のロール 1 つと、その `implies` の推移閉包(`p_actor_roles` の
 * 契約。`roles-to-sql.ts`)。宣言が無ければ空配列にする —— 誰も通らないのが正しい既定である。
 *
 * @param roles role_spec の全ロール定義
 * @returns `array[...]::text[]` の字面
 */
function systemRolesExpression(roles: readonly RoleDef[]): string {
  const id = systemRoleId(roles);
  if (id === undefined) return 'array[]::text[]';
  const closed = [id, ...impliedRoles(roles, id)];
  return `array[${closed.map(sqlLiteral).join(', ')}]::text[]`;
}

/**
 * ① 記録の引数(宣言順)。
 *
 * @param integration 受信の連携
 * @param fn 記録先の作成 RPC の宣言
 * @param table 記録先の表(反例と対処の文面に出す)
 * @param column 外部イベント ID を載せる列
 * @param problems 決まらなかった引数を積む先
 * @returns 引数名 → 渡す式(宣言順)
 */
function recordCall(
  integration: InboundIntegrationDecl,
  fn: DataFunctionDecl,
  table: string,
  column: string,
  roles: readonly RoleDef[],
  problems: PlanProblem[],
): readonly InboundArg[] {
  const values =
    `coalesce(p_payload -> 'record', '{}'::jsonb) || jsonb_build_object(${sqlLiteral(column)}, p_event_id)`;
  const byName: Readonly<Record<string, string>> = {
    p_id: 'gen_random_uuid()',
    p_values: values,
    p_actor_id: 'p_actor_id',
    p_actor_roles: systemRolesExpression(roles),
  };
  return resolve(integration, fn, byName, problems, {
    suggestion:
      `${table}.md の ${fn.name} の引数を ${RECORD_PARAMS.join(' / ')} だけにする` +
      '(受信の記録に渡せる値は「採番した id・本文が運ぶ欄・実行者」の 3 つだけである)',
  });
}

/**
 * ② 遷移の引数(宣言順)。
 *
 * @param integration 受信の連携
 * @param fn 遷移 RPC の宣言
 * @param entity 遷移の対象の集約のエンティティ名
 * @param target 状態機械とイベント
 * @param expectedState 実行してよい状態(宣言された `from`)
 * @param problems 決まらなかった引数を積む先
 * @returns 引数名 → 渡す式(宣言順)
 */
function transitionCall(
  integration: InboundIntegrationDecl,
  fn: DataFunctionDecl,
  entity: string,
  target: { readonly machine: StateMachineSpec; readonly event: EventDef },
  expectedState: string,
  roles: readonly RoleDef[],
  problems: PlanProblem[],
): readonly InboundArg[] {
  const effects = effectsOf(target.machine, target.event);
  const targetId = "(p_payload ->> 'target_id')::uuid";
  const byName: Readonly<Record<string, string>> = {
    [`p_${entity}_id`]: targetId,
    [`p_${target.machine.machine}_id`]: targetId,
    p_expected_state: sqlLiteral(expectedState),
    p_next_state: sqlLiteral(target.event.to),
    p_effects: effects.length === 0 ? 'array[]::text[]' : `array[${effects.map(sqlLiteral).join(', ')}]::text[]`,
    p_event_id: sqlLiteral(integration.emits),
    p_actor_id: 'p_actor_id',
    p_actor_roles: systemRolesExpression(roles),
  };
  return resolve(integration, fn, byName, problems, {
    suggestion:
      '受信口から実行できるのは、引数が宣言だけで決まる遷移に限る(対象の id・前後の状態・副作用・' +
      'イベント ID・実行者)。入力の欄を要求する遷移は人の入口から起こす形にする',
  });
}

/** 宣言された引数名を式に写す(1 本でも決まらなければ理由を積む)。 */
function resolve(
  integration: InboundIntegrationDecl,
  fn: DataFunctionDecl,
  byName: Readonly<Record<string, string>>,
  problems: PlanProblem[],
  hint: { readonly suggestion: string },
): readonly InboundArg[] {
  const args: InboundArg[] = [];
  for (const name of fn.params) {
    const expression = byName[name];
    if (expression === undefined) {
      problems.push({
        message: `連携 ${integration.id} が呼ぶ ${fn.name} の引数 ${name} に渡す値が決まりません`,
        suggestion: hint.suggestion,
        counterexample: { integration: integration.id, function: fn.name, param: name },
      });
      continue;
    }
    args.push({ name, expression });
  }
  return args;
}

/** SQL の文字列リテラル(単引用符のエスケープ込み)。 */
function sqlLiteral(value: string): string {
  return sqlStringLiteral(value);
}
