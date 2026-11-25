import type { Client as PgClient } from 'pg';

/**
 * ハーネスが製品から受け取る**口**(ADR-0013 の裏返し。設計メモ `runtime-package.md` §3-1)。
 *
 * ここに並ぶのは「実 DB とセッションに触る手」だけであり、**アプリの語彙は 1 語も無い** ——
 * 表の名前・集約名・ロール名は設計図(製品の生成物)が運び、ハーネスは引数で受け取る。
 *
 * ## なぜ「クライアント」ではなく「操作」を渡すのか
 *
 * 口を `SupabaseClient` にすると、仕組み側が製品の接続層の型(行の型・スキーマ名)を知ることに
 * なる。ここが持つのは**やること**(空にする / 認証ユーザを作る / ログインする / セッション属性を
 * 書く・読む / pg を開く / 読み取り用クライアントを作る / RPC を呼び出す)であり、その実体をどう作るかは
 * 製品の側にある。だから製品のアダプタが 1 か所で `as unknown as` を引き受け、**パッケージには
 * 製品の型が 1 つも入らない**。
 *
 * ## 読み取り専用のクライアントだけを構造で受ける理由
 *
 * `readAsActor`(画面と同じ経路で `api` のビューを読む)は「ビューの名前 × アクセストークン」で
 * 決まる手であり、ここだけは**クライアントの形**が要る(`from(...).select(...)`)。必要な 2 手だけを
 * 構造として宣言し、それ以上は知らない。
 */
export interface HarnessPorts {
  /**
   * セッション属性の欄の全数(製品の生成物 `session-profile` が正)。
   *
   * 境界(`filters`)の判定はこの欄しか見ない。ハーネスは欄の**名前**を 1 つも綴らない。
   */
  readonly sessionFields: readonly string[];
  /** ドメインの表と認証ユーザを空にする。 */
  resetDatabase(): Promise<void>;
  /** 認証ユーザを 1 人作る(実行者の集約の行は作らない)。 */
  seedAuthUser(): Promise<SeededUser>;
  /** その人としてログインし、アクセストークンを得る。 */
  signIn(user: SeededUser): Promise<string>;
  /** その人のセッション属性(`app_metadata` の枝)を書く。 */
  writeSessionProfile(userId: string): Promise<void>;
  /** その人のセッション属性を読む(書いた結果を実物から読み直す)。 */
  readSessionProfile(userId: string): Promise<Readonly<Record<string, unknown>> | undefined>;
  /** pg に直結して 1 手ぶん実行する(開いて閉じるまで)。 */
  withPg<T>(run: (pg: PgClient) => Promise<T>): Promise<T>;
  /** pg の接続を開く(呼び側が使い回す。組み合わせの数だけ開き直さないため)。 */
  connectPg(): Promise<PgClient>;
  /** RLS が効いた読み取り用クライアント(省略時は未ログイン)。 */
  createRlsClient(accessToken?: string): RlsReadClient;
  /** RPC を呼び出す口(関数名を実行時に決める最小の構え)。 */
  rpcSource(): EqRpcSource;
}

/** 実 DB に作った認証ユーザ 1 人。 */
export interface SeededUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

/**
 * 読み取り用クライアントの**最小の形**(`api` のビューを 1 枚読むのに要る 2 手だけ)。
 *
 * 製品の接続層の型をそのまま受けない —— ビューの名前の値域(`keyof Database['api']['Views']`)は
 * 製品の生成物であり、仕組みが知ってよい相手ではない。名前が実在するかは実 DB が答える。
 */
export interface RlsReadClient {
  from(view: string): {
    select(columns: string): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
  };
}

/**
 * 関数名を実行時に決める最小の口(`rpc-outcome.ts` の `RpcSource` と同じ構え)。
 *
 * 実装の口(`rpcSourceOf`)を借りないのは、**この 1 本だけで閉じている**ことを保てるように
 * するためである —— fixture(題材)の一時ツリーにはハーネスと生成物しか無く、アプリの実装層は
 * 1 つも無い。
 */
export interface EqRpcSource {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): PromiseLike<{ data: unknown; error: { readonly code: string; readonly message: string; readonly details?: string | null; readonly hint?: string | null } | null }>;
}
