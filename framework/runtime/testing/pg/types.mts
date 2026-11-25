import type { InvariantResolver } from '@kaninabe/runtime/bindings';

/**
 * pg の参照 adapter(`pg/ports.mts`)が受け取るものの型。
 *
 * pg の参照 adapter は**テストの基盤**である(`@kaninabe/runtime/testing/pg/*`)。公開の入口(`@kaninabe/runtime/ports` ほか)には
 * 載せない —— DB への口の実装は adapter パッケージ(`@kaninabe/adapter-*`)の仕事で、ここにあるのは「素の pg のクライアントでも
 * 同じ契約が成り立つ」ことを契約テスト(`contract/*`)で示すための参照の実装である。
 */

/**
 * 問い合わせを 1 回流せる最小の口。
 *
 * pg の `Client` / `Pool` がそのまま満たす。接続の作り方(プール・認証・TLS)は呼び側の仕事で、この口を作った側が持つ。
 * 要るのは「文と値を渡して行を受け取る」ことだけである。
 */
export interface PgQueryable {
  /**
   * 文を 1 回流す。
   *
   * @param text - パラメータ記法(`$1`)の SQL
   * @param values - パラメータの値
   * @returns 返った行
   */
  query(text: string, values: unknown[]): Promise<{ readonly rows: readonly Readonly<Record<string, unknown>>[] }>;
}

/**
 * RPC 1 本の署名のうち、直結で呼ぶのに要る部分。
 *
 * 生成物 `rpc-signatures` の 1 行の部分集合である(`as const` の読み取り専用の形をそのまま渡せる)。
 */
export interface PgSignature {
  /** 引数型の並び(pg_catalog の型名。例: `uuid` / `text[]` / `jsonb`)。 */
  readonly args: readonly string[];
  /** 引数名の並び(`args` と同じ順)。 */
  readonly params: readonly string[];
  /** 戻り値の形。`rows` = `setof` の行の列 / `document` = jsonb 1 つ / `scalar` = 行でも文書でもない単一の値(文書と同じく 1 列に畳んで読む)。 */
  readonly returns: 'rows' | 'scalar' | 'document';
}

/** RPC 名 → 署名(閉世界。ここに無い名前は呼べない)。 */
export type PgSignatures = Readonly<Record<string, PgSignature>>;

/** `createPgPorts` の入力。 */
export interface PgPortsOptions {
  /** 問い合わせの口(呼び側が接続を作って渡す)。 */
  readonly client: PgQueryable;
  /** RPC の署名の表。 */
  readonly signatures: PgSignatures;
  /** DB の不整合のメッセージ → 不変条件 ID(製品が渡す)。 */
  readonly invariantOfMessage: InvariantResolver;
  /** RPC とビューのあるスキーマ(既定は `api`)。 */
  readonly schema?: string;
}
