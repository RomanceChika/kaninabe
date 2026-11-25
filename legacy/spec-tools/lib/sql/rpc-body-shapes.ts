/**
 * 定型 RPC の**形ごとの本文**(`begin … end` の中身)。
 *
 * 5 形のうち composite 以外の 4 つ ——作成 / 編集 / 削除 / 遷移—— は、宣言から本文まで決まる。
 * 何がどこから来るかは `RpcBodyFacts` に集めてあり、ここはその写像だけを持つ
 * (骨格と署名は `rpc-body.ts`、共通の断片は `rpc-parts.ts`)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef } from '../model/types.js';
import { RPC_BODY_WORDS } from '../messages/messages.js';
import { sqlLiteral } from './guard-to-sql.js';
import type { EndSessionsWiring } from './rpc-end-sessions.js';
import type { RpcBodyFacts } from './rpc-facts.js';
import { AUDIT_TABLE, TARGET_ALIAS, changedValue, effectsLoop, redactedPayload } from './rpc-parts.js';
import { clockCapture, clockDeclares, guardFrom, lockGuardRows } from './rpc-body-lock.js';
import {
  authzConditions,
  createRefusalBlock,
  createResendBeforeInsert,
  refusalBlock,
  refusalDeclares,
} from './rpc-body-refusal.js';
import { createPayload } from './rpc-body-payload.js';
import { erasedChecks, frozenDeclares } from './rpc-erased-refusal.js';

/** 本文 1 つ分(declare の行と begin…end の中身)。 */
export interface RpcBodyBlock {
  readonly declares: readonly string[];
  readonly statements: readonly string[];
}

/** 作成の本文。 */
export function createBlock(facts: RpcBodyFacts): RpcBodyBlock {
  const columns = facts.insertColumns;
  const occ = guardExists(facts);
  const conditions = [...(occ === null ? [] : [occ.join('\n')]), ...authzConditions(facts)];
  const rows = [
    `    insert into public.${facts.table} (`,
    `        ${columns.map((column) => column.name).join(', ')}`,
    '    )',
    '    select',
    columns.map((column) => `        ${column.expression}`).join(',\n'),
    `    where ${conditions.join('\n      and ')}`,
    '    on conflict (id) do nothing',
    '    returning * into v_row;',
  ];
  return {
    declares: [`    v_row public.${facts.table};`, ...clockDeclares(facts)],
    statements: [
      ...lockGuardRows(facts, false, true),
      ...clockCapture(facts),
      ...createResendBeforeInsert(facts),
      rows.join('\n'),
      '',
      ...createRefusalBlock(facts, occ === null ? [] : [occ.join('\n        ')]),
      '',
      ...erasedChecks(facts, sqlLiteral(facts.eventId)),
      auditInsert(facts, 'v_row.id', createPayload(facts)),
      '',
      '    return next v_row;',
    ],
  };
}

/** 作成の楽観的並行制御の `exists (…)`(条件にする集約が 1 つも無ければ null)。 */
function guardExists(facts: RpcBodyFacts): readonly string[] | null {
  if (facts.guardRows.length === 0) return null;
  const conditions = facts.guardRows.flatMap((row) => [...row.anchors, ...(row.state === null ? [] : [row.state])]);
  return [
    'exists (',
    '        select 1',
    `        from ${facts.guardRows.map((row) => `public.${row.table} ${row.alias}`).join(', ')}`,
    `        where ${conditions.join('\n          and ')}`,
    '    )',
  ];
}

/** 編集の本文。 */
export function updateBlock(facts: RpcBodyFacts): RpcBodyBlock {
  const columns = facts.writeColumns;
  const gate = facts.effectColumns;
  // 1 欄ずつ受ける引数(`computes` が決める列)。鍵が送られなかったときの既定になる ——
  // 変更集合の経路は残したまま、その下に敷く(`rpc-columns.ts` の updateColumns の注)。
  const byParam = new Map(facts.updateColumns.map((column) => [column.name, column.expression]));
  const assignments = [
    ...columns.map(
      (field) => `        ${field.name} = ${changedValue(field, byParam.get(field.name) ?? `${TARGET_ALIAS}.${field.name}`)}`,
    ),
    ...facts.updateColumns
      .filter((column) => !columns.some((field) => field.name === column.name))
      .map((column) => `        ${column.name} = ${column.expression}`),
  ];
  return {
    declares: [
      `    v_row public.${facts.table};`,
      '    v_unknown text;',
      ...gate.map((field) => `    v_before_${field.name} ${facts.columnType(field)};`),
      '    v_effect text;',
      '    v_job_id uuid;',
      ...refusalDeclares(facts),
      ...clockDeclares(facts),
      ...frozenDeclares(facts.frozenOwners, facts.table),
    ],
    statements: [
      `    if p_changes is null or p_changes = '{}'::jsonb then`,
      `        raise exception '%: %', ${sqlLiteral(facts.fn)}, ${sqlLiteral(RPC_BODY_WORDS.noChanges)};`,
      '    end if;',
      '',
      "    select string_agg(key, ', ' order by key) into v_unknown",
      '    from jsonb_object_keys(p_changes) as key',
      `    where key not in (${columns.map((field) => sqlLiteral(field.name)).join(', ')});`,
      '',
      '    if v_unknown is not null then',
      `        raise exception '%: %(%)', ${sqlLiteral(facts.fn)}, ${sqlLiteral(RPC_BODY_WORDS.unknownColumn)}, v_unknown;`,
      '    end if;',
      ...(gate.length === 0 ? [] : ['', beforeRead(facts, gate)]),
      '',
      ...lockGuardRows(facts, true),
      ...clockCapture(facts),
      [
        `    update public.${facts.table} ${TARGET_ALIAS}`,
        '    set',
        assignments.join(',\n'),
        ...fromAndWhere(facts, 'from'),
        `    returning ${TARGET_ALIAS}.* into v_row;`,
      ].join('\n'),
      '',
      ...refusalBlock(facts, refusalStateConditions(facts), guardFrom(facts)),
      '',
      ...erasedChecks(facts, sqlLiteral(facts.eventId)),
      auditInsert(facts, facts.targetId, redactedPayload('p_changes', facts.personalIn(columns.map((field) => field.name)))),
      '',
      ...effectsWithGate(facts, gate),
      '',
      '    return next v_row;',
    ],
  };
}

/** 効果の門に使う列の、書き込み直前の値を読む。 */
function beforeRead(facts: RpcBodyFacts, gate: readonly FieldDef[]): string {
  return [
    `    -- ${RPC_BODY_WORDS.effectGateRead}`,
    `    select ${gate.map((field) => field.name).join(', ')}`,
    `        into ${gate.map((field) => `v_before_${field.name}`).join(', ')}`,
    `    from public.${facts.table} where id = ${facts.targetId};`,
  ].join('\n');
}

/** 効果を積むループ(宣言された列が実際に変わったときだけ、という門が要ればそれで包む)。 */
function effectsWithGate(facts: RpcBodyFacts, gate: readonly FieldDef[]): readonly string[] {
  const loop = effectsLoop(facts.entity, facts.targetId, gate.length === 0 ? '    ' : '        ');
  if (gate.length === 0) return [loop];
  const conditions = gate.map((field) => `v_before_${field.name} is distinct from v_row.${field.name}`);
  return [
    `    -- ${RPC_BODY_WORDS.effectGate}`,
    `    if ${conditions.join('\n        or ')}`,
    '    then',
    loop,
    '    end if;',
  ];
}

/** 削除の本文。 */
export function deleteBlock(facts: RpcBodyFacts): RpcBodyBlock {
  return {
    declares: [`    v_row public.${facts.table};`, ...refusalDeclares(facts), ...clockDeclares(facts)],
    statements: [
      ...lockGuardRows(facts, true),
      ...clockCapture(facts),
      [
        `    delete from public.${facts.table} ${TARGET_ALIAS}`,
        ...fromAndWhere(facts, 'using'),
        `    returning ${TARGET_ALIAS}.* into v_row;`,
      ].join('\n'),
      '',
      ...refusalBlock(facts, refusalStateConditions(facts), guardFrom(facts)),
      '',
      auditInsert(facts, facts.targetId, null),
      '',
      '    return next v_row;',
    ],
  };
}

/** `records_actor` の列の引数を、書き込みの前にイベントで縛る文(無ければ空)。 */
function actorBinds(facts: RpcBodyFacts): readonly string[] {
  const binds = facts.transitionColumns.flatMap((column) => (column.bind === undefined ? [] : [`    ${column.bind};`]));
  return binds.length === 0 ? [] : [`    -- ${RPC_BODY_WORDS.actorBind}`, ...binds, ''];
}

/** 遷移の本文。 */
export function transitionBlock(facts: RpcBodyFacts, endSessions?: EndSessionsWiring): RpcBodyBlock {
  const assignments = [
    `        ${facts.stateColumn} = p_next_state`,
    ...facts.transitionColumns.map((column) => `        ${column.name} = ${column.expression}`),
  ];
  return {
    declares: [`    v_row public.${facts.table};`, '    v_effect text;', '    v_job_id uuid;', ...refusalDeclares(facts), ...clockDeclares(facts), ...frozenDeclares(facts.frozenOwners, facts.table)],
    statements: [
      ...lockGuardRows(facts, true),
      ...clockCapture(facts),
      ...actorBinds(facts),
      [
        `    update public.${facts.table} ${TARGET_ALIAS}`,
        '    set',
        assignments.join(',\n'),
        ...fromAndWhere(facts, 'from'),
        `    returning ${TARGET_ALIAS}.* into v_row;`,
      ].join('\n'),
      '',
      ...refusalBlock(facts, refusalStateConditions(facts), guardFrom(facts)),
      '',
      ...erasedChecks(facts, 'p_event_id'),
      [
        `    insert into public.${AUDIT_TABLE} (event_id, entity, entity_id, actor_id, from_state, to_state)`,
        '    values (',
        `        p_event_id, ${sqlLiteral(facts.entity)}, ${facts.targetId}, p_actor_id, p_expected_state, p_next_state`,
        '    );',
      ].join('\n'),
      '',
      ...endSessionsCall(facts, endSessions),
      effectsLoop(facts.entity, facts.targetId, '    '),
      '',
      '    return next v_row;',
    ],
  };
}

/**
 * セッションを終える呼び出し(ジョブカタログの `ends_sessions`)。効果を載せたイベントで遷移が確定したときだけ、
 * 遷移と同じトランザクションの中で呼ぶ(遷移の更新が 0 行なら、上の拒否の分岐で例外になりここへ来ない)。
 * 認証基盤の綴りは呼び先の本文に閉じる。
 */
function endSessionsCall(facts: RpcBodyFacts, wiring: EndSessionsWiring | undefined): readonly string[] {
  if (wiring === undefined || wiring.events.length === 0) return [];
  return [
    `    -- ${RPC_BODY_WORDS.endSessions}`,
    `    if p_event_id in (${wiring.events.map(sqlLiteral).join(', ')}) then`,
    `        perform ${wiring.schema}.${wiring.call}(${facts.targetId});`,
    '    end if;',
    '',
  ];
}

/**
 * 対象の行を定める `from` / `using` と `where`(編集・削除・遷移で共通)。
 *
 * `where` には 2 種類が並ぶ —— **判断時の前提**(対象の id・自分の状態・条件にする集約の状態)と、
 * **規則そのもの**(`by` のロール・状態の組・ガード。束 ⑳-3)である。前者が崩れたら競合、
 * 後者が崩れたら権限違反かガード違反であり、0 行になったときの分類はこの区別で行う。
 */
function fromAndWhere(facts: RpcBodyFacts, keyword: 'from' | 'using'): readonly string[] {
  const conditions = [...stateConditions(facts), ...authzConditions(facts)];
  return [
    ...(facts.guardRows.length === 0 ? [] : [`    ${keyword} ${guardFrom(facts).join(', ')}`]),
    `    where ${conditions.join('\n      and ')}`,
  ];
}

/**
 * 0 行の理由が「状態違い」かを見るときの条件。
 *
 * 判断時の前提(`stateConditions`)に加えて、**宣言された状態の組か**(遷移の `from` → `to`)も
 * 見る —— 宣言に無い組で実行されたのはガード違反ではなく状態違いである。
 */
function refusalStateConditions(facts: RpcBodyFacts): readonly string[] {
  const state = facts.authz.state;
  return [...stateConditions(facts), ...(state === 'true' ? [] : [state])];
}

/** 判断時の前提にあたる条件(対象の id・自分の状態・条件にする集約の状態)。 */
function stateConditions(facts: RpcBodyFacts): readonly string[] {
  return [
    `${TARGET_ALIAS}.id = ${facts.targetId}`,
    ...(facts.expectedSelf === null ? [] : [`${TARGET_ALIAS}.${facts.expectedSelf} = p_expected_state`]),
    ...facts.guardRows.flatMap((row) => [...row.anchors, ...(row.state === null ? [] : [row.state])]),
  ];
}

/** 監査ログの 1 文(payload を持たない形と持つ形)。 */
function auditInsert(facts: RpcBodyFacts, idExpression: string, payload: string | null): string {
  const columns = ['event_id', 'entity', 'entity_id', ...(facts.hasActor ? ['actor_id'] : [])];
  const values = [sqlLiteral(facts.eventId), sqlLiteral(facts.entity), idExpression, ...(facts.hasActor ? ['p_actor_id'] : [])];
  if (payload === null) {
    return [
      `    insert into public.${AUDIT_TABLE} (${columns.join(', ')})`,
      `    values (${values.join(', ')});`,
    ].join('\n');
  }
  return [
    `    insert into public.${AUDIT_TABLE} (${[...columns, 'payload'].join(', ')})`,
    '    values (',
    `        ${values.join(', ')},`,
    `        ${payload}`,
    '    );',
  ].join('\n');
}
