/**
 * 受信口(Route Handler)と配線の生成器。
 *
 * 生成物が**宣言の軸から決まる**ことだけを見る —— どの鍵で検証し(`signature` +
 * `signature_key`)、どの RPC を呼び出し(`emits` から導いた `inbound_{連携}`)、状態が合わなかったら
 * 何を返し(`on_conflict`)、どのアダプタを呼ぶか(`port` + `adapter`)。段取りそのもの
 * (署名不一致は 401 / 再送は 200 で no-op / 拒否は宣言どおり)は生成されず、
 * 実行時パッケージ(`@kaninabe/runtime/inbound`)の 1 実体にあり、fake の実行器を使う
 * app 側のテスト(`src/infrastructure/__tests__/inbound/run-inbound.test.ts`)が固定している。
 * 記録と遷移を 1 トランザクションにする SQL は `code-inbound-rpc.test.ts` が見る。
 */

import { routeGuardProblems } from '../../../../lib/semantics/route-guard-shape.js';
import { describe, expect, it } from 'vitest';
import { inboundExpectations, inboundRouteGenerator } from '../../../../lib/generate/render/code-inbound-route.js';
import type { ExternalCatalogSpec, IntegrationDecl } from '../../../../lib/model/external/types.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { EMPTY_LAYOUT } from '../../../../lib/model/product/layout.js';
import type { ProductLayout } from '../../../../lib/model/product/layout.js';
import type { ProductRoots } from '../../../../lib/model/product/types.js';
import { GeneratorPreconditionError } from '../../../../lib/kernel/generator-precondition.js';
import { integration as buildIntegration, type IntegrationOpts } from '../../../helpers/external-builder.js';
import { configModel, configVariable } from '../../../helpers/config-builder.js';
import { FOREIGN_LAYOUT, FOREIGN_ROOTS, leaksNextjsEntrySpelling, TEST_LAYOUT, TEST_PLATFORM } from '../../../helpers/platform.js';

/** Finding の位置(内容は生成に関係しない)。 */
const LOC = { file: 'docs/specs/backend/external.md' } as const;

/** 受信の行 1 本(既定は hmac_sha256)。 */
function integration(overrides: IntegrationOpts = {}): IntegrationDecl {
  return buildIntegration('billing_hook', {
    service: 'billing',
    direction: 'inbound',
    effect: 'write',
    port: 'BillingReceiver',
    adapter: 'app/src/infrastructure/billing/receive.ts',
    config: ['BILLING_WEBHOOK_SECRET'],
    degrade: 'refuse',
    retry: 'none',
    idempotency: '外部イベント ID の一意制約',
    signature: 'hmac_sha256',
    signatureKey: 'BILLING_WEBHOOK_SECRET',
    eventIdTable: 'table-billing_events',
    emits: 'invoice.settle',
    migration: '20260912000001_inbound_billing_hook.sql',
    onConflict: 'retry',
    sends: { fields: [], text: '受け取るだけ' },
    summary: '請求サービスの通知を受け取る',
    ...overrides,
  });
}

/** カタログ 1 つ分のモデル。 */
function catalog(integrations: readonly IntegrationDecl[]): ExternalCatalogSpec {
  return {
    id: 'external-catalog',
    vocabulary: { service: [] },
    integrations,
    testCases: [],
    location: LOC,
  };
}

/** 生成器へ渡す文脈(外部連携カタログだけを見る生成器なので他は空でよい)。 */
function context(integrations: readonly IntegrationDecl[], layout: ProductLayout = TEST_LAYOUT, roots: ProductRoots = TEST_ROOTS): GenerateContext {
  return {
    guards: createGuardServices(),
    roots,
    platform: TEST_PLATFORM,
    layout,
    external: { available: true, catalog: catalog(integrations) },
  } as unknown as GenerateContext;
}

/** 空のドメインモデル(この生成器は使わない)。 */
const MODEL = {} as SpecModel;

/** 生成された 2 ファイルを名前で引く。 */
function generated(integrations: readonly IntegrationDecl[], layout: ProductLayout = TEST_LAYOUT): ReadonlyMap<string, string> {
  return new Map(
    inboundRouteGenerator.generate(MODEL, context(integrations, layout, layout === FOREIGN_LAYOUT ? FOREIGN_ROOTS : TEST_ROOTS)).map((section) => [section.file, section.content]),
  );
}

/** 設定カタログを載せた文脈で配線を生成する(鍵の行の `strength` / `previous` を配線が読む)。 */
function wiringWithConfig(variables: Parameters<typeof configModel>[0]): string {
  const ctx = { ...context([integration()]), config: configModel(variables) } as GenerateContext;
  return (
    inboundRouteGenerator.generate(MODEL, ctx).find((section) => section.file === 'app/src/composition/inbound/billing_hook.ts')?.content ?? ''
  );
}

describe('受信口と配線: 鍵の強さと更新の間の旧い鍵(ASVS V13.2.3 / V11.2.2)', () => {
  const KEY = (opts = {}) => configVariable('BILLING_WEBHOOK_SECRET', { strength: { minLength: 32 }, ...opts });

  it('strength を宣言した鍵は、長さの下限を守る関門(readServiceSecret)を通して読む', () => {
    const wiring = wiringWithConfig([KEY()]);
    expect(wiring).toContain("import { readServiceSecret } from '@kaninabe/runtime/secret';");
    expect(wiring).toContain(
      "verifyInboundSignature('hmac_sha256', readServiceSecret('BILLING_WEBHOOK_SECRET', process.env['BILLING_WEBHOOK_SECRET'], 32), rawBody, presented)",
    );
  });

  it('下限はカタログの min_length をそのまま運ぶ', () => {
    expect(wiringWithConfig([KEY({ strength: { minLength: 48 } })])).toContain("process.env['BILLING_WEBHOOK_SECRET'], 48)");
  });

  it('previous を宣言した鍵は、現在の鍵と旧い鍵の両方を並べて渡す(更新の間は新旧どちらの鍵で署名した相手も受ける)', () => {
    const wiring = wiringWithConfig([KEY({ previous: 'BILLING_WEBHOOK_SECRET_PREVIOUS' }), configVariable('BILLING_WEBHOOK_SECRET_PREVIOUS')]);
    expect(wiring).toContain(
      "[readServiceSecret('BILLING_WEBHOOK_SECRET', process.env['BILLING_WEBHOOK_SECRET'], 32), readServiceSecret('BILLING_WEBHOOK_SECRET_PREVIOUS', process.env['BILLING_WEBHOOK_SECRET_PREVIOUS'], 32)]",
    );
  });

  it('strength の無い鍵は従来の素の参照のまま(宣言の欠けは K6 が止める。生成物で黙って埋めない)', () => {
    const wiring = wiringWithConfig([configVariable('BILLING_WEBHOOK_SECRET')]);
    expect(wiring).toContain("verifyInboundSignature('hmac_sha256', process.env['BILLING_WEBHOOK_SECRET'], rawBody, presented)");
    expect(wiring).not.toContain('readServiceSecret');
  });

  it('設定カタログが無い文脈でも従来の形で生成できる', () => {
    expect(generated([integration()]).get('app/src/composition/inbound/billing_hook.ts')).not.toContain('readServiceSecret');
  });

  it('署名しない口・SDK で検証する口は関門を import しない', () => {
    for (const over of [{ signature: 'none', signatureReason: '社内' }, { signature: 'provider_sdk' }] as const) {
      const ctx = { ...context([integration(over)]), config: configModel([KEY()]) } as GenerateContext;
      const wiring = inboundRouteGenerator.generate(MODEL, ctx).find((section) => section.file.includes('composition'))?.content ?? '';
      expect(wiring).not.toContain('readServiceSecret');
    }
  });
});

describe('受信口と配線の生成', () => {
  it('送信だけのカタログからは 1 ファイルも生成しない', () => {
    expect(generated([integration({ direction: 'outbound' })]).size).toBe(0);
  });

  it('受信の行 1 本につき、配線と受信口の 2 ファイルを連携 ID の場所に出す', () => {
    expect([...generated([integration()]).keys()]).toEqual([
      'app/src/composition/inbound/billing_hook.ts',
      'app/src/app/api/inbound/billing_hook/route.ts',
    ]);
  });

  it('受信口は POST だけを持ち、出口の関所で包み、段取りは実体(runInbound)に委ねる', () => {
    const route = generated([integration()]).get('app/src/app/api/inbound/billing_hook/route.ts') ?? '';

    expect(route).toContain('export const POST = guardRoute(async (request: Request): Promise<Response> => ');
    expect(route).toContain("import { guardRoute } from '@kaninabe/runtime/http/route-guard'");
    expect(routeGuardProblems('route.ts', route, false)).toEqual([]);
    expect(route).toContain("import { runInbound } from '@kaninabe/runtime/inbound'");
    expect(route).toContain('runInbound(request, createBillingHookInbound())');
    // 判断は 1 つも無い(生成物に if が現れない)。
    expect(route).not.toContain('if (');
  });

  it('配線は宣言された方式と**名前で指した鍵**で署名検証を閉じる(位置で決めない)', () => {
    const wiring =
      generated([integration({ config: ['BILLING_API_KEY', 'BILLING_WEBHOOK_SECRET'] })]).get(
        'app/src/composition/inbound/billing_hook.ts',
      ) ?? '';

    // config の先頭は API キーだが、鍵として使うのは signature_key が指した方である。
    expect(wiring).toContain(
      "verifyInboundSignature('hmac_sha256', process.env['BILLING_WEBHOOK_SECRET'], rawBody, presented)",
    );
    expect(wiring).not.toContain('BILLING_API_KEY');
  });

  it('signature: none の配線は検証を持たず、理由を字面に残す(誰でも叩ける口である)', () => {
    const wiring =
      generated([integration({ signature: 'none', signatureReason: '社内からしか届かない' })]).get(
        'app/src/composition/inbound/billing_hook.ts',
      ) ?? '';

    expect(wiring).toContain('verify: () => true');
    expect(wiring).toContain('誰でも叩ける');
    expect(wiring).toContain('社内からしか届かない');
    expect(wiring).not.toContain('verifyInboundSignature');
  });

  it('配線は本文の上限を運ぶ(宣言が無ければ小さめの既定、宣言すればその値)', () => {
    const fallback = generated([integration()]).get('app/src/composition/inbound/billing_hook.ts') ?? '';
    const declared = generated([integration({ maxBodyBytes: 262_144 })]).get('app/src/composition/inbound/billing_hook.ts') ?? '';

    expect(fallback).toContain('maxBodyBytes: 65536,');
    expect(declared).toContain('maxBodyBytes: 262144,');
  });

  it('配線は記録と遷移を 1 回の RPC で起こす(実行計画を経由しない)', () => {
    const wiring = generated([integration()]).get('app/src/composition/inbound/billing_hook.ts') ?? '';

    // 使う口(rpc)だけを DB への口の束から取る。PostgREST の組み立ては製品の配線にあり、本文に出ない(③-e2C)。
    expect(wiring).toContain("import { createDbPorts } from '@/infrastructure/supabase/db-ports';");
    expect(wiring).toContain('const { rpc } = createDbPorts();');
    expect(wiring).not.toMatch(/createServiceRoleClient|rpcSourceOf|createRpcCaller|runtimeBindings/);
    // 効果は RPC の本体にあり引数に載らない —— 要求した効果を追わない(`null`)と宣言して呼ぶ。
    expect(wiring).toContain(
      "rpc.call('inbound_billing_hook', { p_event_id: eventId, p_actor_id: null, p_payload: payload }, { tracksEffects: false })",
    );
    expect(wiring).toContain("emits: 'invoice.settle'");
    expect(wiring).toContain("onConflict: 'retry'");
    // 記録だけを実行する口も、実行計画を経由する口も生成物のどこにも無い
    // (記録と遷移は生成された 1 本の RPC の中で同じトランザクションに入る)。
    expect(wiring).not.toContain('receiver.record');
    expect(wiring).not.toContain('runPlanOperation');
    expect(wiring).not.toContain('operationPlans');
  });

  it('配線は宣言されたアダプタを port の名前で呼ぶ', () => {
    const wiring = generated([integration()]).get('app/src/composition/inbound/billing_hook.ts') ?? '';

    expect(wiring).toContain("import { createBillingReceiver } from '@/infrastructure/billing/receive'");
    expect(wiring).toContain('const receiver = createBillingReceiver();');
  });

  it('signature: provider_sdk はアダプタの検証を呼ぶ(体系側の関数を import しない)', () => {
    const wiring =
      generated([integration({ signature: 'provider_sdk' })]).get('app/src/composition/inbound/billing_hook.ts') ?? '';

    expect(wiring).toContain('receiver.verifySignature?.(rawBody, presented) ?? false');
    expect(wiring).not.toContain('verifyInboundSignature');
  });

  it('構造の閉世界には配線と受信口の 2 件が、写像したイベントの名前で載る', () => {
    expect(inboundExpectations(catalog([integration()]), TEST_LAYOUT)).toEqual([
      {
        event: 'invoice.settle',
        file: 'src/composition/inbound/billing_hook.ts',
        export: 'createBillingHookInbound',
      },
      {
        event: 'invoice.settle',
        file: 'src/app/api/inbound/billing_hook/route.ts',
        export: 'POST',
      },
    ]);
  });

  it('カタログが無ければ何も生成しない(受信を持たないリポジトリで壊れない)', () => {
    expect(inboundRouteGenerator.generate(MODEL, {} as GenerateContext)).toEqual([]);
    expect(inboundExpectations(null, TEST_LAYOUT)).toEqual([]);
  });

  it('実装の木を持たない製品は、置き場が無いことが事実なので何も生成しない(配置が空でも前提の失敗にしない)', () => {
    expect(inboundRouteGenerator.generate(MODEL, context([integration()], EMPTY_LAYOUT, { ...TEST_ROOTS, app: null }))).toEqual([]);
  });

  it('実装の木があるのに配置が役割を解決できなければ、黙って 0 本にせず前提の失敗で止める(J2 を名指す)', () => {
    const stop = (act: () => unknown): GeneratorPreconditionError => {
      try {
        act();
      } catch (error) {
        if (error instanceof GeneratorPreconditionError) return error;
        throw error;
      }
      throw new Error('止まらなかった');
    };
    const empty = stop(() => inboundRouteGenerator.generate(MODEL, context([integration()], EMPTY_LAYOUT)));
    expect(empty.findings.map((finding) => finding.verifier)).toEqual(['J2']);
    expect(empty.findings[0]?.message).toContain('外部連携 billing_hook の受信の配線 の置き場を、置き場の配置から決められません(役割 composition-root・キー billing_hook)');
    // 受信口(http-entry)だけが無い配置も止まる(どの役割が無いかが message に出る)。
    const noEntry = { ...TEST_LAYOUT } as { -readonly [K in keyof ProductLayout]: ProductLayout[K] };
    delete noEntry['http-entry'];
    const missingEntry = stop(() => inboundRouteGenerator.generate(MODEL, context([integration()], noEntry)));
    expect(missingEntry.findings[0]?.message).toContain('受信口 /api/inbound/billing_hook の置き場を、置き場の配置から決められません(役割 http-entry');
    // 期待の側(構造の閉世界)も同じ口で止まる(空の配列で黙らない)。
    expect(() => inboundExpectations(catalog([integration()]), EMPTY_LAYOUT)).toThrow(GeneratorPreconditionError);
    // 受信の行が無ければ、配置が空でも期待は 0 件(解決する必要が無い)。
    expect(inboundExpectations(catalog([integration({ direction: 'outbound' })]), EMPTY_LAYOUT)).toEqual([]);
  });

  it('配置を差し替えると、受信口と配線のパスと import の指定がその値で出る(Next.js の綴りは 1 つも残らない)', () => {
    // アダプタのパスは製品の仕様が書く。配置のソースの根(`app/server_code`)の下に置いたものは、その配置の別名で import される。
    const files = generated([integration({ adapter: 'app/server_code/infrastructure/billing/receive.ts' })], FOREIGN_LAYOUT);

    expect([...files.keys()]).toEqual([
      'app/server_code/wiring/webhooks/billing_hook.wire.ts',
      'app/server_code/endpoints/api/inbound/billing_hook.handler.ts',
    ]);
    const route = files.get('app/server_code/endpoints/api/inbound/billing_hook.handler.ts') ?? '';
    expect(route).toContain("import { createBillingHookInbound } from '~srv/wiring/webhooks/billing_hook.wire';");
    expect(files.get('app/server_code/wiring/webhooks/billing_hook.wire.ts')).toContain("from '~srv/infrastructure/billing/receive';");
    for (const [file, content] of files) {
      expect(leaksNextjsEntrySpelling(`${file}\n${content}`), file).toBe(false);
    }
    expect(inboundExpectations(catalog([integration()]), FOREIGN_LAYOUT).map((entry) => entry.file)).toEqual([
      'server_code/wiring/webhooks/billing_hook.wire.ts',
      'server_code/endpoints/api/inbound/billing_hook.handler.ts',
    ]);
  });

  it('仕様が書くアダプタのパスが配置のソースの根の外にあると、別の根の下へ黙って接がず前提の失敗で X1 を名指す', () => {
    // 本番の配置の根(app/src)の下のパスを、別の綴りの配置(根が app/server_code)で使うと、存在しない指定になる。
    let stopped: GeneratorPreconditionError | undefined;
    try {
      generated([integration()], FOREIGN_LAYOUT);
    } catch (error) {
      if (error instanceof GeneratorPreconditionError) stopped = error;
    }
    expect(stopped?.findings.map((finding) => finding.verifier)).toEqual(['X1']);
    expect(stopped?.findings[0]?.message).toContain('外部連携 billing_hook の受信の配線が import するソース app/src/infrastructure/billing/receive.ts');
    expect(stopped?.findings[0]?.counterexample).toEqual({ path: 'app/src/infrastructure/billing/receive.ts', sourceRoot: 'app/server_code' });
  });
});
