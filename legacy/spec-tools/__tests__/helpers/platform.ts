/**
 * テストが使う「プラットフォームの設定」(`PlatformProfile` の値)。
 *
 * 本番の組み立ての根(CLI)が選ぶのと同じ値(Supabase)を使う —— テストの値を別に書き写すと、
 * 設定の綴りを動かした日にテストだけが古い綴りで緑になる。SQL を書く生成器・検証器へ渡す。
 * 設定そのものの形を試すテストは、この定数ではなく自分で値を組む。
 */

import type { ProductLayout, RoleStructure } from '../../lib/model/product/layout.js';
import type { PlatformProfile } from '../../lib/model/product/platform-profile.js';
import type { ProductRoots } from '../../lib/model/product/types.js';
import { surfacePlatformOf } from '../../lib/data/verifiers/t12-surface-naming-input.js';
import type { SurfacePlatform } from '../../lib/data/verifiers/t12-surface-naming.js';
import { allGenerators } from '../../lib/compose/all-generators.js';
import { selectTargetSet, targetGenerators, verifyInputsOf } from '../../lib/target-api/contract.js';
import type { SelectionRoots, Target, TargetSelection } from '../../lib/target-api/contract.js';
import { NEXTJS_LAYOUT } from '../../lib/targets/nextjs/layout.js';
import { NEXTJS_TARGET } from '../../lib/targets/nextjs/target.js';
import { SUPABASE_PLATFORM_PROFILE } from '../../lib/targets/supabase/platform-profile.js';
import { SUPABASE_TARGET } from '../../lib/targets/supabase/target.js';
import { VERCEL_TARGET } from '../../lib/targets/vercel/target.js';
import { bodyModulesOf } from '../../lib/generate/body-modules.js';
import type { BodyModules } from '../../lib/generate/body-modules.js';
import { TEST_ROOTS } from './product-roots.js';

/** 本番と同じ Supabase の設定。 */
export const TEST_PLATFORM: PlatformProfile = SUPABASE_PLATFORM_PROFILE;

/**
 * Supabase とどの綴りも重ならない別のプラットフォームの設定。
 *
 * 「SQL を書く側が設定の中身を知らない」ことを見るために、設定を差し替えたとき出力の綴りが全部これに
 * 変わり、Supabase の綴りが 1 つも残らないことを確かめる(生成器の直書きが 1 本残ると、ここで赤になる)。
 */
export const FOREIGN_PLATFORM: PlatformProfile = {
  roles: { anonymous: 'visitor', authenticated_default: 'signed_in', system: 'worker' },
  currentActorExpr: 'ctx.actor_id()',
  sessionAliveExpr: 'ctx.session_valid()',
  sessionClaimsPath: ['claims', 'attrs'],
  exposedSchema: 'edge',
  surfaceExposure: { kind: 'sql-is-api' },
  functionCreators: [
    { role: 'builder', handling: 'migration' },
    { role: 'operator', handling: 'external', reason: '別の層が持つ管理者の役。接続の役はそのメンバーではない。' },
  ],
};

/** T12 の公開面の判定が読む構成(外に出すスキーマの名前・後段の能力)。既定は本番と同じ Supabase の設定。 */
export function surfacePlatform(platform: PlatformProfile = TEST_PLATFORM): SurfacePlatform {
  return surfacePlatformOf(platform);
}

/** 本番と同じ Next.js の置き場の配置。 */
export const TEST_LAYOUT: ProductLayout = NEXTJS_LAYOUT;

/** 本番と同じ配置・このリポジトリの製品の根から引いた、生成物の本文が import する先の解決(本文を組む関数を直に呼ぶテストが渡す)。 */
export const TEST_BODY_MODULES: BodyModules = bodyModulesOf({ layout: NEXTJS_LAYOUT, roots: TEST_ROOTS }, { what: 'テスト', location: { file: 'test' } });

/**
 * Next.js と綴りが 1 つも重ならない架空の**層と土台ディレクトリの表**(`FOREIGN_LAYOUT` の `source-root` が宣言する)。
 *
 * 層は足す 4 つ(`handlers` / `wiring` / `endpoints` / `ui`)・土台の置き場は `FOREIGN_LAYOUT` の役割の置き場(`handlers/saves/…` ほか)と食い違わないように `placedBy` で名指す
 * (配置の定義の検査が見る)。コアの層の 4 名の下の土台は架空の名前(`built` / `common` / `connectors`)で、実行時パッケージの行は 1 本、載せていない手書きの置き場は 1 本。
 */
export const FOREIGN_STRUCTURE: RoleStructure = {
  layers: [
    { name: 'handlers', role: 'リクエストの入口の層', closedWorld: 'none' },
    { name: 'wiring', role: '外の仕組みとの配線の層', closedWorld: 'none' },
    { name: 'endpoints', role: '外から叩かれる口の層', closedWorld: 'none' },
    { name: 'ui', role: '画面の部品の層', closedWorld: 'none', scanExtensions: ['.ts'] },
  ],
  baseDirs: [
    { root: 'framework', layer: 'domain', dir: 'kernel', role: '実行時の核', generated: false, vocabularyScan: true, layout: 'flat', perSpec: false },
    { root: 'product', layer: 'domain', dir: 'built', role: '仕様からの生成物', generated: true, vocabularyScan: false, layout: 'flat', perSpec: false },
    { root: 'product', layer: 'operation', dir: 'common', role: '集約をまたぐ共有物', generated: false, vocabularyScan: true, layout: 'flat', perSpec: false },
    { root: 'product', layer: 'operation', dir: 'usecase', role: '保存点の手書きの hooks', generated: false, vocabularyScan: false, layout: 'nested', perSpec: false },
    { root: 'product', layer: 'operation', dir: '__tests__', role: 'テスト支援', generated: false, vocabularyScan: false, layout: 'flat', perSpec: false },
    { root: 'product', layer: 'infrastructure', dir: 'connectors', role: '外の仕組みとの接続', generated: false, vocabularyScan: true, layout: 'flat', perSpec: false },
    { root: 'product', layer: 'infrastructure', dir: '__tests__', role: 'テスト支援', generated: false, vocabularyScan: false, layout: 'flat', perSpec: false },
    {
      root: 'product',
      layer: 'handlers',
      dir: 'saves',
      role: '保存点の入口(生成物)',
      generated: true,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: true,
      placedBy: { role: 'save-entry', key: 'a.b' },
    },
    {
      root: 'product',
      layer: 'wiring',
      dir: 'saves',
      role: '保存点の配線(生成物)',
      generated: true,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: true,
      placedBy: { role: 'save-composition', key: 'a.b' },
    },
    {
      root: 'product',
      layer: 'wiring',
      dir: 'webhooks',
      role: '受信の配線(生成物)',
      generated: true,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: true,
      placedBy: { role: 'composition-root', key: 'x' },
    },
    {
      root: 'product',
      layer: 'endpoints',
      dir: 'hooks/in',
      role: '受信口(生成物)',
      generated: true,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: true,
      placedBy: { role: 'http-entry', key: '/hooks/in/x' },
    },
    {
      root: 'product',
      layer: 'ui',
      dir: 'parts',
      role: '画面の部品(生成物)',
      generated: true,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: true,
      placedBy: { role: 'screen-part', key: 'sample.file' },
    },
    {
      root: 'product',
      layer: 'ui',
      dir: 'forms',
      role: '保存点の 1 画面フォーム(生成物)',
      generated: true,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: true,
      placedBy: { role: 'ui-component', key: 'sample.file' },
    },
  ],
  unlistedDirs: [{ layer: 'wiring', dir: 'misc', role: '手書きの配線の置き場(表に載せない)' }],
  auxFiles: [{ layer: 'operation', file: 'iface.ts', role: '操作が宣言する IF' }],
  runtimeSource: 'rt_code',
};

/**
 * Next.js と綴りが 1 つも重ならない架空の置き場の配置。
 *
 * 「コアが配置の中身を知らない」ことを見るために、配置を差し替えたとき HTTP の入口・受信口・配線のパスと import の指定が全部これに変わり、
 * Next.js の綴り(`src` ・`app/` ・`route.ts` ・`@/` ・`composition/inbound`)が 1 つも残らないことを確かめる(直書きが 1 本残ると、ここで赤になる)。
 */
export const FOREIGN_LAYOUT: ProductLayout = {
  'product-root': NEXTJS_LAYOUT['product-root'] ?? {
    multiplicity: { min: 0, max: 1, key: 'none' },
    owners: [{ kind: 'product_declaration' }],
    base: null,
    origin: 'handwritten',
    access: { readers: [], writers: [], when: 'テスト' },
    onCollision: 'fail',
    place: null,
    module: null,
  },
  'source-root': { ...(NEXTJS_LAYOUT['source-root'] ?? failMissing()), place: () => 'server_code', module: () => '~srv', structure: FOREIGN_STRUCTURE },
  'http-entry': {
    ...(NEXTJS_LAYOUT['http-entry'] ?? failMissing()),
    place: (url) => `endpoints${url}.handler.ts`,
    module: (url) => `~srv/endpoints${url}.handler`,
    classify: {
      dir: 'endpoints',
      keyOf: (relative) => (relative.endsWith('.handler.ts') ? `/${relative.slice(0, -'.handler.ts'.length)}` : null),
    },
  },
  'composition-root': {
    ...(NEXTJS_LAYOUT['composition-root'] ?? failMissing()),
    place: (integration) => `wiring/webhooks/${integration}.wire.ts`,
    module: (integration) => `~srv/wiring/webhooks/${integration}.wire`,
  },
  'screen-shell': {
    ...(NEXTJS_LAYOUT['screen-shell'] ?? failMissing()),
    place: (route) => (route === '' ? 'pages/index.view.ts' : `pages${route}.view.ts`),
    classify: {
      dir: 'pages',
      keyOf: (relative) => {
        if (!relative.endsWith('.view.ts')) return null;
        const name = relative.slice(0, -'.view.ts'.length);
        return name === 'index' ? '/' : `/${name}`;
      },
    },
  },
  'request-gate': { ...(NEXTJS_LAYOUT['request-gate'] ?? failMissing()), place: () => 'edge_filter.ts' },
  'screen-part': { ...(NEXTJS_LAYOUT['screen-part'] ?? failMissing()), place: (file) => `ui/parts/${file}` },
  'screen-test': { ...(NEXTJS_LAYOUT['screen-test'] ?? failMissing()), place: (file) => `ui/checks/${file}` },
  'app-icon': { ...(NEXTJS_LAYOUT['app-icon'] ?? failMissing()), place: () => 'ui/brand_default.png' },
  'operation-test': {
    ...(NEXTJS_LAYOUT['operation-test'] ?? failMissing()),
    place: (op) => `checks/ops/${op.replace('.', '__')}.check.ts`,
  },
  'compute-example-test': {
    ...(NEXTJS_LAYOUT['compute-example-test'] ?? failMissing()),
    place: (ref) => `checks/pure/${ref}.table.check.ts`,
    classify: { dir: 'checks/pure', keyOf: foreignStem('.table.check.ts') },
  },
  'eq-test': {
    ...(NEXTJS_LAYOUT['eq-test'] ?? failMissing()),
    place: (name) => `checks/db/same/${name}.agg.test.ts`,
    classify: { dir: 'checks/db/same', keyOf: foreignStem('.agg.test.ts') },
  },
  'eq-save-test': {
    ...(NEXTJS_LAYOUT['eq-save-test'] ?? failMissing()),
    place: (name) => `checks/db/same_save/${name}.flow.test.ts`,
    classify: { dir: 'checks/db/same_save', keyOf: foreignStem('.flow.test.ts') },
  },
  'rls-test': {
    ...(NEXTJS_LAYOUT['rls-test'] ?? failMissing()),
    place: (name) => `checks/db/visibility/${name}.view.test.ts`,
    classify: { dir: 'checks/db/visibility', keyOf: foreignStem('.view.test.ts') },
  },
  'harness-adapter': { ...(NEXTJS_LAYOUT['harness-adapter'] ?? failMissing()), place: (name) => `checks/glue/${name}.glue.ts` },
  'save-harness-adapter': { ...(NEXTJS_LAYOUT['save-harness-adapter'] ?? failMissing()), place: (name) => `checks/glue_save/${name}.glue.ts` },
  'cron-route-test': { ...(NEXTJS_LAYOUT['cron-route-test'] ?? failMissing()), place: () => 'checks/cron/all_routes.check.ts' },
  'browser-defense-test': { ...(NEXTJS_LAYOUT['browser-defense-test'] ?? failMissing()), place: () => 'checks/browser/defense.check.ts' },
  'paid-entry-test': { ...(NEXTJS_LAYOUT['paid-entry-test'] ?? failMissing()), place: () => 'checks/browser/paid_gate.check.ts' },
  'operation-entry': {
    ...(NEXTJS_LAYOUT['operation-entry'] ?? failMissing()),
    place: (op) => `handlers/ops/${op.replace('.', '__')}.action.ts`,
    classify: { dir: 'handlers/ops', keyOf: foreignPair('.action.ts') },
  },
  'operation-composition': {
    ...(NEXTJS_LAYOUT['operation-composition'] ?? failMissing()),
    place: (op) => `wiring/ops/${op.replace('.', '__')}.wire.ts`,
    module: (op) => `~srv/wiring/ops/${op.replace('.', '__')}.wire`,
    classify: { dir: 'wiring/ops', keyOf: foreignPair('.wire.ts') },
  },
  'save-entry': {
    ...(NEXTJS_LAYOUT['save-entry'] ?? failMissing()),
    place: (save) => `handlers/saves/${save.replace('.', '__')}.action.ts`,
    classify: { dir: 'handlers/saves', keyOf: foreignPair('.action.ts') },
  },
  'save-composition': {
    ...(NEXTJS_LAYOUT['save-composition'] ?? failMissing()),
    place: (save) => `wiring/saves/${save.replace('.', '__')}.wire.ts`,
    module: (save) => `~srv/wiring/saves/${save.replace('.', '__')}.wire`,
    classify: { dir: 'wiring/saves', keyOf: foreignPair('.wire.ts') },
  },
  // 認証基盤の操作(platform_ops。ADR-0019)の入口・組み立ての根・配線先・生成テスト。
  'platform-op-entry': {
    ...(NEXTJS_LAYOUT['platform-op-entry'] ?? failMissing()),
    place: (op) => `handlers/platform/${op.replace('.', '__')}.action.ts`,
    classify: { dir: 'handlers/platform', keyOf: foreignPair('.action.ts') },
  },
  'platform-op-composition': {
    ...(NEXTJS_LAYOUT['platform-op-composition'] ?? failMissing()),
    place: (op) => `wiring/platform/${op.replace('.', '__')}.wire.ts`,
    module: (op) => `~srv/wiring/platform/${op.replace('.', '__')}.wire`,
    classify: { dir: 'wiring/platform', keyOf: foreignPair('.wire.ts') },
  },
  'platform-binding': {
    ...(NEXTJS_LAYOUT['platform-binding'] ?? failMissing()),
    place: (port) => `wiring/${port.toLowerCase()}.port.ts`,
    module: (port) => `~srv/wiring/${port.toLowerCase()}.port`,
  },
  'platform-op-test': { ...(NEXTJS_LAYOUT['platform-op-test'] ?? failMissing()), place: () => 'checks/platform/all_ops.check.ts' },
  'ui-component': {
    ...(NEXTJS_LAYOUT['ui-component'] ?? failMissing()),
    place: (file) => `ui/forms/${file}`,
    classify: { dir: 'ui/forms', keyOf: (relative) => (relative.includes('/') ? null : relative) },
  },
  'operation-logic': {
    ...(NEXTJS_LAYOUT['operation-logic'] ?? failMissing()),
    place: (op) => `rules/${op.replace('.', '__')}.rule.ts`,
    classify: { dir: 'rules', keyOf: foreignPair('.rule.ts') },
  },
  infrastructure: {
    ...(NEXTJS_LAYOUT['infrastructure'] ?? failMissing()),
    place: (dir) => `store/${dir}/repo.ts`,
    classify: { dir: 'store', keyOf: (relative) => (relative.includes('/') ? (relative.split('/')[0] ?? null) : null) },
  },  'e2e-root': { ...(NEXTJS_LAYOUT['e2e-root'] ?? failMissing()), place: () => 'journeys' },
  'env-template': { ...(NEXTJS_LAYOUT['env-template'] ?? failMissing()), place: () => 'etc/env.sample' },
  'script-root': { ...(NEXTJS_LAYOUT['script-root'] ?? failMissing()), place: () => 'etc/scripts' },
  'app-resource': { ...(NEXTJS_LAYOUT['app-resource'] ?? failMissing()), place: (relative) => `ui/assets/${relative}` },
  // 生成物の本文が import する手書きの接続点(部品化 ③-e1)。指定は置き場から導く(別名 `~srv` + 拡張子なしの置き場)。
  'operation-hooks': {
    ...(NEXTJS_LAYOUT['operation-hooks'] ?? failMissing()),
    place: (op) => `rules/${op.replace('.', '__')}.guard.ts`,
    module: (op) => `~srv/rules/${op.replace('.', '__')}.guard`,
    classify: { dir: 'rules', keyOf: foreignPair('.guard.ts') },
  },
  'computes-module': {
    ...(NEXTJS_LAYOUT['computes-module'] ?? failMissing()),
    place: (ref) => `pure/${ref}.fn.ts`,
    module: (ref) => `~srv/pure/${ref}.fn`,
  },
  'preflight-module': { ...(NEXTJS_LAYOUT['preflight-module'] ?? failMissing()), place: () => 'pure/entry_check.ts', module: () => '~srv/pure/entry_check' },
  'shared-component': {
    ...(NEXTJS_LAYOUT['shared-component'] ?? failMissing()),
    place: (file) => `ui/kit/${file}.view.ts`,
    module: (file) => `~srv/ui/kit/${file}.view`,
  },
  'auth-composition': { ...(NEXTJS_LAYOUT['auth-composition'] ?? failMissing()), place: () => 'wiring/who.ts', module: () => '~srv/wiring/who' },
  'system-clock': { ...(NEXTJS_LAYOUT['system-clock'] ?? failMissing()), place: () => 'store/clock.ts', module: () => '~srv/store/clock' },
  'db-ports': { ...(NEXTJS_LAYOUT['db-ports'] ?? failMissing()), place: () => 'etc/db_open.ts', module: () => '~srv/etc/db_open' },
  // ブラウザ側の守りの配線が読む手書きの置き場(枠の設定・根のレイアウト・前段のセッションの更新)。
  'session-refresh': { ...(NEXTJS_LAYOUT['session-refresh'] ?? failMissing()), place: () => 'store/session_renew.ts', module: () => '~srv/store/session_renew' },
  'app-config': { ...(NEXTJS_LAYOUT['app-config'] ?? failMissing()), place: () => 'frame.settings.ts' },
  'root-layout': { ...(NEXTJS_LAYOUT['root-layout'] ?? failMissing()), place: () => 'ui/frame_root.ts' },
};

/**
 * `FOREIGN_LAYOUT` / `FOREIGN_BODY_COMPATIBLE_LAYOUT` のソースの根の下へ合わせた製品の根。
 *
 * 生成物の総置き場(`roots.generated`)は製品の宣言が決め、配置のソースの根の中にある(生成物の本文が import する指定は、そこから導く)。別の綴りの配置を試すときは、
 * 宣言もその配置のソースの根の下へ動かす(動かさないと、生成物の根の下の指定を決められない)。
 */
export const FOREIGN_ROOTS: ProductRoots = { ...TEST_ROOTS, generated: `${TEST_ROOTS.app ?? ''}/server_code/domain/generated` };

/**
 * `FOREIGN_LAYOUT` と同じ別の綴りの配置のうち、**生成物の本文が辿る相対の import(`layout-body-imports.ts`)と食い違わない**形に、生成テストとアダプタの 6 役割だけを置き直したもの。
 *
 * `FOREIGN_LAYOUT` は置き場の深さが Next.js と違うので、本文の相対の指定(`../../eq-world`・`../../infrastructure/__tests__/eq-world`)が辿り着かない — 配置の定義の検査が止める反例である
 * (契約を満たす別の配置が要るテスト = 選択・定義の検査の合格側は、こちらを使う)。**基盤の層のアダプタの置き場の根は、保存点のアダプタの本文が `infrastructure/__tests__` を直に指す写しなので、
 * どの配置でも動かせない**(本文を配置から組む P5 以降でなければ外せない)。
 */
export const FOREIGN_BODY_COMPATIBLE_LAYOUT: ProductLayout = {
  ...FOREIGN_LAYOUT,
  'harness-adapter': { ...(NEXTJS_LAYOUT['harness-adapter'] ?? failMissing()), place: (name) => `infrastructure/__tests__/${name}.ts` },
  'eq-test': {
    ...(NEXTJS_LAYOUT['eq-test'] ?? failMissing()),
    place: (name) => `infrastructure/__tests__/ck/same/${name}.agg.test.ts`,
    classify: { dir: 'infrastructure/__tests__/ck/same', keyOf: foreignStem('.agg.test.ts') },
  },
  'rls-test': {
    ...(NEXTJS_LAYOUT['rls-test'] ?? failMissing()),
    place: (name) => `infrastructure/__tests__/ck/visibility/${name}.view.test.ts`,
    classify: { dir: 'infrastructure/__tests__/ck/visibility', keyOf: foreignStem('.view.test.ts') },
  },
  'save-harness-adapter': { ...(NEXTJS_LAYOUT['save-harness-adapter'] ?? failMissing()), place: (name) => `bridge/save/${name}.ts` },
  'eq-save-test': {
    ...(NEXTJS_LAYOUT['eq-save-test'] ?? failMissing()),
    place: (name) => `bridge/save/ck/same_save/${name}.flow.test.ts`,
    classify: { dir: 'bridge/save/ck/same_save', keyOf: foreignStem('.flow.test.ts') },
  },
};

/** 平らな置き場の相対パスから、`{集約}__{イベント}` + 末尾の綴りを `{集約}.{イベント}` のキーにして返す(架空の配置の逆引き用。段が違うものは null)。 */
function foreignPair(suffix: string): (relative: string) => string | null {
  return (relative) => (relative.includes('/') || !relative.endsWith(suffix) ? null : relative.slice(0, -suffix.length).replace('__', '.'));
}

/** 平らな置き場の相対パスから、末尾の綴りを除いたキーを返す(架空の配置の逆引き用)。 */
function foreignStem(suffix: string): (relative: string) => string | null {
  return (relative) => (relative.includes('/') || !relative.endsWith(suffix) ? null : relative.slice(0, -suffix.length));
}

/**
 * Next.js の綴りのうち、**HTTP の入口と受信口の分**(置き場の配置に移した役割の分)が 1 つでも出力に残っているか。
 *
 * 見ているのは Route Handler のファイル名・`app/api/`・ソースの根の別名の指定(別名の接頭辞 `@/` で始まる import の指定は、生成物の根の下・手書きの接続点・組み立ての根・UI 部品の全部が
 * 配置から引くようになった。部品化 ③-e1)・`composition/inbound`・`src/app` と、画面の器まわり
 * (`page.tsx` ・`proxy.ts` ・`favicon.ico` ・`_screens` ・`__screens__`)と、生成テストの置き場(`__tests__/generated`)と、操作・保存点の入口(`_actions`)・保存点の組み立ての根と
 * フォームの置き場(`composition/usecase`・`components/usecase/generated`)だけである。
 * **まだ移していない綴りは見ない**(限界): `force-dynamic` / `server-only`(フレームワークの語。アプリの枠の後段の生成器へ寄せる日に扱う)。
 * ここが緑でも、生成物が Next.js の綴りを全く含まないことは意味しない。
 */
export function leaksNextjsEntrySpelling(text: string): boolean {
  return /\/route\.ts|\bapp\/api\/|composition\/inbound|(?:^|[\s'"`])@\/|\bsrc\/app|page\.tsx|proxy\.ts|favicon\.ico|_screens|__screens__|__tests__\/generated|_actions|composition\/usecase|components\/usecase\/generated/.test(text);
}

/** 配置の元の値が足りないテストの書き間違いを知らせる(投げる)。 */
function failMissing(): never {
  throw new Error('NEXTJS_LAYOUT に必要な役割がありません');
}

/** Supabase の綴り(ロール名・認証関数・JWT の枝・外に出すスキーマ)が 1 つでも出力に残っているか。 */
export function leaksSupabaseSpelling(text: string): boolean {
  return /\bauth\.(uid|jwt)\b|\bapp_metadata\b|\bservice_role\b|(?<![\w.])(anon|authenticated)(?![\w:])|\bapi\.[a-z_]+/.test(text);
}

/** 本番(CLI の `DEFAULT_TARGETS`)と同じ後段の組。Supabase(プラットフォーム)+ Vercel(ホスト)+ Next.js(アプリの枠)。 */
export const TEST_TARGETS: readonly Target[] = [SUPABASE_TARGET, VERCEL_TARGET, NEXTJS_TARGET];

/** 本番と同じ全部入りの生成器の ID(コアの生成器 + 本番の後段が登録する生成器)。配置の持ち主の生成器の実在を確かめる選択の契約に渡す。 */
export const TEST_GENERATOR_IDS: ReadonlySet<string> = new Set(allGenerators(targetGenerators(TEST_TARGETS)).map((generator) => generator.id));

/**
 * 後段の一覧を契約に通して選択にする(契約違反はテストの書き間違いなので投げる)。
 *
 * @param targets 選ぶ後段
 * @param roots 製品の根(既定はこのリポジトリの宣言 = 実装の木あり。実装の木があればアプリの枠の後段がちょうど 1 つ要る)
 */
export function selectionOf(targets: readonly Target[], roots: SelectionRoots = TEST_ROOTS): TargetSelection {
  const result = selectTargetSet(targets, roots, TEST_GENERATOR_IDS);
  if (!result.ok) throw new Error(`テストの後段の選択が契約を満たしません: ${result.problems.join(' / ')}`);
  return result.selection;
}

/** 本番と同じ全部入りの選択(検査・生成のテストの既定)。 */
export const TEST_SELECTION: TargetSelection = selectionOf(TEST_TARGETS);

/** 検証の束ね(`runAllVerifications`)へ渡す、本番と同じ全部入りの後段の入力(設定と、後段が登録した検査)。 */
export const TEST_VERIFY_INPUTS = verifyInputsOf(TEST_SELECTION);

/**
 * 何も検査も生成器も登録しない、プラットフォームだけの後段(`platform` を指定する)。
 * 「後段が受け持つ検査が無い構成」(ホストの後段なし・DB 内スケジューラの後段なし)を作るために、全部入りから後段を引き算する形で使う。
 *
 * @param platform このプラットフォームの設定
 * @param verifiers 登録する検査(省略は無し)
 */
export function barePlatformTarget(platform: PlatformProfile = TEST_PLATFORM, verifiers: Target['verifiers'] = []): Target {
  return { id: 'bare-platform', role: 'platform', verifiers, generators: [], platform };
}
