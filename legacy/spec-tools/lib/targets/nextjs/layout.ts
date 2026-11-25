/**
 * **アプリの枠の後段 Next.js(`role: app_frame`)の置き場の値**(`ProductLayout`)。
 *
 * コアは置き場の**役割**だけを知り(`lib/model/product/layout.ts`)、役割がどのパスに置かれるかは、ここが与える(設計メモ framework-modules §20-2)。
 * 語彙は 39 役割(移すかたまりで足す)。HTTP の入口まわりの 4 つ:
 *
 * | 役割 | Next.js の置き場 | 基準 |
 * |---|---|---|
 * | `product-root` | 製品の宣言(`product.md` の `roots.app`)が決める | リポジトリルート |
 * | `source-root` | `src` | `product-root` |
 * | `http-entry` | `app{URL}/route.ts`(Route Handler。import は基準の `module` に置き場を接いだ `@/app{URL}/route`)。**逆引き**: `app/` の下の `route.ts` から URL を読む(画面の器と同じ規則で、非公開・パラレルルート・インターセプトの下は URL にならない・ルートグループは消える。**動的なセグメント `[x]` を含む入口は 1 本の URL に結べないので null** — Cron が叩く URL にならない) | `source-root` |
 * | `composition-root` | `composition/inbound/{連携}.ts`(受信 Webhook の配線。import は `@/composition/inbound/{連携}`) | `source-root` |
 *
 * 受信口 `app/api/inbound/{連携}/route.ts` は `http-entry` の URL が `/api/inbound/{連携}` の 1 件である(URL の決め方はコアの契約)。
 * `composition-root` は受信の分だけを持つ(操作・保存点の配線は別の役割 `operation-composition` / `save-composition` — キーの形も持ち主の生成器も違う)。
 *
 * 画面の器まわりの 6 つ(部品化 ③-c2。製品が手で書くものは**検査が読むだけ**で、生成器が書くのは `screen-part` と、ブラウザ側の守りを持つリクエスト前段 `request-gate`):
 *
 * | 役割 | Next.js の置き場 | 基準 |
 * |---|---|---|
 * | `screen-shell` | `app{route}/page.tsx`(キーは仕様の `route`。**順写像**: 仕様の動的セグメント `:id` → ディレクトリ `[id]`。**逆引き**: `app/` の下の `page.*` から route を読み、`[id]` → `:id` に正規化する。キャッチオール `[...x]` / `[[...x]]` は仕様の文法に無いので**未対応**として別に返す(単一の param に誤変換しない)。**ルーティング層の下の全部のファイルを分類する閉世界**で、パラレルルート(`@`)・インターセプト(`(.)`)と、知らない形のセグメントも未対応として S7 の赤になる(本物の URL になるのに宣言できないため)。非公開(`_`)の下は Next.js が読まない。ルートグループ `(g)` は route に現れない) | `source-root` |
 * | `request-gate` | `proxy.ts`(リクエスト前段。**生成物** —— 文書の CSP・要求の出どころ・セッションの更新と、保護範囲の `matcher`) | `source-root` |
 * | `root-layout` | ルーティング層の直下の `layout.tsx`(根のレイアウト。要求ごとの描画を宣言する。製品が手で書き、生成テストが読む) | `source-root` |
 * | `screen-part` | `app/_screens/generated/{ファイル名}`(画面の部品の生成物・既定のスタイル・競合の表示) | `source-root` |
 * | `screen-test` | `app/__screens__/{ファイル名}`(手書きの screenTest) | `source-root` |
 * | `app-icon` | `app/favicon.ico`(Next のテンプレートが置く既定のアイコン。残骸として見張る)。**`design.brand` のアイコンのファイル名の規約もこの役割の持ち主(Next の Metadata Files)が受け持つ**: アイコンは `app/icon.png` または `app/icon.svg`(あれば `favicon.ico` は使われない)・共有用画像は `app/opengraph-image.png`・Apple 用は `app/apple-icon.png`。コアの検査・パーサはこの綴りを持たず、「規約は `app-icon` を与える後段が持つ」と案内する(欄の削除はしない = review-queue §28 ① の答え待ち) | `source-root` |
 *
 * 生成テストの置き場の 9 つ(部品化 ③-c3。**どれも生成器が書く**。基準は `source-root`。層の名前 `operation` / `infrastructure` / `composition` はコアの語で、この値が
 * 「どの層の下の `__tests__/generated` に置くか」を持つ。**実 DB で実行する 3 種(`eq-test` / `eq-save-test` / `rls-test`)は逆引き**で、通し実行の走査と余分の検出が置き場の根を引く):
 *
 * | 役割 | Next.js の置き場 |
 * |---|---|
 * | `operation-test` | `operation/__tests__/generated/{集約}/{イベント}.test.ts`(キーは操作 ID) |
 * | `compute-example-test` | `operation/__tests__/generated/computes/{参照}.examples.test.ts`(置き場ぜんたいが生成物) |
 * | `eq-test` | `infrastructure/__tests__/generated/equivalence/{集約}.eq.test.ts` |
 * | `eq-save-test` | `composition/__tests__/generated/equivalence/{ユースケース}.uc.eq.test.ts`(期待を出す実行器と実測の実 DB を同じテストで使えるのは配線の層だけ) |
 * | `rls-test` | `infrastructure/__tests__/generated/rls/{表}.rls.test.ts` |
 * | `harness-adapter` | `infrastructure/__tests__/{名前}.ts`(生成テストが引く住所に置く配線) |
 * | `save-harness-adapter` | `composition/__tests__/{名前}.ts`(保存点の一致の証明の配線) |
 * | `platform-op-test` | `composition/__tests__/generated/platform-ops.test.ts`(認証基盤の操作 `platform_ops` の権限表・接続・負例の見張り。1 枚) |
 * | `cron-route-test` | `app/api/__tests__/generated/cron-routes.test.ts`(Cron 起動口の認可の見張り。1 枚) |
 * | `browser-defense-test` | ルーティング層の `api/__tests__/generated` の下の `browser-defense.test.ts`(ブラウザ側の守りの配線の見張り。1 枚) |
 * | `paid-entry-test` | ルーティング層の `api/__tests__/generated` の下の `paid-entries.test.ts`(有料の口の関門を実物で叩く見張り。1 枚) |
 *
 * 操作・保存点の入口と組み立ての根とフォームの 5 つ(部品化 ③-c4a / ③-c4b。**生成器が書く**。基準は `source-root`。**逆引きを持つ**(読む側 = `trace/scan.ts` が走査の根を、置き場の衝突の検査が
 * キーを引く)。`operation-entry` / `operation-composition` は**製品が手で書く `runner: manual` の操作も同じ置き場に居る**(混在)):
 *
 * | 役割 | Next.js の置き場 |
 * |---|---|
 * | `operation-entry` | `app/_actions/{集約}/{イベント}.ts`(Server Action。キーは操作 ID。生成物と手書き(`runner: manual`)の混在。逆引きは `{集約}/{イベント}.ts` の 2 段だけ = 保存点の 3 段は操作ではない) |
 * | `operation-composition` | `composition/{集約}/{イベント}.ts`(組み立ての根。import は `@/composition/{集約}/{イベント}`。生成物と手書きの混在。逆引きは層の土台のディレクトリと `queries.ts` を操作としない) |
 * | `save-entry` | `app/_actions/usecase/{ユースケース}/{保存点}.ts`(キーは保存点 ID `{ユースケース}.{保存点}`。生成物だけ) |
 * | `save-composition` | `composition/usecase/{ユースケース}/{保存点}.ts`(import は `@/composition/usecase/…`。生成物だけ) |
 * | `ui-component` | `components/usecase/generated/{ファイル名}`(保存点 1 つ = 1 画面フォーム。生成物の分だけ) |
 *
 * 層の読み書きの 2 つ(部品化 ③-c4b。**手書きで、持ち主は製品**。基準は `source-root`。**逆引きを持つ**。層の名前 `operation` / `infrastructure` はコアの語。
 * 集約でないディレクトリ(層の土台)は、この値が `source-root` の `structure` に宣言した表(`STRUCTURE`)から読む — 部品化 ③-c5):
 *
 * | 役割 | Next.js の置き場 |
 * |---|---|
 * | `operation-logic` | `operation/{集約}/{イベント}.ts`(手書きの操作の本体。キーは操作 ID。**逆引き**: `operation/` の下の実装ファイル → 操作 ID。土台のディレクトリの下・層の直下のファイル・集約の補助ファイル(`ports.ts`)・集約の `hooks/` の下(`operation-hooks` の置き場)は操作ではない) |
 * | `infrastructure` | `infrastructure/{集約または連携}/queries.ts`(キーは集約・連携のディレクトリ名。**逆引き**: `infrastructure/` の下の実装ファイル → ディレクトリ名。土台のディレクトリの下・層の直下のファイルは null) |
 *
 * 製品の根の直下の手書きの置き場の 5 つ(部品化 ③-c6。**製品が手で書き、検査・生成は読むだけ**):
 *
 * | 役割 | Next.js の置き場 | 基準 |
 * |---|---|---|
 * | `e2e-root` | `e2e`(E2E スモークとウォーカー) | `product-root` |
 * | `env-template` | `.env.example`(設定の雛形) | `product-root` |
 * | `script-root` | `scripts`(道具のスクリプトの置き場) | `product-root` |
 * | `app-config` | `next.config.ts`(枠の設定。全応答の固定のヘッダを配る `headers()`。生成テストが読む) | `product-root` |
 * | `app-resource` | `app/{相対パス}`(ハンドブックが写し元として読むスタイル・状態バッジの部品。キーは `_styles/ui.module.css` のような相対パス) | `source-root` |
 *
 * 生成物の本文が import する手書きの接続点の 8 つ(部品化 ③-e1。**製品が手で書き、検査・生成は import の指定子を引くだけ**。基準は `source-root`。**別名の綴りはここ 1 か所**(`SOURCE_MODULE`)で、
 * 生成器は役割 + キーから指定子を受け取る。生成物の根の下のモジュールは役割にしない —— 置き場は製品の宣言 `roots.generated` が決める):
 *
 * | 役割 | Next.js の置き場 |
 * |---|---|
 * | `operation-hooks` | `operation/{集約}/hooks/{イベント}.ts`(単発の操作の hooks。キーは操作 ID。**逆引き**: 3 段の `{集約}/hooks/{イベント}.ts` → 操作 ID。`operation-logic` の逆引きはこの下を操作の本体として読まない) |
 * | `computes-module` | `domain/computes/{参照}.ts`(`computes` が名指す手書きの純関数。キーは純関数の参照) |
 * | `preflight-module` | `domain/preflight.ts`(画面の入場判定の手書きの純関数) |
 * | `shared-component` | `components/{ファイル名}.tsx`(画面をまたいで使う手書きの UI 部品。キーは拡張子なしのファイル名) |
 * | `auth-composition` | `composition/auth.ts`(認証の組み立ての根) |
 * | `system-clock` | `infrastructure/system-clock.ts`(時計の口) |
 * | `db-ports` | `infrastructure/supabase/db-ports.ts`(DB への口の束を組む配線 `createDbPorts()`) |
 * | `session-refresh` | `infrastructure/supabase/proxy-session.ts`(生成したリクエスト前段が呼ぶセッションの更新) |
 *
 * **層と土台ディレクトリの表**(部品化 ③-c5。以前はコアの土台表 `framework-base-dirs.ts` が持っていた): `source-root` の役割が `structure`(`RoleStructure`)を宣言する。層の 4 名
 * (`domain` / `operation` / `infrastructure` / `composition`)はコアの語、この値が足す層は UI 部品の層 `components` とルーティング層 `app`、土台ディレクトリの全数 18 行(実行時パッケージの
 * 行 2 本を含む。並びがそのまま生成物 `framework-structure.json` の並び)・土台の表に載せていない手書きの置き場(`composition/shared`)・補助ファイル(`ports.ts`)を、この値が宣言する。
 * 生成物の置き場の行は `placedBy` で書き込む役割を名指し、役割の置き場がその土台の中にあることを配置の定義の検査が見る。
 *
 * **この値の置き場の外に、`route.ts` / `composition/inbound/` / `page.tsx` / `proxy.ts` / `favicon.ico` / `__screens__` / `__tests__/generated` / `_actions` / `_screens` /
 * `components/usecase/generated` の綴りは書かない**(`TARGET_SPELLINGS` の nextjs の行)。ハンドブックの入口は
 * この値だけを読む(後段の契約・生成器・検査には届かない。`CLOSURE_BANS`)ので、**後段の契約・生成器・検査は import しない**(型だけ。コアの土台の表も値では読まない — 依存の向きは配置 → 土台の役割)。
 *
 * @oversize 役割の宣言 39 本(6 項目 + 値)と、層と土台の表(18 行)が 1 つの配置の値で、ハンドブックの入口が読む後段のファイルは 2 本に限る(`book-entry-target-files.ts`)ので、
 *   役割も表も別のファイルへ出せない。生成テストの 9 役割と操作・保存点の 5 役割は組み立ての補助(`generatedTestRole` ・`appPartRole`)で 1 役割 10 行ほどに抑えている。
 * @split-review 値のファイルを役割の群ごと(役割の宣言 / 層と土台の表)に割る案は、ハンドブックの入口が読んでよい後段のファイル(名指しの 2 本)を増やす = 閉包の禁止の表と名指しを変えることになる。
 *   表の行は役割の置き場の綴り(`SAVE_ACTIONS_DIR` ほか)を同じ定数で共有するので、別のファイルにすると定数を公開して 2 枚で追う形になる。割るなら 2 本目の名指しの設計から先にやる。
 */

import type { ProductLayout, RoleDecl, RoleStructure } from '../../model/product/layout.js';

/** 単発の操作の入口・組み立ての根を書く生成器の ID(コアの生成器の ID と同じ。食い違えば `nextjs/layout.test.ts` が赤)。 */
const OPERATION_GENERATOR = 'code-operation-app';

/** 保存点の入口・組み立ての根を書く生成器の ID(コアの生成器の ID と同じ。食い違えば `nextjs/layout.test.ts` が赤)。 */
const SAVE_GENERATOR = 'code-usecase-app';

/** 保存点の 1 画面フォームを書く生成器の ID(コアの生成器の ID と同じ。食い違えば `nextjs/layout.test.ts` が赤)。 */
const FORM_GENERATOR = 'code-usecase-form';

/** 画面の部品の生成物を書く生成器の ID(コアの生成器の ID と同じ。食い違えば `nextjs/layout.test.ts` が赤)。 */
const SCREEN_PART_GENERATORS = ['code-screen-forms', 'code-screen-details', 'code-screen-tables', 'code-platform-parts'] as const;

/** 認証基盤の操作(`platform_ops`)の入口と組み立ての根を書く生成器の ID(コアの生成器の ID と同じ。食い違えば `nextjs/layout.test.ts` が赤)。 */
const PLATFORM_OPS_GENERATOR = 'code-platform-ops-app';

/** 認証基盤の操作の生成テストを書く生成器の ID(同上)。 */
const PLATFORM_OPS_TESTS_GENERATOR = 'code-platform-ops-tests';

/** 受信 Webhook の口と配線を書く生成器の ID(コアの生成器の ID と同じ。食い違えば `nextjs/layout.test.ts` が赤)。 */
const INBOUND_GENERATOR = 'code-inbound-route';

/** ブラウザ側の守り(生成物の宣言とリクエスト前段)を書く生成器の ID(アプリの枠の後段 Next.js が登録する生成器と同じ。食い違えば選択の契約が赤)。 */
const BROWSER_DEFENSE_GENERATOR = 'code-browser-defense';

/** ブラウザ側の守りの配線の見張りテストを書く生成器の ID(同上)。 */
const BROWSER_DEFENSE_TESTS_GENERATOR = 'code-browser-defense-tests';

/** 有料の口の関門の見張りテストを書く生成器の ID(同上)。 */
const PAID_ENTRY_TESTS_GENERATOR = 'code-paid-entry-tests';

/** import の起点(`source-root` の `module`)。`@/…` の `@`。**この綴りはここ 1 か所**で、ほかの役割の `module` はここから導く。 */
const SOURCE_MODULE = '@';

/*
 * **Next.js が要求を受けて実行するファイルの表**(HTTP の入口の閉世界 J2 の母集合。6 回目 C6-2・C6-5・B6-2)。
 *
 * J2 は「実装の木の全ての HTTP の入口が宣言に当たる」を見るが、以前は入口を `route.` + 拡張子 1 つ(`src/app` の下)だけで数えていた。
 * Next.js 16 は次のファイルも要求ごとにサーバで実行する口にするので、どれも閉世界の外に置けた:
 *
 * | 種類 | Next の判定(`node_modules/next`) | ここの扱い |
 * |---|---|---|
 * | Route Handler | `find-page-file.js` の `createLeafPattern(['route'])`(拡張子は `pageExtensions`。点を含む `api.ts` も可) | `route.` で始まる全部を入口の候補。受けるのは `route.ts` だけ |
 * | メタデータのルート | `lib/metadata/is-metadata-route.js` の `isMetadataRouteFile`(`icon` / `apple-icon` / `opengraph-image` / `twitter-image` は数字 1 つの接尾辞つき・どの深さでも、`sitemap` はどの深さでも、`robots` / `manifest` / `favicon` は根だけ) | 静的な形(下の表の拡張子)は通す。**それ以外の拡張子は全部、動的な形(既定の export を要求ごとに実行する GET の口)として入口の候補**(受ける綴りでないので error) |
 * | Pages Router | `lib/find-pages-dir.js` の `findDir`(製品の根の `pages` → `src/pages`) | 置き場があること自体を error(`ROUTER_RIVAL_DIRS`) |
 * | App Router の根 | 同じ `findDir`(製品の根の `app` を `src/app` より優先する) | 製品の根の `app` があること自体を error(走査の根 `src/app` が捨てられる) |
 * | 拡張子の表 | `next.config.*` の `pageExtensions` | 設定の既定の export の鍵を許可表(`NEXT_CONFIG_ALLOWED_KEYS`)で閉じ、表に載せない(点を含む拡張子で `route.api.ts` が口になる。7 回目 C7-4 で構文木の許可表に) |
 * | Server Action | **名前でなく本文の指令 `'use server'`** で決まる(ファイルの先頭の指令の export・関数本体の先頭の指令の関数が POST の口) | この表(名前の母集合)では閉じない。ESLint の `layer/use-server-placement` が、指令を `src/app/_actions/**` のファイルの先頭だけに許す(関数本体の中の指令はどこでも error。7 回目 C7-1) |
 *
 * **許可表で閉じる**: 受けるのは `src/app/**\/route.ts`(J2 の宣言との突き合わせ)・画面のページ(S7 の閉世界)・メタデータの静的な形だけで、ほかの口になるファイルは error。
 * 拡張子を `pageExtensions` の既定の 4 つで数えず「名前の形」で拾うので、`route.mjs` / `icon.mts` のような Next が今は口にしない綴りも error になる(厳しい側)。
 * Next の判定と同じになることは、開発用リポジトリのテスト(`__tests__/dev-repo/unit/targets/next-entry-parity.test.ts`)。
 * 置き場の値のファイル(このファイル)は型以外を import しない決まりなので、表はここに直に置くが実物の関数で突き合わせる(版上げで名前が増えたら赤)。
 */

/** ルーティング層の下のファイルの種類(口にならないものは null)。 */
export type RoutingFileKind = 'route' | 'metadata-static' | 'metadata-dynamic';

/** メタデータのファイル名の 1 種類(Next の `STATIC_METADATA_IMAGES` と、テキストの 3 種)。 */
interface MetadataName {
  /** 名前の綴り(拡張子の前)。 */
  readonly name: string;
  /** 数字 1 つの接尾辞(`icon1.png`)を許すか。 */
  readonly numbered: boolean;
  /** ルーティング層の直下でだけ口になるか。 */
  readonly rootOnly: boolean;
  /** 静的な形の拡張子(これ以外の拡張子は動的な形 = 実行される口)。 */
  readonly staticExtensions: readonly string[];
  /** 口にならない添え物の拡張子(`opengraph-image.alt.txt`。Next は画像の代替文に読むだけ)。 */
  readonly companions?: readonly string[];
}

/** メタデータのルートの名前の表(Next 16 の `is-metadata-route.js` の写し。順は Next の表の順)。 */
export const METADATA_NAMES: readonly MetadataName[] = [
  { name: 'icon', numbered: true, rootOnly: false, staticExtensions: ['ico', 'jpg', 'jpeg', 'png', 'svg'] },
  { name: 'apple-icon', numbered: true, rootOnly: false, staticExtensions: ['jpg', 'jpeg', 'png'] },
  { name: 'favicon', numbered: false, rootOnly: true, staticExtensions: ['ico'] },
  { name: 'opengraph-image', numbered: true, rootOnly: false, staticExtensions: ['jpg', 'jpeg', 'png', 'gif'], companions: ['alt.txt'] },
  { name: 'twitter-image', numbered: true, rootOnly: false, staticExtensions: ['jpg', 'jpeg', 'png', 'gif'], companions: ['alt.txt'] },
  { name: 'robots', numbered: false, rootOnly: true, staticExtensions: ['txt'] },
  { name: 'manifest', numbered: false, rootOnly: true, staticExtensions: ['json', 'webmanifest'] },
  { name: 'sitemap', numbered: false, rootOnly: false, staticExtensions: ['xml'] },
];

/** Route Handler の候補(`route.` + 何か。点を含む `pageExtensions` の `route.api.ts` も拾う)。 */
const ROUTE_CANDIDATE = /^route\..+$/;

/**
 * ルーティング層(`src/app`)の下の相対パスが、Next.js が要求を受けて実行する(または配る)ファイルのどれか。
 *
 * @param relPath ルーティング層の下の相対パス(区切りは `/`)
 * @returns 種類。口にならないファイルは null
 */
export function routingFileKind(relPath: string): RoutingFileKind | null {
  const slash = relPath.lastIndexOf('/');
  const base = relPath.slice(slash + 1);
  if (ROUTE_CANDIDATE.test(base)) return 'route';
  const atRoot = slash === -1;
  for (const entry of METADATA_NAMES) {
    if (entry.rootOnly && !atRoot) continue;
    const match = new RegExp(`^${entry.name}${entry.numbered ? '\\d?' : ''}\\.(.+)$`).exec(base);
    const extension = match?.[1];
    if (extension === undefined) continue;
    if (entry.companions?.includes(extension) === true) return null;
    return entry.staticExtensions.includes(extension) ? 'metadata-static' : 'metadata-dynamic';
  }
  return null;
}

/**
 * 入口の閉世界(J2)が入口として数えるファイルか(Route Handler の全ての綴りと、メタデータのルートの動的な形)。
 * メタデータの静的な形は数えない(製品のコードを実行しない。アイコンの置き場の規約 `app-icon` の綴り)。
 *
 * @param relPath ルーティング層の下の相対パス(区切りは `/`)
 */
export function isHttpEntryCandidate(relPath: string): boolean {
  const kind = routingFileKind(relPath);
  return kind === 'route' || kind === 'metadata-dynamic';
}

/**
 * 製品の根の下で、**あってはならない**口の根(Next の `findDir` が `src/app` と並んで、または優先して選ぶ置き場)。製品の根からの相対。
 * `pages` / `src/pages` は Pages Router(`pages/api/*` は Route Handler と同じ HTTP の口で、J2・出どころの関門・X8・ESLint の外)、
 * `app` は App Router の根として `src/app` より優先される(走査の根の `src/app` が丸ごと捨てられる)。
 */
export const ROUTER_RIVAL_DIRS: readonly string[] = ['pages', 'src/pages', 'app'];

/**
 * 製品の根の下の静的な配信の置き場と、置いてよい拡張子(点検 13 回目 B13-7)。`public/` は `src/app` の外から同じオリジンで配られ、`public/api/x.html` は前段の CSP の外の
 * 文書になる(本番ビルドで実測)。ブラウザがスクリプトや文書として開かない形(画像・書体)だけを許す。`svg`・`html`・`js` などは載せない。
 */
export const STATIC_ROOT = { dir: 'public', extensions: ['avif', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'webp', 'woff', 'woff2'] } as const;

/** 実装のソースの根(製品の根からの相対。`source-root` の置き場)。 */
const SOURCE_ROOT_DIR = 'src';

/** リクエスト前段のファイル(ソースの根の直下。`request-gate` の置き場)。 */
const REQUEST_GATE_FILE = 'proxy.ts';

/**
 * **ソースの根の直下に置いてよいコードのファイル**(許可表。点検 16 回目 C16-3)。Next.js 16 は `src` の直下の `proxy`(旧名 `middleware`)を要求ごとに、
 * `instrumentation` の `register()` を起動時に・`onRequestError()` を失敗した要求ごとに、`instrumentation-client` をブラウザの起動時に**名前で**呼ぶ。
 * 載せるのは生成したリクエスト前段の 1 本だけで、ほかの名前は宣言の無い入口になるので J2 の続きが拒む(`lib/job/verifiers/j2-entry-outside.ts`)。
 */
export const SOURCE_ROOT_FILES: readonly string[] = [REQUEST_GATE_FILE];

/** Next の設定ファイルの名前(`next/dist/shared/lib/constants.js` の `CONFIG_FILES`)。 */
export const NEXT_CONFIG_FILES: readonly string[] = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.mts'];

/*
 * **`next.config.*` の既定の export に書いてよい欄の許可表**(7 回目 C7-4。6 回目 C6-5 の禁止の字面 `pageExtensions` を置き換えた)。
 * 判定は構文木(`lib/job/frame-config-keys.ts`)で、同じファイルのオブジェクトのリテラルの静的な鍵だけを受ける(計算した鍵・スプレッド・
 * import した値・エスケープを含む識別子は error)。表に載せるのは**口の母集合も、前段(`src/proxy.ts`)の matcher の前提も変えない欄**だけ:
 *
 * | 欄 | 扱い | 理由 |
 * |---|---|---|
 * | `poweredByHeader` | 許す(値は `false` に固定) | 応答のヘッダを 1 本減らすだけ(使っている道具を教えない) |
 * | `headers` | 許す(値は固定) | 応答にヘッダを足すだけで、口(要求を受けて実行するファイル)も行き先も増えない。値はブラウザ側の守りの宣言の生成物 1 本だけ(`NEXT_CONFIG_FIXED_MEMBERS`。`Cache-Control: public` などを足して前段の no-store を上書きさせない。7 回目 B7-4)で、配線は TC-GUAR-HEADERS-001 が見る |
 * | `agentRules` | 許す | `next dev` が書く文書の有無だけ |
 * | `distDir` | 許す | ビルドの出力先だけ |
 * | `typescript` | 許す | 型検査の設定だけ(中身の欄は見ない) |
 * | `experimental` | 許す(値は `{ agentUpgrade: false }` に固定) | next の「エージェント向けの更新の案内」を切るだけ。既定の `security` は build のたびに npm の registry へ脆弱性の一覧を取りに行く(外へ通信しないビルド。2026-11-05)。ほかの実験の欄は口を変えうるので値を固定して入れさせない |
 * | `pageExtensions` | 拒む | Route Handler・メタデータのルートの拡張子を変える(点を含む拡張子で `route.api.ts` が口になる。C6-5) |
 * | `rewrites` / `redirects` | 拒む | 要求を別の行き先(外部の URL を含む)へ流す。宣言した口と URL の 1 対 1(J2)・前段の matcher の前提が崩れる |
 * | `basePath` / `trailingSlash` / `skipProxyUrlNormalize` / `skipTrailingSlashRedirect` / `i18n` | 拒む | URL の形を変え、前段の matcher と J2 の URL の前提が崩れる |
 * | それ以外の全部(`output`・`assetPrefix`・`productionBrowserSourceMaps` など) | 拒む | 表に無い欄は口を変えうるかを判断していないので、足すときは理由を書いてこの表に載せる |
 */
/** `next.config.*` の既定の export に書いてよい鍵(上の表の「許す」)。 */
export const NEXT_CONFIG_ALLOWED_KEYS: readonly string[] = ['poweredByHeader', 'headers', 'agentRules', 'distDir', 'typescript', 'experimental'];

/** 値の形を固定した欄(欄の文全体の綴り。字句の並びで比べる。上の表の「値は固定」。7 回目 B7-4)。 */
export const NEXT_CONFIG_FIXED_MEMBERS: Readonly<Record<string, string>> = {
  poweredByHeader: 'poweredByHeader: false',
  experimental: 'experimental: { agentUpgrade: false }',
  headers: 'async headers() { return [{ source: "/:path*", headers: staticHeaderEntries(BROWSER_DEFENSE) }]; }',
};

/** 拡張子を除く(最後の `.xxx` だけ)。 */
function withoutExtension(place: string): string {
  return place.replace(/\.[^./]+$/, '');
}

/** 基準の役割(`source-root`)の `module` に、置き場(拡張子なし)を接ぐ。置き場と import の指定が食い違わない 1 本(`layoutDefinitionProblems` が見る)。 */
function moduleOf(place: string): string {
  return `${SOURCE_MODULE}/${withoutExtension(place)}`;
}

/** ルーティング層のディレクトリ(`source-root` の下。HTTP の入口・画面の器・画面の部品・画面テスト・既定のアイコンがこの下に居る)。 */
const ROUTING_DIR = 'app';

/** `http-entry` の置き場(基準の `source-root` から。キーは正規化した URL のパス)。 */
const httpEntryPlace = (url: string): string => `${ROUTING_DIR}${url}/route.ts`;

/** 層の名前(コアの語)。層のディレクトリ名は層の名前と同じ(ソースの根の直下)。 */
const DOMAIN_LAYER = 'domain';
const OPERATION_LAYER = 'operation';
const COMPOSITION_LAYER = 'composition';
const INFRASTRUCTURE_LAYER = 'infrastructure';

/** UI 部品の層(コアの 4 名に足す、この枠の層。`ui-component` の置き場の根)。 */
const COMPONENTS_LAYER = 'components';

/** ルーティング層の下の、操作・保存点の Server Action の置き場(`operation-entry` の走査の根)。 */
const ACTIONS_DIR = '_actions';

/** ルーティング層の下の、保存点の Server Action の置き場(`save-entry`)。 */
const SAVE_ACTIONS_DIR = `${ACTIONS_DIR}/usecase`;

/** ルーティング層の下の、認証基盤の操作の Server Action の置き場(`platform-op-entry`)。 */
const PLATFORM_ACTIONS_DIR = `${ACTIONS_DIR}/platform`;

/** 配線の層の下の、認証基盤の操作の組み立ての根の置き場(`platform-op-composition`)。 */
const PLATFORM_COMPOSITION_DIR = 'platform';

/** ルーティング層の下の、受信口の URL の根(`/api/inbound/{連携}` の `api/inbound`)。 */
const INBOUND_URL_DIR = 'api/inbound';

/** ルーティング層の下の、画面の部品の生成物の置き場(`screen-part`)。 */
const SCREEN_PARTS_DIR = '_screens/generated';

/** 配線の層の下の、保存点の配線の置き場(`save-composition`。置き場そのものは役割の `place` が綴る — 表と役割の食い違いは `placedBy` が止める)。 */
const SAVE_COMPOSITION_DIR = 'usecase';

/** 配線の層の下の、受信の配線の置き場(`composition-root`。置き場そのものは `compositionPlace` が綴る — 表と役割の食い違いは `placedBy` が止める)。 */
const INBOUND_COMPOSITION_DIR = 'inbound';

/** UI 部品の層の下の、保存点の 1 画面フォームの置き場(`ui-component`。置き場そのものは役割の `place` が綴る — 表と役割の食い違いは `placedBy` が止める)。 */
const FORM_DIR = 'usecase/generated';

/** `composition-root` の置き場(基準の `source-root` から。キーは連携 ID)。 */
const compositionPlace = (integration: string): string => `composition/inbound/${integration}.ts`;

/** ルートを構成しないディレクトリの印(非公開フォルダ)。 */
const PRIVATE_PREFIX = '_';

/** パラレルルートの印(`@modal`)。ルートのパスには現れない。 */
const PARALLEL_PREFIX = '@';

/** ルートグループ(`(marketing)`)。パスから消える。 */
const ROUTE_GROUP = /^\(.+\)$/;

/** インターセプトルート(`(.)photo` / `(..)photo`)。URL にはなるが仕様の文法に無いので、画面の器の逆引きは未対応の赤にする。 */
const INTERCEPT = /^\(\.+\)/;

/** 画面の器を構成するファイル名(App Router の page 規約)。 */
const PAGE_FILES = new Set(['page.tsx', 'page.ts', 'page.jsx', 'page.js']);

/**
 * HTTP の入口として**受ける**ファイル名(Route Handler の実体は `route.ts` の綴りだけ。置き場 `httpEntryPlace` と同じ綴り)。
 * Next.js は `route.tsx` / `route.js` / `route.jsx`(と `pageExtensions` で足した拡張子)も Route Handler にするが、口を数える検査
 * (J2 の出どころの関門・GET / HEAD の禁止・X8・生成の見張りテスト)は置き場の綴り 1 つで読むので、ほかの綴りは閉世界で error にする
 * (5 回目 C5-4・B5-1。以前は閉世界が 4 つの綴りを「宣言の口が実在する」と数え、検査側は `route.ts` しか読まず素通りした)。
 */
export const ROUTE_FILE = 'route.ts';
const ROUTE_FILES: ReadonlySet<string> = new Set([ROUTE_FILE]);


/** Next.js のビルドの出力のディレクトリ名(入口の閉世界の走査が歩かない。根の下に出力が入る構成に備えた宣言)。 */

/** 動的なセグメント(`[id]` / `[...rest]` / `[[...rest]]`。置き場の綴り)。 */
const DYNAMIC_SEGMENT = /^\[.*\]$/;

/**
 * `app` の下の相対パスから、ルーティングに現れる URL のセグメントを読む(`screen-shell` と `http-entry` の逆引きが共有する。**Next.js の規則の写しであって発明ではない**)。
 *
 * @param relPath ファイルまでの相対パス(区切りは `/`)
 * @param files この役割を構成するファイル名の集合(`PAGE_FILES` / `ROUTE_FILES`)
 * @returns URL のセグメント(根は空配列)。ファイル名が役割のものでない・ルートを構成しない配置(非公開フォルダ・パラレルルート・インターセプト)のときは null
 */
function routeSegments(relPath: string, files: ReadonlySet<string>): string[] | null {
  const parts = relPath.split('/');
  if (!files.has(parts[parts.length - 1] ?? '')) return null;
  const segments: string[] = [];
  for (const segment of parts.slice(0, -1)) {
    // 非公開フォルダ・パラレルルート・インターセプトルートの下は「ルート」ではない。
    // ルートグループはパスに現れないだけで、下のルートは通常のルートを持つ。
    if (segment.startsWith(PRIVATE_PREFIX) || segment.startsWith(PARALLEL_PREFIX)) return null;
    if (INTERCEPT.test(segment)) return null;
    if (ROUTE_GROUP.test(segment)) continue;
    segments.push(segment);
  }
  return segments;
}

/** 仕様の動的セグメント(`:id`。セグメント全体が `:` + 名前)。 */
const SPEC_DYNAMIC = /^:([a-z][a-z0-9_]*)$/;

/** page のディレクトリ名としての動的セグメント(`[id]`。名前の文法は仕様と同じ)。 */
const DIR_DYNAMIC = /^\[([a-z][a-z0-9_]*)\]$/;

/** 仕様の route を、画面の器のディレクトリの綴りにする(順写像。動的セグメント `:id` → `[id]`。`/` は根のまま)。 */
function routeToDirectory(route: string): string {
  return route
    .split('/')
    .map((segment) => {
      const name = SPEC_DYNAMIC.exec(segment)?.[1];
      return name === undefined ? segment : `[${name}]`;
    })
    .join('/');
}

/**
 * 画面の器の逆引きの答え。**ルーティング層の下の全部のファイルが、この 3 つのどれかに必ず入る**(閉世界。点検 13 回目 B13-1)。
 *
 * - `route`: 仕様の文法に正規化した URL の形(S7 が screen_spec と突き合わせる)
 * - `unsupported`: 読めない配置。`rawRoute` はファイル名までの置き場の綴りのままで(1 ファイル 1 件・仕様の route の形と重ならない)、S7 が「未対応の配置」として赤にする
 * - `outside`: URL にならないと**名指して分かる**ファイル(`private` = 非公開フォルダの下 / `not-a-page` = 読める配置の、ページでないファイル)
 */
export type PageFileClass =
  | { readonly route: string }
  | { readonly unsupported: string; readonly rawRoute: string }
  | { readonly outside: 'private' | 'not-a-page' };

/** 読める形のセグメント(ルートグループの名前は静的なセグメントと同じ文字だけ。`(a)(b)` は読まない)。 */
const READABLE_GROUP = /^\([a-z0-9_-]+\)$/;

/** 静的なセグメント(仕様の route の文法と同じ。`model/screen/route-syntax.ts` の `STATIC_SEGMENT` の写し)。`%5Fx`・大文字・点を含む名前は読まない。 */
const READABLE_STATIC = /^[a-z0-9_-]+$/;

/** ページの綴りの候補(`page.mjs`・`page.test.tsx`・`Page.tsx` も拾う。受けるのは `PAGE_FILES` だけで、ほかは閉世界の赤)。 */
const PAGE_CANDIDATE = /^page\./i;

/** 根の layout(閉世界で許す唯一の、page の外側で描くファイル)。 */
const ROOT_LAYOUT = 'layout.tsx';

/**
 * page の外側で描く Next.js のファイルの綴りの候補(大文字・`.mjs`・`.test.tsx` も拾う)。**page と同時に描かれ、関門の結果を待たずに同じ応答へ流れる**(点検 14 回目 B14-1)。
 * 関門はこれらの外(各画面)にあり、これらの出力は 307 / 404 の本文に残る。だから関門をまたいで頼らないよう、根の `layout.tsx` のほかは置かせない(根の中身は `layer/root-layout-closed` が閉じる)。
 */
const OUTSIDE_GATE_CANDIDATE = /^(?:layout|template|loading|error|global-error|global-not-found|not-found|forbidden|unauthorized|default)\./i;

/**
 * セグメントが読めない形なら、その理由を返す(読める形は null)。**許可の形を並べる**ので、Next.js の記法が増えても読めない側に落ちる。
 *
 * @param segment ディレクトリ名
 * @returns 理由。読める形(ルートグループ・`[id]`・静的なセグメント)は null
 */
function unreadableSegment(segment: string): string | null {
  if (READABLE_GROUP.test(segment) || DIR_DYNAMIC.test(segment) || READABLE_STATIC.test(segment)) return null;
  if (segment.startsWith(PARALLEL_PREFIX)) return `パラレルルートの ${segment} は仕様の route の文法に無い(本物の URL になるのに screen_spec で宣言できない)`;
  if (INTERCEPT.test(segment)) return `インターセプトの ${segment} は仕様の route の文法に無い(本物の URL になるのに screen_spec で宣言できない)`;
  if (DYNAMIC_SEGMENT.test(segment)) return `動的セグメント ${segment} は仕様の route の文法(:param)に無い(キャッチオール等)`;
  return `セグメント ${segment} は読める形(静的な名前・[id]・(グループ)・_非公開)のどれでもない`;
}

/**
 * ルーティング層の下の**全部のファイル**を分類する(`screen-shell` の逆引きの本体)。黙って落とす枝は無い(閉世界。点検 13 回目 B13-1)。
 * 規則そのもの(App Router の記法が増えたら)が変わるとき、追随するのはここだけ。
 *
 * 1. 根から順にセグメントを読む。非公開フォルダ(`_`)に着いたら、下は Next.js が読まないので `outside: 'private'`。
 * 2. 読めないセグメント(パラレルルート `@x`・インターセプト `(.)x`・キャッチオール `[...x]` / `[[...x]]`・文法に合わない `[…]`・それ以外の知らない形)が
 *    あれば、**ファイルの名前を問わず** `unsupported`(`@modal/default.tsx` も、その枠に置いた部品も数える。単一の param に誤変換しない)。
 * 3. ページの綴りなら `route`(`[id]` → `:id`。ルートグループ `(g)` は route に現れない)。ページの候補で受けない綴り(`page.mjs` など)は `unsupported`。
 * 4. page の外側で描くファイル(`layout`・`template`・`loading`・`error`・`not-found` など)は、根の `layout.tsx` のほかは `unsupported`(点検 14 回目 B14-1)。
 * 5. 残りは `outside: 'not-a-page'`(根の `layout.tsx`・`route.ts`・同じ場所の部品。入口は J2 の閉世界が別に数える)。
 *
 * @param relPath ルーティング層の下の相対パス(例: `workshops/[id]/page.tsx`。区切りは `/`)
 * @returns 分類
 */
export function classifyPageFile(relPath: string): PageFileClass {
  const parts = relPath.split('/');
  const base = parts[parts.length - 1] ?? '';
  const readable: string[] = [];
  for (const [index, segment] of parts.slice(0, -1).entries()) {
    if (segment.startsWith(PRIVATE_PREFIX)) return { outside: 'private' };
    const problem = unreadableSegment(segment);
    if (problem !== null) return { unsupported: problem, rawRoute: `/${[...readable, ...parts.slice(index)].join('/')}` };
    if (!ROUTE_GROUP.test(segment)) readable.push(segment);
  }
  if (PAGE_FILES.has(base)) {
    const normalized = readable.map((segment) => {
      const name = DIR_DYNAMIC.exec(segment)?.[1];
      return name === undefined ? segment : `:${name}`;
    });
    return { route: `/${normalized.join('/')}` };
  }
  if (PAGE_CANDIDATE.test(base)) return { unsupported: `ページの綴り ${base} は受けない(受けるのは ${[...PAGE_FILES].join(' / ')})`, rawRoute: `/${[...readable, base].join('/')}` };
  if (OUTSIDE_GATE_CANDIDATE.test(base) && relPath !== ROOT_LAYOUT) return { unsupported: `${base} は関門の外側で描かれ、出力が 307 / 404 の本文に載るので置かない(許すのは根の ${ROOT_LAYOUT} だけ)`, rawRoute: `/${[...readable, base].join('/')}` };
  return { outside: 'not-a-page' };
}

/**
 * `app` の下の相対パスを仕様の route に変換する(`screen-shell` の逆引きの鍵。`classify` の `keyOf`)。
 * **未対応の配置は置き場の綴りのまま返す**: 仕様の文法に無いので、どの仕様の route とも一致せず、
 * S7 が「未対応の配置」として名指す(null で黙って落とさない・単一の param に誤変換しない)。
 *
 * @param relPath ルーティング層の下の相対パス(例: `workshops/[id]/page.tsx`。区切りは `/`)
 * @returns route(例: `/workshops/:id`)。URL にならないと名指して分かるファイルなら null
 */
export function routeFromPageFile(relPath: string): string | null {
  const classified = classifyPageFile(relPath);
  if ('outside' in classified) return null;
  return 'route' in classified ? classified.route : classified.rawRoute;
}

/**
 * `app` の下の相対パスを URL のパスに変換する(`http-entry` の逆引き)。**動的なセグメント(`[x]`)を含む入口は、1 本の URL に結べない**ので null
 * (ジョブの `endpoint` は Cron が叩く 1 本の URL で、動的なセグメントの入口は 404 になる)。
 *
 * @param relPath `route.ts` までの相対パス(例: `api/jobs/run/route.ts`。区切りは `/`)
 * @returns URL のパス(例: `/api/jobs/run`。根は `/`)。ルートを構成しない配置・動的なセグメントを含む配置なら null
 */
export function urlFromRouteFile(relPath: string): string | null {
  const segments = routeSegments(relPath, ROUTE_FILES);
  if (segments === null || segments.some((segment) => DYNAMIC_SEGMENT.test(segment))) return null;
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/**
 * 相対パスが Route Handler になりうるファイル(`route.` で始まる全部。`route.ts` 以外の綴り — 点を含む `pageExtensions` の `route.api.ts` も — 閉世界が error にするために数える。
 * 6 回目 C6-5: 以前は `route.` + 拡張子 1 つで、`route.api.ts` を拾わなかった)か。入口の閉世界の母集合はこれにメタデータのルートの動的な形を足したもの(`isHttpEntryCandidate`)。**ルーティングに結べるかには依らない**(動的なセグメントや非公開フォルダの下の入口も入口のファイルとして数える —
 * `urlFromRouteFile` は 1 本の URL に結べないものを null にするので、それだけで集めると検査の漏れになる)。
 *
 * @param relPath `app` の下の相対パス(区切りは `/`)
 * @returns 入口のファイル名のとき true
 */
export function isRouteFile(relPath: string): boolean {
  return routingFileKind(relPath) === 'route';
}

/** `screen-shell` の置き場(基準の `source-root` から。キーは正規化した route)。 */
const screenShellPlace = (route: string): string => `${ROUTING_DIR}${routeToDirectory(route)}/page.tsx`;

/** 生成テストの置き場の根(層の下。`__tests__/generated`)。 */
const GENERATED_TESTS = '__tests__/generated';

/** 層の名前(コアの語。`operation` / `infrastructure` / `composition`)の下の生成テストの置き場。 */
const testsOf = (layer: string, ...inside: readonly string[]): string => [layer, GENERATED_TESTS, ...inside].join('/');

/** 平らな置き場の相対パスから、末尾の綴り(`.eq.test.ts` など)を除いたキーを返す(区切りを含む・綴りで終わらないものは null)。 */
const stemBefore =
  (suffix: string) =>
  (relative: string): string | null =>
    relative.includes('/') || !relative.endsWith(suffix) || relative.length === suffix.length ? null : relative.slice(0, -suffix.length);

/** 生成テストの役割 1 つの宣言(基準は `source-root`・生成物・衝突は失敗。持ち主は生成器 1 本)。 */
function generatedTestRole(args: {
  readonly key: 'none' | 'operation_id' | 'spec_name';
  readonly generator: string;
  readonly readers: readonly string[];
  readonly when: string;
  readonly place: (key: string) => string;
  readonly classify?: RoleDecl['classify'];
}): RoleDecl {
  return {
    multiplicity: { min: 1, max: args.key === 'none' ? 1 : 'many', key: args.key },
    owners: [{ kind: 'generator', id: args.generator }],
    base: 'source-root',
    origin: 'generated',
    access: { readers: [...args.readers], writers: [args.generator], when: args.when },
    onCollision: 'fail',
    place: args.place,
    module: null,
    ...(args.classify === undefined ? {} : { classify: args.classify }),
  };
}

/** 生成テストの置き場の 9 役割(キーの形も持ち主も違うので役割を分けた。実 DB で実行する 3 種は逆引きを持つ)。 */
function generatedTestRoles(): Record<string, RoleDecl> {
  const eqDir = testsOf('infrastructure', 'equivalence');
  const saveDir = testsOf('composition', 'equivalence');
  const rlsDir = testsOf('infrastructure', 'rls');
  const computesDir = testsOf('operation', 'computes');
  return {
    'operation-test': generatedTestRole({
      key: 'operation_id',
      generator: 'code-operation-tests',
      readers: ['action-test-cases', 'A6'],
      when: '`source-root` があり、action_spec の操作があるとき(実行計画の場面から 1 操作 = 1 ファイル)',
      place: (op) => `${testsOf('operation')}/${op.replace('.', '/')}.test.ts`,
    }),
    'compute-example-test': generatedTestRole({
      key: 'spec_name',
      generator: 'code-compute-examples',
      readers: ['action-compute-example-cases', 'generate(余分の検出)', 'A6'],
      when: '`source-root` があり、例の表を持つ純関数(`computes[].examples`)があるとき。置き場ぜんたいが生成物で、改名した前の名前のファイルは余分として名指される',
      place: (ref) => `${computesDir}/${ref}.examples.test.ts`,
      classify: { dir: computesDir, keyOf: stemBefore('.examples.test.ts') },
    }),
    'eq-test': generatedTestRole({
      key: 'spec_name',
      generator: 'code-equivalence-tests',
      readers: ['data-table-eq-tests', 'samples:db', 'A6'],
      when: '`source-root` があり、エンジンと RPC の一致を証明する集約があるとき(実 DB で実行する)',
      place: (aggregate) => `${eqDir}/${aggregate}.eq.test.ts`,
      classify: { dir: eqDir, keyOf: stemBefore('.eq.test.ts') },
    }),
    'eq-save-test': generatedTestRole({
      key: 'spec_name',
      generator: 'code-eq-save-tests',
      readers: ['usecase-eq-tests', 'samples:db', 'A6'],
      when: '`source-root` があり、保存点の一致を証明するユースケースがあるとき(実 DB で実行する。期待を出す実行器と実測の実 DB を同じテストで使えるのは配線の層だけ)',
      place: (usecase) => `${saveDir}/${usecase}.uc.eq.test.ts`,
      classify: { dir: saveDir, keyOf: stemBefore('.uc.eq.test.ts') },
    }),
    'rls-test': generatedTestRole({
      key: 'spec_name',
      generator: 'code-rls-behaviour-tests',
      readers: ['data-table-rls-tests', 'samples:db', 'A6'],
      when: '`source-root` があり、ポリシーと読み取りの宣言を持つ表があるとき(実 DB で実行する)',
      place: (table) => `${rlsDir}/${table}.rls.test.ts`,
      classify: { dir: rlsDir, keyOf: stemBefore('.rls.test.ts') },
    }),
    'harness-adapter': generatedTestRole({
      key: 'spec_name',
      generator: 'code-harness-adapters',
      readers: ['生成テスト(import)'],
      when: '`source-root` があるとき(ハーネス本体は実行時パッケージに住み、ここは製品の生成物と口を束ねて渡す配線。生成テストの import 先を動かさない住所に置く)',
      place: (name) => `infrastructure/__tests__/${name}.ts`,
    }),
    'save-harness-adapter': generatedTestRole({
      key: 'spec_name',
      generator: 'code-harness-adapters',
      readers: ['生成テスト(import)'],
      when: '`source-root` があるとき(保存点の一致の証明が使う配線。層境界の帰結として配線の層に置く)',
      place: (name) => `composition/__tests__/${name}.ts`,
    }),
    'cron-route-test': generatedTestRole({
      key: 'none',
      generator: 'code-cron-route-tests',
      readers: ['A6'],
      when: '`source-root` があり、ジョブカタログに時刻起点で起動口を持つ行があるとき(保証「設定が無ければ閉じる」の見張り。1 枚)',
      place: () => `${ROUTING_DIR}/api/__tests__/generated/cron-routes.test.ts`,
    }),
    'platform-op-test': generatedTestRole({
      key: 'none',
      generator: PLATFORM_OPS_TESTS_GENERATOR,
      readers: ['A6'],
      when: '`source-root` があり、auth_spec が `platform_ops` を宣言するとき(権限表・配線先の形から画面の値への接続・負例の見張り。1 枚)',
      place: () => testsOf(COMPOSITION_LAYER, 'platform-ops.test.ts'),
    }),
    'browser-defense-test': generatedTestRole({
      key: 'none',
      generator: BROWSER_DEFENSE_TESTS_GENERATOR,
      readers: ['A6'],
      when: '`source-root` があるとき(ブラウザ側の守りの配線 —— 全応答のヘッダ・cookie で認証する口の出どころの確認・要求ごとの描画 —— の見張り。1 枚)',
      place: () => `${ROUTING_DIR}/api/__tests__/generated/browser-defense.test.ts`,
    }),
    'paid-entry-test': generatedTestRole({
      key: 'none',
      generator: PAID_ENTRY_TESTS_GENERATOR,
      readers: ['A6'],
      when: '`source-root` があり、外部連携カタログに有料の口(`spend: paid` の `endpoints`)があるとき(未ログイン 401・役なし 403 で、本文・枠の RPC・有料の宛先に触れずに閉じるかを実物の口で叩く見張り。1 枚)',
      place: () => `${ROUTING_DIR}/api/__tests__/generated/paid-entries.test.ts`,
    }),
  };
}

/** 層の名前(コアの語)の下の、操作・保存点の置き場の相対パス(キー `{a}.{b}` → `{a}/{b}.ts`)。 */
const pairFile = (key: string): string => `${key.replace('.', '/')}.ts`;

/** 実装ファイル(`.ts`。テスト `.test.ts` は実体ではない)か。 */
const isImplementation = (name: string): boolean => name.endsWith('.ts') && !name.endsWith('.test.ts');

/**
 * この枠(Next.js + 実行時パッケージ `@kaninabe/runtime`)の**層と土台ディレクトリの表**(`source-root` の役割が持つ。`RoleStructure`)。
 *
 * 層の 4 名はコアの語で、ここが足すのは UI 部品の層 `components` とルーティング層 `app` の 2 つ(`app` の下の `_actions` ・`api/inbound` ・`_screens/generated` と、
 * `components` の下の `usecase/generated` はこの枠の綴り)。土台の全数 18 行は、生成物 `framework-structure.json` / `structure-expectations.ts` の並びそのもの
 * (**宣言順がそのまま生成物の順**)。実行時パッケージ(`root: 'framework'`)の行 2 本は、製品の木の行と同じ層の下に**同じ表で並ぶ** —— 生成物は 1 枚の表で、層ごとの
 * 並びが両方の根にまたがる(分けると、並びを戻すためだけの順序の欄が要る)。実行時パッケージは `@kaninabe/runtime` 1 本で、枠を差し替えるときに表を丸ごと書き直す。
 * ③-e2D で、実行時パッケージの `infrastructure/{facts,usecase,rpc,inbound}` の行 4 本は表から落ちた —— DB への接続の方式(facts / usecase / rpc)は adapter パッケージ(`framework/adapters/postgrest`)へ出て、
 * 受信口の段取り(`src/inbound`)と拒否の分類(`src/refusal`)は層の下の土台ではなくなった(`infrastructure/` の名前をやめた)。
 *
 * 生成物の置き場(`generated: true` の `perSpec` の行)は、`placedBy` で書き込む役割を名指す —— 役割の置き場(`place`)がこの土台の中にあることを、配置の定義の検査が見る
 * (役割の表と土台の表が別々に書かれて食い違うのを止める)。
 */
const STRUCTURE: RoleStructure = {
  layers: [
    { name: COMPONENTS_LAYER, role: '画面をまたいで使う部品', closedWorld: 'none', scanExtensions: ['.ts', '.tsx'] },
    { name: ROUTING_DIR, role: 'Next.js のルーティングと画面実装', closedWorld: 'none' },
  ],
  baseDirs: [
    {
      root: 'framework',
      layer: DOMAIN_LAYER,
      dir: 'engine',
      role: '状態機械・権限・ガードの評価(どの集約でも 1 回だけ書く。ADR-0004)',
      generated: false,
      vocabularyScan: true,
      layout: 'flat',
      perSpec: false,
    },
    {
      root: 'product',
      layer: DOMAIN_LAYER,
      dir: 'generated',
      role: '仕様からの生成物(zod・遷移表・表示名・実行計画・トークン)',
      generated: true,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: false,
    },
    {
      root: 'product',
      layer: DOMAIN_LAYER,
      dir: '__tests__',
      role: 'テスト支援(fake・フィクスチャ)',
      generated: false,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: false,
    },
    {
      root: 'framework',
      layer: OPERATION_LAYER,
      dir: '_template',
      role: '5 形の定型(遷移・作成・削除・編集・保存点)そのもの',
      generated: false,
      vocabularyScan: true,
      layout: 'flat',
      perSpec: false,
    },
    {
      root: 'product',
      layer: OPERATION_LAYER,
      dir: 'shared',
      role: '集約をまたぐ共有物',
      generated: false,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: false,
    },
    {
      root: 'product',
      layer: OPERATION_LAYER,
      dir: 'jobs',
      role: '非同期ジョブの実行基盤(ARCH-BE-0015)',
      generated: false,
      vocabularyScan: true,
      layout: 'flat',
      perSpec: false,
    },
    {
      root: 'product',
      layer: OPERATION_LAYER,
      dir: 'usecase',
      role: '保存点で手書きする唯一のもの(application 執行の不変条件の hooks)',
      generated: false,
      vocabularyScan: false,
      layout: 'nested',
      perSpec: false,
    },
    {
      root: 'product',
      layer: OPERATION_LAYER,
      dir: '__tests__',
      role: 'テスト支援(fake・構造テスト)',
      generated: false,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: false,
    },
    {
      root: 'product',
      layer: INFRASTRUCTURE_LAYER,
      dir: 'supabase',
      role: 'Supabase クライアント・セッション(接続層そのもの)',
      generated: false,
      vocabularyScan: true,
      layout: 'flat',
      perSpec: false,
      // 接続層のクライアントの SDK。集約のリポジトリ・ページ・Composition は引けない(B9-4)。
      sdkPackages: ['@supabase/*'],
    },
    {
      root: 'product',
      layer: INFRASTRUCTURE_LAYER,
      dir: '__tests__',
      role: 'テスト支援(統合テスト・実 DB との突合)',
      generated: false,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: false,
    },
    {
      root: 'product',
      layer: COMPOSITION_LAYER,
      dir: 'jobs',
      role: 'ジョブ実行の配線',
      generated: false,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: false,
    },
    {
      root: 'product',
      layer: COMPOSITION_LAYER,
      dir: SAVE_COMPOSITION_DIR,
      role: '保存点の配線(生成物)',
      generated: true,
      vocabularyScan: false,
      layout: 'nested',
      perSpec: true,
      placedBy: { role: 'save-composition', key: 'sample_usecase.sample_save' },
    },
    {
      root: 'product',
      layer: COMPOSITION_LAYER,
      dir: PLATFORM_COMPOSITION_DIR,
      role: '認証基盤の操作の組み立ての根(生成物)',
      generated: true,
      vocabularyScan: false,
      layout: 'nested',
      perSpec: true,
      placedBy: { role: 'platform-op-composition', key: 'sample_group.sample_op' },
    },
    {
      root: 'product',
      layer: COMPOSITION_LAYER,
      dir: INBOUND_COMPOSITION_DIR,
      role: 'Webhook の口の配線(生成物。鍵・記録先・起こすイベントを宣言から組む)',
      generated: true,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: true,
      placedBy: { role: 'composition-root', key: 'sample_id' },
    },
    {
      root: 'product',
      layer: COMPOSITION_LAYER,
      dir: '__tests__',
      role: 'テスト支援(配線を通した統合テスト)',
      generated: false,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: false,
    },
    {
      root: 'product',
      layer: ROUTING_DIR,
      dir: SAVE_ACTIONS_DIR,
      role: '保存点の Server Action(生成物)',
      generated: true,
      vocabularyScan: false,
      layout: 'nested',
      perSpec: true,
      placedBy: { role: 'save-entry', key: 'sample_usecase.sample_save' },
    },
    {
      root: 'product',
      layer: ROUTING_DIR,
      dir: PLATFORM_ACTIONS_DIR,
      role: '認証基盤の操作の Server Action(生成物)',
      generated: true,
      vocabularyScan: false,
      layout: 'nested',
      perSpec: true,
      placedBy: { role: 'platform-op-entry', key: 'sample_group.sample_op' },
    },
    {
      root: 'product',
      layer: ROUTING_DIR,
      dir: INBOUND_URL_DIR,
      role: 'Webhook の口(生成物。Route Handler)',
      generated: true,
      vocabularyScan: false,
      layout: 'nested',
      perSpec: true,
      placedBy: { role: 'http-entry', key: `/${INBOUND_URL_DIR}/sample_id` },
    },
    {
      root: 'product',
      layer: ROUTING_DIR,
      dir: SCREEN_PARTS_DIR,
      role: '画面の部品(生成物。手書きの器 `_screens/{画面}.tsx` が呼ぶ。`kind: form` の部品 1 つ = 1 本 + 既定のスタイル)',
      generated: true,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: true,
      placedBy: { role: 'screen-part', key: 'sample.file' },
    },
    {
      root: 'product',
      layer: COMPONENTS_LAYER,
      dir: FORM_DIR,
      role: '保存点の 1 画面フォーム(生成物)',
      generated: true,
      vocabularyScan: false,
      layout: 'flat',
      perSpec: true,
      placedBy: { role: 'ui-component', key: 'sample.file' },
    },
  ],
  unlistedDirs: [
    {
      layer: COMPOSITION_LAYER,
      dir: 'shared',
      role: '手書きの共有の配線(`operation/shared` の走査・システム起点の呼び出しの Composition Root。集約ではない。土台の表には載せない — 閉世界を宣言できていない層の穴)',
    },
  ],
  auxFiles: [{ layer: OPERATION_LAYER, file: 'ports.ts', role: '操作が宣言する IF(infrastructure が型として実装する唯一の入口)' }],
  runtimeSource: 'src',
  // 枠の基盤(画面と枠の基盤・入力の形・サーバー専用の印)。綴りは lint-config の層の境界の許可表
  // (`policies-external-packages.mjs` の UI_FOUNDATION_PACKAGES と zod / server-only)と同じで、一致は app 側のテストが見る。
  foundationPackages: ['next', 'react', 'react-dom', 'zod', 'server-only'],
};

/**
 * 製品の木の、その層の直下の「集約でないディレクトリ」(土台と、土台の表に載せていない手書きの置き場)の最初の段の名前。
 * **渡された層と土台の表を読む**(逆引きが「操作・集約ではない」と除く相手。配置の `source-root` が宣言した表から導く —— 表と逆引きが別々の綴りにならない。
 * 食い違いは配置の定義の検査が止める)。コアの土台の表から読まない —— 依存の向きは配置 → 土台の役割である。
 */
function baseDirNamesOf(structure: RoleStructure, layer: string): ReadonlySet<string> {
  const listed = structure.baseDirs.filter((entry) => entry.root === 'product');
  return new Set([...listed, ...structure.unlistedDirs].filter((entry) => entry.layer === layer).map((entry) => entry.dir.split('/')[0] ?? ''));
}

/** 集約ディレクトリの下の、単発の操作の hooks の置き場の名前(`operation-hooks`。`operation-logic` の逆引きは操作の本体として読まない)。 */
const HOOKS_DIR = 'hooks';

/**
 * `operation/` の下の相対パスから、単発の操作の hooks の操作 ID を読む(`operation-hooks` の逆引き)。`{集約}/hooks/{イベント}.ts` の 3 段だけ。
 * 土台のディレクトリの下・実装でないファイル(テスト・説明)は null。**`operation-logic` の逆引きはこの規則に当たるファイルを操作の本体として読まない**
 * (同じファイルを 2 つの役割が自分のものと読まない。「hooks の置き場」の綴りはこの規則 1 か所と `place` だけ)。
 *
 * @param structure 配置の層と土台の表
 * @returns `operation/` からの相対パス(区切りは `/`)→ `{集約}.{イベント}`。hooks でないファイルは null
 */
function operationIdFromHooksFile(structure: RoleStructure): (relPath: string) => string | null {
  const baseDirs = baseDirNamesOf(structure, OPERATION_LAYER);
  return (relPath) => {
    const segments = relPath.split('/');
    const filename = segments[segments.length - 1] ?? '';
    if (segments.length !== 3 || segments[1] !== HOOKS_DIR || !isImplementation(filename) || baseDirs.has(segments[0] ?? '')) return null;
    return `${segments[0]}.${filename.replace(/\.ts$/, '')}`;
  };
}

/** 集約のクエリの写像・配線(1 ファイル N クエリ。操作の組み立ての根ではない)のファイル名(拡張子なし)。 */
const QUERY_FILE = 'queries';

/**
 * `operation/` の下の相対パスから、操作 ID を読む(`operation-logic` の逆引き。旧 `trace/operation-path.ts` の `operationIdOf` の規約の写し — 移しただけで挙動は変えない)。
 * 土台のディレクトリと集約の補助ファイルは、渡された層と土台の表から読む。
 *
 * @param structure 配置の層と土台の表
 * @returns `operation/` からの相対パス(区切りは `/`)→ `{集約}.{イベント}`(深すぎる配置は、規約のパスから導けない ID のまま突合に出して落とす)。操作ではないファイル(横断・土台・補助・テスト・実装でないもの)は null
 */
function operationIdFromLogicFile(structure: RoleStructure): (relPath: string) => string | null {
  const baseDirs = baseDirNamesOf(structure, OPERATION_LAYER);
  const auxFiles = new Set(structure.auxFiles.filter((entry) => entry.layer === OPERATION_LAYER).map((entry) => entry.file.replace(/\.tsx?$/, '')));
  const hooksIdOf = operationIdFromHooksFile(structure);
  return (relPath) => {
    const segments = relPath.split('/');
    const filename = segments[segments.length - 1] ?? '';
    if (!isImplementation(filename)) return null;
    // 直下の横断モジュール(logging.ts など)と、集約ではないディレクトリの配下。
    if (segments.length === 1 || baseDirs.has(segments[0] ?? '')) return null;
    // 集約の `hooks/` の下は単発の操作の hooks(役割 `operation-hooks`)で、操作の本体ではない(同じファイルを 2 つの役割が自分のものと読まない)。
    if (hooksIdOf(relPath) !== null) return null;
    const event = filename.replace(/\.ts$/, '');
    if (segments.length === 2 && auxFiles.has(event)) return null;
    return `${segments.slice(0, -1).join('.')}.${event}`;
  };
}

/** `SessionManagement` → `session-management`(ポートの型名 → 配線のファイル名)。 */
function kebabCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** 集約・イベントの 2 段(`{a}/{b}.ts`)のファイル → `{a}.{b}`。それ以外(段が違う・名前に `.` を含むテスト `x.test.ts`・実装でない)は null。 */
function pairKeyOf(relPath: string): string | null {
  const match = /^([^/.]+)\/([^/.]+)\.ts$/.exec(relPath);
  return match === null ? null : `${match[1]}.${match[2]}`;
}

/** `composition/` の下の相対パスから操作 ID を読む(`operation-composition` の逆引き。土台のディレクトリ・クエリの配線は操作ではない)。 */
function operationIdFromCompositionFile(structure: RoleStructure): (relPath: string) => string | null {
  const baseDirs = baseDirNamesOf(structure, COMPOSITION_LAYER);
  return (relPath) => {
    const key = pairKeyOf(relPath);
    if (key === null) return null;
    const [aggregate = '', event = ''] = key.split('.');
    return baseDirs.has(aggregate) || event === QUERY_FILE ? null : key;
  };
}

/** `infrastructure/` の下の相対パスから、集約または連携のディレクトリ名を読む(`infrastructure` の逆引き。土台のディレクトリの下・層の直下のファイルは null)。 */
function infrastructureDirFromFile(structure: RoleStructure): (relPath: string) => string | null {
  const baseDirs = baseDirNamesOf(structure, INFRASTRUCTURE_LAYER);
  return (relPath) => {
    const segments = relPath.split('/');
    const head = segments[0] ?? '';
    return segments.length < 2 || baseDirs.has(head) || !isImplementation(segments[segments.length - 1] ?? '') ? null : head;
  };
}

/** フォームの置き場(平らなディレクトリ。中身は全部生成されるフォーム)の下のファイル名 → キー(ファイル名そのもの)。入れ子は null。 */
function formFileKeyOf(relPath: string): string | null {
  return relPath.includes('/') ? null : relPath;
}

/** 操作・保存点・フォーム・層の読み書きの置き場の役割 1 つの宣言(基準は `source-root`)。 */
function appPartRole(args: {
  readonly key: 'operation_id' | 'save_id' | 'file_name' | 'spec_name';
  readonly generator: string | null;
  /** 製品が手で書くもの(`runner: manual` の操作・層の手書き)も同じ置き場に居るか(居れば混在・生成器が無ければ手書き・居なければ生成物だけ)。 */
  readonly handwritten: boolean;
  readonly readers: readonly string[];
  readonly when: string;
  readonly place: (key: string) => string;
  /** import される役割(組み立ての根)だけが持つ。 */
  readonly imported?: boolean;
  /** 逆引き(実在のファイル → キー)。走査の根 `dir`(基準の役割からの相対)とキーの判定。 */
  readonly classify: NonNullable<RoleDecl['classify']>;
}): RoleDecl {
  const generated = args.generator === null ? [] : [{ kind: 'generator' as const, id: args.generator }];
  return {
    multiplicity: { min: 1, max: 'many', key: args.key },
    owners: [...generated, ...(args.handwritten ? [{ kind: 'product' as const }] : [])],
    base: 'source-root',
    origin: args.generator === null ? 'handwritten' : args.handwritten ? 'mixed' : 'generated',
    access: { readers: [...args.readers], writers: args.generator === null ? [] : [args.generator], when: args.when },
    onCollision: 'fail',
    place: args.place,
    module: args.imported === true ? (key) => moduleOf(args.place(key)) : null,
    classify: args.classify,
  };
}

/** 操作・保存点の入口と組み立ての根とフォーム・層の読み書きの 7 役割(キーの形も持ち主の生成器も違うので役割を分けた。どれも逆引きを持つ)。 */
function appPartRoles(structure: RoleStructure): Record<string, RoleDecl> {
  return {
    'operation-entry': appPartRole({
      key: 'operation_id',
      generator: OPERATION_GENERATOR,
      handwritten: true,
      readers: ['A2', 'A2(置き場の取り合い)', 'code-structure-expectations', 'trace/scan(走査の根)'],
      when: '`source-root` があり、action_spec の操作があるとき。実行計画で走る操作(システム専用のイベントを除く)は生成物・`runner: manual` の操作は製品が手で書く。A2 は配置が決める位置に実装が実在するかを見る',
      place: (op) => `${ROUTING_DIR}/${ACTIONS_DIR}/${pairFile(op)}`,
      classify: { dir: `${ROUTING_DIR}/${ACTIONS_DIR}`, keyOf: pairKeyOf },
    }),
    'operation-composition': appPartRole({
      key: 'operation_id',
      generator: OPERATION_GENERATOR,
      handwritten: true,
      readers: ['A2(置き場の取り合い)', 'code-structure-expectations', '生成された Server Action(import)'],
      when: '`source-root` があり、action_spec の操作があるとき。実行計画で走る操作は生成物(システム専用のイベントも作る)・`runner: manual` の操作は製品が手で書く',
      place: (op) => `${COMPOSITION_LAYER}/${pairFile(op)}`,
      imported: true,
      classify: { dir: COMPOSITION_LAYER, keyOf: operationIdFromCompositionFile(structure) },
    }),
    'save-entry': appPartRole({
      key: 'save_id',
      generator: SAVE_GENERATOR,
      handwritten: false,
      readers: ['A2(置き場の取り合い)', 'code-structure-expectations'],
      when: '`source-root` があり、usecase_spec の保存点があるとき(Server Action は全部生成物。手で書かない)',
      place: (save) => `${ROUTING_DIR}/${SAVE_ACTIONS_DIR}/${pairFile(save)}`,
      classify: { dir: `${ROUTING_DIR}/${SAVE_ACTIONS_DIR}`, keyOf: pairKeyOf },
    }),
    'save-composition': appPartRole({
      key: 'save_id',
      generator: SAVE_GENERATOR,
      handwritten: false,
      readers: ['A2(置き場の取り合い)', 'code-structure-expectations', '生成された Server Action(import)'],
      when: '`source-root` があり、usecase_spec の保存点があるとき(組み立ての根は全部生成物)',
      place: (save) => `composition/usecase/${pairFile(save)}`,
      imported: true,
      classify: { dir: 'composition/usecase', keyOf: pairKeyOf },
    }),
    'platform-op-entry': appPartRole({
      key: 'operation_id',
      generator: PLATFORM_OPS_GENERATOR,
      handwritten: false,
      readers: ['code-structure-expectations'],
      when: '`source-root` があり、auth_spec が `platform_ops` を宣言するとき(認証基盤の操作の Server Action は全部生成物。手で書かない)',
      place: (op) => `${ROUTING_DIR}/${PLATFORM_ACTIONS_DIR}/${pairFile(op)}`,
      classify: { dir: `${ROUTING_DIR}/${PLATFORM_ACTIONS_DIR}`, keyOf: pairKeyOf },
    }),
    'platform-op-composition': appPartRole({
      key: 'operation_id',
      generator: PLATFORM_OPS_GENERATOR,
      handwritten: false,
      readers: ['code-structure-expectations', '生成された Server Action と画面の器(import)'],
      when: '`source-root` があり、auth_spec が `platform_ops` を宣言するとき(実行者・多要素認証・引数の対応・結果の写しを持つ組み立ての根は全部生成物)',
      place: (op) => `${COMPOSITION_LAYER}/${PLATFORM_COMPOSITION_DIR}/${pairFile(op)}`,
      imported: true,
      classify: { dir: `${COMPOSITION_LAYER}/${PLATFORM_COMPOSITION_DIR}`, keyOf: pairKeyOf },
    }),
    'ui-component': appPartRole({
      key: 'file_name',
      generator: FORM_GENERATOR,
      handwritten: false,
      readers: ['A2(置き場の取り合い)', 'code-structure-expectations'],
      when: '`source-root` があり、usecase_spec の保存点があるとき(保存点 1 つ = 1 画面フォーム。生成物の分だけ。手書きの部品は役割にしていない)',
      place: (file) => `components/usecase/generated/${file}`,
      classify: { dir: 'components/usecase/generated', keyOf: formFileKeyOf },
    }),
    'operation-logic': appPartRole({
      key: 'operation_id',
      generator: null,
      handwritten: true,
      readers: ['A11', 'A14', 'A10', 'code-lint-exceptions', 'code-structure-expectations', 'trace/scan(走査の根)'],
      when:
        '`source-root` があるとき。製品が手で書く操作の本体(`runner: manual` の操作と `scans:` の走査・システム起点の入口。1 操作 = 1 ファイル)。' +
        '層の土台(共有物・ジョブ基盤・保存点の hooks・テスト支援)も同じ層に居るが、操作ではない(逆引きは null)。定型 `_template` は実行時パッケージ側に住み、製品の木には無い',
      place: (op) => `${OPERATION_LAYER}/${pairFile(op)}`,
      classify: { dir: OPERATION_LAYER, keyOf: operationIdFromLogicFile(structure) },
    }),
    infrastructure: appPartRole({
      key: 'spec_name',
      generator: null,
      handwritten: true,
      readers: ['code-lint-exceptions', 'X1', 'examples-sources(書き方の例の抜粋元)'],
      when:
        '`source-root` があるとき。製品が手で書く基盤の層の、集約または連携 1 つの置き場(集約のクエリの写像 `queries.ts`・外部連携のアダプタ・内部テーブルの置き場)。' +
        '置き場の代表は集約のクエリの写像で、逆引きは同じディレクトリの全ファイルをそのキーのものと読む。接続層・テスト支援などの土台のディレクトリは、この値の層と土台の表(`STRUCTURE`)から読む',
      place: (dir) => `${INFRASTRUCTURE_LAYER}/${dir}/${QUERY_FILE}.ts`,
      classify: { dir: INFRASTRUCTURE_LAYER, keyOf: infrastructureDirFromFile(structure) },
    }),
  };
}

/** 生成物の本文が import する手書きの接続点の役割 1 つの宣言(基準は `source-root`・製品が手で書く・`module` は置き場(拡張子なし)を別名に接いだ形)。 */
function importPointRole(args: {
  readonly key: 'none' | 'operation_id' | 'spec_name' | 'file_name';
  readonly readers: readonly string[];
  readonly when: string;
  readonly place: (key: string) => string;
  /** 逆引き(実在のファイル → キー)を持つ役割だけが宣言する。 */
  readonly classify?: RoleDecl['classify'];
}): RoleDecl {
  return {
    multiplicity: { min: 1, max: args.key === 'none' ? 1 : 'many', key: args.key },
    owners: [{ kind: 'product' }],
    base: 'source-root',
    origin: 'handwritten',
    access: { readers: [...args.readers], writers: [], when: args.when },
    onCollision: 'fail',
    place: args.place,
    module: (key) => moduleOf(args.place(key)),
    ...(args.classify === undefined ? {} : { classify: args.classify }),
  };
}

/** 生成物の本文が import する手書きの接続点の 8 役割(どれも製品が手で書き、生成器は指定子を引くだけ)。 */
function importPointRoles(structure: RoleStructure): Record<string, RoleDecl> {
  return {
    'operation-hooks': importPointRole({
      key: 'operation_id',
      readers: [`${OPERATION_GENERATOR}(import)`],
      when: '`source-root` があり、`enforced_by: application` の不変条件を持つ操作があるとき(製品が手で書く hooks。1 操作 = 1 ファイル)',
      place: (op) => `${OPERATION_LAYER}/${op.replace('.', `/${HOOKS_DIR}/`)}.ts`,
      classify: { dir: OPERATION_LAYER, keyOf: operationIdFromHooksFile(structure) },
    }),
    'computes-module': importPointRole({
      key: 'spec_name',
      readers: ['code-operation-app(import)', 'code-usecase-app(import)', 'code-operation-tests(import)', 'code-compute-examples(import)'],
      when: '`source-root` があり、action_spec が `computes` で純関数を名指すとき(製品が手で書く純関数。ARCH-BE-0001)',
      place: (ref) => `${DOMAIN_LAYER}/computes/${ref}.ts`,
    }),
    'preflight-module': importPointRole({
      key: 'none',
      readers: ['code-screens(生成物の説明文)'],
      when: '`source-root` があるとき(画面の入場判定にかける手書きの純関数の置き場)',
      place: () => `${DOMAIN_LAYER}/preflight.ts`,
    }),
    'shared-component': importPointRole({
      key: 'file_name',
      readers: ['code-screen-forms(import)', 'code-screen-tables(import)', 'code-usecase-form(import)', 'code-navigation-visibility(生成物の説明文)'],
      when: '`source-root` があるとき(画面をまたいで使う手書きの UI 部品。キーは拡張子なしのファイル名)',
      place: (file) => `${COMPONENTS_LAYER}/${file}.tsx`,
    }),
    'auth-composition': importPointRole({
      key: 'none',
      readers: ['code-operation-app(import)', 'code-usecase-app(import)'],
      when: '`source-root` があり、操作か保存点の入口があるとき(実行者とセッションの券を解く手書きの組み立ての根)',
      place: () => `${COMPOSITION_LAYER}/auth.ts`,
    }),
    'system-clock': importPointRole({
      key: 'none',
      readers: ['code-operation-app(import)', 'code-usecase-app(import)'],
      when: '`source-root` があり、操作か保存点の組み立ての根があるとき(時計の口)',
      place: () => `${INFRASTRUCTURE_LAYER}/system-clock.ts`,
    }),
    'db-ports': importPointRole({
      key: 'none',
      readers: ['code-operation-app(import)', 'code-usecase-app(import)', 'code-inbound-route(import)'],
      when: '`source-root` があり、組み立ての根か受信の配線があるとき(DB への口の束を組む配線)',
      place: () => `${INFRASTRUCTURE_LAYER}/supabase/db-ports.ts`,
    }),
    'platform-binding': importPointRole({
      key: 'spec_name',
      readers: ['H9(構文木で配線先の形を突き合わせる)', `${PLATFORM_OPS_GENERATOR}(import)`],
      when: '`source-root` があり、auth_spec が `platform_ops` を宣言するとき(認証基盤の操作を実際に叩く手書きの配線。キーはポートの型名で、置き場のファイル名はケバブケース)',
      place: (port) => `${COMPOSITION_LAYER}/${kebabCase(port)}.ts`,
    }),
    'session-refresh': importPointRole({
      key: 'none',
      readers: [`${BROWSER_DEFENSE_GENERATOR}(import)`],
      when: '`source-root` があるとき(生成したリクエスト前段が、守りの判定のあとに呼ぶセッションの更新 `refreshSession(request, requestHeaders)`)',
      place: () => `${INFRASTRUCTURE_LAYER}/supabase/proxy-session.ts`,
    }),
  };
}

/**
 * Next.js(App Router)の置き場を、**渡された層と土台の表**で組む(逆引きが「操作・集約ではない」と除く土台は、その表から導く)。
 * 実物は `NEXTJS_LAYOUT`(表は `STRUCTURE`)。別の表を渡す口は、逆引きが表に従うことのテストのために公開している。
 *
 * @param structure `source-root` の役割が宣言する層と土台の表
 * @returns 置き場の配置
 */
export function nextjsLayoutWith(structure: RoleStructure): ProductLayout {
  return {
    'product-root': {
      multiplicity: { min: 1, max: 1, key: 'none' },
      owners: [{ kind: 'product_declaration' }],
      base: null,
      origin: 'handwritten',
      access: {
        readers: ['J2', 'V10', 'W1', 'check:formal', '生成器'],
        writers: [],
        when: '製品が実装の木(`roots.app`)を宣言しているとき。無ければ 0 個で、実装に依る検査・生成は飛ぶ',
      },
      onCollision: 'fail',
      place: null,
      module: null,
    },
    'source-root': {
      multiplicity: { min: 1, max: 1, key: 'none' },
      owners: [{ kind: 'product' }, { kind: 'generator', id: INBOUND_GENERATOR }],
      base: 'product-root',
      origin: 'mixed',
      access: {
        readers: ['J2', 'check:formal', '生成器'],
        writers: [INBOUND_GENERATOR],
        when: '`product-root` があるとき(`@/…` の指す先として import の閉包を辿る(`module` が別名の綴り)・生成器が配下に書く)',
      },
      onCollision: 'fail',
      place: () => SOURCE_ROOT_DIR,
      module: () => SOURCE_MODULE,
      structure,
    },
    'http-entry': {
      multiplicity: { min: 1, max: 'many', key: 'url_path' },
      owners: [{ kind: 'product' }, { kind: 'generator', id: INBOUND_GENERATOR }],
      base: 'source-root',
      origin: 'mixed',
      access: {
        readers: ['J2', 'check:formal', '生成器'],
        writers: [INBOUND_GENERATOR],
        when: '`source-root` があるとき。ジョブの起動口・認証の口は製品が手で書き、受信 Webhook の口は生成器が書く',
      },
      onCollision: 'fail',
      place: httpEntryPlace,
      module: (url) => moduleOf(httpEntryPlace(url)),
      // 入口の候補は Next が要求を受けて実行するファイルの全種類(Route Handler の全綴り + メタデータのルートの動的な形)。根の外の口の根
      // (`pages` / `src/pages` / 製品の根の `app`)と `next.config.*` の許可表の外の欄も閉世界が拒む(6 回目 C6-2・C6-5・B6-2・7 回目 C7-4。表は同じファイルの `routingFileKind` の上と `NEXT_CONFIG_ALLOWED_KEYS` の上)。
      classify: {
        dir: ROUTING_DIR,
        keyOf: urlFromRouteFile,
        entryOf: isHttpEntryCandidate,
        entryFileName: ROUTE_FILE,
        forbiddenRoots: ROUTER_RIVAL_DIRS,
        staticRoot: STATIC_ROOT,
        // 設定は在ることを要する(消すと守りのヘッダが全部消える。点検 16 回目 C16-3)。
        frameConfig: { files: NEXT_CONFIG_FILES, allowedKeys: NEXT_CONFIG_ALLOWED_KEYS, fixedMembers: NEXT_CONFIG_FIXED_MEMBERS, required: true },
        frameRootFiles: { dir: SOURCE_ROOT_DIR, files: SOURCE_ROOT_FILES },
      },
    },
    'composition-root': {
      multiplicity: { min: 1, max: 'many', key: 'integration_id' },
      owners: [{ kind: 'generator', id: INBOUND_GENERATOR }],
      base: 'source-root',
      origin: 'generated',
      access: {
        readers: ['J2', '生成器'],
        writers: [INBOUND_GENERATOR],
        when: '`source-root` があり、外部連携カタログに受信(`direction: inbound`)の行があるとき',
      },
      onCollision: 'fail',
      place: compositionPlace,
      module: (integration) => moduleOf(compositionPlace(integration)),
    },
    'screen-shell': {
      multiplicity: { min: 1, max: 'many', key: 'url_path' },
      owners: [{ kind: 'product' }],
      base: 'source-root',
      origin: 'handwritten',
      access: {
        readers: ['S7'],
        writers: [],
        when: '`source-root` があり、製品が画面(`screens`)を採るとき。製品が手で書き、検査は読むだけ(実ルートと仕様の route の突合)',
      },
      onCollision: 'fail',
      place: screenShellPlace,
      module: null,
      classify: { dir: ROUTING_DIR, keyOf: routeFromPageFile },
    },
    'request-gate': {
      multiplicity: { min: 1, max: 1, key: 'none' },
      owners: [{ kind: 'generator', id: BROWSER_DEFENSE_GENERATOR }],
      base: 'source-root',
      origin: 'generated',
      access: {
        readers: ['S7'],
        writers: [BROWSER_DEFENSE_GENERATOR],
        when: '`source-root` があるとき。生成器が書き(文書の CSP・要求の出どころ・セッションの更新)、検査は読むだけ(要ログイン画面が保護範囲 `matcher` に覆われているかの突合)',
      },
      onCollision: 'fail',
      place: () => REQUEST_GATE_FILE,
      module: null,
    },
    'root-layout': {
      multiplicity: { min: 1, max: 1, key: 'none' },
      owners: [{ kind: 'product' }],
      base: 'source-root',
      origin: 'handwritten',
      access: {
        readers: [BROWSER_DEFENSE_TESTS_GENERATOR],
        writers: [],
        when: '`source-root` があるとき。製品が手で書く根のレイアウトで、生成テストは要求ごとの描画(`await connection()`)を宣言しているかを読むだけ',
      },
      onCollision: 'fail',
      place: () => `${ROUTING_DIR}/layout.tsx`,
      module: null,
    },
    'screen-part': {
      multiplicity: { min: 1, max: 'many', key: 'file_name' },
      owners: SCREEN_PART_GENERATORS.map((id) => ({ kind: 'generator' as const, id })),
      base: 'source-root',
      origin: 'generated',
      access: {
        readers: ['code-structure-expectations'],
        writers: [...SCREEN_PART_GENERATORS],
        when: '`source-root` があり、画面の部品(`kind: form` / `table` / `detail` / `actions`)があるとき。置き場そのものが存在しないのが部品 0 件の基準線',
      },
      onCollision: 'fail',
      place: (file) => `${ROUTING_DIR}/${SCREEN_PARTS_DIR}/${file}`,
      module: null,
    },
    'screen-test': {
      multiplicity: { min: 1, max: 'many', key: 'file_name' },
      owners: [{ kind: 'product' }],
      base: 'source-root',
      origin: 'handwritten',
      access: {
        readers: ['S9'],
        writers: [],
        when: '`source-root` があるとき。製品が手で書く screenTest の置き場(検査は道案内に示すだけ。実在の突合は S8 が `@tc` の走査で見る)',
      },
      onCollision: 'fail',
      place: (file) => `${ROUTING_DIR}/__screens__/${file}`,
      module: null,
    },
    'app-icon': {
      multiplicity: { min: 1, max: 1, key: 'none' },
      owners: [{ kind: 'product' }],
      base: 'source-root',
      origin: 'handwritten',
      access: {
        readers: ['G8'],
        writers: [],
        when: '`source-root` があるとき。アプリの枠が既定で置くアイコンで、独自のアイコンを宣言したら残骸として残っていないこと(G8 (d))',
      },
      onCollision: 'fail',
      place: () => `${ROUTING_DIR}/favicon.ico`,
      module: null,
    },
    'e2e-root': {
      multiplicity: { min: 1, max: 1, key: 'none' },
      owners: [{ kind: 'product' }],
      base: 'product-root',
      origin: 'handwritten',
      access: {
        readers: ['A0〜A6(注釈の走査)', 'S0(smoke の形)', 'S11', 'W1', 'W2', 'K1'],
        writers: [],
        when: '`product-root` があるとき。製品が手で書く E2E スモーク(`*.spec.mts`)とウォーカーの置き場で、検査は読むだけ',
      },
      onCollision: 'fail',
      place: () => 'e2e',
      module: null,
    },
    'env-template': {
      multiplicity: { min: 1, max: 1, key: 'none' },
      owners: [{ kind: 'product' }],
      base: 'product-root',
      origin: 'handwritten',
      access: {
        readers: ['K2'],
        writers: [],
        when: '`product-root` があるとき。製品が手で書く設定の雛形(`NAME=` の行)で、検査は読むだけ(カタログとの双方向の突合)',
      },
      onCollision: 'fail',
      place: () => '.env.example',
      module: null,
    },
    'app-config': {
      multiplicity: { min: 1, max: 1, key: 'none' },
      owners: [{ kind: 'product' }],
      base: 'product-root',
      origin: 'handwritten',
      access: {
        readers: [BROWSER_DEFENSE_TESTS_GENERATOR],
        writers: [],
        when: '`product-root` があるとき。製品が手で書く枠の設定で、生成テストは全応答の固定のヘッダを配る `headers()` を読むだけ',
      },
      onCollision: 'fail',
      place: () => 'next.config.ts',
      module: null,
    },
    'script-root': {
      multiplicity: { min: 1, max: 1, key: 'none' },
      owners: [{ kind: 'product' }],
      base: 'product-root',
      origin: 'handwritten',
      access: {
        readers: ['K1'],
        writers: [],
        when: '`product-root` があるとき。製品が手で書く道具のスクリプトの置き場で、検査は読むだけ(設定の参照の走査)',
      },
      onCollision: 'fail',
      place: () => 'scripts',
      module: null,
    },
    'app-resource': {
      multiplicity: { min: 1, max: 'many', key: 'relative_path' },
      owners: [{ kind: 'product' }],
      base: 'source-root',
      origin: 'handwritten',
      access: {
        readers: ['ハンドブックの入力の読み込み(スタイル・状態バッジの写し元)', 'book-assets(CSS 資材の写し元の表示)'],
        writers: [],
        when: '`source-root` があるとき。ルーティング層の下の製品が手で書く資材(スタイル・状態バッジの部品)で、ハンドブックが写し元として読むだけ',
      },
      onCollision: 'fail',
      place: (relative) => `${ROUTING_DIR}/${relative}`,
      module: null,
    },
    ...generatedTestRoles(),
    ...appPartRoles(structure),
    ...importPointRoles(structure),
  };
}

/** Next.js(App Router)の置き場。 */
export const NEXTJS_LAYOUT: ProductLayout = nextjsLayoutWith(STRUCTURE);
