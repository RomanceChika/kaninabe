/**
 * **パッケージの候補の表**(`lib/` と `cli/` の各ファイル → どの候補か、と候補の下から上への順位)。
 *
 * 層の表(`lib-layers.ts`)は 1 パッケージの中の**層**の向きを守る。ここは一段広い単位 —— 将来パッケージに分けるときの**切れ目の候補**
 * (設計メモ framework-modules §18・§21)—— の間の向きを守る。構造テスト `package-candidates.test.ts` が、候補をまたぐ import の
 * 向きの逆流(下の候補が上の候補を読む辺。型だけの import も)と、候補の同順位の相互参照を赤にする(C28 の続き)。
 * **基線も免除の口も持たない**(増えた違反は常に赤)。判定は `candidate-check.ts`。
 *
 * 候補は下から: `core-base`(土台と前段の土台)→ `core-kinds`(前段の種類ごとの型・パーサ・ローダー)→ `semantics`(意味の層・中間表現・オラクル)→ `kit`(生成器の道具箱)→ `db`(DB の後段が持つ SQL と
 * その検査・SQL を書き出す生成器)→ `check`(種類ごとの検査と検証の器)→ `gen`(実装・テスト・文書とハンドブックの生成)→ `ops`(変異・
 * 差分・形式手法・通し実行・構造テストの判定部)→ `contract`(後段の登録の契約)→ `targets`(差し替えうる後段の値)→ `root`(組み立ての根)。
 * 順位は**依存の向き**から決めた —— 読まれる側が下。`check` が `db` の上なのは、拡張候補の台帳(`extension/scope.ts`)が DB の検査の理由の語を
 * 読むため(DB の後段が自分の語を登録する形にすれば消える宿題で、向きは一方向)。
 *
 * 割り付けは**ディレクトリとファイル名の型**で、先に当たった行が勝つ。どの行にも当たらないファイルは赤(新しいディレクトリは 1 行足して
 * 候補を選ぶ)。
 */

/** 候補の順位(小さいほど下)。同じ順位の別の候補は互いを読まない。 */
export const CANDIDATE_RANK: Readonly<Record<string, number>> = {
  'core-base': 0,
  'core-kinds': 1,
  semantics: 2,
  kit: 3,
  db: 4,
  check: 5,
  gen: 6,
  ops: 7,
  contract: 8,
  targets: 9,
  root: 10,
};

/** 表の 1 行。 */
export interface CandidateRow {
  /** `lib/` か `cli/` 始まりの相対パスに当てる正規表現。 */
  readonly pattern: RegExp;
  readonly candidate: string;
  /** なぜその候補か(名前の型から決まらない行は特に)。 */
  readonly reason: string;
}

/**
 * SQL を書き出す生成器(DDL・RLS・RPC 本文・GRANT・API のビュー・それらの期待表)。**DB の後段の中身**なので、`lib/generate/` の中にあっても
 * `db` に数える。名指しで持つ(接頭辞の型で通さない)。実在・腐り(`dbGeneratorProblems`)・載せ忘れ(`gen → db` の辺の固定)は構造テストが見る。
 */
export const DB_GENERATOR_FILES: readonly string[] = [
  'code-api-base',
  'code-api-views',
  'code-ddl',
  'code-grants',
  'code-rls-policies',
  'code-rpc-bodies',
  'code-usecase-rpc',
  'usecase-rpc-resend',
  'code-inbound-rpc',
  'usecase-sql',
  'code-api-expectations',
  'code-data-table-expectations',
  'code-send-limits',
  'code-lock-expectations',
  'code-data-table-expectation-types',
  'code-data-table-registries',
  'code-rls-expectations',
  'code-rpc-expectations',
  'code-rpc-expectations-file',
  'code-rpc-digest-anchors',
];

/** 候補の表(先に当たった行が勝つ)。 */
export const CANDIDATE_ROWS: readonly CandidateRow[] = [
  {
    pattern: /^lib\/model\/(?!product\/)[^/]+\//,
    candidate: 'core-kinds',
    reason: '前段のうち仕様の種類ごとの型・パーサ・ローダー(`lib/model/<種類>/`。`product/` は土台)。種類どうしは読み合ってよい(同じ候補)が、土台は種類を読まない(読むと赤。種類で共有する小さな葉 — `sql-fields`・`parse-test-case`・`parse-lint-exceptions` — は土台 `lib/model/*.ts` に置く)',
  },
  {
    pattern: /^lib\/(io|kernel|guard|testcase|model)\//,
    candidate: 'core-base',
    reason: '土台(io・kernel・ガード式の言語・テストケースの語彙)と前段の土台(`lib/model/*.ts` の読み込みと型・共有の小さな葉と、`lib/model/product/` = 置き場の契約・プラットフォームの設定の型)。種類のディレクトリ(`core-kinds`)を読まない',
  },
  { pattern: /^lib\/(semantics|relations|world|reach|results|messages|inbound)\//, candidate: 'semantics', reason: '意味の層・関係の層・場合の列挙と世界の組み立て・到達・結果表・共有の文言・受信口の純粋な導出(`lib/inbound/`。SQL も検査も作らない)' },
  { pattern: /^lib\/usecase\/(verifiers\/|verifier\.ts$|run\.ts$|checks\.ts$)/, candidate: 'check', reason: 'ユースケース仕様の検査(Y 群)と束ねと登録。計画の導出(下の行)とは使い手が違う' },
  { pattern: /^lib\/usecase\//, candidate: 'semantics', reason: 'ユースケースの計画の導出(検査も生成もこれを読む意味の計算)' },
  { pattern: /^lib\/gen-kit\//, candidate: 'kit', reason: '生成器の道具箱。SQL の生成器・実装と文書の生成器・ハンドブックの章の 3 つが同じ道具を読むので、どれにも属さない下に置く' },
  {
    pattern: new RegExp(`^lib/generate/render/(${DB_GENERATOR_FILES.join('|')})\\.ts$`),
    candidate: 'db',
    reason: 'SQL を書き出す生成器(DB の後段の中身。`DB_GENERATOR_FILES`)',
  },
  { pattern: /^lib\/(sql|data)\//, candidate: 'db', reason: 'SQL の翻訳(DDL・RLS・RPC 本文・GRANT・API のビュー)とテーブル仕様の検査(T 群)' },
  {
    pattern: /^lib\/(check-api|verify|trace|screen|ux|job|query|notification|auth|guarantee|external|config|design|docs|terms|generality|spec-index|ux-principles|extension|risk|product)\//,
    candidate: 'check',
    reason: '検査の契約・検証の器(`verify/`)と種類ごとの検査(仕様種ごとのディレクトリ)と、製品の根の宣言の検査(`lib/product/`。P1 / P2。種類のローダーを値で読む)',
  },
  { pattern: /^lib\/generate\//, candidate: 'gen', reason: '実装・テスト・文書の生成と、ハンドブックの章(`generate/render/book/`)・書き込みの口' },
  { pattern: /^lib\/(mutation|formal|diff|gates|samples|deps)\//, candidate: 'ops', reason: '変異・形式手法・差分・構造テストの判定部・通し実行の共通部・依存の脆弱性の検査 `deps`(仕組みを運用する側)' },
  { pattern: /^lib\/target-api\//, candidate: 'contract', reason: '後段の登録の契約(検査と生成器の契約を型として読み、後段が読む)' },
  { pattern: /^lib\/targets\//, candidate: 'targets', reason: '差し替えうる後段の値(`lib/targets/<後段>/`。後段どうしは `TARGET_BOUNDARIES` が見る)' },
  { pattern: /^(lib\/compose|cli)\//, candidate: 'root', reason: '組み立ての根(全検査のパイプライン・生成器の一覧・CLI)。どの候補からも読まれない' },
];
