/**
 * 設定の章の「暗号の目録」(ASVS V11.1.2)の生成のテスト。
 *
 * 規約網羅(config-spec-writing.md §暗号の目録):
 *   - 秘密の行は `confidential: true` の種類の行だけ。長さの下限・使う先・置き場・周期と根拠と手順と持つ者・更新の間の旧い値が出る。旧い値の行そのものは別行にしない
 *   - 受信の署名は外部連携カタログの inbound の行から(方式・鍵・受信口)。none は「検証しない」と理由を出す
 *   - ログインセッションはプラットフォームの `sessionToken`(方式がリポジトリに無ければその旨をそのまま出す)
 *   - bearer は宣言した欄があるときだけ、仕組みの採番(CSPRNG 32 バイト・base64url 43 字)と欄の場所を出す
 *   - 値はどこにも出さない
 */

import { describe, expect, it } from 'vitest';
import { cryptoInventoryRows } from '../../../../../lib/generate/render/book/config-crypto.js';
import { termLabels } from '../../../../../lib/generate/render/book/config-lower.js';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';
import type { ConfigSpecModel, ConfigVariableDecl } from '../../../../../lib/model/config/types.js';
import type { IntegrationDecl } from '../../../../../lib/model/external/types.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { configCatalog, configVariable } from '../../../../helpers/config-builder.js';
import { integration as buildIntegration } from '../../../../helpers/external-builder.js';

const ROTATION = { everyCount: 365, everyUnit: 'day', procedure: 'ダッシュボードで作り直す', holders: ['運用担当'], reason: '仮置き・運用で決める' } as const;

/** secret の旗のある語彙のカタログ。 */
function catalogOf(variables: readonly ConfigVariableDecl[]) {
  const base = configCatalog(variables);
  return { ...base, vocabulary: { ...base.vocabulary, kind: [{ id: 'secret', confidential: true }, { id: 'endpoint' }, { id: 'switch' }] } };
}

const SESSION = { format: 'JWT', issuer: 'Auth 基盤', algorithm: '基盤のプロジェクト設定が決める', scope: 'ログインセッション(cookie)' };

function rows(variables: readonly ConfigVariableDecl[], extra: Partial<Parameters<typeof cryptoInventoryRows>[0]> = {}) {
  const catalog = catalogOf(variables);
  return cryptoInventoryRows({ catalog, external: undefined, sessionToken: undefined, bearerPlaces: [], ...extra }, termLabels(catalog));
}

const inbound = (over = {}): IntegrationDecl =>
  buildIntegration('billing_hook', {
    service: 'billing', direction: 'inbound', effect: 'write', port: 'P', adapter: 'a.ts', config: ['K'], degrade: 'refuse', retry: 'none', idempotency: 'x',
    signature: 'hmac_sha256', signatureKey: 'BILLING_WEBHOOK_SECRET', eventIdTable: 't', emits: 'e.x', migration: 'm.sql', onConflict: 'retry', sends: { fields: [], text: 'x' }, summary: 's',
    ...over,
  });

describe('暗号の目録: 秘密', () => {
  it('confidential: true の種類の行だけを出す(endpoint・switch は出さない)', () => {
    const table = rows([configVariable('API_KEY', { kind: 'secret', rotation: ROTATION }), configVariable('HOOK', { kind: 'endpoint' }), configVariable('MODE', { kind: 'switch' })]);
    expect(table.map((row) => row[1])).toEqual(['`API_KEY`']);
  });

  it('下限・使う先・置き場・周期・根拠・手順・持つ者を出す', () => {
    const [row] = rows([configVariable('API_KEY', { kind: 'secret', usedBy: ['supabase_data'], targets: ['local'], strength: { minLength: 32 }, rotation: ROTATION })]);
    expect(row?.[2]).toContain('長さ 32 文字以上');
    expect(row?.[3]).toBe('Supabase — 業務データ');
    expect(row?.[4]).toBe('置き場: `local`');
    expect(row?.[5]).toBe('365 日ごと(仮置き・運用で決める)。手順: ダッシュボードで作り直す。持つ者: 運用担当');
  });

  it('strength の無い秘密は「サービスの認証の秘密ではない」と出す。置き場が無ければ道具が扱わないと出す。か月の周期', () => {
    const [row] = rows([configVariable('API_KEY', { kind: 'secret', targets: [], rotation: { everyCount: 12, everyUnit: 'month', procedure: ROTATION.procedure, holders: ROTATION.holders } })]);
    expect(row?.[2]).toContain('サービスの認証の秘密ではない');
    expect(row?.[4]).toContain('どの置き場にも人が入れない');
    expect(row?.[5]).toMatch(/^12 か月ごと。手順:/u);
  });

  it('更新の間の旧い値は持ち主の行の「更新」欄に出し、別行にはしない', () => {
    const table = rows([
      configVariable('CRON_SECRET', { kind: 'secret', strength: { minLength: 32 }, rotation: ROTATION, previous: 'CRON_SECRET_PREVIOUS' }),
      configVariable('CRON_SECRET_PREVIOUS', { kind: 'secret' }),
    ]);
    expect(table).toHaveLength(1);
    expect(table[0]?.[5]).toContain('更新の間は旧い値(`CRON_SECRET_PREVIOUS`)も受ける');
  });

  it('値や secret の旗の無い語彙では秘密の行を出さない', () => {
    const plain = configCatalog([configVariable('API_KEY', { kind: 'secret' })]);
    expect(cryptoInventoryRows({ catalog: plain, external: undefined, sessionToken: undefined, bearerPlaces: [] }, termLabels(plain))).toEqual([]);
  });
});

describe('暗号の目録: 受信の署名・セッション・bearer', () => {
  it('hmac_sha256 の受信口は方式・受信口の URL・鍵の名前・範囲を出す', () => {
    const [row] = rows([], { external: { integrations: [inbound()] } });
    expect(row?.slice(0, 5)).toEqual([
      '受信の署名',
      '`billing_hook`',
      'HMAC-SHA256(16 進)',
      '`/api/inbound/billing_hook`',
      '受信口の本文(受信したバイト列)の検証だけ。鍵は `BILLING_WEBHOOK_SECRET`(上の秘密の行)',
    ]);
  });

  it('provider_sdk は相手の SDK が検証すると出し、none は検証しないと理由を出す。送信の行は出さない', () => {
    const table = rows([], {
      external: { integrations: [inbound({ signature: 'provider_sdk' }), inbound({ signature: 'none', signatureReason: '社内からだけ' }), inbound({ direction: 'outbound' })] },
    });
    expect(table).toHaveLength(2);
    expect(table[0]?.[2]).toBe('相手の SDK');
    expect(table[1]?.[2]).toBe('検証しない(誰でも叩ける)');
    expect(table[1]?.[4]).toBe('範囲なし。理由: 社内からだけ');
  });

  it('ログインセッションはプラットフォームの宣言を出す(方式が宣言に無いならそのまま)', () => {
    const [row] = rows([], { sessionToken: SESSION });
    expect(row).toEqual(['ログインセッション', 'JWT(Auth 基盤 が発行)', '基盤のプロジェクト設定が決める', 'ブラウザの cookie', 'ログインセッション(cookie)', 'セッションの寿命は認証の設定(H5)']);
  });

  it('bearer は宣言した欄があるときだけ、採番の方式(CSPRNG 32 バイト・base64url 43 字)と欄を出す', () => {
    expect(rows([], { bearerPlaces: [] })).toEqual([]);
    const [row] = rows([], { bearerPlaces: ['invitation.code'] });
    expect(row?.[0]).toBe('持っていれば効く値(bearer)');
    expect(row?.[1]).toBe('`invitation.code`');
    expect(row?.[2]).toContain('CSPRNG 32 バイト');
    expect(row?.[2]).toContain('43 字');
  });

  it('並びは 秘密 → 受信の署名 → セッション → bearer', () => {
    const table = rows([configVariable('API_KEY', { kind: 'secret', rotation: ROTATION })], { external: { integrations: [inbound()] }, sessionToken: SESSION, bearerPlaces: ['invitation.code'] });
    expect(table.map((row) => row[0])).toEqual(['秘密(共有秘密・鍵・トークン)', '受信の署名', 'ログインセッション', '持っていれば効く値(bearer)']);
  });
});

describe('設定の章への載せ方(HTML の本)', () => {
  function chapterHtml(config: ConfigSpecModel, extra = {}): string {
    return bookHtmlPage(bookModel(), { ...bookCtx(), config, ...extra }, 'config.html') ?? '';
  }

  it('暗号の目録の折りたたみが出る(行があるとき)。値は出さない', () => {
    const html = chapterHtml({ available: true, catalog: catalogOf([configVariable('API_KEY', { kind: 'secret', rotation: ROTATION })]) });
    const content = pageText(html);
    expect(content).toContain('暗号の目録(何を・どの方式で・どこで使い・どの範囲か)');
    expect(html).toContain('data-el="config.crypto"');
    expect(content).toContain('種別 | 何 | 方式・強さ | どこで使う | 使ってよい範囲 | 寿命・更新');
    expect(content).toContain('API_KEY');
  });

  it('secret の旗の無い語彙では、設定の行は目録に出ない(旗が語の宣言を読む唯一の入口)', () => {
    const html = chapterHtml({ available: true, catalog: configCatalog([configVariable('API_KEY', { kind: 'secret', rotation: ROTATION })]) });
    const start = html.indexOf('data-el="config.crypto"');
    const body = start < 0 ? '' : pageText(html.slice(start, html.indexOf('</details>', start)));
    expect(body).not.toContain('API_KEY');
  });

  it('秘密・受信・セッション・bearer のどれも無ければ、折りたたみそのものが出ない', () => {
    const { sessionToken: _unused, ...platform } = bookCtx().platform;
    const { external: _external, ...rest } = bookCtx();
    const ctx = { ...rest, platform };
    const html = bookHtmlPage({ ...bookModel(), aggregates: new Map() }, { ...ctx, config: { available: true, catalog: configCatalog([configVariable('API_KEY')]) } }, 'config.html') ?? '';
    expect(html).not.toBe('');
    expect(html).not.toContain('data-el="config.crypto"');
  });
});
