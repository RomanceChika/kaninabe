/**
 * external_spec の有料の口の軸(`spend` / `abuse`)の読み取りの単体テスト。
 *
 * 読み込みが閉じるのは形だけ(値域・知らないキー・型・範囲・source と max の排他)。揃っているか・書いてよい行かは R5-7 / R5-8 の仕事。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseExternalCatalog } from '../../../../lib/model/external/parse-external.js';
import { MAX_INBOUND_BODY_BYTES } from '../../../../lib/model/external/types.js';

const VOCABULARY = { service: [{ id: 'anthropic', adapter_root: 'infra/anthropic' }] };

/** 健全な有料の口の行(読み取り専用の送信)。 */
const ROW: Record<string, unknown> = {
  id: 'chat',
  service: 'anthropic',
  direction: 'outbound',
  effect: 'read',
  port: 'ChatPort',
  adapter: 'infra/anthropic/chat.ts',
  config: ['ANTHROPIC_API_KEY'],
  degrade: 'not_configured',
  degrade_summary: '画面に出さない',
  timeout_ms: 60000,
  retry: 'none',
  sends: { text: '質問文', neutralize: ['control_chars'] },
  summary: 'AI チャット',
  endpoints: ['/api/ai/tutorial'],
  spend: 'paid',
  abuse: { max_body_bytes: { '/api/ai/tutorial': 262144 }, quota: { source: 'AI_LIMIT', per: '1 day', key: 'actor' } },
};

/** 行を 1 つだけ上書きしたカタログを読む。 */
function parse(over: Record<string, unknown>) {
  const reporter = new SpecReporter('external.md');
  const data = { doc_type: 'external_spec', scope: 'backend', id: 'external-catalog', vocabulary: VOCABULARY, integrations: [{ ...ROW, ...over }] };
  return parseExternalCatalog(data, reporter);
}

describe('X0: spend / abuse(有料の口)', () => {
  it('正例: spend: paid と abuse(口ごとの上限 + 枠)を読める', () => {
    const { value, findings } = parse({});

    expect(findings).toEqual([]);
    expect(value?.integrations[0]).toMatchObject({
      spend: 'paid',
      abuse: { maxBodyBytes: { '/api/ai/tutorial': 262144 }, quota: { source: 'AI_LIMIT', per: '1 day', key: 'actor' } },
    });
  });

  it('正例: 枠の数をリテラル(max)で書ける。key: global も読める', () => {
    const { value, findings } = parse({ abuse: { max_body_bytes: {}, quota: { max: 20, per: '2 hours', key: 'global' } } });

    expect(findings).toEqual([]);
    expect(value?.integrations[0]?.abuse?.quota).toEqual({ max: 20, per: '2 hours', key: 'global' });
  });

  it('spend も abuse も無い行は持たない(ruling 6: 要求しない)', () => {
    const { value, findings } = parse({ spend: undefined, abuse: undefined });

    expect(findings).toEqual([]);
    expect(value?.integrations[0]?.spend).toBeUndefined();
    expect(value?.integrations[0]?.abuse).toBeUndefined();
  });

  it('abuse は空の写像でも読める(揃っていないことは R5-7 が言う)', () => {
    const { value, findings } = parse({ abuse: {} });

    expect(findings).toEqual([]);
    expect(value?.integrations[0]?.abuse).toMatchObject({ maxBodyBytes: {} });
    expect(value?.integrations[0]?.abuse?.quota).toBeUndefined();
  });

  it('受信の行・口の無い行にも書ける形のまま持つ(効かない宣言は R5-8 が言う)', () => {
    const { value, findings } = parse({ endpoints: undefined });

    expect(findings).toEqual([]);
    expect(value?.integrations[0]?.spend).toBe('paid');
  });

  // 負例の表: [題, 上書き, 指摘に載る断片]
  const BAD: readonly (readonly [string, Record<string, unknown>, string])[] = [
    ['spend が値域外', { spend: 'free' }, 'は値域(paid)にありません'],
    ['spend が文字列でない', { spend: 3 }, 'spend'],
    ['abuse が写像でない', { abuse: ['x'] }, 'abuse は写像で書きます'],
    ['max_body_bytes が写像でない', { abuse: { max_body_bytes: 100 } }, 'abuse.max_body_bytes は写像で書きます'],
    ['本文の上限が 0', { abuse: { max_body_bytes: { '/a': 0 } } }, '1 以上'],
    ['本文の上限が小数', { abuse: { max_body_bytes: { '/a': 1.5 } } }, '整数ではありません'],
    ['本文の上限が天井超え', { abuse: { max_body_bytes: { '/a': MAX_INBOUND_BODY_BYTES + 1 } } }, `${MAX_INBOUND_BODY_BYTES} 以下`],
    ['本文の上限が文字列', { abuse: { max_body_bytes: { '/a': '1000' } } }, '整数ではありません'],
    ['quota が写像でない', { abuse: { quota: 20 } }, 'abuse.quota は写像で書きます'],
    ['quota に source も max も無い', { abuse: { quota: { per: '1 day', key: 'actor' } } }, 'ちょうど 1 つが要ります'],
    ['quota に source と max の両方', { abuse: { quota: { source: 'X', max: 1, per: '1 day', key: 'actor' } } }, 'ちょうど 1 つが要ります'],
    ['quota.max が 0', { abuse: { quota: { max: 0, per: '1 day', key: 'actor' } } }, '1 以上の整数ではありません'],
    ['quota.max が小数', { abuse: { quota: { max: 2.5, per: '1 day', key: 'actor' } } }, '1 以上の整数ではありません'],
    ['quota.per が無い', { abuse: { quota: { source: 'X', key: 'actor' } } }, 'per'],
    ['quota.per が期間の形でない', { abuse: { quota: { source: 'X', per: 'daily', key: 'actor' } } }, '期間の幅の形ではありません'],
    ['quota.per が単位違い', { abuse: { quota: { source: 'X', per: '1 week', key: 'actor' } } }, '期間の幅の形ではありません'],
    ['quota.key が無い', { abuse: { quota: { source: 'X', per: '1 day' } } }, 'key'],
    ['quota.key が値域外', { abuse: { quota: { source: 'X', per: '1 day', key: 'ip' } } }, 'は値域(actor / global)にありません'],
  ];

  it.each(BAD)('負例: %s → 読み込みで落とす', (_title, over, fragment) => {
    const { value, findings } = parse(over);

    expect(findings.some((finding) => finding.severity === 'error' && `${finding.message} ${finding.suggestion}`.includes(fragment))).toBe(true);
    expect(value?.integrations).toEqual([]);
  });

  it('負例: 知らないキー(abuse・quota)は error で報告する(行は他の違反が無ければ残るが、verify は赤)', () => {
    const topLevel = parse({ abuse: { max_body_bytes: {}, burst: 1 } });
    const nested = parse({ abuse: { quota: { source: 'X', per: '1 day', key: 'actor', burst: 1 } } });

    expect(topLevel.findings.some((finding) => finding.severity === 'error' && finding.suggestion.includes('書けるのは max_body_bytes / quota だけ'))).toBe(true);
    expect(nested.findings.some((finding) => finding.severity === 'error' && finding.suggestion.includes('書けるのは source / max / per / key だけ'))).toBe(true);
  });
});

describe('X0: meter / authz(有料の口の枠を消費する RPC と認可)', () => {
  it('正例: meter(RPC の名前)と authz(kind: role + 役)を読める', () => {
    const { value, findings } = parse({ meter: 'consume_ai_quota', authz: { kind: 'role', role: 'member' } });

    expect(findings).toEqual([]);
    expect(value?.integrations[0]).toMatchObject({ meter: 'consume_ai_quota', authz: { kind: 'role', role: 'member' } });
  });

  it('正例: authz.kind: public は(役なしで)読める形のまま持つ —— 有料の口に書けないことは R5-9 が名指しで言う', () => {
    const { value, findings } = parse({ authz: { kind: 'public' } });

    expect(findings).toEqual([]);
    expect(value?.integrations[0]?.authz).toMatchObject({ kind: 'public' });
    expect(value?.integrations[0]?.authz?.role).toBeUndefined();
  });

  it('meter も authz も書かない行は持たない(要求しない)', () => {
    const { value, findings } = parse({});

    expect(findings).toEqual([]);
    expect(value?.integrations[0]?.meter).toBeUndefined();
    expect(value?.integrations[0]?.authz).toBeUndefined();
  });

  // 負例の表: [題, 上書き, 指摘に載る断片]
  const BAD: readonly (readonly [string, Record<string, unknown>, string])[] = [
    ['meter が文字列でない', { meter: 3 }, 'meter'],
    ['meter がスネークケースでない', { meter: 'Consume-Quota' }, 'RPC の名前(スネークケース)ではありません'],
    ['authz が写像でない', { authz: 'member' }, 'authz は写像で書きます'],
    ['authz に kind が無い', { authz: { role: 'member' } }, 'kind'],
    ['authz.kind が値域外', { authz: { kind: 'secret' } }, 'は値域(role / public)にありません'],
    ['authz.kind: role に role が無い', { authz: { kind: 'role' } }, 'role'],
    ['authz.kind: public に role', { authz: { kind: 'public', role: 'member' } }, 'kind: public に role を書けません'],
    ['authz.role が役の ID の綴りでない', { authz: { kind: 'role', role: 'Member Role' } }, '役の ID(スネークケース)ではありません'],
    ['authz に知らないキー', { authz: { kind: 'role', role: 'member', also: 'x' } }, '書けるのは kind / role だけ'],
  ];

  it.each(BAD)('負例: %s → 読み込みで落とす', (_title, over, fragment) => {
    const { findings } = parse(over);

    expect(findings.some((finding) => finding.severity === 'error' && `${finding.message} ${finding.suggestion}`.includes(fragment))).toBe(true);
  });
});
