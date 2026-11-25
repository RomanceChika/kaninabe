/**
 * 受信の RPC(記録と遷移を 1 トランザクションで起こす migration)の生成器。
 *
 * 見るのは「宣言から決まること」と「**記録と遷移が同じトランザクションに入ること**」である。
 * 後者が束 ⑲-2b-b で直した穴そのもの —— 記録だけが成功して遷移が落ちると、相手が再送しても
 * 記録済みの外部イベント ID が「反映済み」と判定されて no-op になり、その通知は永久に失われる。
 */

import { describe, expect, it } from 'vitest';
import { inboundRpcGenerator } from '../../../../lib/generate/render/code-inbound-rpc.js';
import { inboundRpcFunctions } from '../../../../lib/inbound/inbound-functions.js';
import { externalCatalog, integration } from '../../../helpers/external-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { aggregate, entitySpec, event, machine, specModel } from '../../../helpers/model-builder.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { IntegrationDecl } from '../../../../lib/model/external/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';

/** 記録の作成 RPC。 */
const INSERT_EVENT: DataFunctionDecl = {
  name: 'insert_billing_event',
  args: ['uuid', 'jsonb', 'uuid'],
  params: ['p_id', 'p_values', 'p_actor_id'],
  kind: 'rpc',
  shape: 'create',
  alsoWrites: ['domain_events'],
};

/** 遷移 RPC。 */
const APPLY_TRANSITION: DataFunctionDecl = {
  name: 'apply_invoice_transition',
  args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid'],
  params: ['p_invoice_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id'],
  kind: 'rpc',
  shape: 'transition',
  alsoWrites: ['jobs', 'domain_events'],
};

/** 受信の行 1 本。 */
function inbound(overrides: Partial<Omit<IntegrationDecl, 'id' | 'location'>> = {}): IntegrationDecl {
  return integration('billing_hook', {
    direction: 'inbound',
    effect: 'write',
    degrade: 'refuse',
    config: ['BILLING_WEBHOOK_SECRET'],
    signature: 'hmac_sha256',
    signatureKey: 'BILLING_WEBHOOK_SECRET',
    eventIdTable: 'table-billing_events',
    emits: 'invoice.settle',
    summary: '請求サービスの通知を受け取る',
    ...overrides,
  });
}

/** `invoice.settle`(`awaiting` → `settled`、副作用 1 件)を持つドメインモデル。 */
const MODEL = specModel([
  aggregate('invoice', {
    entity: entitySpec('invoice'),
    stateMachines: [
      machine('invoice', {
        states: ['awaiting', 'settled'],
        initial: 'awaiting',
        events: [event('settle', { from: ['awaiting'], to: 'settled', by: ['system'] })],
        effects: [{ on: 'settle', do: ['notify_settled'], location: { file: 'docs/specs/domain/invoice/states.md' } }],
      }),
    ],
  }),
  aggregate('billing_event', { entity: entitySpec('billing_event') }),
]);

/** 記録先と遷移先の表。 */
const TABLES = dataTableModel([
  dataTable('billing_events', {
    entity: 'billing_event',
    indexes: [{ name: 'billing_events_external_id_unique', on: ['external_id'], unique: true }],
    functions: [INSERT_EVENT],
  }),
  dataTable('invoices', { entity: 'invoice', functions: [APPLY_TRANSITION] }),
]);

/** 生成器へ渡す文脈。 */
function context(integrations: readonly IntegrationDecl[]): GenerateContext {
  return {
    roots: TEST_ROOTS,
    platform: TEST_PLATFORM, layout: TEST_LAYOUT,
    external: { available: true, catalog: externalCatalog(integrations) },
    dataTables: TABLES,
  } as unknown as GenerateContext;
}

/** 生成された migration(1 本)。 */
function sql(integrations: readonly IntegrationDecl[] = [inbound()]): string {
  const sections = inboundRpcGenerator.generate(MODEL, context(integrations));
  return sections[0]?.content ?? '';
}

describe('受信の RPC(記録と遷移を 1 トランザクションで)', () => {
  it('宣言された migration に 1 本だけ書き出す', () => {
    const sections = inboundRpcGenerator.generate(MODEL, context([inbound()]));

    expect(sections.map((section) => section.file)).toEqual([
      'supabase/migrations/20260912000001_inbound_billing_hook.sql',
    ]);
  });

  it('送信だけのカタログからは 1 本も生成しない', () => {
    expect(inboundRpcGenerator.generate(MODEL, context([integration('discord_webhook')]))).toEqual([]);
  });

  it('署名は 1 つの関数で、引数は外部イベント ID・実行者・本文の 3 本', () => {
    expect(sql()).toContain('create or replace function api.inbound_billing_hook(');
    expect(sql()).toContain('    p_event_id text,\n    p_actor_id uuid,\n    p_payload jsonb\n) returns jsonb');
    expect(sql()).toContain('security definer');
  });

  /** **束 ⑲-2b-b の止め。** 記録と遷移が同じ `begin … end` の中にあること。 */
  it('記録と遷移が 1 つのトランザクション(関数本体)の中で順に実行される', () => {
    const body = sql();
    const record = body.indexOf('api.insert_billing_event(');
    const transition = body.indexOf('api.apply_invoice_transition(');
    // 旧署名を落とす do ブロック(束 ⑳-3)が本文の前に並ぶので、関数の `end;` は**最後のもの**である。
    const end = body.lastIndexOf('\nend;');

    expect(record).toBeGreaterThan(0);
    expect(transition).toBeGreaterThan(record);
    expect(end).toBeGreaterThan(transition);
    // 関数の本体は 1 つ($$ が 2 つ)—— 途中で commit する経路は無い。
    expect(body.match(/\$\$/g)).toHaveLength(2);
    expect(body).not.toContain('commit');
  });

  it('記録は外部イベント ID を宣言された一意索引の列に載せる', () => {
    expect(sql()).toContain(
      "p_values => coalesce(p_payload -> 'record', '{}'::jsonb) || jsonb_build_object('external_id', p_event_id)",
    );
  });

  it('同じ外部イベント ID の再送は一意制約で duplicate になり、遷移を起こさない', () => {
    const body = sql();

    expect(body).toContain('when unique_violation then');
    expect(body).toContain("return jsonb_build_object('status', 'duplicate');");
    // duplicate の return は遷移の呼び出しより前にある(起こさずに閉じる)。
    expect(body.indexOf("'duplicate'")).toBeLessThan(body.indexOf('api.apply_invoice_transition('));
  });

  it('遷移の引数は宣言だけで決まる(前後の状態・副作用・イベント ID・対象の id)', () => {
    const body = sql();

    expect(body).toContain("p_invoice_id => (p_payload ->> 'target_id')::uuid");
    expect(body).toContain("p_expected_state => 'awaiting'");
    expect(body).toContain("p_next_state => 'settled'");
    expect(body).toContain("p_effects => array['notify_settled']::text[]");
    expect(body).toContain("p_event_id => 'invoice.settle'");
  });

  it('遷移が 0 行なら例外で全体を戻す(記録も残らない = 相手の再送で再試行される)', () => {
    const body = sql();

    expect(body).toContain('if not found then');
    expect(body).toContain("raise exception using errcode = 'UC409', message = 'usecase_conflict:invoice.settle';");
  });

  it('実行できたら applied を返し、service_role にだけ実行を許す', () => {
    expect(sql()).toContain("return jsonb_build_object('status', 'applied');");
    expect(sql()).toContain('revoke all on function api.inbound_billing_hook(text, uuid, jsonb) from public;');
    expect(sql()).toContain('grant execute on function api.inbound_billing_hook(text, uuid, jsonb) to service_role;');
  });

  it('関数の閉世界に記録先の表の持ち物として載る(実 DB との突合から見える)', () => {
    expect(inboundRpcFunctions({ roots: TEST_ROOTS, domain: MODEL, dataTables: TABLES, external: { available: true, catalog: externalCatalog([inbound()]) } })).toEqual([
      {
        table: 'billing_events',
        fn: {
          name: 'inbound_billing_hook',
          args: ['text', 'uuid', 'jsonb'],
          params: ['p_event_id', 'p_actor_id', 'p_payload'],
          kind: 'rpc',
          shape: 'composite',
          alsoWrites: ['domain_events', 'invoices', 'jobs'],
        },
      },
    ]);
  });
});
