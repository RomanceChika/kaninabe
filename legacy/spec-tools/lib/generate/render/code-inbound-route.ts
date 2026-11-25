/**
 * external_spec の受信の行(`direction: inbound`)1 件 → **受信口と配線**(app の実装そのもの)
 * の生成器。
 *
 * 受信 Webhook の並びは連携によらず同じである —— 署名を検証し、**記録と遷移を 1 回の RPC で
 * 実行する**。どの鍵で・どの RPC を・状態が合わなかったら何を返すかは宣言(`signature` +
 * `signature_key` / `emits` / `on_conflict`)が決めているので、手で書く余地は「相手の本文の形」
 * だけになる —— それがアダプタ(`port` の実装)である。
 *
 * 出力は 2 つで、どちらも既存の形に揃えてある(ARCH-BE-0013 / ARCH-BE-0001)。置き場は**アプリの枠の後段の配置**
 * (`ProductLayout`。文脈に載った `layout`)が決める(Next.js なら下のとおり)。
 *   - `composition-root` … 配線だけ(鍵・RPC・アダプタを繋ぐ。`app/src/composition/inbound/{連携}.ts`)
 *   - `http-entry`(URL は `/api/inbound/{連携}`)… Route Handler(配線を呼ぶだけ。`app/src/app/api/inbound/{連携}/route.ts`)
 *
 * 記録と遷移を 1 トランザクションにする RPC そのものは `code-inbound-rpc.ts` が migration に
 * 書き出す(ADR-0011 §4「保存点の内側は全部か無しか」を受信に当てたもの)。
 *
 * **段取りそのものは生成しない。** `@kaninabe/runtime/inbound` が 1 回だけ
 * 書かれた唯一の実体であり、ここが生成するのは宣言から決まる値の配線である
 * (手で書ける場所を残すと、その分だけ定型から外れうる —— code-operation-app.ts と同じ理由)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import { lineCommentText } from '../../kernel/safe-text.js';
import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { InboundIntegrationDecl, IntegrationDecl } from '../../model/external/types.js';
import { isInbound } from '../../model/external/types.js';
import { inboundRpcName } from '../../inbound/inbound-plan.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import { docComment, generatedHeader, toPascalCase, tsString } from '../../gen-kit/code-emit.js';
import { inboundUrlOf } from '../../inbound/inbound-url.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import { placedModule, placedPath } from '../layout-placement.js';
import { bodyModulesOf } from '../body-modules.js';
import type { BodyModules } from '../body-modules.js';
import type { ConfigVariableDecl } from '../../model/config/types.js';
import { RUNTIME_INBOUND_MODULE, RUNTIME_INBOUND_SIGNATURE_MODULE, RUNTIME_ROUTE_GUARD_MODULE, RUNTIME_SECRET_MODULE } from './runtime-modules.js';

/** 配線の主 export 名(`{連携}` → `create{連携}Inbound`)。 */
export function inboundFactoryOf(integration: string): string {
  return `create${toPascalCase(integration)}Inbound`;
}

/**
 * 配線の置き場(`composition-root`。リポジトリルート相対。製品の根からの相対で欲しい呼び手は `roots` に `{ app: '' }` を渡す)。
 * 置き場を決められなければ前提の失敗で止める(`layout-placement.ts`)。
 */
export function inboundCompositionFileOf(integration: IntegrationDecl, layout: ProductLayout, roots: Pick<ProductRoots, 'app'>): string {
  return placedPath(layout, roots, { role: 'composition-root', key: integration.id, what: `外部連携 ${integration.id} の受信の配線`, location: integration.location });
}

/** 受信口の置き場(`http-entry` の URL が `inboundUrlOf` の 1 件。リポジトリルート相対)。決められなければ前提の失敗で止める。 */
export function inboundRouteFileOf(integration: IntegrationDecl, layout: ProductLayout, roots: Pick<ProductRoots, 'app'>): string {
  return placedPath(layout, roots, { role: 'http-entry', key: inboundUrlOf(integration.id), what: `外部連携 ${integration.id} の受信口 ${inboundUrlOf(integration.id)}`, location: integration.location });
}

/** 配線のモジュール指定(受信口が import する)。決められなければ前提の失敗で止める。 */
function inboundCompositionModuleOf(integration: IntegrationDecl, layout: ProductLayout): string {
  return placedModule(layout, { role: 'composition-root', key: integration.id, what: `外部連携 ${integration.id} の受信の配線`, location: integration.location });
}

/**
 * 全 external_spec の受信の行から受信口と配線を生成するジェネレーター。
 * 出力は配置の `composition-root` と `http-entry` の 2 本(いまの Next.js の配置では `app/src/composition/inbound/{連携}.ts` と
 * `app/src/app/api/inbound/{連携}/route.ts`)。実装の木を宣言していない製品では 1 本も出さない(置き場が無いのが事実)。
 * **実装の木があるのに配置が役割を解決できなければ、黙って 0 本にせず前提の失敗で止める**(`layout-placement.ts`)。
 */
export const inboundRouteGenerator: DocGenerator = {
  id: 'code-inbound-route',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.external?.catalog;
    if (catalog === undefined || catalog === null) return [];
    // 受信口は実装の木の中にしか置けない。宣言していない製品では 1 本も生成しない
    // (仕様だけの製品でも壊れない線。appGrounded と同じ扱い)。置き場は配置が決める。
    if (ctx.roots.app === null) return [];
    return catalog.integrations
      .filter(isInbound)
      .flatMap((integration) => {
        const compositionFile = inboundCompositionFileOf(integration, ctx.layout, ctx.roots);
        const routeFile = inboundRouteFileOf(integration, ctx.layout, ctx.roots);
        const compositionModule = inboundCompositionModuleOf(integration, ctx.layout);
        const modules = bodyModulesOf(ctx, { what: `外部連携 ${integration.id} の受信の配線`, location: integration.location });
        return [
          { file: compositionFile, content: renderComposition(integration, catalog.location.file, ctx.platform, modules, ctx.config?.catalog?.variables ?? []), wholeFile: true },
          { file: routeFile, content: renderRoute(integration, catalog.location.file, compositionModule), wholeFile: true },
        ];
      });
  },
};

/** 受信の連携が生む app 側のファイル 1 件(構造の閉世界に載せる形)。 */
export interface InboundExpectedFile {
  readonly event: string;
  readonly file: string;
  readonly export: string;
}

/**
 * 受信の行から導いた app 側の期待ファイル(配線と受信口)。
 *
 * `event` には写像されたドメインイベント ID を入れる —— 「この口は何を起こすのか」が
 * 構造の一覧からも読めるようにするためである(保存点の鍵と同じ流儀)。
 *
 * @param catalog 読み込み済みの外部連携カタログ(無ければ空)
 * @param layout 置き場の配置(文脈の配置。役割を解決できなければ前提の失敗で止める)
 * @returns ファイルの期待(パスは `app/` からの相対)
 */
export function inboundExpectations(
  catalog: { readonly integrations: readonly IntegrationDecl[] } | null | undefined,
  layout: ProductLayout,
): InboundExpectedFile[] {
  // 期待ファイル木は**実装の木の中の相対パス**で持つ(閉世界の検査が木の根を別に知っている)。製品の根からの相対で解く。
  const inApp = { app: '' };
  return (catalog?.integrations ?? [])
    .filter(isInbound)
    .flatMap((integration) => {
      const event = integration.emits;
      return [
        { event, file: inboundCompositionFileOf(integration, layout, inApp), export: inboundFactoryOf(integration.id) },
        { event, file: inboundRouteFileOf(integration, layout, inApp), export: 'POST' },
      ];
    });
}

/**
 * 署名検証の式(本文は**受信したバイト列のまま**渡る。復号した文字列で検証すると、相手が生のバイト列に
 * 署名していて本文に不正な UTF-8 や BOM がある日に永久に合わない)。
 *
 * `provider_sdk` だけはアダプタが検証を持つ(相手の SDK が判定する方式なので、体系側に
 * 実体を置けない)。`hmac_sha256` は宣言された鍵を渡して体系側の関数が判定する。`none` は
 * **理由つきで宣言したときだけ**開く。方式は型で閉じた和なので、網羅を `assertNever` で確かめる
 * (方式を足した日に、ここが書き分けを持たないまま開くことが無い)。
 */
function verifyExpression(integration: InboundIntegrationDecl, variables: readonly ConfigVariableDecl[]): readonly string[] {
  switch (integration.signature) {
    case 'provider_sdk':
      return ['    verify: (rawBody, presented) => receiver.verifySignature?.(rawBody, presented) ?? false,'];
    case 'none':
      // 署名を検証しないと宣言した口である。**誰でも叩ける**ことを生成物の字面に残す
      // (宣言された理由も一緒に置く —— 理由の無い免除をこの体系は持たない)。
      return [
        `    // 署名を検証しない口である(誰でも叩ける)。理由: ${lineCommentText(integration.signatureReason)}`,
        '    verify: () => true,',
      ];
    case 'hmac_sha256':
      // 鍵は宣言された **名前**(`signature_key`)で引く。`config` の先頭を暗黙の鍵にすると、
      // 鍵以外の設定を 1 つ足した瞬間に検証が常に落ちる(X5 が接地を見ている)。
      return [
        '    verify: (rawBody, presented) =>',
        `      verifyInboundSignature(${tsString(integration.signature)}, ${hmacKeyExpression(integration.signatureKey, variables)}, rawBody, presented),`,
      ];
    default:
      return assertNever(integration);
  }
}

/**
 * 署名の鍵を読む式。カタログの行が `strength` を宣言していれば、長さの下限を守る関門(`readServiceSecret`)を通して読む
 * (短い鍵は未設定と同じに閉じる)。行が `previous` を宣言していれば、更新前の鍵も並べる(更新の間は新旧どちらの鍵で署名した相手も受ける)。
 * `strength` が無い行は従来の素の参照のまま —— 宣言の欠けは K6 が止める(生成物で黙って埋めない)。
 */
function hmacKeyExpression(key: string, variables: readonly ConfigVariableDecl[]): string {
  const row = variables.find((decl) => decl.id === key);
  const strength = row?.strength;
  if (strength === undefined) return `process.env[${tsString(key)}]`;
  const read = (name: string): string => `readServiceSecret(${tsString(name)}, process.env[${tsString(name)}], ${String(strength.minLength)})`;
  return row?.previous === undefined ? read(key) : `[${read(key)}, ${read(row.previous)}]`;
}

/** 網羅の確かめ(方式の和に枝の無い値が来たら型で落ちる)。 */
function assertNever(value: never): never {
  return value;
}

/** 配線(Composition Root)。分岐も計算も無く、宣言から決まる値を繋ぐだけ。 */
function renderComposition(
  integration: InboundIntegrationDecl,
  specFile: string,
  platform: PlatformProfile,
  modules: BodyModules,
  variables: readonly ConfigVariableDecl[],
): string {
  const emits = integration.emits;
  const hmac = integration.signature === 'hmac_sha256';
  const keyRow = integration.signature === 'hmac_sha256' ? variables.find((decl) => decl.id === integration.signatureKey) : undefined;
  const readsStrongKey = keyRow?.strength !== undefined;
  const rpc = inboundRpcName(integration.id);
  return [
    generatedHeader([specFile]),
    '',
    "import 'server-only';",
    `import type { InboundRoute } from '${RUNTIME_INBOUND_MODULE}';`,
    ...(hmac ? [`import { verifyInboundSignature } from '${RUNTIME_INBOUND_SIGNATURE_MODULE}';`] : []),
    ...(readsStrongKey ? [`import { readServiceSecret } from '${RUNTIME_SECRET_MODULE}';`] : []),
    `import { createDbPorts } from '${modules.dbPorts()}';`,
    `import { create${integration.port} } from '${modules.sourceFile(integration.adapter)}';`,
    '',
    docComment([
      `${integration.summary} —— 受信 ${tsString(integration.id)} の配線。`,
      '',
      `仕様: ${specFile}`,
      '',
      'この層の役割は配線だけである(ARCH-BE-0001)。署名の鍵は宣言された設定から、記録と遷移を',
      `1 トランザクションで呼び出す RPC(\`${platform.exposedSchema}.${rpc}\`)は生成された migration から、本文の読み取りは`,
      'アダプタから来る。段取りそのものは `@kaninabe/runtime/inbound` の唯一の実体が持つ。',
      '',
      `**アダプタが返す \`payload\` の形**: \`{ record: {…}, target_id: "…" }\`。\`record\` は記録先の`,
      '表に入れる欄(外部イベント ID の列は RPC が `p_event_id` から埋めるので書かない)、',
      `\`target_id\` は \`${emits}\` を実行する対象の id である。`,
      '',
      '@returns 受信口が呼ぶ、この連携 1 本分の宣言',
    ]),
    `export function ${inboundFactoryOf(integration.id)}(): InboundRoute {`,
    `  const receiver = create${integration.port}();`,
    '  const { rpc } = createDbPorts();',
    '  return {',
    `    integration: ${tsString(integration.id)},`,
    `    emits: ${tsString(emits)},`,
    `    onConflict: ${tsString(integration.onConflict)},`,
    // 本文の上限(宣言が無ければ小さめの既定。超えた本文は署名を検証する前に 413 で閉じる)。
    `    maxBodyBytes: ${String(integration.maxBodyBytes)},`,
    ...verifyExpression(integration, variables),
    '    receiver,',
    // 受信口に人のセッションは無い。実行者は system であり、その口を叩けることの根拠は
    // 署名検証だけである(`by` に system を並べていることは X5 が仕様側で見ている)。
    // 効果(通知など)は生成された RPC の本体にあり、引数に載らない。要求した効果を追わない(`null`)と宣言する
    // (既定のまま呼ぶと受領が「効果を要求しなかった」空の配列になり、「積まなかった」と読めてしまう)。
    '    apply: (eventId, payload) =>',
    `      rpc.call(${tsString(rpc)}, { p_event_id: eventId, p_actor_id: null, p_payload: payload }, { tracksEffects: false }),`,
    '  };',
    '}',
    '',
  ].join('\n');
}

/** 受信口(Route Handler)。配線を呼ぶだけ(`compositionModule` は配線の import 指定)。 */
function renderRoute(integration: InboundIntegrationDecl, specFile: string, compositionModule: string): string {
  const factory = inboundFactoryOf(integration.id);
  return [
    generatedHeader([specFile]),
    '',
    `import { ${factory} } from '${compositionModule}';`,
    `import { runInbound } from '${RUNTIME_INBOUND_MODULE}';`,
    `import { guardRoute } from '${RUNTIME_ROUTE_GUARD_MODULE}';`,
    '',
    docComment([
      `${integration.summary} —— 受信 ${tsString(integration.id)} の口。`,
      '',
      `仕様: ${specFile}`,
      '',
      'Server Action と違い、この口には人間のセッションが無い。認可は宣言された方式の',
      '署名検証だけであり、鍵が設定されていなければ**開いていない**(401)。',
    ]),
    'export const dynamic = ' + tsString('force-dynamic') + ';',
    '',
    docComment([
      '受信した 1 本を処理する。',
      '',
      '@param request - 相手から届いたリクエスト',
      '@returns 本文が上限を超えれば 413、署名不一致は 401、本文を読めなければ 400、受け取り切ったら 200',
      '(口は出口の関所 `guardRoute` で包む — 応答の行き先の見出しを外へ出さない)',
    ]),
    `export const POST = guardRoute(async (request: Request): Promise<Response> => runInbound(request, ${factory}()));`,
    '',
  ].join('\n');
}
