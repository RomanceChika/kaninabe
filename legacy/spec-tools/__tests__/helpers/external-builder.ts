/**
 * external_spec(外部連携カタログ)テスト用の最小ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器・生成器のテストはファイル I/O を行わず、
 * モデルをテスト内でリテラル構築する。ここではその定型部分(location・語彙の既定)を引き受ける。
 */

import type {
  ExternalAbuseDecl,
  ExternalAuthzDecl,
  ExternalCatalogSpec,
  ExternalSpend,
  ExternalSpecModel,
  IdempotencySource,
  InboundConflictReply,
  InboundSignature,
  IntegrationDecl,
} from '../../lib/model/external/types.js';
import { DEFAULT_INBOUND_MAX_BODY_BYTES } from '../../lib/model/external/types.js';
import type { ActionTestCase } from '../../lib/testcase/types.js';
import { loc } from './model-builder.js';

/** カタログの仕様ファイル(location に使う)。 */
const CATALOG_FILE = 'docs/specs/backend/external.md';

/** テスト用のテストケース宣言を 1 件作る。`implementation` は `{パス}::{テスト名}` 形式。 */
export function externalTestCase(
  id: string,
  implementation = 'app/src/infrastructure/__tests__/external/example.test.ts::突合',
): ActionTestCase {
  const sep = implementation.indexOf('::');
  return {
    id,
    type: 'integration',
    specIds: ['external-catalog'],
    covers: ['other'],
    implementation: {
      raw: implementation,
      file: implementation.slice(0, sep),
      testName: implementation.slice(sep + 2),
    },
    location: loc(CATALOG_FILE, `test_cases.${id}`),
  };
}

/**
 * ビルダーに渡せる欄(向きによらず平らに受ける。どの欄が効くかは `direction` で決まる)。
 * 受信の軸を渡さなければ、ビルダーの既定(`hmac_sha256` + 鍵 `WEBHOOK_SECRET` ほか)が入る。
 */
export interface IntegrationOpts {
  readonly service?: string;
  readonly direction?: IntegrationDecl['direction'];
  readonly effect?: IntegrationDecl['effect'];
  readonly port?: string;
  readonly adapter?: string;
  readonly config?: readonly string[];
  readonly degrade?: IntegrationDecl['degrade'];
  readonly degradeSummary?: string;
  readonly timeoutMs?: number;
  readonly retry?: IntegrationDecl['retry'];
  readonly retryMax?: number;
  readonly idempotency?: string;
  readonly idempotencySource?: IdempotencySource;
  readonly idempotencyReason?: string;
  readonly sends?: IntegrationDecl['sends'];
  readonly summary?: string;
  readonly endpoints?: readonly string[] | undefined;
  /** 有料の口(R5-7 / R5-8 のテストが使う。向きによらず付く)。 */
  readonly spend?: ExternalSpend | undefined;
  readonly abuse?: ExternalAbuseDecl | undefined;
  /** 有料の口の枠を消費する RPC の名前と認可(R5-7 / R5-9 / X8 のテストが使う)。 */
  readonly meter?: string | undefined;
  readonly authz?: ExternalAuthzDecl | undefined;
  readonly signature?: InboundSignature;
  readonly signatureKey?: string;
  readonly signatureReason?: string;
  readonly eventIdTable?: string;
  readonly emits?: string;
  readonly migration?: string;
  readonly onConflict?: InboundConflictReply;
  readonly maxBodyBytes?: number;
}

/**
 * 連携 1 件を作る。既定は「discord への outbound write(縮退: not_configured)」。
 * `direction: 'inbound'` を渡すときは受け取る側の軸(`signature` + `signatureKey` /
 * `eventIdTable` / `emits`)も渡す(渡さなければ既定が入る。`migration` / `onConflict` / `maxBodyBytes` も同じ)。
 */
export function integration(id: string, opts: IntegrationOpts = {}): IntegrationDecl {
  const effect = opts.effect ?? 'write';
  const degrade = opts.degrade ?? 'not_configured';
  const base = {
    id,
    service: opts.service ?? 'discord',
    effect,
    port: opts.port ?? 'DeliveryPort',
    adapter: opts.adapter ?? 'app/src/infrastructure/discord/webhook.ts',
    config: opts.config ?? ['DISCORD_NOTICE_WEBHOOK_URL'],
    degrade,
    retry: opts.retry ?? ('none' as const),
    sends: opts.sends ?? { fields: [], text: `${id} が送る情報` },
    summary: opts.summary ?? `${id} の説明`,
    location: loc(CATALOG_FILE, `integrations.${id}`),
    ...(degrade === 'not_configured' || degrade === 'fallback'
      ? { degradeSummary: opts.degradeSummary ?? `${id} は縮退する` }
      : opts.degradeSummary === undefined
        ? {}
        : { degradeSummary: opts.degradeSummary }),
    ...(effect === 'write'
      ? {
          idempotency: opts.idempotency ?? `${id} の冪等キー`,
          idempotencySource: opts.idempotencySource ?? ('local_ledger' as const),
        }
      : {}),
    ...(opts.idempotencyReason === undefined ? {} : { idempotencyReason: opts.idempotencyReason }),
    ...(opts.retry === 'inline' ? { retryMax: opts.retryMax ?? 3 } : {}),
    ...(opts.spend === undefined ? {} : { spend: opts.spend }),
    ...(opts.abuse === undefined ? {} : { abuse: opts.abuse }),
    ...(opts.meter === undefined ? {} : { meter: opts.meter }),
    ...(opts.authz === undefined ? {} : { authz: opts.authz }),
  };
  if (opts.direction !== 'inbound') {
    return {
      ...base,
      direction: 'outbound',
      timeoutMs: opts.timeoutMs ?? 5000,
      // 手書きの口(送信の連携が使う HTTP の入口。J2 の閉世界が数える)。
      ...(opts.endpoints === undefined ? {} : { endpoints: opts.endpoints }),
    };
  }
  // 受け取る側の軸(`direction: inbound` の行だけが持つ)。X5 のテストがここから作る。
  const signature =
    opts.signature === 'none'
      ? { signature: 'none' as const, signatureReason: opts.signatureReason ?? `${id} は署名を持たない` }
      : { signature: opts.signature ?? ('hmac_sha256' as const), signatureKey: opts.signatureKey ?? 'WEBHOOK_SECRET' };
  return {
    ...base,
    direction: 'inbound',
    ...signature,
    eventIdTable: opts.eventIdTable ?? 'inbound_events',
    emits: opts.emits ?? `${id}.receive`,
    migration: opts.migration ?? `20260912000001_inbound_${id}.sql`,
    onConflict: opts.onConflict ?? 'retry',
    maxBodyBytes: opts.maxBodyBytes ?? DEFAULT_INBOUND_MAX_BODY_BYTES,
  };
}

/** カタログ 1 件を作る。語彙はビルダーの既定値を全部含む。 */
export function externalCatalog(
  integrations: readonly IntegrationDecl[],
  testCases: readonly ActionTestCase[] = [],
): ExternalCatalogSpec {
  return {
    id: 'external-catalog',
    vocabulary: {
      service: [
        { id: 'discord', label: 'Discord', adapterRoot: 'app/src/infrastructure/discord', sdkPackages: [], clientUi: [] },
        { id: 'anthropic', adapterRoot: 'app/src/infrastructure/anthropic', sdkPackages: [], clientUi: [] },
        { id: 'notion', adapterRoot: 'app/src/infrastructure/notion', sdkPackages: [], clientUi: [] },
      ],
    },
    integrations,
    testCases,
    location: loc(CATALOG_FILE),
  };
}

/** ExternalSpecModel を作る。 */
export function externalModel(
  integrations: readonly IntegrationDecl[],
  opts: { available?: boolean; testCases?: readonly ActionTestCase[] } = {},
): ExternalSpecModel {
  return { available: opts.available ?? true, catalog: externalCatalog(integrations, opts.testCases) };
}
