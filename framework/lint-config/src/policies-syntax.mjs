/**
 * 禁止する構文パターン（`no-restricted-syntax` に渡すデータ）。
 *
 * 設定値としてのポリシー表であり、ルールの実装ではない。「どの層が何を import してよいか」の
 * 正は ARCH-BE-0001 の「依存方向」の表であり、ここはその機械執行の記述である。
 *
 * 規則の種類ごとにファイルを分けてある（層境界は `policies-boundaries.mjs`、画面の見え方と
 * 文言にかかる構文の禁止は `policies-ux.mjs`、環境変数の読み方と matcher の無い `expect` の禁止は
 * `policies-syntax-selectors.mjs`）。入口は `policies.mjs` 1 つである。
 */

import { DISABLED_TEST_SELECTORS, EXPECT_MATCHER_SELECTORS, PROCESS_ENV_SELECTORS } from "./policies-syntax-selectors.mjs";

export { DISABLED_TEST_SELECTORS, EXPECT_MATCHER_SELECTORS, PROCESS_ENV_SELECTORS } from "./policies-syntax-selectors.mjs";

/**
 * 禁止する構文パターン（`no-restricted-syntax` に渡す）。
 *
 * - `vi.mock` / `jest.mock`: 具象依存コードをモジュール差し替えでテストするのを防ぐ。
 *   モックはインターフェース分離＋DIされた注入点にだけ差す（NOTES.md「コード品質の方針」）。
 * - `useEffect` 内の `fetch`: データ取得は Server Component / Server Action で行う。
 * - `role: globalRole(...)`: 拒否（`ActionError` の `role`）を `globalRole` から直接作るのを防ぐ。
 *   `_template/actor.ts` の JSDoc が明示する禁則で、system 経路の拒否が `anonymous` として
 *   誤記録される（実行者IDを持たない system は `globalRole(null)` と `anonymous`(未ログイン) を
 *   見分けられない）。拒否のロールは判断に実際に使った解決結果から作る `rejectedRole(actorRoles)`
 *   を使うこと。`globalRole` そのものは `actorRoles: (actorId) => [globalRole(actorId)]` の形で
 *   使うぶんには対象外（人間専用の操作が大半で使う定型のロール解決であり、意味が違う）。
 * - `process.env` の読み方(`PROCESS_ENV_SELECTORS`)と matcher の無い `expect(...)`
 *   (`EXPECT_MATCHER_SELECTORS`): 末尾に連ねてある(正は各配列の注釈)。
 */
export const RESTRICTED_SYNTAX = [
  {
    selector:
      "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock|unmock|doUnmock)$/]",
    message:
      "vi.mock() 等によるモジュール差し替えは禁止。インターフェースを切り、DIされた注入点にテスト用実装を渡すこと。",
  },
  {
    selector:
      "CallExpression[callee.object.name='jest'][callee.property.name=/^(mock|doMock|unmock|setMock|requireMock)$/]",
    message:
      "jest.mock() 等によるモジュール差し替えは禁止。インターフェースを切り、DIされた注入点にテスト用実装を渡すこと。",
  },
  {
    selector:
      "CallExpression[callee.name='useEffect'] CallExpression[callee.name='fetch']",
    message:
      "useEffect 内でのデータ取得は禁止。Server Component でのフェッチか Server Action を使うこと。",
  },
  {
    selector:
      "CallExpression[callee.name='useEffect'] CallExpression[callee.property.name='fetch']",
    message:
      "useEffect 内でのデータ取得は禁止。Server Component でのフェッチか Server Action を使うこと。",
  },
  {
    selector:
      "CallExpression[callee.property.name='useEffect'] CallExpression[callee.name='fetch']",
    message:
      "useEffect 内でのデータ取得は禁止。Server Component でのフェッチか Server Action を使うこと。",
  },
  {
    selector: "Property[key.name='role'] > CallExpression[callee.name='globalRole']",
    message:
      "role: globalRole(...) は禁止。拒否のロールは rejectedRole(actorRoles)（_template/actor.ts）から作ること" +
      "（globalRole から直接作ると system 経路の拒否が anonymous として誤記録される）。" +
      "既存の例外は eslint-disable-next-line で明示すること。",
  },
  // 環境変数の読み方(K1 の閉世界の執行者)と、matcher の無い expect(A16 の ESLint 側の対)。
  ...PROCESS_ENV_SELECTORS,
  ...EXPECT_MATCHER_SELECTORS,
  ...DISABLED_TEST_SELECTORS,
];

/**
 * 読み取りクエリ（`**​/queries.ts`）だけに課す禁止パターン（`no-restricted-syntax` に渡す）。
 *
 * 正は ARCH-BE-0016（読み取り経路）と conventions/queries.md。読み取りの安全性は
 * 「RLS が効いた経路であること」と「宣言された列しか取らないこと」の 2 点に懸かっており、
 * どちらもレビューではなく機械で落とす。
 */
export const QUERY_RESTRICTED_SYNTAX = [
  {
    selector: "CallExpression[callee.name='createServiceRoleClient']",
    message:
      "クエリ関数で service role クライアントを使うのは禁止。RLS をバイパスすると可視性を守るものが無くなる（ARCH-BE-0016）。JWT 付きクライアントを使うこと。",
  },
  {
    selector: "ImportSpecifier[imported.name='createServiceRoleClient']",
    message:
      "クエリ関数で service role クライアントを import するのは禁止。読み取りは JWT 付きクライアント（RLS 有効経路）で行う（ARCH-BE-0016）。",
  },
  {
    // select('*') もこれで拾う（Literal は文字列・数値の両方を含む）。
    // .select(SOME_CONST) のような識別子経由は対象外 —— 型情報なしに「その定数が
    // 生成物由来か」までは判定できない。generate で導けない例外（型カーディナリティの決定など）は
    // 識別子経由に逃げず、理由つきの eslint-disable-next-line で明示させる運用にしてある
    // （queries.md「select / order / limit は生成物から」）。
    selector:
      "CallExpression[callee.property.name=/^(select|order|limit|range)$/] > :matches(Literal, TemplateLiteral)",
    message:
      "select() / order() / limit() / range() に列名・並び・上限を直書きするのは禁止（'*' を含む）。これらは query_spec の projection / sort / paging から生成された @/domain/generated/query-fragments（queryFragments.{name}.select / .order / .limit）をそのまま渡すことに1本化してある。列の隠蔽（fields_hidden）に対するアプリ側の防波堤でもある（* を書くと Q3 の検査が素通りする）。generate で導けない例外（型カーディナリティの決定・nulls の位置など）だけ、理由つきの eslint-disable-next-line で明示すること（queries.md）。",
  },
  {
    selector: "CallExpression[callee.property.name='filter']",
    message:
      "クエリの中で .filter() を書くのは禁止。行の選別を TS 側で肩代わりした瞬間、可視性・絞り込みの正が query_spec と RLS から離れる（取得後に絞るので paging の意味も壊れる）。絞り込みは query_spec の filters に宣言して WHERE に写し、可視性は access_spec の reads に書く（queries.md「行の選別は書かない」）。",
  },
  {
    selector: "CallExpression[callee.property.name='find']",
    message:
      "クエリの中で .find() を書くのは禁止。1 件を選ぶのは DB の仕事であり（filters + returns: one）、取得後に TS 側で選ぶと「何件取ってきたか」が仕様から読めなくなる（queries.md「行の選別は書かない」）。",
  },
  {
    // `.eq('owner_id', actorId)` の第 2 引数（呼び出しの直下に来る Identifier）だけを見る。
    // `applyActorConditions(builder, conditions, actorId)` の callee は MemberExpression では
    // ないので当たらない＝生成物を適用する唯一の口だけが通る。
    selector: "CallExpression[callee.type='MemberExpression'] > Identifier[name='actorId']",
    message:
      "クエリの中で実行者の ID を問い合わせに直接渡すのは禁止。スコープ条件（可視性を成立させる絞り込み）は via のロールの binding からの決定的な写しであり、写す作業は機械の仕事である（BACKLOG「決定性の格上げ①」）。列の並びは生成物 @/domain/generated/query-windows が持ち、適用は applyActorConditions（infrastructure/supabase/query-window.ts）だけが行う。足したい条件があるなら query_spec か roles.md を直して generate すること。",
  },
];

/**
 * 入力スキーマの導出（`src/domain/inputs/**`）だけに課す禁止パターン。
 *
 * 正は server-actions.md「フォームと Server Action は同じ導出スキーマを使う」。
 * ここに置いてよいのは**生成スキーマからの導出**（`omit` / `pick` / `extend` / `shape` の借用）
 * だけで、制約そのものを書き直した瞬間に `entity_spec` と二重管理になる。
 * 「zod を新しく組み立てる口」を機械で塞ぐ（レビューに頼らない）。
 */
export const INPUT_RESTRICTED_SYNTAX = [
  {
    selector: "ImportDeclaration[source.value='zod']",
    message:
      "src/domain/inputs/ で zod を import するのは禁止。ここに書いてよいのは生成スキーマからの導出（omit / pick / extend / shape の借用）だけで、制約の再定義は entity_spec との二重管理になる（server-actions.md）。",
  },
  {
    selector: "CallExpression[callee.object.name='z']",
    message:
      "src/domain/inputs/ で zod のコンストラクタ（z.string() 等）を呼ぶのは禁止。制約の正は entity_spec の生成スキーマであり、ここはその導出だけを書く（server-actions.md）。",
  },
];

/**
 * 画面の `data-testid`（`src/app/**`）だけに課す禁止パターン。
 *
 * 正は screen-spec-writing.md §testid。testid の**骨格**（`{画面名}.{スロットパス}.{部品}`）は
 * `screen_spec` の `layout` そのものであり、実装が同じ文字列を手で書くと仕様と DOM が静かに
 * ずれる（C-1 の実測: 共有ヘッダが `app.header.…` を名前に使っており、仕様の名前空間 `{集約}.header.…`
 * とは別物になっていた）。骨格は生成物（`@/domain/generated/testids`）からしか作れないようにする。
 *
 * 部品の**内側**（入力欄・行・エラー表示）は仕様が持たない自由地帯なので、
 * `` `${itemDetailTestIds['body.center.loan_form']}.title` `` のように
 * 生成定数を前置きにした派生を許す。禁じるのは「先頭に手書きの文字列が来ること」だけである。
 */
export const TESTID_RESTRICTED_SYNTAX = [
  {
    selector: "JSXAttribute[name.name='data-testid'] > Literal",
    message:
      "data-testid に文字列を直書きするのは禁止。testid の骨格は screen_spec の layout が正であり、生成物 @/domain/generated/testids の定数を使う（screen-spec-writing.md §testid）。",
  },
  {
    selector: "JSXAttribute[name.name='data-testid'] > JSXExpressionContainer > Literal",
    message:
      "data-testid に文字列を直書きするのは禁止（式で包んでも同じ）。生成物 @/domain/generated/testids の定数を使う（screen-spec-writing.md §testid）。",
  },
  {
    selector:
      "JSXAttribute[name.name='data-testid'] > JSXExpressionContainer > TemplateLiteral[quasis.0.value.raw!='']",
    message:
      "data-testid のテンプレート literal を手書きの文字列で始めるのは禁止。骨格は生成定数から取り、その後ろに部品内側の名前を足す形（`${screenTestIds…}.title`）で書く（screen-spec-writing.md §testid）。",
  },
];

/**
 * 視覚層（`src/app/**` と `src/components/**` の JSX）だけに課す禁止パターン。
 *
 * 正は styling.md（G1〜G4）。**色と寸法の生値を書かせない仕組みは CSS 側にある**
 * （G1 が `legacy/spec-tools` の検査として `.css` を走査する）が、JSX の `style` 属性で書かれた
 * 値はその視界の外にある —— CSS ファイルに現れないためである。
 *
 * したがってここで塞ぐのは「値」ではなく「口」である。`style` 属性を 1 つも書けなくすれば、
 * 意匠は必ず CSS Modules を通り、G1 の走査対象に入る。動的な寸法が本当に要るときは
 * CSS custom property を要素に載せる形（`style={{ '--x': … }}`）になるが、
 * **その実例がまだ 1 つも無いので例外は作っていない**（要ったときに、この行を緩めるのではなく
 * 規約に実例つきで書き足す）。
 */
export const STYLE_RESTRICTED_SYNTAX = [
  {
    selector: "JSXAttribute[name.name='style']",
    message:
      "JSX に style 属性を書くのは禁止。スタイルは CSS Modules に置き、値はデザイントークン（var(--…)）から引く。インラインの style は生値の直書き検査（G1）の視界に入らないため、口ごと塞いでいる（styling.md）。",
  },
];
