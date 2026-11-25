/**
 * X5(受け取る側の軸の接地)のユニットテスト。
 *
 * 規約網羅(external-spec-writing.md §direction: inbound):
 *   - `event_id_table` が実在する data_table を指し、単一列の一意索引を**ちょうど 1 本**持つこと
 *     (冪等の実体であり、生成される RPC がその列に外部イベント ID を載せる)
 *   - 記録と遷移の RPC が実在し、引数が宣言だけで決まること(1 トランザクションに写せること)
 *   - `emits` が実在するイベントで、`by` に system を含み、`from` が 1 つでガードが無いこと
 *   - 署名を検証する行は `degrade: refuse` であること(鍵が無ければ口を閉じる)
 *   - `signature_key` が `config` に並んでいること(鍵は位置ではなく名前で決まる)
 *   - `migration` が全連携で一意であること
 *   - 送信の行(`direction: outbound`)には何も掛からないこと
 *
 * **action_spec は要求しない**(`by` が system だけのイベントは Server Action の入口を持たない)。
 */

import { describe, expect, it } from 'vitest';
import { inboundGroundingGaps, verifyInboundGrounding } from '../../../../lib/external/verifiers/x5-inbound-grounding.js';
import { externalCatalog, integration, type IntegrationOpts } from '../../../helpers/external-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { aggregate, entitySpec, event, machine, specModel } from '../../../helpers/model-builder.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';
import type { DataIndexDecl } from '../../../../lib/model/data/types-shape.js';
import type { IntegrationDecl } from '../../../../lib/model/external/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** 受け取る側の行 1 本(既定は健全な宣言)。 */
function inbound(opts: IntegrationOpts = {}): IntegrationDecl {
  return integration('billing_hook', {
    direction: 'inbound',
    effect: 'write',
    degrade: 'refuse',
    config: ['BILLING_WEBHOOK_SECRET'],
    signature: 'hmac_sha256',
    signatureKey: 'BILLING_WEBHOOK_SECRET',
    eventIdTable: 'table-billing_events',
    emits: 'invoice.settle',
    ...opts,
  });
}

/** `invoice.settle` を `by: [system]` で持つドメインモデル。 */
function domain(opts: { by?: readonly string[]; from?: readonly string[]; guard?: string } = {}) {
  const settle = event('settle', {
    from: opts.from ?? ['awaiting'],
    to: 'settled',
    by: opts.by ?? ['system'],
    ...(opts.guard === undefined ? {} : { guard: opts.guard }),
  });
  const invoice = machine('invoice', {
    states: ['awaiting', 'settled', 'void'],
    initial: 'awaiting',
    events: [settle],
  });
  return specModel([
    aggregate('invoice', { entity: entitySpec('invoice'), stateMachines: [invoice] }),
    aggregate('billing_event', { entity: entitySpec('billing_event') }),
  ]);
}

/** 記録の作成 RPC(引数は採番した id・本文の欄・実行者の 3 本)。 */
const INSERT_EVENT: DataFunctionDecl = {
  name: 'insert_billing_event',
  args: ['uuid', 'jsonb', 'uuid'],
  params: ['p_id', 'p_values', 'p_actor_id'],
  kind: 'rpc',
  shape: 'create',
  alsoWrites: [],
};

/** 遷移 RPC(引数は宣言だけで決まる 6 本)。 */
const APPLY_TRANSITION: DataFunctionDecl = {
  name: 'apply_invoice_transition',
  args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid'],
  params: ['p_invoice_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id'],
  kind: 'rpc',
  shape: 'transition',
  alsoWrites: [],
};

/** 外部イベント ID の一意索引 1 本。 */
const UNIQUE: DataIndexDecl = { name: 'billing_events_external_id_unique', on: ['external_id'], unique: true };

/** 記録先と遷移先の表(既定は健全)。 */
function tables(opts: { indexes?: readonly DataIndexDecl[]; recordFn?: readonly DataFunctionDecl[] } = {}) {
  return dataTableModel([
    dataTable('billing_events', {
      entity: 'billing_event',
      indexes: opts.indexes ?? [UNIQUE],
      functions: opts.recordFn ?? [INSERT_EVENT],
    }),
    dataTable('invoices', { entity: 'invoice', functions: [APPLY_TRANSITION] }),
  ]);
}

/** 既定の入力で X5 を実行する。 */
function run(args: {
  integration?: IntegrationDecl;
  integrations?: readonly IntegrationDecl[];
  by?: readonly string[];
  from?: readonly string[];
  guard?: string;
  indexes?: readonly DataIndexDecl[];
  recordFn?: readonly DataFunctionDecl[];
}): readonly string[] {
  return verifyInboundGrounding({ roots: TEST_ROOTS,
    domain: domain({
      ...(args.by === undefined ? {} : { by: args.by }),
      ...(args.from === undefined ? {} : { from: args.from }),
      ...(args.guard === undefined ? {} : { guard: args.guard }),
    }),
    catalog: externalCatalog(args.integrations ?? [args.integration ?? inbound()]),
    dataTables: loadedInput(
      tables({
        ...(args.indexes === undefined ? {} : { indexes: args.indexes }),
        ...(args.recordFn === undefined ? {} : { recordFn: args.recordFn }),
      }),
    ),
  }).map((finding) => finding.message);
}

describe('X5: 受け取る側の軸の接地', () => {
  it('軸が実在の宣言に接地していれば違反なし', () => {
    expect(run({})).toEqual([]);
  });

  it('送信の行には何も掛からない', () => {
    expect(run({ integration: integration('discord_webhook') })).toEqual([]);
  });

  it('event_id_table が実在しなければエラー', () => {
    const messages = run({ integration: inbound({ eventIdTable: 'table-nowhere' }) });

    expect(messages.some((message) => message.includes('table-nowhere'))).toBe(true);
  });

  it('event_id_table に単一列の一意索引が無ければエラー(冪等の実体が無い)', () => {
    const messages = run({ indexes: [{ name: 'billing_events_external_id_idx', on: ['external_id'], unique: false }] });

    expect(messages.some((message) => message.includes('単一列の一意索引が 0 本です'))).toBe(true);
  });

  it('単一列の一意索引が 2 本あればエラー(どの列に載せるか決まらない)', () => {
    const messages = run({
      indexes: [UNIQUE, { name: 'billing_events_number_unique', on: ['number'], unique: true }],
    });

    expect(messages.some((message) => message.includes('単一列の一意索引が 2 本です'))).toBe(true);
  });

  it('記録の作成 RPC が無ければエラー(記録を `permit` の外の書き込みにしない)', () => {
    expect(run({ recordFn: [] }).some((message) => message.includes('insert_billing_event'))).toBe(true);
  });

  it('記録の作成 RPC が余分な引数を要求すればエラー(渡す値が決まらない)', () => {
    const messages = run({
      recordFn: [{ ...INSERT_EVENT, args: [...INSERT_EVENT.args, 'uuid'], params: [...INSERT_EVENT.params, 'p_store_id'] }],
    });

    expect(messages.some((message) => message.includes('p_store_id に渡す値が決まりません'))).toBe(true);
  });

  it('emits が実在しなければエラー', () => {
    const messages = run({ integration: inbound({ emits: 'invoice.nope' }) });

    expect(messages.some((message) => message.includes('ドメインイベントがありません'))).toBe(true);
  });

  it('emits 先の by に system が無ければエラー(外の誰かに人の操作を実行させない)', () => {
    expect(run({ by: ['member'] }).some((message) => message.includes('by に system がありません'))).toBe(true);
  });

  it('emits 先の from が 2 つ以上ならエラー(受信口は状態を読まずに実行する)', () => {
    expect(run({ from: ['awaiting', 'void'] }).some((message) => message.includes('from が 2 個です'))).toBe(true);
  });

  it('emits 先にガード式があればエラー(受信口はガードを評価できない)', () => {
    expect(run({ guard: 'now < deadline' }).some((message) => message.includes('ガード式があります'))).toBe(true);
  });

  it('署名を検証するのに degrade が refuse でなければエラー(鍵が無いときに素通ししない)', () => {
    const messages = run({
      integration: inbound({ degrade: 'not_configured', degradeSummary: '縮退する' }),
    });

    expect(messages.some((message) => message.includes('degrade: not_configured です'))).toBe(true);
  });

  it('signature: none は degrade を問わない(検証しないと宣言している)', () => {
    const messages = run({
      integration: integration('billing_hook', {
        direction: 'inbound',
        effect: 'write',
        config: ['BILLING_WEBHOOK_SECRET'],
        signature: 'none',
        signatureReason: '社内ネットワークからしか届かない',
        eventIdTable: 'table-billing_events',
        emits: 'invoice.settle',
        degrade: 'not_configured',
        degradeSummary: '縮退する',
      }),
    });

    expect(messages).toEqual([]);
  });

  it('signature_key が config に並んでいなければエラー(常に 401 になる口を verify 緑で作らない)', () => {
    const messages = run({ integration: inbound({ signatureKey: 'OTHER_SECRET' }) });

    expect(messages.some((message) => message.includes('config に並んでいません'))).toBe(true);
  });

  it('migration が重複していればエラー(2 本の受信が同じファイルを取り合わない)', () => {
    const messages = run({
      integrations: [
        inbound(),
        integration('billing_hook_2', {
          direction: 'inbound',
          effect: 'write',
          degrade: 'refuse',
          config: ['BILLING_WEBHOOK_SECRET'],
          signature: 'hmac_sha256',
          signatureKey: 'BILLING_WEBHOOK_SECRET',
          eventIdTable: 'table-billing_events',
          emits: 'invoice.settle',
          migration: '20260912000001_inbound_billing_hook.sql',
        }),
      ],
    });

    expect(messages.some((message) => message.includes('と重複しています'))).toBe(true);
  });
});

describe('X5(a): テーブル仕様の入力の状態(未選択も阻害も判定を出さず、受信の連携を名指して言う)', () => {
  const input = (dataTables: Parameters<typeof verifyInboundGrounding>[0]['dataTables'], integrations: readonly IntegrationDecl[] = [inbound()]) => ({
    roots: TEST_ROOTS,
    domain: domain({ by: ['member'] }),
    catalog: externalCatalog(integrations),
    dataTables,
  });
  const planFindings = (findings: readonly { message: string }[]) => findings.filter((finding) => !finding.message.includes('by に'));

  it('使えない入力(未選択・阻害)では (a) の判定を出さず、受信の連携を名指す。(b)〜(e) は従来どおり出る', () => {
    for (const [state, expectedGap] of [
      [UNSELECTED, { input: 'data_tables', state: 'unselected' }],
      [blockedInput<never>('missing'), { input: 'data_tables', state: 'blocked', reason: 'missing' }],
    ] as const) {
      const findings = verifyInboundGrounding(input(state));

      expect(planFindings(findings)).toEqual([]); // 「event_id_table が実在しません」などを導かない
      expect(findings.some((finding) => finding.message.includes('by に'))).toBe(true); // (b) は表に依らない
      expect(inboundGroundingGaps(input(state))).toEqual([
        { gap: expectedGap, consequence: expect.stringContaining('1 つの RPC に接地'), subjects: ['billing_hook'] },
      ]);
    }
  });

  it('読込済みなら記録は空(0 件の表でも判定する側に回る)', () => {
    expect(inboundGroundingGaps(input(loadedInput(tables())))).toEqual([]);
    expect(inboundGroundingGaps(input(loadedInput(dataTableModel([]))))).toEqual([]);
    expect(verifyInboundGrounding(input(loadedInput(dataTableModel([])))).length).toBeGreaterThan(0);
  });

  it('受信の連携が無ければ、使えない入力でも記録は空(見ていないものが無い)。送信の行は対象にならない', () => {
    expect(inboundGroundingGaps(input(UNSELECTED, []))).toEqual([]);
    expect(inboundGroundingGaps(input(UNSELECTED, [integration('discord_webhook')]))).toEqual([]);
  });

  it('対象は受信の連携の ID(複数あれば宣言順)', () => {
    const second = integration('payment_hook', { direction: 'inbound', effect: 'write', degrade: 'refuse', emits: 'invoice.settle' });

    expect(inboundGroundingGaps(input(UNSELECTED, [inbound(), second]))[0]?.subjects).toEqual(['billing_hook', 'payment_hook']);
  });
});
