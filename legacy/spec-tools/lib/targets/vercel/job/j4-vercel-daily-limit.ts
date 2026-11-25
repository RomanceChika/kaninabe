/**
 * J4 Vercel Cron の頻度制約(Vercel の後段が登録する検査) — `scheduler: host` の cron 式は 1 日 1 回以下であること(いまのホストの後段 Vercel の制約)。
 *
 * 実測(2026-09-06): Vercel Hobby プランの Cron は "Hobby accounts are limited to daily
 * cron jobs" のメッセージでデプロイを拒否する。この制約を仕様の検査に持ち込み、
 * 「1 日に複数回叩きたいなら scheduler: host ではなく scheduler: database(pg_cron)を選ぶ」という設計判断を
 * カタログの宣言だけで機械が守れるようにする(job-spec-writing.md §scheduler)。
 *
 * **Pro プラン等に上げて頻度制約が緩んだら、この検査は緩める側に変える**
 * (job-spec-writing.md にその手順を書く。ここではプランを検出できないので固定で見る)。
 */

import type { Finding } from '../../../kernel/finding.js';
import type { JobSpecModel } from '../../../model/job/types.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'J4';

/** cron の分・時フィールドが「単一の固定値」であることを求める(範囲・刻み・列挙は不可)。 */
const SINGLE_VALUE = /^\d+$/;

/** J4 の指摘を組み立てる。 */
function j4Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * cron 式が 1 日に高々 1 回しか発火しないかを判定する。
 *
 * 標準 5 フィールド(分 時 日 月 曜日)のうち、**分・時の両方が単一の固定値**であることを
 * 求める。`*`・`,`・`-`・`/` のいずれかが分・時に混じっていれば「1 日に複数回」になりうるので
 * 拒否する(日・月・曜日のワイルドカードは日次の範囲内で発火日を絞るだけなので対象外)。
 *
 * @param cron 標準 5 フィールドの cron 式
 * @returns 1 日 1 回以下なら true。5 フィールドでない不正な形式は安全側(false)に倒す
 */
export function firesAtMostOncePerDay(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour] = fields;
  return SINGLE_VALUE.test(minute ?? '') && SINGLE_VALUE.test(hour ?? '');
}

/**
 * カタログの `scheduler: host` 行が、Vercel Hobby の頻度制約(1 日 1 回まで)に収まることを見る。
 *
 * @param jobs 読み込み済みのジョブカタログ
 * @returns 違反のリスト
 */
export function verifyVercelDailyLimit(jobs: JobSpecModel): Finding[] {
  const catalog = jobs.catalog;
  if (catalog === null) return [];

  const findings: Finding[] = [];
  for (const decl of catalog.jobs) {
    const schedule = decl.schedule;
    if (schedule?.scheduler !== 'host' || schedule.cron === undefined) continue;
    if (firesAtMostOncePerDay(schedule.cron)) continue;
    findings.push(
      j4Finding({
        message: `ジョブ ${decl.id}(scheduler: host)の schedule ${schedule.cron} は 1 日に複数回発火しうる cron 式です`,
        location: decl.location,
        suggestion:
          'Vercel Hobby プランの Cron は 1 日 1 回までしか登録できない。分・時を単一の固定値にするか' +
          '(例: "0 18 * * *")、高頻度が必要なら scheduler: database に変えて pg_cron + pg_net から叩く' +
          '(job-spec-writing.md §scheduler)。Pro プラン等に上げて制約が緩んだら、この検査自体を緩める',
        counterexample: { job: decl.id, schedule: schedule.cron },
      }),
    );
  }
  return findings;
}
