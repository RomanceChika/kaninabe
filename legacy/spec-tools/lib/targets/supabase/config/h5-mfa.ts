/**
 * H5 の部品 — 認証フロー仕様が多要素認証を要求する(`mfa` が外す宣言でない)なら、1 つの範囲(ローカルの設定そのもの / deploy 先ごとの
 * 有効な設定)で、認証基盤の多要素認証の要素が 1 つ以上**登録も確認も**できる設定であることを見る。綴りは Supabase のもの(後段の置き場の中だけ)。
 *
 * Supabase の要素は TOTP(`[auth.mfa.totp]`)・電話(`[auth.mfa.phone]`)・WebAuthn(`[auth.mfa.web_authn]`)で、どれも
 * `enroll_enabled` / `verify_enabled` の既定は false である(CLI の設定の既定)。どれも有効でなければ、多要素認証を済ませたセッション
 * (`aal2`)を誰も作れず、要求した画面に誰も入れない —— 要求の宣言が設定で黙って無効になるので止める。
 *
 * deploy 先は基の設定を引き継ぐので、deploy 先が `auth.mfa.*` のキーを自分で書いたときだけ見る(引き継いだ値の指摘は基の設定の指摘と重なる)。
 */

import type { Finding } from '../../../kernel/finding.js';
import type { AuthMfaDecl } from '../../../model/auth/mfa.js';
import { h5Finding, valueOf } from './h5-doors.js';
import type { Scope, ScopeResult } from './h5-doors.js';

/** 多要素認証の要素のセクション(Supabase の綴り)。 */
const FACTOR_SECTIONS: readonly string[] = ['auth.mfa.totp', 'auth.mfa.phone', 'auth.mfa.web_authn'];

/** 要素 1 つの 2 つのスイッチ。 */
const SWITCHES: readonly string[] = ['enroll_enabled', 'verify_enabled'];

/** 位置の言い方。deploy 先は `[remotes.{名}.…]`。 */
function sectionWords(scope: Scope, section: string): string {
  return `[${scope.remote === null ? '' : `remotes.${scope.remote}.`}${section}]`;
}

/**
 * 多要素認証の要素の設定の突合。
 *
 * @param scope 突合の範囲
 * @param mfa 宣言した多要素認証(読めなかった・外す宣言なら何も見ない)
 */
export function mfaResult(scope: Scope, mfa: AuthMfaDecl | undefined): ScopeResult {
  if (mfa?.kind !== 'require' || valueOf(scope.doc, 'auth', 'enabled') === false) return { findings: [], skipped: [] };
  const wrote = scope.written === null || FACTOR_SECTIONS.some((section) => SWITCHES.some((key) => scope.written?.has(`${section}\0${key}`) === true));
  if (!wrote) return { findings: [], skipped: [] };
  const findings: Finding[] = [];
  let usable = false;
  for (const section of FACTOR_SECTIONS) {
    const values = SWITCHES.map((key) => valueOf(scope.doc, section, key));
    const unreadable = SWITCHES.filter((_, index) => values[index] !== undefined && typeof values[index] !== 'boolean');
    for (const key of unreadable) {
      findings.push(h5Finding(scope.file, `${sectionWords(scope, section)}.${key}`, { message: `${scope.file} の ${sectionWords(scope, section)} ${key} を読めません(真偽値ではありません)`, suggestion: `${key} は true か false で書く`, counterexample: { setting: `${section}.${key}` } }));
    }
    if (values.every((value) => value === true)) usable = true;
  }
  if (usable || findings.length > 0) return { findings, skipped: [] };
  findings.push(
    h5Finding(scope.file, sectionWords(scope, 'auth.mfa'), {
      message:
        `${scope.file} は多要素認証の要素(${FACTOR_SECTIONS.map((section) => sectionWords(scope, section)).join(' / ')})がどれも登録と確認の両方を有効にしていません(既定はどれも無効)が、` +
        `認証フロー仕様の mfa は多要素認証を要求しています。多要素認証を済ませたセッションを誰も作れず、要求した画面に誰も入れません`,
      suggestion: `使う要素(例: ${sectionWords(scope, 'auth.mfa.totp')})に enroll_enabled = true と verify_enabled = true を書く。本番の設定(管理画面)にも同じ要素を有効にする。外すなら認証フロー仕様の mfa に exempt と理由を書く`,
      counterexample: { mfa: 'require', factors: FACTOR_SECTIONS.join(',') },
    }),
  );
  return { findings, skipped: [] };
}
