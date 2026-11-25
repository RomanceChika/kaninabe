/**
 * auth_spec の `idp_session`(IdP とアプリのセッションの関係)の読み取り。
 *
 * parse-auth.ts が呼ぶ下位の部品。責務は 1 ファイルの中で閉じる形に限る —— 必須であること・マッピングであること・書けるキー・
 * 3 欄(`logout` / `idp_ends` / `lifetime`)と理由が揃うこと・語が宣言できるものであること・
 * **語がいまの仕組みで支えられる主張であること**(書ける語でも、IdP のセッションを終える口や IdP の終了をアプリへ伝える口が
 * 無いので接地できない主張は error にする。書いたのに効いていない宣言を通さない)・理由が空でないこと。
 */

import type { SpecReporter } from '../parse-common.js';
import { asRecord } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { AuthIdpSessionDecl } from './idp-session.js';
import {
  IDP_ENDS_WORDS,
  IDP_LIFETIME_WORDS,
  IDP_LOGOUT_WORDS,
  SUPPORTED_IDP_ENDS,
  SUPPORTED_IDP_LIFETIME,
  SUPPORTED_IDP_LOGOUT,
} from './idp-session.js';

/** `idp_session` に書けるキー。 */
const IDP_KEYS: readonly string[] = ['logout', 'idp_ends', 'lifetime', 'reason'];

/** `idp_session` の書き方の案内。 */
const IDP_SUGGESTION =
  'idp_session は "logout / idp_ends / lifetime / reason" のマッピングで書く(アプリのログアウトが IdP のセッションにすること・' +
  'IdP のセッションが終わったとき / アカウントが失効したときのアプリのセッション・寿命の決め方・その関係でよい理由)。' +
  '書かないと、ログアウトしても IdP のセッションは残ること・IdP の側の失効がアプリに届かないことが文書にならない';

/** 語 1 つを読む(宣言できる語で、かつ支えられる主張のときだけ返す)。 */
function readWord<T extends string>(item: YamlReader, key: string, known: readonly T[], supported: readonly T[], what: string, reporter: SpecReporter): T | null {
  const suggestion = `${key} に${what}を書く(${known.join(' / ')}。いまの仕組みが支えられるのは ${supported.join(' / ')})`;
  const text = item.requiredString(key, suggestion);
  if (text === null) return null;
  const word = known.find((candidate) => candidate === text);
  if (word === undefined) {
    reporter.error(item.pointer(key), `idp_session.${key} ${text} は宣言できる語ではありません`, suggestion, { [key]: text });
    return null;
  }
  if (!supported.includes(word)) {
    reporter.error(
      item.pointer(key),
      `idp_session.${key} ${word} は、いまの仕組みでは接地できない主張です(IdP のセッションを終える口も、IdP の側の終了をアプリへ伝える口も、仕組みは持たない)`,
      `${key} は ${supported.join(' / ')} と書く。${word} を主張したいなら、先にその挙動を仕組みに入れる(書いたのに効いていない宣言は通さない)`,
      { [key]: word },
    );
    return null;
  }
  return word;
}

/**
 * `idp_session`(必須)を読む。読めなければ違反を記録して undefined(宣言を落としたものとして数える)。
 *
 * @param root 認証フロー仕様のルート
 * @param reporter 違反の記録先
 */
export function parseIdpSession(root: YamlReader, reporter: SpecReporter): AuthIdpSessionDecl | undefined {
  const drop = (): undefined => {
    reporter.dropRows();
    return undefined;
  };
  if (!root.has('idp_session')) {
    reporter.error(root.pointer('idp_session'), 'idp_session(IdP とアプリのセッションの関係)がありません', IDP_SUGGESTION);
    return drop();
  }
  const record = asRecord(root.raw('idp_session'));
  if (record === null) {
    reporter.error(root.pointer('idp_session'), 'idp_session はマッピングで書きます', IDP_SUGGESTION);
    return drop();
  }
  const item = new YamlReader(record, root.pointer('idp_session'), reporter);
  item.rejectUnknownKeys(IDP_KEYS, 'idp_session', `書けるのは ${IDP_KEYS.join(' / ')} だけ`);
  const logout = readWord(item, 'logout', IDP_LOGOUT_WORDS, SUPPORTED_IDP_LOGOUT, 'アプリのログアウトが IdP のセッションにすること', reporter);
  const idpEnds = readWord(item, 'idp_ends', IDP_ENDS_WORDS, SUPPORTED_IDP_ENDS, 'IdP のセッションが終わったとき / アカウントが失効したときのアプリのセッション', reporter);
  const lifetime = readWord(item, 'lifetime', IDP_LIFETIME_WORDS, SUPPORTED_IDP_LIFETIME, 'アプリのセッションの寿命の決め方', reporter);
  const reason = item.requiredString('reason', 'reason にこの関係でよい理由を書く');
  const blank = reason !== null && reason.trim() === '';
  if (blank) {
    reporter.error(item.pointer('reason'), 'idp_session.reason が空です', 'reason にこの関係でよい理由を書く(理由の無い関係は、IdP の側で起きたことがアプリに届かなくてよい理由を誰も確かめられない)');
  }
  if (logout === null || idpEnds === null || lifetime === null || reason === null || blank) return drop();
  return { logout, idpEnds, lifetime, reason, location: reporter.location('idp_session') };
}
