/**
 * ジェネレーター(仕様モデル → 人間可読ドキュメント)の共有インターフェース。
 *
 * ジェネレーターは「構築済みの SpecModel を受け取り、差し込むべきセクション群を返す純粋関数」
 * であり、ファイル I/O をしない(規約: scripts-code-quality.md)。
 * ファイルへの書き込みは CLI(generate-docs.ts)だけが行う。
 *
 * 出力形式について: 現在のレンダラーは Markdown + mermaid を出力するが、
 * 「どのファイルのどのマーカーに何を差し込むか」という本インターフェースは形式に依存しない。
 * 将来 HTML 直接生成に切り替える場合もレンダラーの差し替えだけで済む(ARCH-SP-0002)。
 */

import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { QuerySpecModel } from '../model/query/types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import type { DesignTokenModel } from '../model/design/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { NotificationSpecModel } from '../model/notification/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import type { ConfigSpecModel } from '../model/config/types.js';
import type { AuthGateDecl, AuthSpecModel } from '../model/auth/types.js';
import type { CatalogInput } from '../kernel/input-state.js';
import type { GuaranteeSpecModel } from '../model/guarantee/types.js';
import type { UxPrinciplesModel } from '../model/ux-principles/types.js';
import type { SurfaceSpecModel } from '../model/surface/types.js';
import type { ExternalSpecModel } from '../model/external/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import type { TermLedgerModel } from '../model/terms/types.js';
import type { ExtensionLedgerModel } from '../model/extension/types.js';
import type { BookInputs } from './book-inputs-types.js';
import type { ProductRoots } from '../model/product/types.js';
import type { Finding } from '../kernel/finding.js';
import type { ReadingBase } from '../semantics/reading-change.js';
import type { MutationOutcome } from '../kernel/mutation-report.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import type { ProductLayout } from '../model/product/layout-types.js';

/** ジェネレーターに注入される共有サービス(検証器の VerifyContext と同じ流儀)。 */
export interface GenerateContext {
  readonly guards: GuardServices;
  /**
   * **生成対象の製品が宣言した根**(`product.md`)。
   *
   * 生成器は出力先のパスも、生成物の中に書く「出どころ」のパスも、この宣言からしか組み立てない
   * —— `app/` や `docs/specs/` のような綴りを 1 つも持たない(W3 が執行する)。
   * 組み立ての口は lib/model/product/paths.ts(`specPath` / `generatedPath` / `appPath` …)である。
   */
  readonly roots: ProductRoots;
  /**
   * **プラットフォームの設定**(DB のロール名・現在の実行者の式・セッション属性の枝・外に出すスキーマ)。
   *
   * SQL を書く生成器はロール名もスキーマ名も認証の関数も自分では持たず、ここから引く。**値を選ぶのは
   * 組み立ての根(CLI と通し実行)だけ**で、生成器は選ばない(コアは後段 `lib/targets/**` を import しない)。
   * 人向けの本だけを出す入口の生成器はこの値を読まないが、文脈の形を 1 つに保つために全入口が渡す。
   */
  readonly platform: PlatformProfile;
  /**
   * **置き場の配置**(役割 → パス。HTTP の入口・組み立ての根の位置と import の指定)。
   *
   * アプリの枠の後段が与える値で、**値を選ぶのは組み立ての根(CLI と通し実行)だけ**(`platform` と同じ明示の渡し方。生成器は選ばない)。
   * 配置を読む生成器(受信口・Cron の見張りテスト・構造の期待・外部連携の本文)は、役割を解決できないとき空を黙って返さず、前提の失敗で名指す
   * (`layout-placement.ts`)。実装の木を持たない製品は空の配置(`EMPTY_LAYOUT`)で、そのときは置き場が無いことが事実なので何も出さない。
   */
  readonly layout: ProductLayout;
  /**
   * 読み込み済みの query_spec(読み取りクエリ仕様)。
   *
   * ドメイン仕様(SpecModel)の外側にある入力なので、モデルではなく文脈として渡す。
   * `available: false` は「specs/backend/queries がまだ無い」、`available: true` で
   * `queries` が空なら「置き場はあるがまだ 1 件も書いていない」を意味する。
   * 省略時は前者と同じ扱いになる。
   */
  readonly queries?: QuerySpecModel;
  /**
   * 読み込み済みの screen_spec / chrome_spec(画面仕様)。
   *
   * query_spec と同じくドメイン仕様(SpecModel)の外側にある入力なので、文脈として渡す。
   * `available: false` は「specs/frontend/screens がまだ無い」、`available: true` で
   * `screens` が空なら「置き場はあるがまだ 1 件も書いていない」を意味する。
   */
  readonly screens?: ScreenSpecModel;
  /**
   * 読み込み済みのデザイントークン仕様。
   *
   * query_spec / screen_spec と同じくドメイン仕様(SpecModel)の外側にある入力なので、
   * 文脈として渡す。`available: false` は「specs/frontend/design がまだ無い」を意味し、
   * その場合 tokens.css / tokens.ts は生成されない。
   */
  readonly design?: DesignTokenModel;
  /**
   * 読み込み済みの action_spec(Server Action 仕様)。
   *
   * query_spec / screen_spec と同じくドメイン仕様(SpecModel)の外側にある入力なので、
   * 文脈として渡す。省略時は「specs/backend/actions がまだ無い」と同じ扱いになり、
   * action_spec 個別ファイルの本文ブロックは生成されない。
   */
  readonly actions?: ActionSpecModel;
  /**
   * 読み込み済みの data_table(テーブル仕様)。
   *
   * query_spec / screen_spec と同じくドメイン仕様(SpecModel)の外側にある入力なので、
   * 文脈として渡す。`available: false` は「specs/backend/data/tables がまだ無い」を意味し、
   * その場合 data-table-expectations.ts と本文ブロックは生成されない。
   */
  readonly dataTables?: DataTableSpecModel;
  /**
   * 読み込み済みの notification_spec(通知カタログ)。
   *
   * data_table と同じくドメイン仕様(SpecModel)の外側にある入力なので、文脈として渡す。
   * `available: false` は「specs/backend/notifications.md がまだ無い」を意味し、
   * その場合 notifications.ts と本文ブロック・ハンドブックの章は生成されない。
   */
  readonly notifications?: NotificationSpecModel;
  /**
   * 読み込み済みの job_spec(ジョブカタログ)。
   *
   * `available: false` は「specs/backend/jobs.md がまだ無い」を意味し、
   * その場合 jobs.ts と本文ブロック・ハンドブックの章は生成されない。
   */
  readonly jobs?: JobSpecModel;
  /**
   * 読み込み済みの config_spec(設定カタログ)。
   *
   * `available: false` は「specs/backend/config.md がまだ無い」を意味し、
   * その場合カタログの本文ブロックとハンドブックの章は生成されない
   * (設定に対応する実装側の生成物は無い — 値は運用のものであり、
   * 閉世界は K1 が仕様の側から実装の参照を見ることで閉じている)。
   */
  readonly config?: ConfigSpecModel;
  /**
   * 読み込み済みの auth_spec(認証フロー仕様)。
   *
   * `available: false` は「specs/backend/auth.md がまだ無い」を意味し、
   * その場合 auth.ts と本文ブロック・ハンドブックの章は生成されない。
   */
  readonly auth?: AuthSpecModel;
  /**
   * 認証フローの関門(`auth_spec` の `gates`)の**入力の状態**(組み立ての根が `uses` と読み込みの結果から決める)。到達に依る欄(L2 の到達・着地・可視性、
   * タスクの章の画面・前提)が読み、**阻害なら空の関門で探索せず「確かめていない」と書く**。
   * 任意の欄ではなく**必須**(省略を「読込済み」と読ませると、関門が阻害の構成が黙って到達を断定する。単体テストは `loadedGates` を渡す)。
   */
  readonly gates: CatalogInput<readonly AuthGateDecl[]>;
  /**
   * 読み込み済みの guarantee_spec(保証台帳)。
   *
   * `available: false` は「specs/backend/guarantees.md がまだ無い」を意味し、
   * その場合本文ブロック・ハンドブックの章は生成されない(app 側の生成物は無い)。
   */
  readonly guarantees?: GuaranteeSpecModel;
  /**
   * 読み込み済みの ux_principles_spec(UX 原則の台帳)。
   *
   * `available: false` は「specs/frontend/ux-principles.md がまだ無い」を意味し、
   * 閾値は検査器の定数(既定値)で動く(UX 原則の章は生成しない)。
   */
  readonly uxPrinciples?: UxPrinciplesModel;
  /**
   * 読み込み済みの external_spec(外部連携カタログ)。
   *
   * `available: false` は「specs/backend/external.md がまだ無い」を意味し、
   * その場合本文ブロック・ハンドブックの章・可視性の章の節は生成されない(app 側の生成物は無い)。
   */
  readonly external?: ExternalSpecModel;
  /**
   * 読み込み済みの surface_spec(SQL の公開面の仕様)。
   *
   * `available: false` は「specs/backend/surface.md がまだ無い」を意味し、その場合 公開スキーマの
   * **土台**と surface の一覧の表が生成されない(土台は手書きの migration が持つ構成である)。
   * **ビューはこの文脈に依らない** —— 書き出し先は表ごとの `surface_migration` が宣言するので、
   * surface の仕様書が無くても生成される。
   */
  readonly surface?: SurfaceSpecModel;
  /**
   * 読み込み済みの usecase_spec(ユースケース仕様)。
   *
   * `available: false` は「specs/frontend/usecases がまだ無い」を意味し、
   * その場合 usecases.ts・本文ブロック・ハンドブックの「タスク」章は生成されない
   * (ADR-0011「起点は 2 つ」の束⑯a)。
   */
  readonly usecases?: UsecaseSpecModel;
  /**
   * 読み込み済みの用語の台帳(term_ledger)。
   *
   * `available: false` は「specs/terms.md がまだ無い」を意味し、その場合ハンドブック表紙の
   * 「この本に出てくる言葉」の表は生成されない(表の行は台帳の `face: book` の行である)。
   */
  readonly terms?: TermLedgerModel;
  /**
   * 仕様ファイルの生テキスト(リポジトリルート相対パス → ファイル内容)。
   *
   * 意味レビューの台帳が標識(生成ブロック外の手書き本文)を数えるための入力。
   * 生成器は I/O をしない規約のため、CLI が `ledgerFiles()` の返すパスを読んで構築する。
   * 省略時・載っていないファイルは標識 0 本の扱いになる。
   */
  readonly specSources?: ReadonlyMap<string, string>;
  /**
   * ジョブカタログの起動口(`endpoint`)の Route Handler の生テキスト(リポジトリルート相対パス → 本文)。
   *
   * Cron 起動口の認可の見張りテストが、**起動口が export している HTTP メソッド全部**を構文木から取るための入力
   * (手書きの一覧を持たない)。生成器は I/O をしない規約のため、CLI が `readRouteSources()` で構築する。
   * 省略時・載っていない起動口は `GET` だけを export する形の扱いになる(規約が「Cron の口は GET」)。
   */
  readonly routeSources?: ReadonlyMap<string, string>;
  /**
   * **生成対象のリポジトリ**のルート(絶対パス)。
   *
   * 生成器は原則としてファイルを読まないので、この欄が要るのは「入力が仕様モデルではなく
   * リポジトリの実ファイルそのもの」である章 —— 「書き方の例」(実コードの印から抜粋を切り出す)
   * だけである。生成器が自分の位置からリポジトリルートを解くと、**生成器が住んでいる
   * リポジトリ**を指してしまい、別のリポジトリの仕様を生成しても抜粋だけがこちらのコードから
   * 採られる(束 ⑱ の題材 B が実測)。省略時はその章を生成しない。
   */
  readonly repoRoot?: string;
  /**
   * ハンドブックが「実装の実物」を写すための入力(`book-inputs.ts` / `book-inputs-types.ts`)。
   *
   * パーツ見本の CSS(globals.css / ui.module.css)・状態バッジの意味色の出典
   * (state-badge.tsx)・スクリーンショットのマニフェストは、仕様ではなく実装・成果物が
   * 正である。生成器は I/O をしない規約のため、CLI が読んでここに載せる。
   * 省略時はその部分が「無い」ものとして生成される(プレースホルダ表記)。
   */
  readonly book?: BookInputs;
  /**
   * 人向けの表示(部品 5 枚で描く形)で出す集約の章。`'all'` なら全章、数なら重さの上位 N 章(`face-scope.ts`)。
   *
   * 省略・0 は「どの章も従来の形」である。束 ③ は 1 章だけで器を試し、束 ④ で全章にした。
   * 選び方は章の中ではなく**組み立ての口(CLI)が宣言する**。
   */
  readonly humanFaceChapters?: number | 'all';
  /**
   * 検証器(`npm run verify`)の警告の一覧。**まだ通していない受け入れ**として章と手引きに配られる。
   *
   * 生成器は検証器を import しない(層の表: emit は check を読まない)ので、**検証を先に回した側
   * (`cli/generate-docs.ts`)が結果を渡す**。省略は「検証の結果が渡されていない」で、章は
   * 「未集計」と書く(0 件とは書かない)。渡すのは warning だけでよい(error は生成を止める側が持つ)。
   */
  readonly findings?: readonly Finding[];
  /**
   * 拡張候補の台帳(警告を「拡張候補 / 未分類」に分ける材料。`findings` と同じく検証を先に回した側が渡す)。
   *
   * **「まだ通していない受け入れ」に数えるのは未分類の警告だけ**である(拡張候補は仕組みの宿題で、仕様を読む人が
   * 読まなくてよい)。拡張候補は手引きの「仕組みの拡張候補」の節に出る。省略は「台帳を知らない」で、
   * 警告はすべて「まだ通していない受け入れ」として数える。
   */
  readonly extensionLedger?: ExtensionLedgerModel;
  /**
   * 基点つきで読むときの、公理の側の差分(章の「今回変わった」と手引きの数)。
   *
   * 「前回読了」の記録はまだ無いので、基点は `generate -- --base <ref>` の引数で受ける。
   * 省略は「基点なし」で、変更は「—」と書く(0 件とは書かない)。
   */
  readonly readingBase?: ReadingBase;
  /**
   * 変異の目録の状態(保証の章の「宣言を 1 か所壊したら、どれが赤になるか」)。
   *
   * **人向けの本は変異を自分で回さず、回した結果を受け取る**(回すには生成器と検査器を実際に動かすので、
   * 本の生成器の依存が DDL・RLS・RPC 本文の生成器まで広がる。設計メモ framework-modules §11)。
   * 載せるのは組み立ての根(`completeGenerateContext`)で、**状態を必ず 1 つ持つ**:
   * `ran`(実測あり)/ `unavailable`(回そうとしたが材料が無い。理由つき)/ `not_run`(この入口は回さない)。
   * 章は 3 つを書き分ける —— 回していないことを「目録 0 行」と言わない。省略は「状態が渡されていない」で、`not_run` と同じに書く。
   */
  readonly mutation?: MutationOutcome;
}

/**
 * 人向けの表示で出す章(`GenerateContext.humanFaceChapters` に載せる値)。束 ③ は「まず 1 章だけ」で器を試し、束 ④ で全章にした(`'all'`)。
 * 数を宣言すれば重さの上位 N 章だけに絞れる(器を試す・一部の章だけ戻すときの口)。
 *
 * 文脈の欄の隣に置くのは、組み立ての根(`completeGenerateContext`)が章の側(`render/book/face-scope.ts`)を読まずに値を載せるため
 * (生成の側がハンドブックの章を読む向きをなくす)。
 */
export const FACE_CHAPTERS: number | 'all' = 'all';

/**
 * 生成された 1 件。2 つのモードがある:
 * - マーカー差し込み(既定): file 内の `<!-- AUTO-GENERATED:{marker} -->` ブロックに content を差し込む
 * - ファイル全体(wholeFile: true): file が存在しなければ新規作成、存在すれば全置換。
 *   実装側コード生成(app/src/domain/generated/)用。手書き部分は持てないため、
 *   content の先頭に「AUTO-GENERATED・編集禁止」のヘッダコメントを含めること。
 */
export interface GeneratedSection {
  /** 出力先ファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** マーカー名。wholeFile: true のときは省略する。 */
  readonly marker?: string;
  /** 差し込む本文(マーカー差し込み時はマーカー行自体を含めない)。 */
  readonly content: string;
  /** true = ファイル全体を生成物として全置換する。 */
  readonly wholeFile?: boolean;
}

/** 全ジェネレーターが実装するインターフェース。 */
export interface DocGenerator {
  /** 識別子(例: "state-machine")。 */
  readonly id: string;
  /** モデル全体から、担当するセクションをすべて生成する。対象が無ければ空配列。 */
  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[];
}
