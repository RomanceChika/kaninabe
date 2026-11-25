/**
 * X0(外部連携カタログのスキーマ適合 + 語彙の閉世界 + 条件付き必須の対応)のユニットテスト。
 *
 * 規約網羅(external-spec-writing.md §共通形式・§1 行が宣言すること・§検証):
 *   - 正しいカタログが読めること
 *   - id が external-catalog 固定であること
 *   - 連携 ID がスネークケースであること・重複しないこと
 *   - **service が、同じファイルが宣言した語彙(vocabulary.service)に閉じていること**
 *   - direction / effect / degrade / retry がフレームワーク固定の値域にあること
 *   - effect: write ⇒ idempotency / idempotency_source 必須・effect: read で書けば違反
 *   - idempotency_source: none ⇒ idempotency_reason 必須(逆向きも違反)
 *   - direction: outbound ⇒ timeout_ms 必須(正の整数)
 *   - degrade: not_configured | fallback ⇒ degrade_summary 必須
 *   - retry: inline ⇒ retry_max 必須(正の整数)・retry: inline 以外で書けば違反
 *   - sends は fields か text の少なくとも一方が必須
 *   - test_cases はこのカタログだけ任意(省略・空配列も正しい)
 *   - 未知キーは弾くこと
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseExternalCatalog } from '../../../../lib/model/external/parse-external.js';

/** 最小の語彙(テストごとに上書きする)。 */
const VOCABULARY = {
  service: [
    { id: 'discord', label: 'Discord', adapter_root: 'app/src/infrastructure/discord' },
    { id: 'anthropic', adapter_root: 'app/src/infrastructure/anthropic' },
  ],
};

/** 1 行分の正しい連携宣言(write + not_configured)。 */
const ROW = {
  id: 'discord_webhook',
  service: 'discord',
  direction: 'outbound',
  effect: 'write',
  port: 'DeliveryPort',
  adapter: 'app/src/infrastructure/discord/webhook.ts',
  config: ['DISCORD_NOTICE_WEBHOOK_URL'],
  degrade: 'not_configured',
  degrade_summary: '送らずに not_configured の結果を返す',
  timeout_ms: 5000,
  retry: 'none',
  idempotency: 'job id を冪等キーにする',
  idempotency_source: 'external_key',
  sends: { text: '通知の本文', neutralize: ['control_chars'] },
  summary: 'Discord Webhook へ POST する',
};

/** 受け取る側の行(健全な既定。テストはここから 1 つだけ崩す)。 */
function inboundRow(): Record<string, unknown> {
  const row = { ...ROW } as Record<string, unknown>;
  delete row['degrade_summary'];
  delete row['timeout_ms'];
  row['direction'] = 'inbound';
  row['degrade'] = 'refuse';
  row['signature'] = 'hmac_sha256';
  row['signature_key'] = 'DISCORD_NOTICE_WEBHOOK_URL';
  row['event_id_table'] = 'table-payment_notices';
  row['emits'] = 'sales_order.pay';
  row['migration'] = '20260912000001_inbound_discord_webhook.sql';
  row['on_conflict'] = 'retry';
  row['sends'] = { text: '通知の本文' };
  return row;
}

/** フロントマター相当のマッピングを組み立てる。 */
function frontmatter(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    doc_type: 'external_spec',
    scope: 'backend',
    id: 'external-catalog',
    vocabulary: VOCABULARY,
    integrations: [ROW],
    ...overrides,
  };
}

/** パースして (カタログ, 違反) を返す。 */
function parse(data: Readonly<Record<string, unknown>>) {
  const reporter = new SpecReporter('docs/specs/backend/external.md');
  return parseExternalCatalog(data, reporter);
}

describe('X0: 外部連携カタログのパース', () => {
  it('正しいカタログを読める(test_cases 省略)', () => {
    const { value, findings } = parse(frontmatter());

    expect(findings).toEqual([]);
    expect(value?.integrations).toHaveLength(1);
    expect(value?.integrations[0]).toMatchObject({
      id: 'discord_webhook',
      service: 'discord',
      direction: 'outbound',
      effect: 'write',
      degrade: 'not_configured',
      timeoutMs: 5000,
      retry: 'none',
      idempotency: 'job id を冪等キーにする',
      idempotencySource: 'external_key',
    });
    expect(value?.testCases).toEqual([]);
    expect(value?.vocabulary.service[0]?.adapterRoot).toBe('app/src/infrastructure/discord');
  });

  it('test_cases: [] は正しく読める(このカタログだけ任意)', () => {
    const { findings } = parse(frontmatter({ test_cases: [] }));

    expect(findings).toEqual([]);
  });

  it('id が external-catalog でなければエラー', () => {
    const { findings } = parse(frontmatter({ id: 'external' }));

    expect(findings.some((f) => f.message.includes('カタログの id ではありません'))).toBe(true);
  });

  it('連携 ID がスネークケースでなければエラー', () => {
    const { value, findings } = parse(frontmatter({ integrations: [{ ...ROW, id: 'DiscordWebhook' }] }));

    expect(findings.some((f) => f.message.includes('スネークケース'))).toBe(true);
    expect(value?.integrations).toEqual([]);
  });

  it('連携 ID の重複はエラー', () => {
    const { value, findings } = parse(frontmatter({ integrations: [ROW, ROW] }));

    expect(findings.some((f) => f.message.includes('重複'))).toBe(true);
    expect(value?.integrations).toHaveLength(1);
  });

  it('宣言されていない service はエラー(語彙の閉世界)', () => {
    const { value, findings } = parse(frontmatter({ integrations: [{ ...ROW, service: 'notion' }] }));

    expect(findings.some((f) => f.message.includes('vocabulary.service に宣言されていません'))).toBe(true);
    expect(value?.integrations).toEqual([]);
  });

  it('語彙に足せば同じ値が通る(語彙は仕様側が決める)', () => {
    const { findings } = parse(
      frontmatter({
        vocabulary: { service: [...VOCABULARY.service, { id: 'line', adapter_root: 'app/src/infrastructure/line' }] },
        integrations: [{ ...ROW, service: 'line' }],
      }),
    );

    expect(findings).toEqual([]);
  });

  it('direction: inbound は受け取る側の軸を読み、timeout_ms を持たない', () => {
    const { value, findings } = parse(frontmatter({ integrations: [inboundRow()] }));

    expect(findings).toEqual([]);
    expect(value?.integrations[0]).toMatchObject({
      direction: 'inbound',
      signature: 'hmac_sha256',
      signatureKey: 'DISCORD_NOTICE_WEBHOOK_URL',
      eventIdTable: 'table-payment_notices',
      emits: 'sales_order.pay',
      migration: '20260912000001_inbound_discord_webhook.sql',
      onConflict: 'retry',
    });
  });

  it('direction: inbound で軸のどれかが欠ければエラー(部分的に書ける形にしない)', () => {
    const row = inboundRow();
    delete row['event_id_table'];

    const { findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.message.includes('event_id_table'))).toBe(true);
  });

  it('signature が無い受信の行はエラーで落とす(方式を欠いた行を「検証しない」に倒さない)', () => {
    const row = inboundRow();
    delete row['signature'];

    const { value, findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.severity === 'error' && f.message.includes('signature'))).toBe(true);
    expect(value?.integrations ?? []).toEqual([]);
  });

  it('max_body_bytes は省略すると小さめの既定、書けばその値(緩めるのは宣言だけ)', () => {
    const omitted = parse(frontmatter({ integrations: [inboundRow()] }));
    const declared = parse(frontmatter({ integrations: [{ ...inboundRow(), max_body_bytes: 262144 }] }));

    expect(omitted.value?.integrations[0]).toMatchObject({ maxBodyBytes: 65536 });
    expect(declared.findings).toEqual([]);
    expect(declared.value?.integrations[0]).toMatchObject({ maxBodyBytes: 262144 });
  });

  it('max_body_bytes が 1 以上・天井以下の整数でなければエラー。送信の行に書いてもエラー', () => {
    for (const value of [0, -1, 1.5, '64k', 16_777_217]) {
      const { findings } = parse(frontmatter({ integrations: [{ ...inboundRow(), max_body_bytes: value }] }));
      expect(findings.some((f) => f.message.includes('max_body_bytes')), String(value)).toBe(true);
    }
    const outbound = parse(frontmatter({ integrations: [{ ...ROW, max_body_bytes: 1024 }] }));
    expect(outbound.findings.some((f) => f.message.includes('受信の軸(max_body_bytes)'))).toBe(true);
  });

  it('signature が none 以外なのに signature_key が無ければエラー(鍵を位置で決めない)', () => {
    const row = inboundRow();
    delete row['signature_key'];

    const { findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.message.includes('signature_key がありません'))).toBe(true);
  });

  it('signature: none なのに理由が無ければエラー(理由の無い免除を持たない)', () => {
    const row = inboundRow();
    row['signature'] = 'none';
    delete row['signature_key'];

    const { findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.message.includes('signature_reason がありません'))).toBe(true);
  });

  it('signature: none に鍵を書くとエラー(検証しない口は鍵を使わない)', () => {
    const row = inboundRow();
    row['signature'] = 'none';
    row['signature_reason'] = '社内からしか届かない';

    const { findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.message.includes('signature_key があります'))).toBe(true);
  });

  it('migration の形が違えばエラー(生成先のファイル名は仕様が決める)', () => {
    const row = inboundRow();
    row['migration'] = 'inbound_discord_webhook.sql';

    const { findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.message.includes('_inbound_{連携 id}.sql の形ではありません'))).toBe(true);
  });

  it('on_conflict が値域に無ければエラー(既定を持たない)', () => {
    const row = inboundRow();
    row['on_conflict'] = 'ignore';

    const { findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.message.includes('on_conflict ignore は値域'))).toBe(true);
  });

  it('config が空ならエラー(鍵を 1 つも指せない宣言を通さない)', () => {
    const { findings } = parse(frontmatter({ integrations: [{ ...ROW, config: [] }] }));

    expect(findings.some((f) => f.message.includes('config が空です'))).toBe(true);
  });

  it('direction: outbound に受け取る側の軸を書くとエラー', () => {
    const { findings } = parse(
      frontmatter({ integrations: [{ ...ROW, signature: 'hmac_sha256' }] }),
    );

    expect(findings.some((f) => f.message.includes('受信の軸'))).toBe(true);
  });

  it('direction: inbound に timeout_ms を書くとエラー(呼びに行かない口に待ち時間は無い)', () => {
    const row = inboundRow();
    row['timeout_ms'] = 5000;

    const { findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.message.includes('timeout_ms があります'))).toBe(true);
  });

  it('direction が値域に無ければエラー', () => {
    const { findings } = parse(frontmatter({ integrations: [{ ...ROW, direction: 'both' }] }));

    expect(findings.some((f) => f.message.includes('値域'))).toBe(true);
  });

  it('effect: write なのに idempotency が無ければエラー', () => {
    const row = { ...ROW } as Record<string, unknown>;
    delete row['idempotency'];
    const { value, findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.message.includes('idempotency がありません'))).toBe(true);
    expect(value?.integrations).toEqual([]);
  });

  it('effect: read なのに idempotency があればエラー', () => {
    const { findings } = parse(
      frontmatter({ integrations: [{ ...ROW, effect: 'read', idempotency: '要らないはず' }] }),
    );

    expect(findings.some((f) => f.message.includes('idempotency があります'))).toBe(true);
  });

  it('effect: write なのに idempotency_source が無ければエラー', () => {
    const row = { ...ROW } as Record<string, unknown>;
    delete row['idempotency_source'];
    const { value, findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.message.includes('idempotency_source がありません'))).toBe(true);
    expect(value?.integrations).toEqual([]);
  });

  it('idempotency_source が値域に無ければエラー', () => {
    const { findings } = parse(
      frontmatter({ integrations: [{ ...ROW, idempotency_source: 'hope' }] }),
    );

    expect(findings.some((f) => f.message.includes('idempotency_source hope は値域'))).toBe(true);
  });

  it('idempotency_source: none は idempotency_reason が無ければエラー', () => {
    const { findings } = parse(
      frontmatter({ integrations: [{ ...ROW, idempotency_source: 'none' }] }),
    );

    expect(findings.some((f) => f.message.includes('idempotency_reason がありません'))).toBe(true);
  });

  it('idempotency_source: none は理由を書けば通る(免除には理由が要る)', () => {
    const { value, findings } = parse(
      frontmatter({
        integrations: [
          { ...ROW, idempotency_source: 'none', idempotency_reason: '同じ本文が 2 度出ても害が無い' },
        ],
      }),
    );

    expect(findings).toEqual([]);
    expect(value?.integrations[0]?.idempotencyReason).toBe('同じ本文が 2 度出ても害が無い');
  });

  it('idempotency_source が none 以外なのに idempotency_reason があればエラー', () => {
    const { findings } = parse(
      frontmatter({ integrations: [{ ...ROW, idempotency_reason: '要らないはず' }] }),
    );

    expect(findings.some((f) => f.message.includes('idempotency_reason があります'))).toBe(true);
  });

  it('direction: outbound なのに timeout_ms が無ければエラー', () => {
    const row = { ...ROW } as Record<string, unknown>;
    delete row['timeout_ms'];
    const { findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.message.includes('timeout_ms がありません'))).toBe(true);
  });

  it('timeout_ms が 0 以下ならエラー', () => {
    const { findings } = parse(frontmatter({ integrations: [{ ...ROW, timeout_ms: 0 }] }));

    expect(findings.some((f) => f.message.includes('timeout_ms は 1 以上の整数'))).toBe(true);
  });

  it('degrade: not_configured なのに degrade_summary が無ければエラー', () => {
    const row = { ...ROW } as Record<string, unknown>;
    delete row['degrade_summary'];
    const { findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings.some((f) => f.message.includes('degrade_summary がありません'))).toBe(true);
  });

  it('degrade: refuse は degrade_summary が無くても通る', () => {
    const row = { ...ROW, degrade: 'refuse' } as Record<string, unknown>;
    delete row['degrade_summary'];
    const { findings } = parse(frontmatter({ integrations: [row] }));

    expect(findings).toEqual([]);
  });

  it('retry: inline なのに retry_max が無ければエラー', () => {
    const { findings } = parse(frontmatter({ integrations: [{ ...ROW, retry: 'inline' }] }));

    expect(findings.some((f) => f.message.includes('retry_max がありません'))).toBe(true);
  });

  it('retry: inline は retry_max を書けば通る', () => {
    const { value, findings } = parse(
      frontmatter({ integrations: [{ ...ROW, retry: 'inline', retry_max: 3 }] }),
    );

    expect(findings).toEqual([]);
    expect(value?.integrations[0]?.retryMax).toBe(3);
  });

  it('retry: none なのに retry_max があればエラー', () => {
    const { findings } = parse(frontmatter({ integrations: [{ ...ROW, retry_max: 3 }] }));

    expect(findings.some((f) => f.message.includes('retry_max があります'))).toBe(true);
  });

  it('config が空ならエラー', () => {
    const { findings } = parse(frontmatter({ integrations: [{ ...ROW, config: [] }] }));

    expect(findings.some((f) => f.message.includes('config'))).toBe(true);
  });

  it('sends に fields も text も無ければエラー', () => {
    const { findings } = parse(frontmatter({ integrations: [{ ...ROW, sends: { neutralize: ['control_chars'] } }] }));

    expect(findings.some((f) => f.message.includes('sends'))).toBe(true);
  });

  it('sends は fields だけでも通る', () => {
    const { value, findings } = parse(
      frontmatter({ integrations: [{ ...ROW, sends: { fields: ['member.display_name'], neutralize: ['control_chars'] } }] }),
    );

    expect(findings).toEqual([]);
    expect(value?.integrations[0]?.sends).toEqual({ fields: ['member.display_name'], neutralize: { kind: 'apply', parts: [{ kind: 'control_chars' }] } });
  });

  it('vocabulary が無ければエラー', () => {
    const { findings } = parse(frontmatter({ vocabulary: undefined }));

    expect(findings.some((f) => f.message.includes('vocabulary がありません'))).toBe(true);
  });

  it('service の語が重複していればエラー', () => {
    const { findings } = parse(
      frontmatter({
        vocabulary: { service: [{ id: 'discord', adapter_root: 'a' }, { id: 'discord', adapter_root: 'b' }] },
      }),
    );

    expect(findings.some((f) => f.message.includes('service の語 discord が重複'))).toBe(true);
  });

  it('未知のトップレベルキーはエラー', () => {
    const { findings } = parse(frontmatter({ extra_key: 'x' }));

    expect(findings.some((f) => f.message.includes('extra_key は書けません'))).toBe(true);
  });

  it('連携の行に未知キーがあればエラー', () => {
    const { findings } = parse(frontmatter({ integrations: [{ ...ROW, extra_key: 'x' }] }));

    expect(findings.some((f) => f.message.includes('extra_key は書けません'))).toBe(true);
  });
});

describe('X0: endpoints(この連携を使う手書きの口)', () => {
  it('送信の連携は endpoints を持てる(任意)。書かなければ持たない', () => {
    const none = parse(frontmatter());
    const some = parse(frontmatter({ integrations: [{ ...ROW, endpoints: ['/api/ai/tutorial', '/api/ai/program-draft'] }] }));

    expect(none.findings).toEqual([]);
    const first = none.value?.integrations[0];
    expect(first?.direction === 'outbound' ? first.endpoints : 'inbound').toBeUndefined();
    expect(some.findings).toEqual([]);
    const declared = some.value?.integrations[0];
    expect(declared?.direction === 'outbound' ? declared.endpoints : undefined).toEqual(['/api/ai/tutorial', '/api/ai/program-draft']);
  });

  it('書くなら 1 本以上(空のリストは落とす。口が無いなら endpoints ごと書かない)', () => {
    const { value, findings } = parse(frontmatter({ integrations: [{ ...ROW, endpoints: [] }] }));

    expect(findings.some((f) => f.message.includes('endpoints が空です'))).toBe(true);
    expect(value?.integrations).toEqual([]);
  });

  it('リストでなければ落とす', () => {
    const { findings } = parse(frontmatter({ integrations: [{ ...ROW, endpoints: '/api/ai/tutorial' }] }));

    expect(findings.some((f) => f.message.includes('endpoints はリストで書きます'))).toBe(true);
  });

  it('受信の連携は endpoints を持てない(受信口は生成物で URL が連携 ID から決まっている)', () => {
    const { value, findings } = parse(frontmatter({ integrations: [{ ...inboundRow(), endpoints: ['/api/hooks/x'] }] }));

    expect(findings.some((f) => f.message.includes('direction: inbound なのに endpoints があります'))).toBe(true);
    expect(value?.integrations).toEqual([]);
  });
});

describe('X0: 落とした行の数(入力の状態の「仕様を落としたか」の源)', () => {
  /** パースして、記録器が数えた落とした行の数を返す。 */
  function dropped(data: Readonly<Record<string, unknown>>): number {
    const reporter = new SpecReporter('docs/specs/backend/external.md');
    parseExternalCatalog(data, reporter);
    return reporter.droppedCount();
  }

  it('正しいカタログは 0', () => {
    expect(dropped(frontmatter())).toBe(0);
  });

  it('行を落とさない error(未知のキー・連携 ID の重複で先の行が残る形)は数えない', () => {
    expect(dropped(frontmatter({ unknown_key: 1 }))).toBe(0);
    expect(dropped(frontmatter({ integrations: [ROW, { ...ROW }] }))).toBe(0);
    expect(dropped(frontmatter({ vocabulary: { service: [VOCABULARY.service[0], VOCABULARY.service[0]] } }))).toBe(0);
    // 語彙の軸が空(vocabulary.service が空です)は error だが、落とした行は無い(宣言どおりに空のモデルが読めている)。
    expect(dropped(frontmatter({ vocabulary: { service: [] }, integrations: [] }))).toBe(0);
  });

  it('読めずに落とした連携・語彙・テストケースの行は数える(値域の外・マッピングでない行・語彙に無い service)', () => {
    expect(dropped(frontmatter({ integrations: [ROW, { ...ROW, id: 'bad_effect', effect: 'maybe' }] }))).toBe(1);
    expect(dropped(frontmatter({ integrations: [ROW, 'not a mapping'] }))).toBe(1);
    expect(dropped(frontmatter({ integrations: [ROW, { ...ROW, id: 'unknown_service', service: 'ghost' }] }))).toBe(1);
    expect(dropped(frontmatter({ vocabulary: { service: [VOCABULARY.service[0], { id: 'Bad-Id', adapter_root: 'x' }] } }))).toBe(1);
    expect(dropped(frontmatter({ test_cases: [{ id: 'TC-X-001' }] }))).toBeGreaterThan(0);
  });

  it('読めなかった必須のリスト(integrations)・語彙そのものが無いのも 1 件と数える', () => {
    expect(dropped(frontmatter({ integrations: undefined }))).toBe(1);
    expect(dropped(frontmatter({ vocabulary: undefined, integrations: [] }))).toBeGreaterThanOrEqual(1);
  });
});
