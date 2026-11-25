/**
 * R5-7 / R5-8(有料の口の濫用の歯止めの**宣言**)の単体テスト。
 *
 * 形ごとに「止める形(負例)」「通る形(正例)」を表で固定する。これは宣言の検査のテストであり、口の実装が本文を読む前に
 * 上限で落とすか・課金の前に枠を消費するか(執行)は見ない —— その断りが指摘の直し方に載ることも固定する。
 */

import { describe, expect, it } from 'vitest';
import { verifyPaidEndpoints } from '../../../lib/risk/verifiers/r5-paid.js';
import { verifyAbuseOf } from '../../../lib/risk/verifiers/r5-abuse.js';
import type { ExternalAbuseDecl, ExternalAuthzDecl, ExternalQuotaDecl, IntegrationDecl } from '../../../lib/model/external/types.js';
import type { RoleDef } from '../../../lib/model/types.js';
import type { CatalogInput } from '../../../lib/kernel/input-state.js';
import type { ConfigCatalogSpec } from '../../../lib/model/config/types.js';
import { externalCatalog, integration, type IntegrationOpts } from '../../helpers/external-builder.js';
import { configCatalog, configVariable } from '../../helpers/config-builder.js';
import { role, roleSpec, specModel } from '../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';

const LOC = { file: 'external.md', pointer: 'integrations.chat.abuse' };
const ENDPOINTS = ['/api/ai/tutorial', '/api/ai/program-draft'] as const;

/** 健全な枠(上書きできる)。 */
function quota(over: Partial<ExternalQuotaDecl> = {}): ExternalQuotaDecl {
  return { source: 'AI_LIMIT', per: '1 day', key: 'actor', ...over };
}

/** 健全な abuse(上書きできる)。 */
function abuse(over: Partial<ExternalAbuseDecl> = {}): ExternalAbuseDecl {
  return { maxBodyBytes: { '/api/ai/tutorial': 262144, '/api/ai/program-draft': 131072 }, quota: quota(), location: LOC, ...over };
}

/** 回数の枠を持たない abuse。 */
function abuseWithoutQuota(maxBodyBytes: Readonly<Record<string, number>>): ExternalAbuseDecl {
  return { maxBodyBytes, location: LOC };
}

/** 枠の数をリテラルで持つ枠。 */
function literalQuota(max: number): ExternalQuotaDecl {
  return { max, per: '1 day', key: 'actor' };
}

/** config カタログ(読込済み)。 */
const LOADED_CONFIG: CatalogInput<ConfigCatalogSpec> = { state: 'loaded', value: configCatalog([configVariable('AI_LIMIT')]), findings: [] };

/** 実行者の行の条件(`member.state in [active]`)を持つ有効メンバーの役と、それを含意する運営の役、未ログインの役ほか。 */
const MEMBER: RoleDef = { ...role('member'), claim: 'member.state', claimValues: ['active'], implies: ['anonymous'] };
const ROLES: readonly RoleDef[] = [
  role('anonymous'),
  MEMBER,
  { ...role('staff', undefined, ['member']), claim: 'member.is_staff' },
  role('system'),
  role('open', undefined, undefined, undefined),
  role('owner', 'member.id == actor.id', ['member']),
];

/** テーブル仕様の rpc の名前(枠を消費する RPC を持つ)。 */
const RPCS: ReadonlySet<string> = new Set(['consume_quota']);

/** 連携 1 本の R5-7 / R5-8 を `検査 ID|severity|message` で返す。 */
function messages(
  opts: IntegrationOpts,
  config: CatalogInput<ConfigCatalogSpec> | undefined = LOADED_CONFIG,
  grounds: { readonly roles?: readonly RoleDef[] | undefined; readonly rpcNames?: ReadonlySet<string> | undefined } = { roles: ROLES, rpcNames: RPCS },
): readonly string[] {
  return verifyPaidEndpoints({ external: externalCatalog([integration('chat', opts)]), config, ...grounds }).map(
    (finding) => `${finding.verifier}|${finding.severity}|${finding.message}`,
  );
}

/** 役の宣言。 */
function authz(over: Partial<ExternalAuthzDecl> = {}): ExternalAuthzDecl {
  return { kind: 'role', role: 'member', location: LOC, ...over };
}

/** 健全な有料の口(上限・枠・枠を消費する RPC・役がそろう)。 */
const PAID: IntegrationOpts = { effect: 'read', endpoints: [...ENDPOINTS], spend: 'paid', abuse: abuse(), meter: 'consume_quota', authz: authz() };

/** abuse だけを持たない有料の口。 */
const NO_ABUSE: IntegrationOpts = { ...PAID, abuse: undefined };

describe('R5-7 有料の口の宣言が揃っている', () => {
  it('正例: spend: paid + 全部の口の本文の上限 + 枠 + 実在する source は 0 件', () => {
    expect(messages(PAID)).toEqual([]);
  });

  it('正例: 枠の数をリテラル(max)で書けば config が無くても通る', () => {
    expect(messages({ ...PAID, abuse: abuse({ quota: literalQuota(20) }) }, { state: 'unselected', findings: [] })).toEqual([]);
  });

  it('正例: spend も endpoints も無い連携・endpoints があっても spend の無い連携は何も言わない(ruling 6: すべての口には要求しない)', () => {
    expect(messages({ effect: 'read' })).toEqual([]);
    expect(messages({ effect: 'read', endpoints: [...ENDPOINTS] })).toEqual([]);
  });

  it('正例: 外部連携カタログが無ければ何も見ない', () => {
    expect(verifyPaidEndpoints({ external: undefined, config: undefined })).toEqual([]);
  });

  // 負例の表: [題, 連携の宣言, 指摘に載る断片]
  const BAD: readonly (readonly [string, IntegrationOpts, string])[] = [
    ['abuse が無い', NO_ABUSE, 'abuse がありません'],
    ['口の本文の上限が 1 つ欠ける', { ...PAID, abuse: abuse({ maxBodyBytes: { '/api/ai/tutorial': 262144 } }) }, 'abuse.max_body_bytes に口の上限がありません: /api/ai/program-draft'],
    ['口の本文の上限が全部無い', { ...PAID, abuse: abuse({ maxBodyBytes: {} }) }, '/api/ai/tutorial, /api/ai/program-draft'],
    [
      'endpoints に無い口の上限がある',
      { ...PAID, abuse: abuse({ maxBodyBytes: { '/api/ai/tutorial': 1, '/api/ai/program-draft': 1, '/api/other': 1 } }) },
      'endpoints に無い口があります: /api/other',
    ],
    ['回数の枠が無い', { ...PAID, abuse: abuseWithoutQuota({ '/api/ai/tutorial': 262144, '/api/ai/program-draft': 131072 }) }, 'abuse.quota(回数の枠)がありません'],
    ['枠の期間が 366 日を超える', { ...PAID, abuse: abuse({ quota: quota({ per: '400 day' }) }) }, '366 日を超えます'],
    ['枠の max がリテラルで 0', { ...PAID, abuse: abuse({ quota: literalQuota(0) }) }, 'quota.max=0 は 1 以上の整数ではありません'],
    ['枠の source が config に無い', { ...PAID, abuse: abuse({ quota: quota({ source: 'NOPE' }) }) }, 'quota.source="NOPE" は config カタログに実在しません'],
  ];

  it.each(BAD)('負例: %s → error', (_title, opts, fragment) => {
    const found = messages(opts);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('R5|error|連携 chat は spend: paid の口(/api/ai/tutorial, /api/ai/program-draft)ですが、濫用の歯止めの宣言が揃っていません');
    expect(found[0]).toContain(fragment);
  });

  it('負例: 問題が複数あれば 1 つの指摘にまとめて並べる(連携ごとに 1 件)', () => {
    const found = messages({ ...PAID, abuse: abuseWithoutQuota({}) });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('口の上限がありません');
    expect(found[0]).toContain('回数の枠)がありません');
  });

  it('config が未選択なのに source を書くと、接地先が無いとして鳴る(max: n に直す)', () => {
    const found = messages(PAID, { state: 'unselected', findings: [] });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('を接地する config カタログがありません');
  });

  it('config が阻害(読めていない)なら source の実在は見ない(偽の error を出さない)', () => {
    expect(messages(PAID, { state: 'blocked', reason: 'load-failed', findings: [] })).toEqual([]);
    expect(verifyPaidEndpoints({ external: externalCatalog([integration('chat', PAID)]), config: undefined })).toEqual([]);
  });

  it('直し方に、書き方と「執行は X8 が見る」断りが載る(import は執行ではない)', () => {
    const [finding] = verifyPaidEndpoints({ external: externalCatalog([integration('chat', NO_ABUSE)]), config: LOADED_CONFIG, roles: ROLES, rpcNames: RPCS });

    expect(finding?.suggestion).toContain('abuse: { max_body_bytes:');
    expect(finding?.suggestion).toContain('値の大きさは製品が決められます');
    expect(finding?.suggestion).toContain('meter: {枠を消費する RPC の名前}');
    expect(finding?.suggestion).toContain('authz: { kind: role, role:');
    expect(finding?.suggestion).toContain('X8 が構文木で見ます');
    expect(finding?.counterexample).toMatchObject({ integration: 'chat' });
  });
});

describe('R5-7(続き)meter(枠を消費する RPC)と authz(認可)', () => {
  // 負例の表: [題, 連携の宣言, 指摘に載る断片]
  const BAD: readonly (readonly [string, IntegrationOpts, string])[] = [
    ['meter が無い', { ...PAID, meter: undefined }, 'meter(枠を消費する RPC の名前)がありません'],
    ['meter が data_table の kind: rpc の関数に無い', { ...PAID, meter: 'consume_other' }, 'meter="consume_other" は data_table の kind: rpc の関数に実在しません'],
    ['authz が無い', { ...PAID, authz: undefined }, 'authz(認可: { kind: role, role: {役の ID} })がありません'],
    ['authz.kind: public(有料の口を誰にでも開く)', { ...PAID, authz: { kind: 'public', location: LOC } }, 'authz.kind: public は有料の口に書けません'],
    ['authz.role が役の台帳に無い', { ...PAID, authz: authz({ role: 'nobody' }) }, 'authz.role="nobody" は役の台帳に実在しません'],
    ['authz.role が未ログインの役(誰にでも立つ)', { ...PAID, authz: authz({ role: 'anonymous' }) }, '未ログインにも立つ役です'],
    ['authz.role が内部実行の役', { ...PAID, authz: authz({ role: 'system' }) }, '内部実行の役です'],
    ['authz.role が文脈依存の役(binding)', { ...PAID, authz: authz({ role: 'owner' }) }, '対象の行に依って立つ文脈依存の役です'],
    ['authz.role が実行者の行の条件(claim)を持たない', { ...PAID, authz: authz({ role: 'open' }) }, '実行者の行の条件(claim)を持ちません'],
  ];

  it.each(BAD)('負例: %s → error', (_title, opts, fragment) => {
    const found = messages(opts);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('R5|error|連携 chat は spend: paid の口');
    expect(found[0]).toContain(fragment);
  });

  it('正例: 含意の先で行の条件を持つ役(staff は member を含意し、自分も claim を持つ)も立てられる', () => {
    expect(messages({ ...PAID, authz: authz({ role: 'staff' }) })).toEqual([]);
  });

  it('役の台帳・テーブル仕様が無ければ(読めていなければ)役と RPC の実在は見ない(偽の error を出さない)', () => {
    expect(messages({ ...PAID, meter: 'consume_other', authz: authz({ role: 'nobody' }) }, LOADED_CONFIG, {})).toEqual([]);
    expect(messages({ ...PAID, meter: 'consume_other' }, LOADED_CONFIG, { roles: ROLES, rpcNames: undefined })).toEqual([]);
  });

  it('meter と authz の問題は abuse の問題と 1 つの指摘にまとまる', () => {
    const found = messages({ ...PAID, abuse: undefined, meter: undefined, authz: undefined });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('abuse がありません');
    expect(found[0]).toContain('meter(');
    expect(found[0]).toContain('authz(');
  });
});

describe('R5-8 効かない場所の spend / abuse', () => {
  const INBOUND = (extra: IntegrationOpts): IntegrationOpts => ({ direction: 'inbound', ...extra });

  // 負例の表: [題, 連携の宣言, 指摘に載る断片]
  const BAD: readonly (readonly [string, IntegrationOpts, string])[] = [
    ['受信の連携に spend', INBOUND({ spend: 'paid' }), '受信の連携です'],
    ['受信の連携に abuse', INBOUND({ abuse: abuse() }), '受信の連携です'],
    ['受信の連携に spend と abuse', INBOUND({ spend: 'paid', abuse: abuse() }), 'spend / abuse'],
    ['endpoints の無い送信の連携に spend', { effect: 'read', spend: 'paid' }, 'endpoints(ブラウザから叩かれる口)がありません'],
    ['endpoints の無い送信の連携に abuse', { effect: 'read', abuse: abuse() }, 'endpoints(ブラウザから叩かれる口)がありません'],
    ['spend: paid なしの abuse(口あり)', { effect: 'read', endpoints: [...ENDPOINTS], abuse: abuse() }, 'spend: paid がありません'],
    ['spend: paid なしの meter(口あり)', { effect: 'read', endpoints: [...ENDPOINTS], meter: 'consume_quota' }, 'spend: paid がありません'],
    ['spend: paid なしの authz(口あり)', { effect: 'read', endpoints: [...ENDPOINTS], authz: authz() }, 'spend: paid がありません'],
    ['受信の連携に meter と authz', INBOUND({ meter: 'consume_quota', authz: authz() }), 'meter / authz'],
  ];

  it.each(BAD)('負例: %s → error', (_title, opts, fragment) => {
    const found = messages(opts);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^R5\|error\|連携 chat に .*がありますが、/);
    expect(found[0]).toContain(fragment);
    expect(found[0]).toContain('効く先の無い宣言です');
  });

  it('R5-8 の直し方に、書ける場所と、執行の証明ではない断りが載る', () => {
    const [finding] = verifyPaidEndpoints({ external: externalCatalog([integration('chat', INBOUND({ spend: 'paid' }))]), config: LOADED_CONFIG, roles: ROLES, rpcNames: RPCS });

    expect(finding?.suggestion).toContain('ブラウザから叩かれる口(endpoints)を持つ送信の連携にだけ書ける');
    expect(finding?.suggestion).toContain('X8 が構文木で見ます');
  });
});

describe('入口 verifyAbuseOf が R5-7 / R5-8 を束ねる', () => {
  it('external と config を渡すと R5-7 が出て、渡さなければ従来どおり(未ログインの作成の検査だけ)', () => {
    const external = externalCatalog([integration('chat', NO_ABUSE)]);
    const model = specModel([]);

    expect(verifyAbuseOf({ model, dataTables: undefined, external, config: LOADED_CONFIG })).toHaveLength(1);
    expect(verifyAbuseOf({ model, dataTables: undefined })).toEqual([]);
  });

  it('入口がテーブル仕様の rpc の名前と役の台帳を引いて、meter の実在と役を見る(テーブル仕様が読めていなければ実在は見ない)', () => {
    const model = specModel([], roleSpec([role('anonymous'), MEMBER, role('system')]));
    const tables = dataTableModel([dataTable('quota', { functions: [{ name: 'consume_quota', args: [], params: [], kind: 'rpc', alsoWrites: [] }] })]);
    const wrongMeter = externalCatalog([integration('chat', { ...PAID, meter: 'consume_other' })]);

    expect(verifyAbuseOf({ model, dataTables: tables, external: externalCatalog([integration('chat', PAID)]), config: LOADED_CONFIG })).toEqual([]);
    expect(verifyAbuseOf({ model, dataTables: tables, external: wrongMeter, config: LOADED_CONFIG })).toHaveLength(1);
    expect(verifyAbuseOf({ model, dataTables: dataTableModel([], false), external: wrongMeter, config: LOADED_CONFIG })).toEqual([]);
    expect(verifyAbuseOf({ model, dataTables: undefined, external: wrongMeter, config: LOADED_CONFIG })).toEqual([]);
  });

  it('IntegrationDecl の型が spend / abuse を運ぶ(ビルダーが付ける)', () => {
    const row: IntegrationDecl = integration('chat', PAID);

    expect(row.spend).toBe('paid');
    expect(row.abuse?.quota?.key).toBe('actor');
  });
});
