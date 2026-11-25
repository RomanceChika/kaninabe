/**
 * **ホストの後段 Vercel**(`role: host`)。Cron の登録と、Vercel Cron の契約に属する検査・生成を持つ。
 *
 *   - J2(ホストの部分)… カタログの `schedule` と、実装の木の直下の `vercel.json` の `crons` の双方向一致(`job/j2-schedule-parity.ts`)と、
 *     同じファイルの鍵の許可表(転送・ヘッダ・URL の形の欄を拒み、Git 連携の自動デプロイを全ブランチで止める形に固定する。`job/j2-host-config.ts`。8 回目 C8-1・C8-3)
 *   - J4 … `scheduler: host` の cron 式が 1 日 1 回以下(Vercel Hobby の頻度制約。`job/j4-vercel-daily-limit.ts`)
 *   - 生成器 … 時刻起点のジョブの起動口が `Authorization: Bearer {CRON_SECRET}` の認可で閉じていることの見張りテスト
 *     (`generate/code-cron-route-tests.ts`。Vercel Cron が秘密を運ぶ形)
 *
 *   - 未検証の名指し … IP 単位の流量制限(本番の WAF は仕様から見えない。未ログインの作成か有料の口があるとき、毎回「未検証」と名指す。`ip-rate-limit.ts`)
 *
 * ルール ID(J2 / J4)・検査の中身・指摘の文面は、後段へ移す前と同じである(執行者の置き場が動いただけ)。
 * この値を選んで検査と生成器の一覧に合成するのは組み立ての根(`cli/select-targets.ts`)だけで、コアはこの後段の名前を知らない。
 * ホストを別のものに替える日は、この置き場と同じ形(役割 `host`・同じ口の ID)の後段を足して選び直す。
 */

import type { Target } from '../../target-api/contract.js';
import { cronRouteTestsGenerator } from './generate/code-cron-route-tests.js';
import { verifyHostJ2 } from './job/j2-host.js';
import { IP_RATE_LIMIT_UNVERIFIED } from './ip-rate-limit.js';
import { verifyVercelDailyLimit } from './job/j4-vercel-daily-limit.js';

/** Vercel(ホスト)の後段。 */
export const VERCEL_TARGET: Target = {
  id: 'vercel',
  role: 'host',
  verifiers: [
    { group: 'job', id: 'J2', verify: verifyHostJ2 },
    { group: 'job', id: 'J4', verify: (input) => verifyVercelDailyLimit(input.jobs) },
  ],
  generators: [cronRouteTestsGenerator],
  unverified: [IP_RATE_LIMIT_UNVERIFIED],
};
