/**
 * ホストの未検証の名指し: **IP 単位の流量制限**(R5 の続き。設計 r5-abuse-freeze.md §1・§4-D)。
 *
 * 未ログインに開いた作成と有料の口は、DB の全体の天井・回数の枠(R5)で行数と費用の上限を持てるが、**同じ接続元からの連打を抑える**のはホストの仕事で、
 * 仕様にもアプリの実装にも書けない。Vercel の WAF のレート制限は `vercel.json` に書けず、ダッシュボード・`@vercel/firewall` の SDK・CLI / REST API で設定する
 * (Pro / Enterprise の機能。カウンターはリージョンごと)。本番の設定はフレームワークから見えないので、検査せず**毎回「未検証」と名指す**
 * (error でも warning でもない。H5 が本番の設定を毎回名指すのと同じ語)。濫用の口が製品に無ければ、流量制限を掛ける相手が無いので名指さない。
 */

import { hasAbuseExposure, type AbuseExposure } from '../../model/external/abuse-exposure.js';
import type { TargetUnverified } from '../../job/target-unverified.js';

/** 濫用の口の言い方(「未ログインの作成: a・b / 有料の口: c」)。 */
function exposureWords(exposure: AbuseExposure): string {
  const parts = [
    exposure.anonymousCreates.length === 0 ? null : `未ログインが作成できる集約: ${exposure.anonymousCreates.join('・')}`,
    exposure.paidEndpoints.length === 0 ? null : `有料の口を持つ連携: ${exposure.paidEndpoints.join('・')}`,
  ];
  return parts.filter((part): part is string => part !== null).join(' / ');
}

/** IP 単位の流量制限の未検証の名指し(ホストの後段が登録する)。 */
export const IP_RATE_LIMIT_UNVERIFIED: TargetUnverified = {
  id: 'ip-rate-limit',
  note: (exposure) =>
    hasAbuseExposure(exposure)
      ? `IP 単位の流量制限(同じ接続元からの連打を抑える設定)はフレームワークから見えず、未検証です(${exposureWords(exposure)})。` +
        'Vercel の WAF のレート制限は vercel.json には書けず、ダッシュボード(Firewall)・@vercel/firewall の SDK・CLI / REST API で設定します' +
        '(Pro / Enterprise の機能で、カウンターはリージョンごと)。全体の天井(DB)と回数の枠は接続元ごとの制限の代わりにはなりません。本番で設定の有無を確かめてください'
      : null,
};
