import type { Retried } from './rollback-retry';

/**
 * **接続層の読み取りだけの型**(`ReadOnlyClient`。差分点検 fix26 13 回目 D26m-1)。RPC と表の書き込みの道を型の上から外す、この形の唯一の持ち主。
 *
 * RPC を呼ぶ道は `retryRollbacks` が返す型の印つきの `RpcSource`、表の書き込みの道は `retryTableWrites` が返す
 * `TableWriteSource` だけである(`rollback-retry.ts`)。接続層そのものを持ち回る型がそれらを出していると、生の `client.rpc` や
 * `client.from(表).insert(…)` がやり直しの口を素通りして書ける。だから接続層を返す部品(セッションの adapter の `createSessionClient`)と
 * 製品の接続層の型は、どちらもこの型で持ち回る:
 *
 * - `rpc` を出さない(RPC は `RpcSource` からだけ)
 * - `from` は読み取り(`select`)だけを返す(`insert` / `update` / `upsert` / `delete` は `TableWriteSource` からだけ)
 * - `schema` を出さない(`schema(…)` が返す接続層は `rpc` と書き込みを持つので、出すと上の 2 つを素通りできる)
 *
 * **ベンダーの型は持たない**(この adapter は `@supabase/**` に依存しない。TC-FW-CLOSURE-002)。接続層の型 `Client` と、表の名前ごとの
 * 問い合わせの組み立ての型 `Builders`(表名 → その表の `from(表)` が返す型)は、接続層を作る側(セッションの adapter)が具体の型で渡す。
 * ここが持つのは「何を外し、`from` に何を残すか」の規則だけである。
 *
 * 型の絞りは `as` で外せる(実行時の値は同じクライアント)。外してよい場所は、やり直しの口へ実クライアントを渡す製品の接続層の適合 1 か所と、
 * 関数の本文を 1 回だけ確かめる試験の口だけである。
 *
 * @typeParam Client - 接続層の型
 * @typeParam Builders - 表名 → その表の問い合わせの組み立ての型
 */
export type ReadOnlyClient<Client, Builders extends Readonly<Record<string, { readonly select: unknown }>>> = Omit<Client, 'rpc' | 'schema' | 'from'> & {
  /** 表を読む(読み取りの `select` だけを返す)。 */
  from<N extends string & keyof Builders>(relation: N): Pick<Builders[N], 'select'>;
};

/** PostgREST の問い合わせの組み立ての、表を書き換えるメソッド(`from(表)` がこれと `select` を持てば、表の書き込みの生の道)。 */
type TableWriteMethod = 'insert' | 'update' | 'upsert' | 'delete';

/**
 * **何が生の道か**の規則(fix27 項目 C。差分点検 fix26 14 回目 E14-1)。この規則の唯一の持ち主で、型の欄の値がそのまま規則のデータである。
 * 照らし(`../../testing/closed-surface.mts`)が、型検査器で adapter の公開の口の全部(全部の多重定義の引数と戻り値・`Promise` は解く・
 * 構築子・欄・添字)をたどり、たどった先の各型をこの規則に掛ける。生の道は次のとおり:
 *
 * - {@link RawPathRule.callables} の名前の欄(関数)を持つのに、やり直しの口の型の印 {@link RawPathRule.except}(`Retried`。`RpcSource`・
 *   `TableWriteSource`・`HandwrittenRpc` が持つ)が無い。`rpc` は RPC の生の道、`schema` は `rpc` と書き込みを持つ接続層を返す道。
 *   設定の `db: { schema: '名前' }` の文字列は関数でないので数えない
 * - {@link RawPathRule.opener} の欄の関数の、**どれか 1 本の多重定義**が返すものが {@link RawPathRule.reads} と
 *   {@link RawPathRule.writes} のどれかを両方持つ(PostgREST の問い合わせの組み立て。`select` を持たないストレージの
 *   `from(バケツ)` は表の書き込みではない)
 * - 口が**渡す** `any`(型の検査を外した値)が、口から {@link RawPathRule.anyOutWithin} 段までにある(受け取る `any` は何も渡さない
 *   ので数えない。標準の型の奥の `any`(`Response.json()` など)は口の約束ではない)。それより深い段の渡す `any` も、照らしは
 *   「読み切れない」として赤にする(表の明示の行だけが受ける。fix27 差分点検 C27-2)
 *
 * **ベンダーの型は持たない**。照らしの深さの上限より深くに続く型は、生の道でないと言い切れないので赤である(表の明示の行だけが受ける)。
 */
export interface RawPathRule {
  /** 持てば生の道になる関数の欄の名前。 */
  readonly callables: 'rpc' | 'schema';
  /** 問い合わせの組み立てを返す関数の欄の名前。 */
  readonly opener: 'from';
  /** 組み立ての読み取りのメソッド。 */
  readonly reads: 'select';
  /** 組み立ての書き換えのメソッド。 */
  readonly writes: TableWriteMethod;
  /** 例外: やり直しの口を通った型の印(これを持つ型そのものは生の道でない。欄はたどる)。 */
  readonly except: Retried;
  /** 口が渡す `any` を数える深さ(0 = 口そのもの・1 = その直下の戻り値と欄)。 */
  readonly anyOutWithin: 1;
}
