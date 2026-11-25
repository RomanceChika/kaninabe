/**
 * external_spec の `sends.neutralize` / `neutralize_none` の読み取りの単体テスト。
 * 形(送る行は 1 通りを必ず宣言・語彙・重複・受信の行には書けない)だけを見る。部品の呼び出しの突合は X7。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseExternalCatalog } from '../../../../lib/model/external/parse-external.js';

const VOCABULARY = { service: [{ id: 'discord', adapter_root: 'infra/discord' }] };

const OUTBOUND: Record<string, unknown> = {
  id: 'hook',
  service: 'discord',
  direction: 'outbound',
  effect: 'read',
  port: 'DeliveryPort',
  adapter: 'infra/discord/hook.ts',
  config: ['DISCORD_URL'],
  degrade: 'not_configured',
  degrade_summary: '送らない',
  timeout_ms: 5000,
  retry: 'none',
  summary: '通知',
};

function parse(sends: Record<string, unknown> | undefined, over: Record<string, unknown> = {}) {
  const reporter = new SpecReporter('external.md');
  const row = { ...OUTBOUND, ...(sends === undefined ? {} : { sends }), ...over };
  return parseExternalCatalog({ doc_type: 'external_spec', scope: 'backend', id: 'external-catalog', vocabulary: VOCABULARY, integrations: [row] }, reporter);
}

describe('X0: sends.neutralize', () => {
  it('部品の並びを読む(語の順を保つ)', () => {
    const { value, findings } = parse({ text: 't', neutralize: ['discord_mentions', 'length:2000', 'control_chars'] });
    expect(findings).toEqual([]);
    expect(value?.integrations[0]?.sends.neutralize).toEqual({
      kind: 'apply',
      parts: [{ kind: 'discord_mentions' }, { kind: 'length', max: 2000 }, { kind: 'control_chars' }],
    });
  });

  it('neutralize_none を理由つきで読む', () => {
    const { value, findings } = parse({ text: 't', neutralize_none: '数字の ID だけを送る' });
    expect(findings).toEqual([]);
    expect(value?.integrations[0]?.sends.neutralize).toEqual({ kind: 'none', reason: '数字の ID だけを送る' });
  });

  const rejected: readonly (readonly [string, Record<string, unknown> | undefined, string])[] = [
    ['外へ送る行に宣言が無い', { text: 't' }, 'sends に neutralize がありません'],
    ['語彙の外', { text: 't', neutralize: ['html_escape'] }, 'html_escape は語彙の外です'],
    ['length:0', { text: 't', neutralize: ['length:0'] }, 'length:0 は語彙の外です'],
    ['length の数が天井を超える', { text: 't', neutralize: ['length:1000001'] }, '語彙の外です'],
    ['同じ部品の重複', { text: 't', neutralize: ['control_chars', 'control_chars'] }, 'control_chars が重複しています'],
    ['length の重複', { text: 't', neutralize: ['length:1', 'length:2'] }, 'length が重複しています'],
    ['空の並び', { text: 't', neutralize: [] }, 'neutralize'],
    ['neutralize と none の併記', { text: 't', neutralize: ['control_chars'], neutralize_none: 'r' }, '併記しています'],
    ['none の理由が空', { text: 't', neutralize_none: '  ' }, '理由が空です'],
  ];

  it.each(rejected)('弾く: %s', (_name, sends, message) => {
    const { value, findings } = parse(sends);
    expect(findings.some((finding) => finding.message.includes(message)), findings.map((finding) => finding.message).join(' / ')).toBe(true);
    expect(value?.integrations ?? []).toHaveLength(0);
  });

  it('受信の行に neutralize は書けない', () => {
    const inbound = {
      direction: 'inbound',
      signature: 'hmac_sha256',
      signature_key: 'WEBHOOK_SECRET',
      event_id_table: 'inbound_events',
      emits: 'hook.receive',
      migration: '20260912000001_inbound_hook.sql',
      on_conflict: 'retry',
      timeout_ms: undefined,
    };
    const { findings } = parse({ text: 't', neutralize: ['control_chars'] }, inbound);
    expect(findings.some((finding) => finding.message.includes('受信の行です'))).toBe(true);
  });

  it('受信の行は neutralize を書かなくてよい', () => {
    const inbound = {
      direction: 'inbound',
      signature: 'hmac_sha256',
      signature_key: 'WEBHOOK_SECRET',
      event_id_table: 'inbound_events',
      emits: 'hook.receive',
      migration: '20260912000001_inbound_hook.sql',
      on_conflict: 'retry',
      timeout_ms: undefined,
      config: ['WEBHOOK_SECRET'],
      idempotency_source: 'local_ledger',
      effect: 'write',
    };
    const { findings } = parse({ text: 't' }, inbound);
    expect(findings.filter((finding) => finding.message.includes('neutralize'))).toEqual([]);
  });
});
