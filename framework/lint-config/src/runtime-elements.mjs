/**
 * 実行時パッケージ `@kaninabe/runtime`（ADR-0013）と、その上の adapter パッケージの境界要素。
 *
 * パッケージは**製品の層ではない**が、中身は製品と同じ 3 つの層（domain / operation /
 * infrastructure）に分かれている。したがって境界の要素も**層ごとに 1 つ**立てる —— 1 つの
 * `runtime` 要素にまとめると「domain が `@kaninabe/runtime/inbound` を引く」「components が実行器を
 * 引く」が通ってしまい、コードを `src/domain/` からパッケージへ移した瞬間に検査が緩む。
 * 移動で緩めないことがこの分割の目的である。
 *
 * **綴りはここだけ**にある。要素の型名は `runtimeElementType()` が作り、層の一覧は製品の
 * 生成物（`framework-structure.json` の `root: "framework"` の行）から導く。新しい層が
 * 生えても要素は自動で立つが、`BOUNDARY_POLICIES` がその型を許していないので既定の
 * disallow で落ちる（緩む側に寄らない）。
 *
 * @see ./policies-boundaries.mjs
 * @see ./docs/rules/decisions/common/ADR-0013-framework-runtime-package.md
 */

/** 要素の型名の接頭辞（製品の層名と衝突させないため）。 */
const PREFIX = "runtime-";

/**
 * 層名から境界要素の型名を作る。
 *
 * @param {string} layer 層名（`src/<層>/...` の第 2 区画）
 * @returns {string} 境界要素の型名
 */
export function runtimeElementType(layer) {
  return `${PREFIX}${layer}`;
}

/** ポリシーが名前で参照する型（層ごと + テスト基盤）。 */
export const RUNTIME_ELEMENTS = Object.freeze({
  domain: runtimeElementType("domain"),
  operation: runtimeElementType("operation"),
  infrastructure: runtimeElementType("infrastructure"),
  testing: runtimeElementType("testing"),
  navigation: runtimeElementType("navigation"),
  adapter: "framework-adapter",
});

/**
 * **転送の安全な部品**の置き場(`src/navigation`。`safeRedirect` / `useSafeNavigate`。点検 9 回目 B9-1〜B9-6)。
 *
 * 製品の層ではなく、純粋な軸(domain に畳む)でもない —— 枠の転送の口(`next/navigation`)を包むので、依存ゼロの
 * 純粋層(製品の domain)から引けてはならない。転送を作る層(app・components・composition・画面の部品の生成物)だけが
 * 引ける要素として 1 つ立てる(許す側は `BOUNDARY_POLICIES`)。
 */
const NAVIGATION_DIR = "navigation";

/**
 * パッケージの置き場の手前(リポジトリの在りか)に当てる区画。
 *
 * パッケージの実体は製品の置き場の外にあるので、lint の CLI では照合が**絶対パス**に対して走る。micromatch の `**` は
 * 既定でドットで始まるディレクトリを越えないので、素朴な `**` だと、ドットで始まるディレクトリの下(エディタや
 * エージェントが作る作業木の置き場など)に置いたリポジトリでは全部が「不明な要素」になる(2026-10-21 実測。
 * `@boundaries/elements` は照合の設定を渡せない)。そこでドットのディレクトリを 1 つまで挟む形も許す。
 * 末尾の `/` まで含み、空の候補で根からの相対パスにも当たる(テストの実行は根がリポジトリの直下なので相対で照合される)。
 * 使う側は `${ANY_PREFIX}framework/…` と続けて書く。製品の側で製品の置き場の外のファイルに当てるパターン(`ports` の分類)も
 * これを使う。
 */
export const ANY_PREFIX = "{,**/,**/.*/**/}";

/**
 * パッケージの置き場（ワークスペースなので実体はリポジトリの中にある）。
 *
 * **`partialMatch: false` が要点である。** 要素の照合はパスを末尾から 1 区画ずつ伸ばして走り、
 * **先に当たったパターンが勝つ**（`@boundaries/elements`）。素朴に部分一致で書くと、製品側の
 * `src/<層>` がパッケージのパス（`.../framework/runtime/src/<層>/...`）にも同じ深さで当たり、
 * **パッケージのファイルが製品の層に化ける**（実測: わざと壊す確認が `"infrastructure"` という嘘の
 * 型名で赤くなった）。`partialMatch: false` はパターンを**パス全体**に当てるので、最初の区画の
 * 時点で当たり、製品のパターンより先に確定する。製品側の宣言は 1 文字も変えなくてよい。
 *
 * `basePattern` では分けられない —— この版の実装は `micromatch.capture()` が返す `undefined` を
 * `null` と比べており、上の並びが食い違っても弾けない（実測: 製品のファイルまで `runtime-*` に
 * 化けた）。要素のパターンは**フォルダ**にしか当たらないので、ファイル名のパターンも使えない。
 */
const PACKAGE = `${ANY_PREFIX}framework/runtime`;

/**
 * adapter パッケージ(`framework/adapters/*`。PostgREST など、DB への接続の方式ごとに 1 つ)の置き場。
 *
 * 製品の層ではなく、runtime の層でもない。**製品の infrastructure と composition だけが引ける**(DB への配線は
 * そこにしか無い)。domain・operation・components・app からは引けない —— 既定の disallow に任せ、
 * 許す側(`BOUNDARY_POLICIES`)に足さないことで閉じる。`partialMatch: false` の理由は {@link PACKAGE} と同じ。
 */
const ADAPTERS = `${ANY_PREFIX}framework/adapters/*`;

/**
 * **サーバー側の実体を持つ層**(`runtime-infrastructure`)に畳むフォルダ。
 *
 * ③-e2D で `src/infrastructure/` の名前をやめた(DB への口は adapter パッケージへ出た)。残るのは DB に触れない
 * 2 つ —— 受信口の段取り(`inbound`: Web 標準の Request / Response と署名の検証)と拒否の分類(`refusal`:
 * SQLSTATE → 業務の拒否)である。どちらも**製品の層では infrastructure / composition だけが引ける**
 * (components・app・domain・operation からは引けない)という移動前と同じ許可を保つため、要素は
 * `runtime-infrastructure` のまま 1 つに畳む。ディレクトリ名は層の名前ではないので、層の一覧(生成物の行)
 * ではなくここで名指す —— 生成物の行が古くても・無くなっても、要素は消えない。
 */
const SERVER_SIDE_DIRS = ["inbound", "refusal"];

/**
 * 層のフォルダが現れる 2 つの根。
 *
 * `src` はワークスペースの中で直接読む経路(`docs` の型検査・パッケージ自身の lint)で、
 * `dist` は**利用側が `exports` 経由で解決する実体**である(`tsc` の成果物。ADR-0013 の
 * 配り方 A)。`dist` を書き忘れると、利用側から見た依存が**どの要素にも当たらない「未知」**に
 * なり、`boundaries/dependencies` は未知の相手に何も言わない —— 検査が黙って消える(実測)。
 * 未知そのものを赤にする `boundaries/no-unknown` を製品側で有効にしてあるが、綴りは両方置く。
 */
const LAYER_ROOTS = [`${PACKAGE}/src`, `${PACKAGE}/dist`];

/**
 * テスト基盤の置き場（パッケージの `testing/`。層ではない）。
 *
 * ローカル Supabase の起動と錠（`testing/local`）・E2E の段取り（`testing/e2e`）・一致の証明と
 * RLS のハーネス（`testing/{harness,rls,equivalence,save}`。束 ①-d）が住む。**`src/` の下ではない**
 * ので層の要素にはならず、配布物（`dist`）にも入らない —— テストだけが読む木である。
 *
 * **要素として宣言する理由は「本番コードから引けないことを機械で言う」ためである。** 宣言する前は
 * どの要素にも当たらない「未知」であり、`boundaries/dependencies` は未知の相手に何も言わなかった
 * （テストの軸では `no-unknown-dependencies` も切ってあるので、本番コードが引いても誰も咎めない形が
 * 残っていた。束 ①-d 手 2）。許すのは**テストの軸のファイルだけ**である（`BOUNDARY_POLICIES` の
 * `test` / `harness-adapter` / `test-world-declaration` の 3 つのファイル分類）。
 */
const TESTING_DIR = `${PACKAGE}/testing`;

/**
 * **層に属さない純粋な軸**（`domain` の要素に畳むもの）。
 *
 * 畳む相手は 2 つある。どちらも**依存が 0 本の純関数と型**であり、別の要素にするとポリシーが
 * 1 つ増えるだけで許す先は domain と同じになる。
 *
 * | 軸 | 何が住むか | なぜ domain か |
 * |---|---|---|
 * | `plan` | 実行計画の型 | 型だけで、値も I/O も持たない |
 * | `http` | ブラウザ側の守りの組み方(CSP の組み立て・要求の出どころの確認・応答のヘッダ)の純関数と型 | Web 標準の `Request` / `Response` / `Headers` と乱数だけを使い、import も I/O も持たない。生成物の宣言(domain)・リクエスト前段・Route Handler のどこからでも引ける |
 * | `sql` | 設計図から「実行する相手（行の id と置き直した値）」を作る純関数 | **層は依存で決まる。** 題材が SQL の行であっても、この口は import を 1 つも持たず I/O もしない（`infrastructure` に置く理由は「実体に触ること」であって「DB の話をすること」ではない） |
 *
 * `sql` は束 ①-c で生えたときどちらの表にも登録されておらず、**製品から引くと「未知」になる**
 * 状態だった（レビューの実測: `operation` から import すると `no-unknown-dependencies` で赤）。
 * 層を決める場所はここ 1 つである。
 *
 * **`src/` 直下にファイルを置いてはならない**(パッケージ側の約束)。要素のパターンはフォルダに
 * しか当たらないため、`src` を指すパターンを 1 つ置くと**部分一致で配下の全層がその要素に吸われ**、
 * 検査が黙って消える(実測: わざと壊す確認 4 本が 1 本も赤くならなかった)。だから `bindings.ts` は
 * `src/domain/` に住む(`dist` 側も同じ形になる)。
 */
const PURE_AXIS_DIRS = ["plan", "sql", "http"];

/** 純粋な軸のパターン（2 つの根 × 軸の数）。 */
const PURE_AXIS_PATTERNS = LAYER_ROOTS.flatMap((root) => PURE_AXIS_DIRS.map((dir) => `${root}/${dir}`));

/**
 * 規則の置き場 `@kaninabe/lint-config` の境界要素の型名。
 *
 * 製品の層でも実行時パッケージでもない。**規則の単体テスト(`eslint-rule-test`)だけが引ける**相手で、
 * 宣言する理由は `testing` と同じ(宣言が無いと「未知」の相手になる)。
 */
export const LINT_CONFIG_ELEMENT = "lint-config";

/**
 * 規則の置き場の要素を作る(`boundaries/elements` に足す)。`partialMatch: false` の理由は
 * {@link PACKAGE} と同じ(パスの全体に当てて、製品の短いパターンより先に確定させる)。
 *
 * @returns {object} 要素の宣言
 */
export function lintConfigBoundaryElement() {
  return {
    type: LINT_CONFIG_ELEMENT,
    partialMatch: false,
    pattern: [`${ANY_PREFIX}framework/lint-config/src`, `${ANY_PREFIX}framework/lint-config/src/**`],
  };
}

/**
 * `boundaries/elements` に足す実行時パッケージの要素を作る。
 *
 * 製品の層（`src/domain` 等）より**前**に置くこと。ワークスペースの依存は実体がリポジトリの
 * 中にあるため、後ろに置くと解決後のパスが製品の層に当たって嘘の診断になる。
 *
 * @param {{ baseDirs: readonly { root: string, path: string }[] }} frameworkStructure 製品の生成物
 * @returns {readonly object[]} 要素の宣言（層ごとに 1 つ）
 */
export function runtimeBoundaryElements(frameworkStructure) {
  // 層の一覧は生成物の行から導き、サーバー側の層(`infrastructure`)は行の有無に依らず必ず立てる
  // (そのフォルダは行ではなく {@link SERVER_SIDE_DIRS} が決める)。
  const layers = [
    ...new Set([
      ...frameworkStructure.baseDirs
        .filter((dir) => dir.root === "framework")
        .map((dir) => dir.path.split("/")[1]),
      "infrastructure",
    ]),
  ];
  const testing = {
    type: RUNTIME_ELEMENTS.testing,
    partialMatch: false,
    pattern: [TESTING_DIR],
  };
  const adapter = {
    type: RUNTIME_ELEMENTS.adapter,
    partialMatch: false,
    pattern: [
      `${ADAPTERS}/src`,
      `${ADAPTERS}/src/**`,
      `${ADAPTERS}/dist`,
      `${ADAPTERS}/dist/**`,
    ],
  };
  const navigation = {
    type: RUNTIME_ELEMENTS.navigation,
    partialMatch: false,
    pattern: LAYER_ROOTS.map((root) => `${root}/${NAVIGATION_DIR}`),
  };
  return [
    testing,
    adapter,
    navigation,
    ...layers.map((layer) => ({
      type: runtimeElementType(layer),
      // パターンは**フォルダ**に当たる（v7。ファイルのパターンは無効な記述として無視される）。
      // `partialMatch: false` にする理由はモジュール冒頭に書いてある（パターンをパス全体に当てて、
      // 製品の短いパターンより先に確定させる）。**既定の部分一致にしてはならない。**
      partialMatch: false,
      pattern: [
        ...LAYER_ROOTS.flatMap((root) =>
          (layer === "infrastructure" ? SERVER_SIDE_DIRS : [layer]).map((dir) => `${root}/${dir}`),
        ),
        ...(layer === "domain" ? PURE_AXIS_PATTERNS : []),
      ],
    })),
  ];
}
