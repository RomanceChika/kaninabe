/**
 * 層境界のポリシーのうち、**テストの軸の緩和**(`BOUNDARY_POLICIES` の末尾に並ぶ。評価は last-write-wins なので順も含めて
 * ここが正)。テスト本体・ハーネス・規則の単体テスト・静的走査のテストが、層の要素のポリシーに足して引いてよい相手だけを持つ。
 * 層の要素ごとのポリシーは `policies-boundaries.mjs`。
 */

import { LINT_CONFIG_ELEMENT, RUNTIME_ELEMENTS } from "./runtime-elements.mjs";

/** テストの軸の緩和(`BOUNDARY_POLICIES` の末尾)。 */
export const TEST_AXIS_POLICIES = [
  // --- テストファイルはテストランナーを import してよい（層境界は緩めない） ---
  {
    from: { file: { categories: "test" } },
    allow: {
      to: {
        module: {
          origin: "external",
          // fast-check は「仕様から導いた候補を振る」値の生成器（束 ⑰-3 の生成ユニット
          // テストの性質）。テストランナーと同じ扱いにする。
          source: ["vitest", "@testing-library/**", "fast-check"],
        },
      },
    },
  },

  // --- テストの軸だけが実行時パッケージのテスト基盤（ハーネス）を引ける（束 ①-d 手 2） ---
  // ハーネス本体は `@kaninabe/runtime/testing/**` に住む（ADR-0013）。**本番コードからは引けない** ——
  // 要素として宣言する前はどの分類にも当たらない「未知」で、テストの軸では
  // `no-unknown-dependencies` も切ってあるため、本番コードが引いても誰も咎めなかった。
  // 許すのはこの 3 分類だけである: テスト本体（`test`）・ハーネスのアダプタ（`harness-adapter`）・
  // world の設計図の生成物（`test-world-declaration`）。
  {
    from: { file: { categories: "test" } },
    allow: [{ to: { element: { type: RUNTIME_ELEMENTS.testing } } }],
    message:
      "テスト本体は @kaninabe/runtime/testing/**（ハーネス）を import してよい。本番コードからは引けない（層のポリシーが許していない）。",
  },

  // --- ハーネスのアダプタ（生成物）は、ハーネス本体と製品の生成物・接続層を束ねる ---
  // 生成テストが呼ぶ住所であり、**口（HarnessPorts）を渡すだけの層**である（束 ①-d）。
  // 層の要素（infrastructure / composition）のポリシーはそのまま効く —— ここが足すのは
  // 「パッケージのテスト基盤を引ける」ことだけである。
  {
    from: { file: { categories: "harness-adapter" } },
    allow: [{ to: { element: { type: RUNTIME_ELEMENTS.testing } } }],
    message:
      "ハーネスのアダプタ（生成物）は @kaninabe/runtime/testing/** を import してよい（口を渡す層）。",
  },

  // --- world の設計図の生成物は、型をパッケージから再輸出する ---
  // `rls-worlds.ts` / `eq-worlds.ts` は**テストだけが読む生成物**であり、形（型）の正は
  // パッケージのハーネスが持つ（束 ①-d 手 2 で二重の宣言を 1 つにした）。値は仕様から生成される。
  {
    from: { file: { categories: "test-world-declaration" } },
    allow: [{ to: { element: { type: RUNTIME_ELEMENTS.testing } } }],
    message:
      "world の設計図（生成物）は @kaninabe/runtime/testing/**/types から型を再輸出してよい（形の正はハーネス側 1 か所）。",
  },

  // --- セッションテストハーネス（src/app/__tests__）は composition と同じ扱い ---
  // Server Action を実物のまま呼ぶ実 DB 統合テストであり、screenTest（層境界を緩めない）とは
  // 別物である。composition の統合テスト（src/composition/__tests__）が domain / operation /
  // infrastructure に直接依存できるのと同じ理由（Composition Root 相当の配線をテスト側が担う）。
  {
    from: { file: { categories: "session-harness" } },
    allow: [
      {
        to: {
          element: {
            // パッケージへの直接依存はセッションの adapter だけ（注入が cookie の約束 `__Host-auth*` を同じ正から組むため）。
            types: { anyOf: ["domain", "operation", "infrastructure", "composition", "components", "framework-adapter"] },
          },
        },
      },
      { to: { module: { origin: ["external", "core"] } } },
    ],
    message:
      "src/app/__tests__ は Server Action を実物のまま呼ぶ実 DB 統合テストの置き場。domain・operation・infrastructure・composition・セッションの adapter（cookie の約束）・外部SDK/Node組み込みへの依存を許す。",
  },

  // --- 基盤の層のテストと支援コード(`src/infrastructure/__tests__`)は外部パッケージの全部を引ける ---
  // 実 DB に繋ぐ統合テスト・seed・RLS の world が `pg` / `@supabase/supabase-js` / `vitest` を引く。基盤の層の既定は枠の基盤だけで、
  // 外部の SDK は宣言した置き場の分類からだけ許す(B9-4)ので、テストの軸の緩和をここに 1 本置く(本番コードには効かない)。
  {
    from: { file: { categories: "infrastructure-test-support" } },
    allow: { to: { module: { origin: ["external", "core"] } } },
  },

  // --- ブラウザ側の守りの配線の見張りテスト(生成物): 枠の設定と根のレイアウトを読み、リクエスト前段を実物のまま呼ぶ ---
  {
    from: { file: { categories: "browser-defense-wiring-test" } },
    allow: [{ to: { module: { origin: "core" } } }, { to: { file: { categories: "proxy" } } }],
  },

  // --- 画面実装への静的走査テスト（gate-implementation.test.ts）は Node 組み込みを import してよい ---
  // 通常の screenTest はレンダリング結果を突き合わせるだけで実ファイルを読まないが、これは
  // 「実装ファイルが関門の関数を呼んでいるか」を `_screens/*.tsx` のソースを直接読んで見る
  // （H2 の実装実在検査の延長。infrastructure/__tests__/guarantees と同じ理由で node:fs / node:path が要る）。
  {
    from: { file: { categories: "screen-static-scan" } },
    allow: { to: { module: { origin: "core" } } },
  },

  // --- ESLint ローカルルールの単体テストは Node 組み込みを import してよい ---
  // `layer/no-direct-action-call` を型情報つき ESLint(projectService)で lintFiles する単体
  // テスト。フィクスチャを実ファイルとして書き出す必要があり node:fs / node:path が要る
  // （screen-static-scan・infrastructure/__tests__/guarantees と同じ理由）。
  // もう 1 つ、規則の置き場そのもの(`@kaninabe/lint-config`)を import してよい —— 規則の単体テストが
  // 読む相手だからである。要素として宣言するのは、宣言が無いと「未知」の相手になり、テストの軸だけ
  // `no-unknown-dependencies` を切るしか無くなる(束 分離 ②-b2: 切り欠きは消した)ため。
  {
    from: { file: { categories: "eslint-rule-test" } },
    allow: [
      { to: { module: { origin: "core" } } },
      { to: { element: { type: LINT_CONFIG_ELEMENT } } },
      // 規則を実際の設定で回す道具そのものと、テストの支援コード(`danger-api-lint.ts`)が引くテストランナー(画面の層の許可表には載せない。B8-1)。
      { to: { module: { origin: "external", source: ["eslint", "eslint-plugin-boundaries", "typescript", "typescript-eslint", "vitest"] } } },
    ],
  },

  // --- 期待ファイル木の逆方向の突合(structure-static-scan)は Node 組み込み + typescript
  // パッケージ + domain(生成物)+ テストランナーを import してよい ---
  // ファイルシステムと TS 構文木を読む静的走査テスト(決定性の格上げ ⑥)。**last-write-wins
  // なのでこの 1 エントリが "operation" 要素の既定ポリシー(domain + zod のみ)を丸ごと
  // 置き換える** —— domain(生成物 structure-expectations.ts の import)を明示的に足す。
  {
    from: { file: { categories: "structure-static-scan" } },
    allow: [
      { to: { element: { type: "domain" } } },
      // パッケージへの直接依存は無い（実測。期待ファイル木は `app/src/` の話しかしない）。
      { to: { module: { origin: ["external", "core"] } } },
    ],
  },
];
