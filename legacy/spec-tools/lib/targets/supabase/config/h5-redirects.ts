/**
 * H5 の部品 — **戻り先の許可リスト**(`[auth] site_url` と `[auth] additional_redirect_urls`)を、認証フロー仕様の帰り道(`callback.endpoint`)に突き合わせる。
 * 綴りは Supabase のもの(後段の置き場の中だけ)。
 *
 * ## 何を守るのか(server-only-session.md §3-3)
 *
 * セッションの cookie をスクリプトから読めなくしても、攻撃者のスクリプトは**自分で新しいサインインを始められる**。自分で作った PKCE の検証子で認可を始め、
 * 戻り先の URL に付いた認可コードを同じオリジンのスクリプトが読めれば、自分の検証子で交換して新しいトークンを手に入れる(RFC 10017 §5.1.3)。
 * 帰り道の口は画面を描かずすぐ転送するので、コードの付いた URL のまま文書が開くことは無い。危ないのは、**許可リストに無い戻り先が `site_url` に
 * 置き換わる**場合と、**ワイルドカードで描かれた画面が戻り先に入る**場合である(`/?code=…` が描かれた画面として開く)。
 *
 * だから設定は閉世界にする: `site_url` も `additional_redirect_urls` の各値も、**パスが宣言した帰り道に一致する http(s) の絶対 URL** で、
 * グロブの文字(`*` `?` `[` `]` `{` `}`)・クエリ・フラグメント・利用者の情報を含まない。オリジンは問わない(開発のポートや HTTPS の開発サーバーを並べてよい)。
 *
 * `site_url` が書かれていなければ Supabase の既定(`http://127.0.0.1:3000` = トップの画面)で読む。`additional_redirect_urls` が書かれていなければ空。
 * 帰り道の宣言が無い製品では見ない(未実施として名指す)。**本番の管理画面の設定は見えない**ので、見た範囲でも毎回それを未実施として名指す。
 */

import type { Finding } from '../../../kernel/finding.js';
import type { TomlValue } from './config-toml.js';
import { h5Finding, valueOf } from './h5-doors.js';
import type { Scope, ScopeResult } from './h5-doors.js';

/** `site_url` が書かれていないときの Supabase の既定(トップの画面)。 */
export const DEFAULT_SITE_URL = 'http://127.0.0.1:3000';

/** 許可リストのグロブに使われる文字(どれも、1 本の URL に絞れない書き方)。 */
const GLOB_CHARS = /[*?[\]{}]/;

/**
 * 戻り先 1 本が帰り道だけを指しているか。指していなければ理由を返す。
 *
 * @param url - 設定に書かれた戻り先
 * @param callback - 宣言した帰り道のパス
 * @returns 問題の言葉(問題が無ければ null)
 */
export function redirectProblem(url: string, callback: string): string | null {
  if (GLOB_CHARS.test(url)) return 'ワイルドカード(グロブの文字 * ? [ ] { })を含んでいます';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '絶対 URL として読めません';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `http(s) ではありません(${parsed.protocol})`;
  if (parsed.username !== '' || parsed.password !== '') return '利用者の情報(user:pass@)を含んでいます';
  if (parsed.hash !== '' || url.includes('#')) return 'フラグメント(#)を含んでいます';
  if (trimSlash(parsed.pathname) !== trimSlash(callback)) return `パスが帰り道 ${callback} ではありません(${parsed.pathname})`;
  return null;
}

/** 末尾の `/` を落とす(根の `/` は残す)。 */
function trimSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** 位置の言い方(`[auth] site_url`。deploy 先は `[remotes.{名}.auth] site_url`)。 */
function whereOf(scope: Scope, key: string): string {
  return `[${scope.remote === null ? '' : `remotes.${scope.remote}.`}auth] ${key}`;
}

/** 範囲が、このキーを見るべきか(ローカルは全部。deploy 先は自分で書いたものだけ — 基の設定の指摘と重ねない)。 */
function watches(scope: Scope, key: string): boolean {
  return scope.written === null || scope.written.has(`auth\0${key}`);
}

/** 読めない値の指摘。 */
function unreadableFinding(scope: Scope, key: string, shape: string): Finding {
  const where = whereOf(scope, key);
  return h5Finding(scope.file, where.replace('] ', '].'), {
    message: `${scope.file} の ${where} を読めません(${shape}ではありません)`,
    suggestion: `${where} は${shape}で書く(読めない値は、戻り先が帰り道だけかを検査できない)`,
    counterexample: { setting: where },
  });
}

/** 戻り先 1 本の指摘。 */
function redirectFinding(scope: Scope, key: string, url: string, problem: string, callback: string, defaulted: boolean): Finding {
  const where = whereOf(scope, key);
  const how = defaulted ? `書かれておらず、既定の ${url} で読みます` : `${url} が書かれています`;
  return h5Finding(scope.file, where.replace('] ', '].'), {
    message:
      `${scope.file} の ${where} は${how}が、${problem}。戻り先の許可リストは帰り道 ${callback} だけを指してください —— ` +
      '許可リストに無い戻り先は site_url に置き換わり、描かれた画面に認可コードが着くと、同じオリジンのスクリプトがそれを読んで自分の検証子で交換できます',
    suggestion:
      `${where} を帰り道の絶対 URL(例: http://127.0.0.1:3000${callback})にする。ワイルドカード・クエリ・フラグメントは書かない。` +
      '本番の管理画面(URL Configuration の Site URL と Redirect URLs)にも同じ値を揃える(この検査が見るのは設定ファイルだけ)',
    counterexample: { setting: where, url, callback },
  });
}

/** 戻り先の並びを取り出す(読めなければ null)。 */
function urlList(value: TomlValue | undefined): readonly string[] | null {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value as readonly string[];
  return null;
}

/**
 * 1 つの範囲の戻り先の許可リストを、帰り道に突き合わせる。
 *
 * @param scope - 突合の範囲
 * @param callback - 宣言した帰り道のパス(宣言が無ければ undefined = 見ない)
 * @returns 違反と、見なかった理由
 */
export function redirectResult(scope: Scope, callback: string | undefined): ScopeResult {
  const { doc } = scope;
  // 認証を動かさない設定はサインインの方式の突合が「見ていない」と名指す(重ねない)。
  if (valueOf(doc, 'auth', 'enabled') === false) return { findings: [], skipped: [] };
  if (callback === undefined) {
    return { findings: [], skipped: scope.remote === null ? ['認証フロー仕様に帰り道(callback)の宣言が無いため、戻り先の許可リスト(site_url / additional_redirect_urls)の突合は見ていません'] : [] };
  }
  const findings: Finding[] = [];
  if (watches(scope, 'site_url')) {
    const written = valueOf(doc, 'auth', 'site_url');
    if (written !== undefined && typeof written !== 'string') findings.push(unreadableFinding(scope, 'site_url', '文字列'));
    else {
      const url = written ?? DEFAULT_SITE_URL;
      const problem = redirectProblem(url, callback);
      if (problem !== null) findings.push(redirectFinding(scope, 'site_url', url, problem, callback, written === undefined));
    }
  }
  if (watches(scope, 'additional_redirect_urls')) {
    const urls = urlList(valueOf(doc, 'auth', 'additional_redirect_urls'));
    if (urls === null) findings.push(unreadableFinding(scope, 'additional_redirect_urls', '文字列の配列'));
    for (const url of urls ?? []) {
      const problem = redirectProblem(url, callback);
      if (problem !== null) findings.push(redirectFinding(scope, 'additional_redirect_urls', url, problem, callback, false));
    }
  }
  const skipped = scope.remote === null ? ['本番の戻り先の許可リスト(管理画面の Site URL と Redirect URLs)は見ていません(この検査が読むのはローカルの設定ファイルだけ)'] : [];
  return { findings, skipped };
}
