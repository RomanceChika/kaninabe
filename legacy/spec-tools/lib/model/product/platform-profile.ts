/**
 * **プラットフォームの設定 `PlatformProfile`**(Postgres の後段が受け取る契約。型だけで値は持たない)。
 *
 * ## なぜ設定にするのか
 *
 * SQL(RLS のポリシー・RPC の権限・外に出すビュー)は **Postgres の語**だけで書ける —— ただし
 * 「誰が呼んでいるか」「どのロールに権限を与えるか」「どのスキーマを外へ見せるか」は、Postgres の上に
 * 載せる認証・API 層(いまは Supabase)の約束で決まる。その約束が SQL の生成器ごとに直書きで複製されて
 * いると、別の層に載せ替える日に複製の数だけ直すことになる。**約束を 1 つの値にして引数で受ける**
 * ことで、SQL の生成器は約束の中身を知らずに済み、値を選ぶのは組み立ての根(CLI・通し実行)だけになる。
 *
 * 値は `lib/targets/<後段>/platform-profile.ts` が持つ(いまは `supabase` だけ)。**コアは後段を import
 * しない** —— 値の選択は組み立ての根で 1 回だけ行い、以降は引数として配る(グローバルな「選択済みの設定」
 * を返す口は作らない)。
 *
 * 純粋な型である。**アプリの語彙は 1 語も持たない。**
 *
 * **置き場は前段(`lib/model/product/`)**: この型を読むのは SQL の層・テーブル仕様の検査・SQL を書き出す生成器・生成の文脈・後段の登録の契約・
 * 後段の値で、どれも読めるのは前段より上である。型を SQL の層に置くと、SQL の層を読まない側(生成の文脈・登録の契約)が型のために SQL の層を
 * 向く形になる(パッケージの候補の間の向きが逆流する)ので、置き場の契約(`layout-types.ts`)と並べて前段に置く。
 */

import type { RoleKind } from '../types-role.js';

/**
 * 後段が **SQL の公開面(surface)を API として外へ出す能力**。
 *
 * コアの surface_spec は Postgres の SQL の境界(外に出すスキーマ・そこに置く生成ビューと土台の関数・DB ロールへの grants)
 * だけを仕様にする。**API 層がその公開面をどう外に出すか**(認証主体の解決・API 側の権限)は SQL の外で、後段の能力である:
 *
 *   - `sql-is-api` … **SQL の公開面 = API の公開面**(スキーマの GRANT がそのまま API の権限になる構成)。
 *   - `unsupported` … SQL の公開面を API として外へ出す能力を持たない(権限が SQL の外 —— メタデータ等 —— にある API 層など)。
 *     この構成では、surface に依る検査・生成を**未対応**と報告する(黙って緑にしない)。`reason` が報告に出る。
 *
 * 能力を持たない後段の実装は書かない(宣言と未対応の報告の経路だけがある)。
 */
export type SurfaceExposure =
  | { readonly kind: 'sql-is-api' }
  | { readonly kind: 'unsupported'; readonly reason: string };

/** プラットフォームの約束(認証・API 層が決める、SQL に現れる名前と式)。 */
export interface PlatformProfile {
  /**
   * 仕様の役割(`role_spec` の `kind`)→ DB のロール名。
   *
   * - `anonymous` … 未ログインの呼び出し
   * - `authenticated_default` … ログイン済みの呼び出し
   * - `system` … RLS をバイパスする内部実行(サーバー側と非同期のワーカー)
   *
   * 仕様は役割の語だけを持ち、ロール名への写像はここだけにある。
   *
   * **契約: 3 つの値は互いに異なる**(一般利用者と内部実行の区別を SQL が前提にしている)。
   * 値を選ぶ組み立ての根が `platformProfileProblems`(`platform-sql.ts`)で確かめてから配る。
   */
  readonly roles: Readonly<Record<RoleKind, string>>;
  /**
   * 現在の実行者の id(uuid)を返す SQL の式。**括弧で包まない**(関数呼び出しの字面)。
   *
   * 初期計画に畳ませる包み(`(select …)`)は Postgres の都合なので、SQL の側が付ける。
   */
  readonly currentActorExpr: string;
  /**
   * 呼び出しのログインセッションが**いまも生きている**かを答える SQL の真偽式(**括弧で包まない**・列の別名を持ち込まない)。
   *
   * 署名として有効なトークンは、セッションが終わった(ログアウト・強制終了)後も期限まで残る。それを提示された DB が
   * 「そのセッションはもう無い」と判定して拒むための式で、トークンが運ぶセッションの識別子が認証基盤のセッションの表に
   * 実在する(かつ期限内である)ことを見る。識別子を持たない呼び出し(トークンの無い呼び出し・古い形式のトークン)は偽である —— 欠けたら閉じる。
   *
   * SQL の側は、この式を **security definer の関数 1 本**(土台の関数 `session_alive`)に包んで使う(一般利用者のロールは
   * 認証基盤のセッションの表を読めないため)。式は関数の本文にそのまま入るので、`search_path` が空でも読めるよう
   * スキーマ修飾した綴りで書く。
   */
  readonly sessionAliveExpr: string;
  /**
   * セッション属性(`session: true` の欄)が載る枝(ログインセッションの属性の入れ物を外側から辿る鍵の並び)。
   * 書き込むのは実行計画の先読みのための写しだけであり、**SQL の判定はこの枝を読まない** ——
   * RLS の境界も RPC も実行者自身の行を読む(写しはトークンの寿命だけ古い)。人向けの文面(`a.b` の形)にも同じ並びを使う。
   */
  readonly sessionClaimsPath: readonly string[];
  /** SQL の公開面(surface。ビュー・RPC・土台の関数)を置くスキーマ名。 */
  readonly exposedSchema: string;
  /** SQL の公開面を API として外へ出す能力(`unsupported` なら surface に依る検査・生成は未対応と報告する)。 */
  readonly surfaceExposure: SurfaceExposure;
  /**
   * 公開面のスキーマに**関数を作りうる DB ロール**(作成主体)の全数と、その扱い。
   *
   * 新しい関数に付く既定の実行権限(`PUBLIC` への既定と、プラットフォームがロールを名指しで付ける既定)は
   * **作成主体ごと**に持たれる。実行した役の既定しか書き換えられないので、migration を流す役が
   * 作成主体のすべてではない —— 閉世界は、ここに挙げた役ごとに既定を閉じて成り立つ。
   * 一般利用者のロールは含められない(`platformProfileProblems`)。
   *
   * 扱いは 2 つある(`FunctionCreator`)。**閉じる責務を migration が持つ役**(`migration`)は、
   * 実在するのに書き換えられなければ migration を止める。**プラットフォームが持つ役**(`external`)は
   * migration からは触れないので、閉じられないことと理由を宣言する。
   */
  readonly functionCreators: readonly FunctionCreator[];
  /**
   * ログインセッションのトークンの素性(任意。暗号の目録 — ハンドブックの設定の章 — に出す。ASVS V11.1.2)。
   * 署名の方式はプラットフォームが決め、リポジトリの宣言に無いことがある。そのときは `algorithm` に「どこが決めるか」を書き、
   * 検査から見えないことを隠さない(方式を発明しない)。
   */
  readonly sessionToken?: SessionTokenProfile;
}

/** ログインセッションのトークンの素性(暗号の目録の 1 行)。 */
export interface SessionTokenProfile {
  /** トークンの形式(例 JWT)。 */
  readonly format: string;
  /** 発行して署名する主体。 */
  readonly issuer: string;
  /** 署名の方式、または方式を決める場所(リポジトリの宣言に無いなら、その旨)。 */
  readonly algorithm: string;
  /** 使ってよい範囲(誰に・何のために提示するか)。 */
  readonly scope: string;
}

/**
 * 関数を作る DB ロール 1 つと、その役の既定の実行権限の扱い。
 *
 *   - `migration` … migration が既定を閉じる責務を持つ(例: migration を流す役)。役が実在するのに
 *     流した接続がそのメンバーでなければ、**migration は止まる**(通知で飛ばさない。fail closed)。
 *     役が実在しなければ飛ばす(作れない役は関数を作らない)。
 *   - `external` … プラットフォームが持つ役で、migration からは触れない(例: 拡張や内部の関数を作る管理者の役)。
 *     閉じられないことの根拠を `reason` に必ず書く。保証は流す時点の関数の一覧の剥奪と、閉世界の
 *     突合テスト(function-acl-parity)が持つ —— この役が後から作る関数の既定は閉じない。
 */
export type FunctionCreator =
  | { readonly role: string; readonly handling: 'migration' }
  | { readonly role: string; readonly handling: 'external'; readonly reason: string };
