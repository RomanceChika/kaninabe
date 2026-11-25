/**
 * 認証フロー仕様の本文のうち、セッションに関する節(セッションの寿命・同時セッション・IdP とのセッションの関係)。
 * `auth-body.ts` から分けた(300 行を超えないため)。読めなかった(H0 が言っている)宣言の節は出さない。
 */

import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { IDP_WORDS } from '../../model/auth/idp-session.js';
import { concurrentWords } from '../../model/auth/sessions.js';
import type { AuthFlowSpec } from '../../model/auth/types.js';

/**
 * セッションの寿命(`sessions`)。読めなかった(H0 が言っている)なら節ごと出さない。
 * プラットフォームの設定が同じ値であること(H5)の、人が読む側(ASVS の「寿命を理由つきで文書にする」はこの節が担う)。
 */
export function sessionsSection(flow: AuthFlowSpec): string | null {
  const sessions = flow.sessions;
  if (sessions === undefined) return null;
  return [
    '### セッションの寿命(設定が同じ値でないと H5 が止める)',
    '',
    markdownTable(
      ['寿命', '長さ', '測り始め'],
      [
        [cell('無操作の時間切れ'), cell(`\`${sessions.inactivity}\``), cell('最後にセッションを更新したとき')],
        [cell('絶対の寿命'), cell(`\`${sessions.absolute}\``), cell('サインインしたとき(更新トークンもここで使えなくなる)')],
      ],
    ),
    '',
    `理由: ${sessions.reason}`,
    '',
    `同時に持てるセッションの数: ${concurrentWords(sessions.concurrent)}。理由: ${sessions.concurrent.reason}`,
  ].join('\n');
}

/**
 * IdP とアプリのセッションの関係(`idp_session`)。読めなかった(H0 が言っている)なら節ごと出さない。
 * フレームワークが接地できる主張だけが書ける(H0)。IdP の側の実際の挙動はこの検査では見えない。
 */
export function idpSessionSection(flow: AuthFlowSpec): string | null {
  const idp = flow.idpSession;
  if (idp === undefined) return null;
  return [
    '### IdP とアプリのセッションの関係(書ける主張はいまの仕組みが支えられるものだけ — H0)',
    '',
    markdownTable(
      ['問い', '答え'],
      [
        [cell('アプリのログアウトは IdP のセッションをどうするか'), cell(IDP_WORDS[idp.logout])],
        [cell('IdP のセッションが終わったとき・アカウントが失効したとき'), cell(IDP_WORDS[idp.idpEnds])],
        [cell('寿命の揃え方'), cell(IDP_WORDS[idp.lifetime])],
      ],
    ),
    '',
    `理由: ${idp.reason}`,
  ].join('\n');
}
