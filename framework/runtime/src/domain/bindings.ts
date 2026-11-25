/**
 * **製品が渡す宣言の束**(`RuntimeBindings`)。
 *
 * 実行時パッケージは「軸」だけを持ち、「語」は持たない —— ロール ID・状態名・制約名はその製品の
 * 事情であり、仕様から生成される。仕組み側がそれを**直接 import すると、パッケージが利用側の木を
 * 読む逆向きの依存**になって依存として成立しなくなる(設計メモ `docs/design/runtime-package.md`
 * §1-2)。だから**製品が渡す**。
 *
 * **口は 1 つに束ねる。** 渡すものが増えても配線の手数が増えないためであり、足し忘れは型で出る。
 * 束の実体は製品の生成物(`{生成物の置き場}/runtime-bindings.ts`)であり、手で書く場所は無い。
 */

import type { RoleTables } from '../operation/_template/actor-roles';

export type { RoleTables } from '../operation/_template/actor-roles';

/**
 * セッション(`app_metadata.profile`)に載る欄。
 *
 * **欄の名前と型は製品が決める**(`entity_spec` の `session: true` から生成される)。仕組み側が
 * 要るのは「名前で 1 つ引ける」ことだけなので、閉じた形ではなく引ける形で受ける ——
 * 製品の生成物はこの形を満たす型として書き出される(`interface` ではなく型の別名にするのは、
 * TypeScript が暗黙の添字シグネチャを型の別名にだけ与えるためである)。
 */
export type SessionClaims = Readonly<Record<string, string | number | boolean | null>>;

/**
 * DB が上げた不整合のメッセージから不変条件 ID を引く口。
 *
 * 制約の名前と不変条件 ID の対応はその製品の事情(`invariant` を宣言する CHECK / 一意制約の
 * 名前から生成される)。仕組み側が要るのは「引ける」ことだけである。
 */
export type InvariantResolver = (haystack: string) => string | undefined;

/**
 * **多要素認証の要求**(認証フロー仕様の `mfa` の写し。auth-spec-writing.md §mfa)。
 *
 * - `all` … サインインした全員に要求する
 * - `roles` … 宣言したロールが立つ実行者にだけ要求する(ロール ID は仕様の語で、製品の生成物が渡す)
 *
 * 書き込みの入口(実行器)が、判断と書き込みの前に見る。何を「多要素認証を済ませたセッション」とするか
 * (Supabase なら JWT の `aal` が `aal2`)は認証基盤の後段が決め、ここは真偽だけを受ける。
 */
export type MfaRequirement =
  | { readonly scope: 'all' }
  | { readonly scope: 'roles'; readonly roles: readonly string[] };

/** 製品が渡す宣言の束。 */
export interface RuntimeBindings {
  /**
   * ロール解決の表(`role_spec` の `kind` と `implies` の写像)。
   *
   * 未ログイン / 認証ユーザーの既定 / システムの 3 スロットに入る**ロール ID**と、`implies` の
   * 含意表である。軸(3 スロットと閉包の規則)は仕組みが決め、値はその製品が決める。
   */
  readonly roleTables: RoleTables;
  /**
   * DB の不整合のメッセージ → 不変条件 ID。
   *
   * 定型 RPC の呼び出し口(adapter。`@kaninabe/adapter-postgrest`)が、`invariant_violated` の拒否に ID を載せるために
   * 通す。対応表は製品の生成物が持つ。
   */
  readonly invariantOfMessage: InvariantResolver;
  /**
   * 多要素認証の要求(`MfaRequirement`)。**生成物は認証フロー仕様が要求を宣言したときだけ書く** ——
   * 外す宣言(`mfa: { exempt: 理由 }`。verify が毎回「受け入れた危険」として名指す)の製品と、認証フロー仕様を
   * 持たない製品では欄が無く、実行器は要求を見ない。束は生成物だけが作る(手で書く場所は無い)ので、
   * 欄の有無は仕様の宣言の写しである。
   */
  readonly mfa?: MfaRequirement;
}
