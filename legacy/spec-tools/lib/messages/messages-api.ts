/**
 * 生成した**外から届く surface**(`api` スキーマのビューと隠し列の述語)の SQL に出る仕組みの文言。
 *
 * 生成物が SQL でも事情は同じである —— 別のアプリに移したときに何が日本語のまま残るかは、
 * ここを見れば分かる(`messages-rls.ts` の `RLS_WORDS` と同じ規約)。
 *
 * **この文言は適用済みの migration に固着する**(docs/design/ddl-generation.md §4-b)。
 * 1 文字直すと生成物のバイト列が変わり、既に当たったファイルの書き換えになる ——
 * 直すには `surface_migration` の採番をやり直すことになる。文言は意味の一部として扱う。
 *
 * **文言の中の仕様の欄名は旧い綴りのまま据え置く**(`api_view_migration` は `surface_migration` の旧い綴り。適用済みの migration の
 * 先頭コメントに同じ文があり、1 文字直すと次の generate と食い違う = C23)。直せるのは次に出す migration から。
 */

/** 生成した api のビューの SQL に出る固定の文言。 */
export const API_VIEW_WORDS = {
  /** 追記専用の歴史との両立のしかた(ファイル先頭)。 */
  migrationNote: [
    'SQL が変わる仕様変更をしたら api_view_migration の名前を新しくする(適用済みの',
    'migration は書き換えない。migrations.md §生成 migration)。ビューは drop してから',
    'create するので、新しいファイルが同じ名前のビューを置き換える。',
  ],
  /** 隠し列の述語の節の見出し。 */
  maskSection: [
    '隠し列の述語 —— その行を fields_hidden.from の外側のロールとして読める人かどうか。',
    '呼び出した人の権限で評価する(security invoker)—— 述語はその表の RLS のポリシーと同じ式で、実行者の解決は',
    '土台の関数と補助関数(security definer)に委ねる。面のロールが行を作って直接呼んでも、RLS で見えない行は読めない',
    '(定義者の権限で評価すると、親の状態を読む述語が RLS で見えない行を探る口になる)。',
  ],
  /** ビューの節の見出し。 */
  viewSection: [
    'ビュー本体。列は宣言の順に並べて書き、select * は使わない —— 外から見えるのは',
    '宣言した列だけである、を形にしている。security_invoker = true なので行の防御は',
    '元の表に張った RLS がそのまま効く(正は 1 つのまま)。',
  ],
  /** 作り直す形の意味。 */
  replaceView: [
    'drop してから作り直すのは、create or replace view が列の名前・型・並びを変えられず',
    '追加を末尾にしか置けないためである(並びは宣言の順に保つ)。このビューは外の口が',
    '読む葉であり、ほかのビュー・関数から参照されていないので落としても連鎖しない。',
  ],
  /** 隠し列のマスクの形の意味。 */
  maskCase: [
    '隠し列は「特権のある接続か、述語が真なら値・それ以外は空」で出す。特権のある接続は',
    '元々 RLS もバイパスするので、ここで新たに広げてはいない。',
  ],
  /** 権限の節の意味。 */
  grants: [
    '読みだけを一般の呼び出し主体へ開ける(書き込みの直接経路は作らない。全書き込みは',
    'security definer の RPC を通る)。',
  ],
  /**
   * 内部テーブルの surface の権限の節の意味(surface のロールには 1 つも与えない)。
   *
   * 文言を分けてあるのは、**与えないことが性質そのもの**だからである —— 「読みだけを開ける」
   * という説明の下に `grant select` が 1 行も無いと、消し忘れなのか意図なのかが読めない。
   *
   * @param readers surface のロール(DB のロール名。プラットフォームの設定が決める)
   */
  internalGrants: (readers: readonly string[]): readonly string[] => [
    `面のロール(${readers.join(' / ')})には何も与えない —— このビューは特権のある接続が`,
    '読み書きする経路のためだけに置くものであり、外の口からは完全に消える。',
  ],
  /** 隠し列 1 つの上に出す由来の行の作り。 */
  maskOrigin: (column: string, visibleTo: readonly string[]): string =>
    `列 ${column} / 見てよいロール: ${visibleTo.length === 0 ? 'なし' : visibleTo.join(', ')}`,
} as const;
