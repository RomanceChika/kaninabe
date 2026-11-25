/**
 * H5 サインインの方式と公開スキーマの突合(認証フロー仕様の宣言 ⇔ プラットフォームのローカル設定)の**契約**。
 *
 * ## 何を守るのか
 *
 * 「宣言に無い口が、設定で開いたまま出荷される」ことを仕組みで止める。認証・API 層(プラットフォーム)の設定は仕様の外にあり、
 * 既定のまま / 手で触ったまま、使っていない方式や使っていない公開スキーマが開いていても、仕様のどの検査にも当たらなかった。
 * **設定は宣言の許す範囲を超えて開けない**という閉世界にする:
 *
 *   - 開いているサインインの方式は、認証フロー仕様の `providers`(と、ローカルでだけ開けてよい方式の `local_only`)に載っているもの**だけ**
 *   - 外へ出すスキーマは、プラットフォームの設定 `PlatformProfile.exposedSchema` の 1 つ**だけ**
 *   - セッションの寿命(無操作の時間切れ・絶対の寿命)は、認証フロー仕様の `sessions` と**同じ値**(書いていなければ、セッションが時間で終わらない
 *     既定のまま出荷される。更新トークンが期限を持たない設定も、宣言した絶対の寿命を破るので止める)
 *   - 多要素認証を要求するなら、設定で要素が 1 つ以上有効(どれも無効だと、多要素認証を済ませたセッションを誰も作れない)
 *   - 戻り先の許可リストは、宣言した OAuth の帰り道(`callback.endpoint`)**だけ**(server-only-session.md §3-3)
 *
 * ## なぜ後段が受け持つのか
 *
 * 設定ファイルの名前・書式・方式の綴りは、プラットフォームごとに違う(具体のスタックの語)。コアが持つのは**この契約と ID だけ**で、
 * 設定を読んで宣言と突き合わせる本体は、プラットフォームの後段が `Target.authConfig` として登録する。後段が登録しない構成では、
 * 実行ログが H5 の**未実施**を名指す(黙って緑にしない)。設定ファイルが無い製品も、未実施である(緑にしない)。
 *
 * 純粋な型と定数と、登録された検査を呼ぶ小さな関数だけ。**アプリの語彙も、具体のスタックの語も 1 語も持たない。**
 */

import type { Finding } from '../kernel/finding.js';
import type { LocalOnlyDecl } from '../model/auth/types.js';
import type { AuthSessionsDecl } from '../model/auth/sessions.js';
import type { AuthMfaDecl } from '../model/auth/mfa.js';
import type { ProductRoots } from '../model/product/types.js';

/** この検査の ID(認証フロー仕様の群。受け持つのはプラットフォームの後段)。 */
export const H5_ID = 'H5';

/** H5 の題(全検査の表と実行ログが使う)。 */
export const H5_TITLE = 'サインインの方式・公開スキーマ・セッションの寿命・戻り先の許可リストの突合(プラットフォームの設定 ⇔ 認証フロー仕様の宣言。後段が登録する)';

/** 後段が無いときに見ていないこと(文末。句点は付けない)。 */
export const H5_UNSEEN = '開いているサインインの方式と外へ出すスキーマと戻り先の許可リストが宣言の範囲に収まっているか、セッションの寿命が宣言と同じかの突合';

/** 検査 1 回が受け取る入力(リポジトリルートは I/O のため呼び出し側が渡す)。 */
export interface AuthConfigInput {
  /** 認証フロー仕様が宣言した、受け入れるサインインの方式(`providers`)。 */
  readonly providers: readonly string[];
  /** ローカルの設定でだけ開けてよい方式と理由(`local_only`。本番では開けない。ローカルの設定の突合は `providers` ∪ これに対して行う)。 */
  readonly localOnly: readonly LocalOnlyDecl[];
  /** 宣言した OAuth の帰り道のパス(`callback.endpoint`)。戻り先の許可リストはこれだけを指す。宣言が無ければ書かない(後段は戻り先の突合を未実施と名指す)。 */
  readonly callback?: string;
  /** 認証フロー仕様が宣言したセッションの寿命(`sessions`)。読めなかったなら undefined(H0 が言っている)で、寿命の突合は出さない。 */
  readonly sessions?: AuthSessionsDecl;
  /** 認証フロー仕様が宣言した多要素認証(`mfa`)。要求するなら、設定で要素を有効にしているかを見る。読めなかったなら undefined。 */
  readonly mfa?: AuthMfaDecl;
  /** リポジトリルートの絶対パス(設定ファイルの実在確認に使う)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(設定ファイルの置き場は migration の置き場から決まる)。 */
  readonly roots: ProductRoots;
}

/**
 * 検査の結果。設定ファイルを読めたか(読めなければ未実施として報告する。緑にしない)。
 * `skipped` は読めたが見なかった部分とその理由(認証やデータ API を動かさない設定など。文末の句点は付けない)。実行ログが未実施として名指す。
 */
export type AuthConfigOutcome =
  | { readonly status: 'checked'; readonly file: string; readonly findings: readonly Finding[]; readonly skipped: readonly string[] }
  | { readonly status: 'absent'; readonly file: string };

/** プラットフォームの後段が登録する H5 の本体。純粋な関数で、例外で違反を報告しない(規約)。 */
export interface AuthConfigVerifier {
  /** ルール ID(`H5_ID` と一致させる)。 */
  readonly id: typeof H5_ID;
  /** 設定を読んで宣言と突き合わせる。 */
  verify(input: AuthConfigInput): AuthConfigOutcome;
}

/** 本番の設定は検査できないので、実行ログが毎回名指す宣言(ローカル専用の方式・セッションの寿命)。 */
interface UnverifiedInProduction {
  /** 宣言したローカル専用の方式(空でなければ「本番で閉じているかは未検証」と名指す)。 */
  readonly localOnly: readonly LocalOnlyDecl[];
  /** 宣言したセッションの寿命(あれば「本番の寿命は未検証」と名指す)。 */
  readonly sessions?: AuthSessionsDecl;
  /** 宣言した多要素認証(要求するなら「本番の多要素認証の要素は未検証」と名指す)。 */
  readonly mfa?: AuthMfaDecl;
}

/**
 * H5 の実行の状態(実行ログの行を決める)。本番の設定は検査できないので、宣言したローカル専用の方式とセッションの寿命は毎回名指す。
 * `no_declaration` = 認証フロー仕様が無い / 読めないので突き合わせる相手が無い。
 */
export type AuthConfigRun =
  | ({ readonly state: 'checked'; readonly file: string; readonly skipped: readonly string[] } & UnverifiedInProduction)
  | ({ readonly state: 'absent'; readonly file: string } & UnverifiedInProduction)
  | ({ readonly state: 'unregistered' } & UnverifiedInProduction)
  | { readonly state: 'no_declaration'; readonly cause: 'absent' | 'unreadable' };

/**
 * 登録された H5 を実行する(登録が無ければ何も見ず `unregistered`)。
 *
 * @param verifier プラットフォームの後段が登録した検査(無ければ null)
 * @param input 検査の入力
 * @returns 違反と実行の状態
 */
export function runAuthConfig(verifier: AuthConfigVerifier | null | undefined, input: AuthConfigInput): { readonly findings: readonly Finding[]; readonly run: AuthConfigRun } {
  const unverified: UnverifiedInProduction = {
    localOnly: input.localOnly,
    ...(input.sessions === undefined ? {} : { sessions: input.sessions }),
    ...(input.mfa === undefined ? {} : { mfa: input.mfa }),
  };
  if (verifier === null || verifier === undefined) return { findings: [], run: { state: 'unregistered', ...unverified } };
  const outcome = verifier.verify(input);
  if (outcome.status === 'absent') return { findings: [], run: { state: 'absent', file: outcome.file, ...unverified } };
  return { findings: outcome.findings, run: { state: 'checked', file: outcome.file, skipped: outcome.skipped, ...unverified } };
}
