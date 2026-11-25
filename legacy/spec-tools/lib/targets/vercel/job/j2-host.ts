/**
 * **ホスト Vercel の J2 の全部**(Cron の登録の双方向の突合と、`vercel.json` の鍵の許可表)。verify(後段の検査の口 `target.ts`)と
 * ビルドの入口の関所(`cli/build-gate-routes.ts`)が**同じこの 1 本**を呼ぶ(関所だけ別の規則にしない。点検 16 回目 C16-3)。
 * 関所はドメインの仕様を読まないので、入力はドメインモデルを要らない形に絞る(どちらの検査もドメインモデルを使わない)。
 */

import type { Finding } from '../../../kernel/finding.js';
import type { JobCheckInput } from '../../../job/target-checks.js';
import { verifyHostConfig } from './j2-host-config.js';
import { verifyCronRegistration } from './j2-schedule-parity.js';

/**
 * ホストの J2 を回す。
 *
 * @param input ジョブカタログ・リポジトリルート・製品の根
 * @returns 違反のリスト(Cron の登録の突合 → ホストの設定の許可表の順)
 */
export function verifyHostJ2(input: Pick<JobCheckInput, 'jobs' | 'repoRoot' | 'roots'>): Finding[] {
  return [...verifyCronRegistration(input), ...verifyHostConfig(input)];
}
