import { defineConfig } from "vitest/config";

/**
 * ユニットテストの実行の**根**(vitest の projects)。
 *
 * ## なぜルートに要るのか
 *
 * 束 ①-b で仕組みの実行時コードが `app/src/` から実行時パッケージへ出た(ADR-0013)。
 * カバレッジの v8 プロバイダは**プロジェクトルートの外のファイルを測らない**ので、実行を
 * `app/` に根付かせたままでは「テストは走っているのに閾値が掛からない」状態になる ——
 * `coverage.include` にパッケージを指すグロブを足しても表に出ないことを実測で確かめた
 * (相対で遡る形と、globstar を前置する形の両方で試した)。移動で検査の範囲が静かに縮むのを防ぐため、**実行の根をリポジトリルートに上げる**。
 *
 * 引き換えは「テストの置き場を動かさずに済む」ことである。製品のテストが製品の語で
 * パッケージのコードを実行するのは今までと同じ形であり、**いまの検査をそのまま新しい住所に
 * 掛け直しただけ**になる(パッケージ単体で製品なしに実行できるテストを揃えるのは、公開
 * パッケージにする第 2 段の受け入れ条件であって、この段の受け入れには要らない)。
 *
 * ## 何をどこが決めるか
 *
 * - **実行方法**(環境・alias・include / exclude)は各 project の設定が持つ。ここは参照するだけで、
 *   写しを作らない。
 * - **カバレッジ**はここだけが持つ。projects の実行は 1 つの表に集まるので、閾値の宣言が
 *   2 か所に分かれる余地が無い(`framework-dirs.ts` が免除リスト 6 か所を畳んだのと同じ形)。
 */
export default defineConfig({
  test: {
    // ワーカーの上限(手元の CPU の上限 2 まで。並びの数は環境で変えず、ここに固定する。環境変数 VITEST_MAX_WORKERS は実 DB の設定の直列を壊すので使わない)。
    maxWorkers: 2,
    projects: ["framework/runtime/vitest.config.mts", "framework/adapters/postgrest/vitest.config.mts", "framework/adapters/supabase-session/vitest.config.mts", "framework/adapters/log-axiom/vitest.config.mts"],
    coverage: {
      provider: "v8",
      include: ["framework/runtime/src/**", "framework/adapters/postgrest/src/**", "framework/adapters/supabase-session/src/**", "framework/adapters/log-axiom/src/**"],
      exclude: [
        // 実行時パッケージの配布物(`tsc` の成果物)。`include` が `src/**` なので構造的にも
        // 入らないが、**検査の範囲外にあることを宣言として置く**(ADR-0013 の配り方 A の条件 2)。
        // adapter パッケージの `dist` も同じ理由で構造的に外にある(`include` が `src/**`)。
        "framework/runtime/dist/**",
        // --- 製品側(app/vitest.config.mts から移した線。理由は各項に書いてある) ---
        "app/src/domain/generated/**",
        // 層READMEはコードではない。v8 のリマップがパースに失敗してノイズになるため外す。
        "**/*.md",
        "**/__tests__/**",
        "**/*.test.*",
        // src/app 全体（画面・Server Action・Route Handler）。実体（リクエスト・cookie・
        // 実DB）が無いと何も確かめられない層である。`_screens/` を一度対象に入れて測った
        // 結果と、外に戻した理由は testing/unit.md 6節に書いてある（残った分岐はすべて
        // null 許容フィールドの表示フォールバック＝仕様が持たない自由地帯だった）。
        "app/src/app/**",
        // リクエスト前段（Next.js の proxy 規約の入口）。中身は infrastructure への
        // 委譲だけで、実体が無いと何も確かめられない（testing/unit.md 7節）。
        "app/src/proxy.ts",
        "app/src/components/**",
        "app/src/composition/**",
        "app/src/infrastructure/**",
        // --- 実行時パッケージ側(製品と同じ線を当てる) ---
        // 受信の段取り。**製品の `app/src/infrastructure/**` を外しているのと同じ理由**である ——
        // 実リクエストが無いと何も確かめられないので、ユニットの検査ではなく統合テストが保証を持つ
        // (testing/integration.md)。テストの置き場も製品側と同じで、`src/infrastructure/__tests__/**` は
        // ユニットの実行から外れている。(接続層・汎用 RPC の口は ③-e2D で adapter パッケージ
        // `framework/adapters/postgrest` へ出た。拒否の分類 `src/refusal/**` は純粋な関数なので
        // 外さず、閾値の対象に入れている。)
        "framework/runtime/src/inbound/**",
        // world の組み立て(設計図 → 置き直したあとの行の値)。**このユニットテストの実行では動かない** ——
        // 呼び側は ①一致の証明のハーネス(実 DB。`npm run test:integration`)と
        // ②ハンドブックの結果表(`docs` の実行。`lib/results/simulated-world.ts` 経由)の 2 つで、
        // どちらもこの projects の外に居る。仕様側と実 DB 側が**同じ 1 本**を使うことが
        // この置き場の目的なので、片方の実行だけに閉じた写しは作らない。
        "framework/runtime/src/sql/**",
        // --- kaninabe の最初の切り出しで、測れなくなった分(docs/known-gaps.md の 11) ---
        // 次のファイルは、旧製品が生成した操作のユニットテスト・フォームのテスト(製品の側の木)が踏んでいた分で、
        // kaninabe にはまだそれを動かす製品が無い。100% の閾値を下げる代わりに、**名指しで**測定の外に置く。
        // サンプル製品から生成したテストでこの表を空にする(空になったらこのブロックを消す)。
        "framework/runtime/src/domain/action-error.ts",
        "framework/runtime/src/domain/datetime.ts",
        "framework/runtime/src/domain/form-changes.ts",
        "framework/runtime/src/domain/form-datetime.ts",
        "framework/runtime/src/domain/form-plan.ts",
        "framework/runtime/src/domain/form.ts",
        "framework/runtime/src/domain/preflight.ts",
        "framework/runtime/src/domain/result.ts",
        "framework/runtime/src/domain/step-decision.ts",
        "framework/runtime/src/navigation/client.ts",
        "framework/runtime/src/operation/_template/facts.ts",
        "framework/runtime/src/operation/_template/outcome.ts",
        "framework/runtime/src/operation/_template/run-plan-args.ts",
        "framework/runtime/src/operation/_template/run-plan-decide-core.ts",
        "framework/runtime/src/operation/_template/run-plan-decide.ts",
        "framework/runtime/src/operation/_template/run-plan-facts.ts",
        "framework/runtime/src/operation/_template/run-plan-reads.ts",
        "framework/runtime/src/operation/_template/run-plan.ts",
        "framework/runtime/src/operation/_template/transition.ts",
        "framework/runtime/src/operation/_template/update-fields.ts",
        "framework/runtime/src/operation/_template/update.ts",
        "framework/runtime/src/plan/types.ts",
      ],
      thresholds: {
        // 実行時パッケージ。移す前は `app/src/domain/**` の閾値の中に居たので、同じ 100% を
        // そのまま引き継ぐ（移動で数字を動かさない）。
        "framework/runtime/src/**": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
        // PostgREST の adapter。runtime から出る前は上の閾値の中に居たので、同じ 100% を引き継ぐ。
        // 製品や検証器のテストが踏む分に頼らず、自前のテスト(`src/**/__tests__/`)だけで届く形にしてある
        // (パッケージ単体で製品なしに実行できることが、公開パッケージにする段の受け入れ条件。ADR-0013)。
        "framework/adapters/postgrest/src/**": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
        // Supabase のセッションの adapter(cookie の約束・サインインの開始・ログアウト)。PostgREST の adapter と同じ 100% を、
        // 自前のテストだけで満たす(書く cookie と消す cookie の全部が約束の属性を持つことを、ここのテストが見る)。
        "framework/adapters/supabase-session/src/**": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
        // Axiom へのログの転送の adapter(取り込みの宛先の縛り・応答の読み分け・失敗が値で返ること)。他の adapter と同じ 100% を自前のテストだけで満たす。
        "framework/adapters/log-axiom/src/**": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
      },
    },
  },
});
