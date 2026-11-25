/**
 * 層境界のポリシー（`BOUNDARY_POLICIES`）。`docs/` を指す import の禁止は
 * `policies-docs-imports.mjs`、構文の禁止は `policies-syntax.mjs` が持つ。入口は `policies.mjs`。
 */

import { RUNTIME_ELEMENTS } from "./runtime-elements.mjs";
import { TEST_AXIS_POLICIES } from "./policies-boundaries-tests.mjs";
import {
  COMPOSITION_EXTERNAL_PACKAGES,
  INFRASTRUCTURE_EXTERNAL_PACKAGES,
  UI_FOUNDATION_PACKAGES,
  UI_LAYER_EXTERNAL_PACKAGES,
} from "./policies-external-packages.mjs";

/**
 * 層境界のポリシー（boundaries/dependencies、default: disallow の allowlist）。
 *
 * 正となる定義は ARCH-BE-0001「依存方向」の表。ここはその機械執行（E1〜E3）。
 * 評価は last-write-wins。同一層内の import は「要素内部の依存」として既定で無視される。
 *
 * **実行時パッケージ `@kaninabe/runtime`（ADR-0013）は層ではないが、層ごとに要素を立てる。**
 * `RUNTIME_ELEMENTS.domain` / `.operation` / `.infrastructure`（と adapter の `.adapter`）の綴りは
 * `./runtime-elements.mjs` が 1 か所で作る。1 つにまとめると「domain が受信口を引く」
 * 「components が実行器を引く」が通ってしまい、コードを移した瞬間に検査が 1 ビット緩む。
 * 割ったうえで各層に許すのは**移動前と同じ届く先だけ**である（domain・app・components は純粋な軸のみ /
 * operation は実行器まで / infrastructure と composition はパッケージの infrastructure 側と adapter まで。
 * adapter は許す側に足さない限り誰も引けない）。
 *
 * @see ./docs/rules/architecture/system/backend/ARCH-BE-0001-app-layer-structure.md
 */
export const BOUNDARY_POLICIES = [
  // --- domain: 何も import しない（他層・react・next・Node組み込みすべて不可） ---
  {
    from: { element: { type: "domain" } },
    allow: [
      { to: { module: { origin: "external", source: "zod" } } },
      // 評価器と実行計画の型（束 ①-b までは `src/domain/engine` と `src/domain/generated` に
      // 住んでいた同じコード）。純粋層のままである —— `@kaninabe/runtime` は zod 以外の実行時依存を
      // 持たない（パッケージ自身の lint と型がそれを見る）。**パッケージの domain 層だけ**を
      // 許す —— 実行器（operation）や RPC / facts（infrastructure）は依存ゼロの純粋層から
      // 引いてよいものではない。
      { to: { element: { type: RUNTIME_ELEMENTS.domain } } },
    ],
    message:
      "domain は依存ゼロの純粋層。zod と @kaninabe/runtime の domain 層（評価器・実行計画の型・束の型）以外の import は禁止（他層・react・next・Node組み込みを含む）。",
  },

  // --- operation: domain のみ ---
  {
    from: { element: { type: "operation" } },
    allow: [
      { to: { element: { type: "domain" } } },
      // 実行器（`_template`）とロール解決の部品まで届く。パッケージの infrastructure は不可。
      {
        to: {
          element: {
            types: { anyOf: [RUNTIME_ELEMENTS.domain, RUNTIME_ELEMENTS.operation] },
          },
        },
      },
      { to: { module: { origin: "external", source: "zod" } } },
    ],
    message:
      "operation が import してよいのは domain と zod だけ。具象（Supabaseクライアント・外部SDK）は infrastructure に閉じ、ports.ts の IF として引数で受けること。",
  },

  // --- infrastructure: domain + Node組み込み + 枠の基盤(外部の SDK は宣言した置き場の分類だけ。sdkHomeBoundaries) ---
  {
    from: { element: { type: "infrastructure" } },
    allow: [
      { to: { element: { type: "domain" } } },
      {
        to: {
          element: {
            types: { anyOf: [RUNTIME_ELEMENTS.domain, RUNTIME_ELEMENTS.infrastructure, RUNTIME_ELEMENTS.adapter] },
          },
        },
      },
      { to: { module: { origin: "core" } } },
      // 外部パッケージは枠の基盤だけ。外部の SDK は宣言した置き場(adapter_root・土台)の下でだけ引ける(B9-4)。
      { to: { module: { origin: "external", source: [...INFRASTRUCTURE_EXTERNAL_PACKAGES] } } },
    ],
    message:
      "infrastructure が import してよいのは domain・Node組み込み・枠の基盤のパッケージ（next / react / react-dom / zod / server-only）・operation の ports.ts（型のみ）・runtime の infrastructure 側(拒否の分類・受信口)・adapter パッケージだけ。外部の SDK は external.md の sdk_packages に宣言し、その adapter_root の下に置く（集約のディレクトリから引くと有料の口の関門を通らない）。composition・app・components は不可。",
  },
  // 依存性逆転: operation が宣言した IF を実装するための型 import だけを許す。
  // `ports.ts` 以外のファイルや、関数本体の値 import は許可されない。
  {
    from: { element: { type: "infrastructure" } },
    dependency: { kind: "type" },
    allow: {
      to: {
        element: { types: { anyOf: ["operation", RUNTIME_ELEMENTS.operation] } },
        // `**/ports.ts` はパッケージ側の `src/operation/ports.ts` にも当たる（@kaninabe/runtime/ports）。
        file: { categories: "ports" },
      },
    },
    message:
      "infrastructure が operation を参照してよいのは ports.ts の IF を型として実装するときだけ（製品でもパッケージでも同じ）。operation の関数本体を呼んではならない。",
  },

  // --- composition: domain / operation / infrastructure（Composition Root） ---
  {
    from: { element: { type: "composition" } },
    allow: [
      {
        to: {
          element: {
            types: {
              anyOf: [
                "domain",
                "operation",
                "infrastructure",
                RUNTIME_ELEMENTS.domain,
                RUNTIME_ELEMENTS.operation,
                RUNTIME_ELEMENTS.infrastructure,
                RUNTIME_ELEMENTS.adapter,
                // 転送の安全な部品(`safeRedirect`。要求の関門が未ログインをログイン画面へ送る)。
                RUNTIME_ELEMENTS.navigation,
              ],
            },
          },
        },
      },
      { to: { module: { origin: "core" } } },
      // 外部パッケージは許可表だけ(SDK は infrastructure のアダプタに閉じる。B8-1)。
      { to: { module: { origin: "external", source: [...COMPOSITION_EXTERNAL_PACKAGES] } } },
    ],
    message:
      "composition は DI 配線専用。app・components に依存してはならない（配線される側が配線元を知らないため）。外部パッケージは next / react / zod / server-only だけで、外部の SDK・サービスのパッケージ（AI の SDK・@supabase/* など）は infrastructure のアダプタに閉じる。",
  },

  // --- src/app: composition・domain・components ---
  {
    from: { element: { type: "app" } },
    allow: [
      {
        to: {
          element: {
            // パッケージは domain 層だけ（実測: datetime / engine / form / preflight / result）。
            // 実行器（@kaninabe/runtime/template）や RPC を画面から直に引かせない。
            types: { anyOf: ["composition", "domain", "components", "screens-generated", RUNTIME_ELEMENTS.domain, RUNTIME_ELEMENTS.navigation] },
          },
        },
      },
      // 外部パッケージは許可表だけ(SDK は infrastructure のアダプタに閉じる。B8-1)。
      { to: { module: { origin: "external", source: [...UI_LAYER_EXTERNAL_PACKAGES] } } },
    ],
    message:
      "src/app から operation・infrastructure を直接 import しない。必ず composition（Composition Root）を経由すること。外部パッケージは next / react / react-dom / zod / server-only だけで、外部の SDK・サービスのパッケージ（AI の SDK・@supabase/* など）は infrastructure のアダプタに閉じる（ページから直に呼ぶと有料の口の関門を通らない）。",
  },

  // --- screens-generated(`src/app/_screens/generated`): 画面の部品の生成物 ---
  // 手書きの器(`_screens/{画面}.tsx`)から呼ばれる側で、**器を知らない**(`app` を許さない)。
  // composition も引けない — 依存は器が引数で渡す(`render{X}Screen(deps)` と同じ向き)。
  {
    from: { element: { type: "screens-generated" } },
    allow: [
      { to: { element: { types: { anyOf: ["components", "domain", RUNTIME_ELEMENTS.domain, RUNTIME_ELEMENTS.navigation] } } } },
      { to: { element: { type: "app" }, file: { categories: "screen-actions" } } },
      { to: { module: { origin: "external", source: [...UI_LAYER_EXTERNAL_PACKAGES] } } },
    ],
    message:
      "画面の部品の生成物(_screens/generated)が import してよいのは components・domain・@kaninabe/runtime の domain 層・Server Action(_actions)・画面の基盤の外部パッケージ(next / react / zod)だけ。器(_screens/*.tsx)や composition・外部の SDK は不可。",
  },

  // --- proxy: リクエスト前段（層ではなく Next.js のファイル規約の入口） ---
  // セッション更新の実体は infrastructure に置く。前段が domain / operation / composition を呼び始めたら、それは「前段に業務を持ち込んだ」合図（ARCH-BE-0016）。
  // ブラウザ側の守りのため宣言の値(生成物 1 本)と runtime の domain 層を足す(domain は明示の禁止に並べない — 許した 1 本まで禁止が勝つ)。
  {
    from: { file: { categories: "proxy" } },
    allow: [
      { to: { element: { type: "infrastructure" } } },
      { to: { element: { type: "domain" }, file: { categories: "browser-defense-policy" } } },
      { to: { element: { type: RUNTIME_ELEMENTS.domain } } },
      { to: { module: { origin: "external", source: [...UI_FOUNDATION_PACKAGES] } } },
    ],
    disallow: { to: { element: { types: { anyOf: ["operation", "composition", "app", "components"] } } } },
    message:
      "src/proxy.ts が import してよいのは infrastructure（セッション更新の実体）・ブラウザ側の守りの宣言の値（生成物）・@kaninabe/runtime の domain 層・枠の基盤の外部パッケージ（next）だけ。前段は認可・業務判断を持たない（ARCH-BE-0016）。外部の SDK は infrastructure に閉じる。",
  },

  // --- components: domain（型・zod）のみ ---
  {
    from: { element: { type: "components" } },
    allow: [
      { to: { element: { type: "domain" } } },
      // パッケージは domain 層だけ（実測: form / result）と、転送の安全な部品(`useSafeNavigate`)。
      { to: { element: { types: { anyOf: [RUNTIME_ELEMENTS.domain, RUNTIME_ELEMENTS.navigation] } } } },
      { to: { module: { origin: "external", source: [...UI_LAYER_EXTERNAL_PACKAGES] } } },
    ],
    disallow: {
      to: {
        module: {
          origin: ["external", "core"],
          source: ["server-only", "@supabase/**", "node:**"],
        },
      },
    },
    message:
      "components が import してよいのは domain（型・zodスキーマ）と画面の基盤の外部パッケージ（next / react / react-dom / zod）だけ。operation・infrastructure・composition・サーバー専用パッケージ・外部の SDK は不可。",
  },

  // --- 外部の SDK の置き場と SDK の UI 部品は、仕様から生成した表(`sdk-homes.json`)を `sdkHomeBoundaries` が分類とポリシーにする
  //     (policies-sdk-homes.mjs。製品の設定がこの表の後ろに足す。B9-4) ---

  // --- 型だけの import は外部パッケージの全部を許す(実行時に何も呼ばない。B8-1 の許可表の外側) ---
  {
    from: { element: { types: { anyOf: ["app", "composition", "components", "screens-generated", "infrastructure"] } } },
    dependency: { kind: "type" },
    allow: { to: { module: { origin: "external" } } },
  },

  // --- テストの軸の緩和(テストランナー・ハーネス・規則の単体テスト・静的走査。policies-boundaries-tests.mjs) ---
  ...TEST_AXIS_POLICIES,
];
