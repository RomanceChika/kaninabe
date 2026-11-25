/**
 * 仕組みの土台(層と、層の直下の土台ディレクトリ)の**唯一の宣言**。
 *
 * **表は 2 つの根にまたがる**(束 ①-b・ADR-0013)。仕組みの実行時コードは実行時パッケージ
 * `@kaninabe/runtime` に住み、製品の実装の木には無い —— どちらかは各行の `root` が言う。
 *
 * アプリの実装は「集約 1 つ = ディレクトリ 1 つ」で並ぶ(`src/operation/entry/` 等)。その中に
 * 混じる**集約でないディレクトリ**(定型の置き場・共有物・ジョブ基盤・Supabase 接続層・
 * 保存点の置き場・生成物の置き場・テスト支援)は、フレームワークが形として決めているもので
 * あって、アプリが選んだ語ではない —— つまり**軸**である(dsl-extension-triage.md §軸と語)。
 *
 * それらを**免除リストとして各検査が別々に持っていた**のがこの宣言の前史である。
 * X1(`app/src/infrastructure/` の閉世界)・A11(`operation` の閉世界)・W1(語彙漏れの走査
 * 範囲)・ESLint の生成物グロブ 2 本・`layer/operation-naming` の skip 一覧・構造テストの
 * 保存点の置き場が、同じ 1 つの事実の写しを 6 か所に持っており、土台を 1 つ足すたびに
 * 6 か所を直す(直し忘れれば黙って検査の外に落ちる)形だった。ここが正になり、
 * 各執行者は**生成物**(`app/src/domain/generated/structure-expectations.ts` の
 * `frameworkBaseDirs` / 同 `framework-structure.json`)か、この宣言そのものを読む。
 *
 * **アプリの語彙は 1 語も無い。** ここに並ぶのは層とフレームワークの部品の名前だけであり、
 * 集約・ロール・状態・イベントの id は 1 つも現れない(W1 が見張っている)。
 *
 * 散文の正は ARCH-BE-0001(層構造と実装配置)。この宣言はその機械可読な写しである。
 *
 * **土台の表そのものは置き場の配置の値が宣言する**(部品化 ③-c5。`lib/model/product/layout-types.ts` の `RoleStructure`・値は `lib/targets/<アプリの枠の後段>/`)。
 * 層の 4 名(`domain` / `operation` / `infrastructure` / `composition`)は**コアの語**でここが持ち、スタックが足す層(ルーティング・UI 部品)・土台ディレクトリの
 * 全数・補助ファイルは配置の値が持つ —— 土台のディレクトリ名・生成物の置き場の綴りは、スタックの木の形だからである。配置から引く口(解決した土台・層・走査の入力)は `framework-base-dirs.ts`。
 * ここは**型と、配置に依らない宣言**(層の 4 名)だけを持つ。
 */

/** 土台ディレクトリの中身の並び方。 */
export type FrameworkDirLayout =
  /** 直下にファイルが並ぶ。 */
  | 'flat'
  /** 1 段のサブディレクトリ(ユースケース名)の下にファイルが並ぶ(保存点の置き場)。 */
  | 'nested';

/**
 * 土台がどちらの根に住んでいるか。
 *
 * 束 ①-b で仕組みの実行時コードが実行時パッケージ `@kaninabe/runtime` へ出た(ADR-0013)。以後この
 * 宣言は**2 つの根にまたがる 1 枚の表**である —— 免除リストではなく**軸**であり、`generated` /
 * `vocabularyScan` / `perSpec` と同じ扱いをする。
 *
 * - `product`: 製品の実装の木(`product.md` の `app`)からの相対。閉世界を見るのは X1・A11・
 *   構造テストで、ESLint の生成物グロブもここから引く。
 * - `framework`: 実行時パッケージ(`FRAMEWORK_RUNTIME_DIR`)からの相対。閉世界を見るのは
 *   パッケージ側であり、**製品の `src/` には存在しない** —— 製品側の検査がここを期待すると
 *   「あるはずのディレクトリが無い」と嘘を言う。
 */
export type FrameworkDirRoot = 'product' | 'framework';

/** 層の直下にある「集約でないディレクトリ」1 つの宣言。 */
export interface FrameworkBaseDir {
  /** 根からの相対パス(例: "src/operation/usecase")。どちらの根かは `root` が言う。 */
  readonly path: string;
  /** この土台の下でだけ値として import してよい外部の SDK のパッケージ(宣言が無ければ空。点検 9 回目 B9-4)。 */
  readonly sdkPackages: readonly string[];
  /** どちらの根に住んでいるか(製品の実装の木か、実行時パッケージか)。 */
  readonly root: FrameworkDirRoot;
  /** 何の置き場か(人が読む説明。閉世界の検査のエラー文面に出す)。 */
  readonly role: string;
  /**
   * 配下が生成物か。
   *
   * true なら中身は `npm run generate` が書く —— `AUTO-GENERATED` ヘッダを必須にし
   * (`layer/generated-header`)、手書きのコードにだけ意味がある規則(JSDoc 必須・行数上限・
   * 免除コメントの禁止)からは外す。「生成物か」の判定そのものはヘッダであり、ESLint の
   * `files` / `ignores` は中身を読めないので、**どのディレクトリが生成物か**をここが宣言する。
   */
  readonly generated: boolean;
  /**
   * 仕組みの手書きコードとして語彙漏れの走査(W1 / W2)に載せるか。
   *
   * 「どの集約でも同じこと」を書く場所(定型・エンジン・ジョブ基盤・接続層)は、仕様の値域
   * 語彙を文字列で持ってはならない。逆に、生成物と、アプリ固有の手書き(保存点の hooks 等)は
   * 走査しない —— 前者は生成器が正、後者は実装であって仕組みではない。
   *
   * **この欄が走査の入力になるのは `root: 'product'` の行だけである。** 実行時パッケージ
   * (`root: 'framework'`)は**根で指して全域を走査する**(束 ①-c-b。ディレクトリを列挙して
   * いたあいだ、パッケージの 13 本が母集合の外にあった)。framework の行を `true` で揃えてある
   * のは「中は全部が仕組みである」という事実の記録であって、走査の切り替えではない。
   */
  readonly vocabularyScan: boolean;
  /** 中身の並び方(閉世界の検査がどの深さまで見るかを決める)。 */
  readonly layout: FrameworkDirLayout;
  /**
   * 中身が**そのアプリの仕様の量で決まる**か(`generated: true` の置き場だけが true になりうる)。
   *
   * 生成物の置き場には 2 種類ある。仕様が 1 行も無くても常に書き出されるもの(生成物の総置き場)と、
   * **その仕様がその種の宣言を持つときだけ**書き出されるもの(保存点・受信口)である。後者は
   * 宣言が 0 件のアプリでは 1 ファイルも生成されないので、**置き場そのものが存在しない**
   * (空のディレクトリを置かない)。
   *
   * 構造テストはこの 1 ビットと期待ファイル木から「実在すべきか」を導く —— ディレクトリ名を
   * テスト側の免除リストに書かないためである(独立レビュー ⑲-2b 指摘 7-A)。
   */
  readonly perSpec: boolean;
}


/** 集約ディレクトリの直下にあって、ドメインイベントに対応しないファイル 1 つの宣言。 */
export interface FrameworkAuxFile {
  /** どの層の集約ディレクトリの直下か。 */
  readonly layer: string;
  /** ファイル名(拡張子込み)。 */
  readonly file: string;
  /** 何のファイルか(人が読む説明)。 */
  readonly role: string;
}

/** 層 1 つの宣言(ARCH-BE-0001 の層構造)。 */
export interface FrameworkLayer {
  /** `app/src/` 直下のディレクトリ名(= 層の名前)。 */
  readonly name: string;
  /** 何の層か(人が読む説明。エラー文面に出す)。 */
  readonly role: string;
  /**
   * 直下の「集約か、宣言された土台ディレクトリか」の閉世界を、誰が見るか。
   *
   *   - `structure_test` … app 側の構造テストが期待ファイル木と宣言だけで判定できる。
   *   - `verifier` … 判定に仕様の別のカタログが要るので docs 側の検証器が見る
   *     (`infrastructure` は内部テーブル・外部連携のアダプタも直下に並ぶため X1 が見る)。
   *   - `none` … 直下が集約で並ばない層(ルーティング・純関数の束・共有部品)、または
   *     まだ閉世界を宣言できていない層。**後者は穴であって既定ではない。**
   */
  readonly closedWorld: 'structure_test' | 'verifier' | 'none';
}

/**
 * 層の 4 名(ARCH-BE-0001 の層構造。**コアの語**)。
 *
 * ここに無い名前のディレクトリが `src/` 直下に現れたら、それは「どの層にも属さないコード」
 * であり、層境界の ESLint(`boundaries/elements`)の検査の範囲外に落ちる —— 構造テストが閉世界で見る。
 * **スタックが足す層**(ルーティング・UI 部品)は配置の値が宣言し(`RoleStructure.layers`)、コアの 4 名のあとに並ぶ(`framework-base-dirs.ts` の `frameworkLayers`)。
 */
export const CORE_LAYERS: readonly FrameworkLayer[] = [
  { name: 'domain', role: '依存ゼロの純関数と生成物(ARCH-BE-0001 の E1)', closedWorld: 'none' },
  { name: 'operation', role: '業務手順(1 ドメインイベント = 1 ファイル)', closedWorld: 'structure_test' },
  { name: 'infrastructure', role: '具象(写像・リポジトリ・外部連携のアダプタ)', closedWorld: 'verifier' },
  // composition の直下には、集約でも宣言された土台でもないディレクトリが 1 つある
  // (機能ごとの配線。束⑯g の閉世界で実測した)。「集約ではなく機能を配線する置き場」に
  // フレームワークの名前がまだ無いので、閉世界は宣言できていない —— 穴として報告済みである。
  // その手書きの置き場は配置の値が土台の表に**載せないまま**名指す(`RoleStructure.unlistedDirs`)。
  { name: 'composition', role: 'Composition Root(依存の配線だけ)', closedWorld: 'none' },
];

/** コアが前提にする土台ディレクトリ(層と、層の直下からの相対パス)1 つ。 */
export interface CoreRequiredBaseDir {
  /** 層の名前(コアの層の 4 名)。 */
  readonly layer: string;
  /** 層の直下からの相対パス。 */
  readonly dir: string;
  /** コアのどの生成・検査がこの置き場を読むか(配置の定義の検査が、宣言が無いときに名指す)。 */
  readonly usedBy: string;
}

/**
 * **コアが前提にする土台ディレクトリ**(部品化 ③-c6。配置の定義の検査 `structureProblems` が、配置の `structure` に宣言があることを必須にする)。
 *
 * 配置が宣言する土台の表は「層の直下の集約でないディレクトリ」の全数だが、コアの生成・検査のうち 3 つは、その表の特定の行を**名前で**引く(置き場を層と相対パスで指す)。
 * 宣言が無いと、生成は前提の失敗で止まるか(hooks・突合テストの案内)、検査が黙って別の場所を見る(T3)。そうなる前に、配置を選ぶ根の 1 回で止める。
 * 層の名前はコアの語、相対パスはコアが読む置き場の名前(スタックの綴りではなく、仕組みが「ここに置く」と決めた役割の名前)である。
 */
export const CORE_REQUIRED_BASE_DIRS = {
  /** 保存点で手書きする唯一のもの(application 執行の不変条件の hooks)の置き場。 */
  hooks: { layer: 'operation', dir: 'usecase', usedBy: '保存点の hooks の期待(`code-usecase-app` / `code-structure-expectations`)' },
  /** 操作の層のテスト支援(認証の突合テストの置き場の案内)。 */
  operationTests: { layer: 'operation', dir: '__tests__', usedBy: '認証の期待表の突合テストの案内(`code-auth`)' },
  /** 基盤の層のテスト支援(表ごとの突合テストの置き場)。 */
  infrastructureTests: { layer: 'infrastructure', dir: '__tests__', usedBy: 'T3(data_table の突合テストの置き場)' },
} as const satisfies Readonly<Record<string, CoreRequiredBaseDir>>;
