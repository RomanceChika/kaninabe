/**
 * `legacy/spec-tools/lib` の**層の表**(依存の向きの正)。構造テスト `lib-layering.test.ts` がこれを読む。
 *
 * 設計の正は `docs/design/scripts-layering.md`、規約の正は `scripts-code-quality.md` の
 * 「依存の向きが行数より先」。ここは表のデータだけを持ち、判定は `layer-check.ts` が行う。
 *
 * **向き**: 下の層は上の層を import しない。同じ層の中は読んでよい(ただし値の循環は 0)。
 * 同じ順位の別の層(`check` と `emit`、`kernel` と `lang`)は互いを読まない。
 *
 * ```
 * io → kernel = lang → model → facts → relations → messages → derive = kit → check = emit → contract → orch = target → book → compose
 * ```
 *
 * **割り付けは「ディレクトリ + ファイル名の型」**である。仕様の種ごとのディレクトリ(`sql` / `usecase` / `trace` …)は model(型・パーサ・ローダー)・
 * derive(仕様から期待される成果物を純関数で導くもの)・check(`verifiers/**`)の 3 つを抱えるので、ディレクトリ全体では決まらない。
 * 先に当たった行が勝つ。**どの行にも当たらないファイルは赤**(新しいディレクトリを足したら、
 * ここに 1 行足して層を選ぶ —— 黙って層の外に置かない)。
 *
 * @oversize 層の順位・割り付け・値の閉包の禁止・後段の境界・公開の入口・`fs` の入口は、どれも「この木の import をどの向きに許すか」を宣言する
 * 同じ種類の表で、判定 `layer-check.ts` の `LayerTable` が 1 つの値として受ける。1 か所で並べて読めば、1 本の import がどの表の何行に当たるかを辿れる。
 * @split-review 割る案は 2 つ。(1) 層の割り付け(`LAYER_ROWS`)と、閉包の禁止・後段の境界・入口の宣言を別ファイルにする案: 閉包の禁止の `from` / `banned` と
 * 後段の境界の `inside` は割り付けの行が決めるディレクトリの名前を同じ綴りで持つので、割ると行を足す日に 2 枚の綴りを突き合わせることになり、
 * 食い違いは構造テストでしか見つからない。(2) 後段の境界だけを `lib/targets` 側へ出す案: 後段の置き場は「コアが読めない」側の宣言で、
 * 置き場の中に置くと境界を決める表が境界の内側に居る形になる。どちらも採らず、表のまま 1 枚に置く。
 */

import { BOOK_ENTRY_TARGET_FILES, bookEntryBannedPattern } from './book-entry-target-files.js';

/** 層の順位(小さいほど下)。 */
export const LAYER_RANK: Readonly<Record<string, number>> = {
  io: 0,
  kernel: 1,
  lang: 1,
  model: 2,
  facts: 3,
  relations: 4,
  messages: 5,
  derive: 6,
  /** kit = 生成器の道具箱(`lib/gen-kit/`。生成器の契約・リテラルの書き出し・表の道具。仕様の種類を知らない葉で、derive と同順位なので互いを読まない)。 */
  kit: 6,
  check: 7,
  emit: 7,
  /** contract = 後段の登録の契約(`lib/target-api/`。check / emit の契約を型として読む)/ target = 差し替えうる後段(`lib/targets/<後段>/`。契約を読んで値を作る。orch と同順位で互いに読まない)。 */
  contract: 8,
  orch: 9,
  target: 9,
  book: 10,
  compose: 11,
};

/** 表の 1 行。 */
export interface LayerRow {
  /** `lib/` 始まりの相対パスに当てる正規表現。 */
  readonly pattern: RegExp;
  readonly layer: string;
  /** なぜその層か(個別に割り付ける行は特に、名前の型から決まらない理由を書く)。 */
  readonly reason: string;
}

/**
 * 層の表(先に当たった行が勝つ)。
 *
 * 移行中の注意: 個別の行は、ファイルを動かして要らなくなったものから消す。違反の基線も同じ順で縮む。
 */
export const LAYER_ROWS: readonly LayerRow[] = [
  { pattern: /^lib\/io\//, layer: 'io', reason: 'ファイルシステムの小道具。何も import しない最下層' },
  { pattern: /^lib\/kernel\//, layer: 'kernel', reason: '全層が読む最小の共通語(Finding・位置・リテラル値・検査への入力の状態 `input-state`・変異の目録の実測結果 `mutation-report` = 診断の系統の語彙)。型と小さい組み立てだけで、kernel の中以外を import しない' },
  { pattern: /^lib\/guard\//, layer: 'lang', reason: 'ガード式の言語(構文木・パーサ・SMT への写し)。仕様モデルの語を知らない' },
  {
    pattern: /^lib\/targets\//,
    layer: 'target',
    reason: '差し替えうる後段(`lib/targets/<後段>/`。いまは `supabase` = プラットフォームと、`vercel` = ホスト)。コアが決めた契約(設定の型・後段の登録の契約・検査と生成器の契約)の**値**を持つ置き場。コアの層は読まない(下の `TARGET_BOUNDARIES`: 読んでよいのは組み立ての根だけ)',
  },
  { pattern: /^lib\/(mutation|diff|formal|gates)\//, layer: 'orch', reason: '検査器・生成器を回す・比べる・歩く側。互いにほぼ独立なので同じ層にまとめる' },
  { pattern: /^lib\/target-api\//, layer: 'contract', reason: '後段の登録の契約(`Target` と、選んだ後段の合成・契約の検査)。check と emit の契約を型として読むので、その上に置く。束ね役・後段がこれを読む' },
  {
    pattern: /^lib\/check-api\//,
    layer: 'check',
    reason: '検査の契約(`Verifier` / `VerifyContext` / `ApplicationRefs`)。検証の束ね(`lib/verify/`)の外に置く —— 契約を束ね役と同じディレクトリに置くと、各種類の検査と verify が互いに依存し合う形になる。`Finding` は再輸出せず、使う側が kernel を直接読む',
  },
  {
    pattern: /^lib\/verify\/(verifier-range|satisfiability-findings|z3-reachability|z3-satisfiability)\.ts$/,
    layer: 'check',
    reason: '検証器が共有する充足性・到達性の判定',
  },
  { pattern: /^lib\/verify\/verifiers\//, layer: 'check', reason: '検証器(`verifiers/**`)' },
  { pattern: /^lib\/verify\/group-contract\.ts$/, layer: 'model', reason: '検証の群と束ね(`lib/compose/verify-pipeline.ts`)が共有する契約(型だけの葉。何も import しない)。群が束ねの型を逆向きに読む形をやめるための置き場' },
  { pattern: /^lib\/verify\//, layer: 'orch', reason: '検証の群ごとの束ね(読み込み・報告・各群の配線。全検査のパイプライン本体は `lib/compose/`)' },
  { pattern: /^lib\/[^/]+\/verifiers\//, layer: 'check', reason: '検証器(`verifiers/**`)' },
  { pattern: /^lib\/[^/]+\/(run|verifier|checks)\.ts$/, layer: 'check', reason: '仕様種ごとの検証器の束ね(`run.ts`)と器(`verifier.ts`)と登録(`checks.ts` = 検査の ID・題・実行の順。全検査の表が読む)' },
  { pattern: /^lib\/generate\/render\/book\//, layer: 'book', reason: 'ハンドブックの章。変異の目録・結果表など全体を読む読み物で、検査器の結果を束ねる側(orch)より上' },
  { pattern: /^cli\//, layer: 'compose', reason: 'CLI。パイプラインと生成の全体を呼ぶ最上層(何でも読んでよい。`lib/` は CLI を読まない)' },
  {
    pattern: /^lib\/compose\//,
    layer: 'compose',
    reason: '組み立ての根(`lib/compose/`。全検査のパイプラインとその群の束ね・生成器の一覧・ハンドブックだけを出す入口の一覧)。検査・生成のどの置き場からも読まれず、読むのは CLI だけ。何でも読んでよい最上層',
  },
  { pattern: /^lib\/generate\/(apply-sections|write-gate|book-sanitize|book-sanitize-balance|book-sanitize-code|book-inputs-loader|generate-context|generate-inputs|book-entry-plan|book-entry-destination|book-entry-report|book-entry-notice|book-entry-check)\.ts$/, layer: 'compose', reason: '生成の全体の組み立て(入力の読み込み・文脈の最終段・書き込みの口。ハンドブックの章を読む)と、ハンドブックだけを出す入口の一覧・実行の計画(入力の状態から止める章)・書き先(書き先の決定・置き場の木の別名の検査)・実行報告・阻害した種類を読む章の冒頭の注記・全部入りの生成物との比較(`--check`)。何でも読んでよい最上層' },
  {
    pattern: /^lib\/gen-kit\//,
    layer: 'kit',
    reason:
      '生成器の道具箱(生成器の契約 `generator.ts`・リテラルの書き出し `code-emit.ts`・状態機械の表 `state-machine-table.ts`・ハンドブックの実装由来の入力の型と読み方 `book-inputs*.ts`)。SQL を作る生成器(DB の後段)と実装・文書の生成器とハンドブックの章の**3 つが同じ道具を読む**ので、どれにも属さない下に置く。読むのは前段・土台・事実の層だけ(derive と同順位)',
  },
  { pattern: /^lib\/generate\//, layer: 'emit', reason: '仕様から成果物(生成物・文書・テスト)の文字列を組む出力側' },
  {
    pattern: /^lib\/model\//,
    layer: 'model',
    reason:
      '前段(仕様を読んで宣言の型にする側)。土台の読み込みと型(`lib/model/*.ts`)と、仕様の種ごとの型・パーサ・ローダー(`lib/model/<種類>/`)・製品の根の宣言(`lib/model/product/`。型・ローダー・パーサと、根のパスの組み立て `paths.ts`・採る種類の値域 `uses.ts`・プラットフォームの設定の型 `platform-profile.ts`)。種類のディレクトリ(`lib/<種類>/`)には解析のパス(検査・計画・SQL・生成の入力)だけが残る。前段は解析を値で読まない(`CLOSURE_BANS`)',
  },
  { pattern: /^lib\/testcase\//, layer: 'model', reason: 'テストケースの共通の語彙(`test_cases` の形・app/ の走査結果の型・意味クラスの値域)と、その台帳の型(`registry.ts` = 全仕様種を横断する索引の構造。どの仕様種から作るかは知らない)。どの仕様種の型も読む**種類に属さない葉**で、いま import するのは `testcase/` の中と kernel(位置情報・`Finding`)だけ(仕様種のモデルを 1 つも知らない。台帳を組み立てる側 `spec-index/sources.ts` は全仕様種を読むので spec-index に残す。`test-trace-match.ts` = 仕様の `test_cases` と `@tc` の 3 段の突合は 8 種類の検査が共有する口なのでここ)' },
  { pattern: /^lib\/semantics\//, layer: 'facts', reason: '仕様から導く事実(検証器と生成器が同じ意味を読むための共通の下)' },
  {
    pattern: /^lib\/relations\//,
    layer: 'relations',
    reason:
      '種類どうしの関係(2 つ以上の種類の宣言を合わせて初めて決まる事実)を、名前のついた中間表現(型つきの値)にして返す層。検査・生成・ハンドブックが同じ結果を読む(設計メモ framework-modules §7 の教訓 1)。読むのは前段(`lib/model/**`)・土台(kernel / guard)・事実の層の葉だけで、種類のディレクトリの解析(検査・計画・生成)は値でも型でも読まない(層の向きと `CLOSURE_BANS` が見る)。facts の直上: 種類をまたぐので、種類ごとの事実(`lib/semantics/`)を材料にできる',
  },
  {
    pattern: /^lib\/messages\//,
    layer: 'messages',
    reason:
      '共有の文言(生成物・テスト名・検査の文面)。導出・検証器・生成器のどれからも読まれる。facts の直上: 事実の型を受けて字面を組む関数(`ownerConflictOf` など)が型を借りる。値は文言の層の中しか読まない',
  },
  {
    pattern: /^lib\/world\//,
    layer: 'derive',
    reason:
      '仕様から「起こりうる場合」と「世界(実行者と行)」を数え上げる意味の計算(一致の証明の場合の列挙・RLS の挙動テストの世界の組み立て・ポリシーの計画)。SQL の文字列を作らない。結果表とハンドブックはここまでを読み、`lib/sql/`(SQL を作る側)は読まない(`CLOSURE_BANS`)',
  },
  {
    pattern:
      /^lib\/(api|auth|config|data|deps|design|docs|extension|external|generality|guarantee|inbound|job|notification|query|reach|results|risk|screen|spec-index|sql|terms|trace|usecase|ux|ux-principles)\//,
    layer: 'derive',
    reason: '仕様種ごとのディレクトリの既定: 前段(`lib/model/<種類>/`)でも検証器でもなければ、仕様から期待される成果物・計画・結果表を純関数で導くもの(解析の補助)',
  },
];

/** 値の閉包の禁止 1 行(`layer-check.ts` の「値の閉包の禁止」)。 */
export interface ClosureBan {
  /** 起点: `lib/` 始まりの相対パスに当てる正規表現。 */
  readonly from: RegExp;
  /** 起点の**実行時の依存の閉包**に入ってはいけないファイル。 */
  readonly banned: RegExp;
  /** なぜ入れないか(違反の説明にそのまま出る)。 */
  readonly reason: string;
}

/**
 * 値の閉包の禁止。層の向きでは守れない**部分利用の約束**を置く。
 *
 * **前段**(`lib/model/**`)は、仕様を読んで宣言の型にするだけの層で、検査・生成の両方が共有する入口である
 * (設計メモ framework-modules §12)。解析(検査・計画・SQL・世界・生成)を実行時の依存に持たせない。
 * **関係の層**(`lib/relations/**`)は、その上で種類どうしの関係を値にする層で、同じく解析を実行時の依存に持たせない
 * (入れてよい事実の層の葉は名指しの 9 本に限る)。
 *
 * **生成器**(`lib/generate/**`)は、変異の層(`lib/mutation/**`)を
 * 実行時の依存に持たない(結果をデータで受け取る葉 `lib/kernel/mutation-report.ts` は kernel にある)。変異の検出器が生成器(DDL・RLS・RPC 本文)を呼ぶので、生成器が変異を起動すると
 * 両者が互いを読む形になる。起動は組み立ての根(CLI と通し実行)が行い、生成器は結果(`MutationReport`)を受け取るだけ
 * (設計メモ framework-modules §13)。
 *
 * **ハンドブックだけを出す入口**(`cli/generate-book.ts`。使い方の 3 段の①「合意の道具 = 仕様 + ハンドブック」)は、
 * SQL を作るファイル(`lib/sql/**`)と変異の層(`lib/mutation/**`)を実行時の依存に持たない。上の 2 つ(本の生成器は SQL を読まない・
 * 生成器は変異を読まない)は**入口の起点が読む他のもの**(読み込み・検証・書き込み)までは見ないので、入口そのものを起点にした
 * 禁止を別に置く(`lib/compose/verify-pipeline` のように、全検査を束ねる側は SQL の層を読む)。**後段**についても同じ入口に禁止を置く
 * (後段の登録の契約と、後段の生成器・検査は読まない。入るのはプラットフォームの設定の値と置き場の配置の値の 2 ファイルだけ)。実行時の読み込みの記録は
 * `__tests__/unit/cli/generate-book.test.ts` が見る。
 *
 * 人向けの本(ハンドブックの生成器)・結果表・世界の組み立ては、DB なしでも動く「意味の層」である
 * (設計メモ framework-modules §11)。SQL を作るファイル(`lib/sql/`)は DDL・RLS・RPC 本文の生成器を
 * 引き連れるので、これらの**実行時の閉包**に入れない。型だけの import(`import type`)は実行時に消えるので数えない。
 * 「SQL を作る」側の例外は置かない —— 意味の計算が `lib/sql/` に居るなら、`lib/world/` へ出す。
 */
export const CLOSURE_BANS: readonly ClosureBan[] = [
  {
    from: /^lib\/(generate\/render\/book|results|world)\//,
    banned: /^lib\/sql\//,
    reason: 'ハンドブックの生成器・結果表・世界の組み立ては、SQL を作るファイル(lib/sql/)を実行時の依存に持たない(DB なしで動く意味の層。意味の計算が sql/ に居るなら lib/world/ へ出す)',
  },
  {
    from: /^lib\/(generate|gen-kit)\/|^lib\/compose\/(all-generators|book-generators)\.ts$/,
    banned: /^lib\/mutation\//,
    reason:
      '生成器(lib/generate/** と道具箱 lib/gen-kit/**)は、変異の層(lib/mutation/**)を実行時の依存に持たない(変異の検出器が生成器を呼ぶので、互いを読む形にしない。変異の起動は組み立ての根(CLI と通し実行)が行い、生成器は kernel の MutationReport(データ)を受け取るだけ)',
  },
  {
    from: /^(cli\/(generate-book|run-generators)|lib\/(generate\/(book-entry-plan|book-entry-destination|book-entry-report|book-entry-notice|book-entry-check|generate-inputs|generate-context)|compose\/book-generators))\.ts$/,
    banned: /^lib\/(sql|mutation)\//,
    reason:
      'ハンドブックだけを出す入口(cli/generate-book.ts と、それが組み立てに使う生成の口)は、SQL を作るファイル(lib/sql/**)と変異の層(lib/mutation/**)を実行時の依存に持たない(DB なしで動く部分利用の入口。検証の全検査(lib/compose/verify-pipeline)は SQL の層を読むので、この入口は生成を止める error の判定だけを呼ぶ)',
  },
  {
    from: /^(cli\/(generate-book|run-generators)|lib\/(generate\/(book-entry-plan|book-entry-destination|book-entry-report|book-entry-notice|book-entry-check|generate-inputs|generate-context)|compose\/book-generators))\.ts$/,
    banned: bookEntryBannedPattern(BOOK_ENTRY_TARGET_FILES),
    reason:
      'ハンドブックだけを出す入口(cli/generate-book.ts と、それが組み立てに使う生成の口)は、後段の登録の契約(lib/target-api/**)と、後段の生成器・検査(lib/targets/<後段>/** のうち、プラットフォームの設定の値 lib/targets/supabase/platform-profile.ts と置き場の配置の値 lib/targets/nextjs/layout.ts 以外)を実行時の依存に持たない(ホストの生成器・検査など、この入口の仕事に要らない後段のコードを入れない。設定と配置の値だけを返す口 cli/select-target-values.ts を通す)',
  },
  {
    from: /^lib\/model\//,
    banned: /^lib\/(?!model\/|testcase\/|kernel\/|io\/|guard\/)/,
    reason:
      '前段(lib/model/**。仕様を読んで宣言の型にする側)は、解析(検査・計画・SQL・世界・生成・ハンドブック・種類のディレクトリに残る補助)を実行時の依存に持たない(前段は検査と生成の両方が共有する入口。解析の補助が前段に要るなら前段へ移し、前段が解析を呼ぶなら呼び出しを解析の側へ出す)',
  },
  {
    from: /^lib\/relations\//,
    banned:
      /^lib\/(?!model\/|relations\/|testcase\/|kernel\/|io\/|guard\/|semantics\/(domain-lookup|domain-index|domain-env|entity-state-axes|state-admit|action-ground|required-guards|query-window-columns|query-filter-path)\.ts$)/,
    reason:
      '関係の層(lib/relations/**。種類どうしの関係を型つきの値にして返す層)は、前段・土台・事実の層の葉(semantics の名指しの 9 本)以外を実行時の依存に持たない(種類のディレクトリの解析(検査・計画・SQL・生成)を道連れにしない。材料が解析に居るなら、読み込みに要るものは前段へ・モデルだけを引数に取る葉は semantics へ出す)',
  },
];

/** 後段の置き場の境界 1 行(`layer-check.ts` の「後段への辺」)。 */
export interface TargetBoundary {
  /** 後段の置き場の中のファイル(`lib/` 始まり)。**先頭からの一致(`match[0]`)がその後段の接頭辞**で、同じ後段の中どうしは読んでよい。 */
  readonly inside: RegExp;
  /** 後段を import してよいファイル(組み立ての根)。 */
  readonly roots: RegExp;
  /**
   * 後段の置き場の**直下**のファイル(後段のディレクトリの外 = どの後段にも属さない)。**後段は必ずディレクトリ**で、
   * 直下に置いたファイルは `inside` に当たらず、辺の境界(コアから読めない)をすり抜けるので、あれば赤にする。
   */
  readonly loose: RegExp;
  /** なぜ根だけか(違反の説明にそのまま出る)。 */
  readonly reason: string;
}

/**
 * 後段の置き場の境界。**`lib/targets/<後段>/**` を import してよいのは組み立ての根(CLI)だけ**である
 * (コアから後段への辺は 0。後段どうしも読まない)。値を選ぶのは根の 1 回だけで、コアは引数で受け取る
 * (設計メモ framework-modules §20)。後段の中身は、コアの契約(型)を読むために層の向きの上では
 * contract の上(orch と同順位)の `target` に置く —— 向きの検査は残り、辺の許可はここが絞る。
 * 違反は辺 1 本ずつで、基線を持たない。
 */
export const TARGET_BOUNDARIES: readonly TargetBoundary[] = [
  {
    inside: /^lib\/targets\/([^/]+)\//,
    roots: /^cli\//,
    loose: /^lib\/targets\/[^/]+$/,
    reason: '後段(lib/targets/<後段>/)を import してよいのは組み立ての根(cli/)だけ。コアは契約(型)を引数で受け取り、値を選ばない(後段どうしも読まない)',
  },
];

/** 辺の禁止 1 行(`layer-check.ts` の「辺の禁止」)。 */
export interface EdgeBan {
  /** 読む側: `lib/` 始まりの相対パスに当てる正規表現。 */
  readonly from: RegExp;
  /** 読んではいけないファイル(辺の行き先)。 */
  readonly banned: RegExp;
  /** なぜ読まないか(違反の説明にそのまま出る)。 */
  readonly reason: string;
}

/**
 * 辺の禁止。**層の向きが許す辺**のうち、置き場の約束として読ませない辺を 1 本ずつ名指す。値の閉包の禁止(`CLOSURE_BANS`)と違って、
 * **直接の辺だけ**を見て、**型だけの import も数える**(型で借りても、読む側の依存になる)。
 *
 * **検査の束ね役**(`lib/verify/**` と、その本体 `lib/compose/verify-pipeline*.ts`)は、後段の登録の契約(`lib/target-api/**`)を読まない。
 * 束ねの入力は設定と集めた登録の 2 つのデータだけで、後段の選択と合成は根(`cli/`)が契約を通して行ってから渡す。束ね役の本体は組み立ての根の層
 * (`compose`。何でも読んでよい)に置かれるので、この向きは層の表では止まらず、ここが見張る。
 */
export const EDGE_BANS: readonly EdgeBan[] = [
  {
    from: /^lib\/(verify\/|compose\/verify-pipeline[^/]*\.ts$)/,
    banned: /^lib\/target-api\//,
    reason:
      '検査の束ね役(lib/verify/** と lib/compose/verify-pipeline*.ts)は後段の登録の契約(lib/target-api/**)を読まない(束ねの入力は設定と集めた登録の 2 つのデータだけ。後段の選択と合成は根の cli/ が契約を通して行ってから渡す)',
  },
];

/** 公開の入口の宣言 1 行(`layer-check.ts` の「入口の外からの深い import」)。 */
export interface LayerEntrance {
  /**
   * 置き場の中のファイル(`lib/` 始まりの相対パスに当てる正規表現)。**先頭からの一致(`match[0]`)がその置き場の接頭辞**で、
   * 読み手がこの接頭辞の下にいれば「中」、いなければ「外」。1 つ目の捕捉グループは `entry` の `$1` に入る
   * (`lib/relations/<関係>/` のように置き場が同じ形で増えていく層を 1 行で見る)。
   */
  readonly inside: RegExp;
  /**
   * 外から読んでよいファイル(`lib/` 始まり。`$1` は `inside` の 1 つ目の捕捉)。**ほとんどの層は 1 本**。
   * 型だけを読む側に値の実装(関数・組み立て)を道連れにさせたくない層は、**型・語彙の入口と値の入口の 2 本**にする
   * (型だけの import が値の入口を読むと、実行時の依存の閉包と C24 の写し元の閉包に値の実装が入る)。
   */
  readonly entries: readonly string[];
  /** なぜ入口を持つか(違反の説明にそのまま出る)。 */
  readonly reason: string;
}

/**
 * 公開の入口の宣言。**部品化でできた層**(関係の層・世界・検査の契約・テストケースの共通の語彙)は、外から使われる名前だけを
 * 入口の 1 ファイルに出し(再輸出は外から実際に使われているものだけ)、**外からは入口だけを import する**
 * (置き場の中どうしは自由。型だけの import も入口を通す)。**入口は 1 層に複数あってよい**: 型だけを読む側(前段)に値の実装を道連れにさせない層は、型・語彙の入口と値の入口に分ける(`lib/testcase/` = `types.ts` と `index.ts`。入口を挟むと C24 の写し元の閉包が太るので、前段に入口を広げるときも同じ形にする)。部分利用の入口の起点にするためと、置き場の内部の組み替えが
 * 外の import に波及しないようにするため(設計メモ framework-modules §6 の「配布するパッケージの数は最後。まず 1 パッケージの
 * 中で境界と公開の入口を作り、既存の C28 で執行」)。**新しい層は入口を持つ** —— 新しい関係の層(`lib/relations/<関係>/`)は
 * 宣言を足さなくても `index.ts` を要求される(入口が無ければ赤)。テストは中身を確かめるため置き場の内部を読んでよい(この検査の母集合は `lib/` と `cli/`)。
 */
export const LAYER_ENTRANCES: readonly LayerEntrance[] = [
  {
    inside: /^lib\/relations\/([^/]+)\//,
    entries: ['lib/relations/$1/index.ts'],
    reason: '関係の層(lib/relations/<関係>/)は入口の index.ts だけを公開する(検査・生成・ハンドブックは入口の値を読む)',
  },
  {
    inside: /^lib\/world\//,
    entries: ['lib/world/index.ts'],
    reason: '世界の組み立て(lib/world/)は入口の index.ts だけを公開する(外から使われる名前だけを再輸出する)',
  },
  {
    inside: /^lib\/check-api\//,
    entries: ['lib/check-api/contract.ts'],
    reason: '検査の契約(lib/check-api/)は 1 ファイル(contract.ts)が入口である(Verifier / VerifyContext)',
  },
  { inside: /^lib\/target-api\//, entries: ['lib/target-api/contract.ts'], reason: '後段の登録の契約(lib/target-api/)は 1 ファイル(contract.ts)が入口である(Target と、選んだ後段の合成)' },
  {
    inside: /^lib\/testcase\//,
    entries: ['lib/testcase/types.ts', 'lib/testcase/index.ts'],
    reason:
      'テストケースの共通の語彙(lib/testcase/)は入口が 2 本: 型と閉じた値域の入口 types.ts(前段・型だけを読む側はこちら。値の実装を道連れにしない)と、値の入口 index.ts(台帳の組み立て・突合・説明文)',
  },
];

/** `node:fs` を import してよいファイルの宣言 1 行。 */
export interface IoRow {
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * ファイルを読む・書く・子プロセスを回す(`node:fs` / `node:child_process`)入口の宣言。
 *
 * **検証器は入らない**(検証器の中で `fs` を import しない。規約 scripts-code-quality.md。中身を読む項は
 * `lib/io/read-text.ts` の小道具を通す)。宣言の無いファイルが `fs` を import すると赤。
 * **名前の型で通さない**(接頭辞つきの任意名を許さない)。入口は実際に `fs` を読む
 * ファイルを 1 本ずつ名指しする(新しい入口は、ここに 1 行足す日にレビューが見る)。
 */
export const IO_ROWS: readonly IoRow[] = [
  { pattern: /^lib\/io\//, reason: 'io 層そのもの' },
  { pattern: /^lib\/(model\/[^/]+|[^/]+)\/loader\.ts$/, reason: 'ローダー(仕様・設定を読み込む口。前段 `lib/model/<種類>/` と各ディレクトリの `loader.ts`。I/O はローダーに集約する)' },
  { pattern: /^lib\/[^/]+\/scan\.ts$/, reason: '走査器(各ディレクトリの `scan.ts`。ファイル木を端から読んで決まった形を集める)' },
  { pattern: /^lib\/config\/env-scan\.ts$/, reason: '環境変数の参照を実装の木から走査する(設定カタログの突合の入力)' },
  { pattern: /^lib\/generality\/prose-scan\.ts$/, reason: '語彙漏れの走査が散文のファイルを読む' },
  { pattern: /^lib\/verify\/application-ref-scan\.ts$/, reason: '実装の木(app/src)の export と参照を走査する(V10 の ref 実在検査の入力)' },
  { pattern: /^lib\/screen\/app-loader\.ts$/, reason: '実装側の画面ファイルを読み込む口' },
  { pattern: /^lib\/generate\/book-inputs-loader\.ts$/, reason: 'ハンドブックが写す実装の実物(CSS・SSR プレビュー)を読み込む口' },
  { pattern: /^lib\/targets\/supabase\/samples\//, reason: '通し実行(Supabase の後段の道具。一時ツリー・ローカルの DB・子プロセスを扱う置き場)' },
  { pattern: /^lib\/generate\/apply-sections\.ts$/, reason: '生成セクションを実ファイルへ適用する I/O 境界(書き込みの口)' },
  { pattern: /^lib\/generate\/write-gate\.ts$/, reason: '書き込みの関所(書き先が木の中の通常のファイルかを `lstat` で確かめる I/O 境界)' },
  { pattern: /^lib\/generate\/render\/code-examples\.ts$/, reason: '「書き方の例」の章が実ファイルから抜粋を切り出す(入力がリポジトリの実ファイルである章だけの例外)' },
  { pattern: /^lib\/model\/docs\/template\.ts$/, reason: 'template_policy に従ってテンプレートを解決する I/O 層' },
  { pattern: /^lib\/model\/docs\/link-scan\.ts$/, reason: 'リンクの実在(M4)の範囲(CLAUDE.md と docs/ の下の全部の .md)を読み、行き先の実在を確かめる I/O 層' },
  { pattern: /^lib\/model\/decl-list\.ts$/, reason: 'README のフロントマターの宣言リストを読む共通ローダー' },
  { pattern: /^lib\/generality\/literals\.ts$/, reason: '走査のためにソースを読む小道具(`readText`)を持つ' },
  { pattern: /^cli\//, reason: 'CLI(仕様・生成物・DB を実際に読み書きする最上層の入口)' },
];

/** I/O とみなす組み込みモジュール(`node:` の有無は問わない)。 */
export const IO_MODULES: ReadonlySet<string> = new Set(['fs', 'fs/promises', 'child_process']);
