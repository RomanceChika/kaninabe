/**
 * J2 のホストの後段の部分 — `schedule`(cron 式)と Cron の登録(実装の木の直下の `vercel.json` の `crons`)の**双方向一致**。
 *
 * 「どの口が何分おきに叩かれるか」は今までデプロイ設定の中にしか無く、仕様のどこにも現れない暗黙の挙動だった。
 * 片方だけ足すと落ちる(job-spec-writing.md の要求)。対象は `scheduler: host` の行だけ —— `scheduler: database` の行は
 * Vercel Cron に登録しない(J3 が `supabase/migrations` の `cron.schedule` との突合を別に担う)。
 *
 * 実装・Route Handler・fires・due_from の接地はコアの部分(`lib/job/verifiers/j2-schedule-grounding.ts`)が見る。
 * **登録の突合は `app/` が実在する環境でだけ見る**(逆向きだけが黙って飛び、順向きだけが鳴る非対称を作らない)。
 * 一致の単位は (口, cron 式) の組である。口だけ合っていて間隔が違う状態を通すと、「10 分おきに動く」と読める仕様のまま
 * 日次で回る、が黙って成立する。
 */

import path from 'node:path';
import { appGrounded, isFile } from '../../../io/paths.js';
import { tryReadText } from '../../../io/read-text.js';
import type { Finding } from '../../../kernel/finding.js';
import type { JobCheckInput } from '../../../job/target-checks.js';
import type { JobDecl } from '../../../model/job/types.js';
import { appPath, joinPath, specPath } from '../../../model/product/paths.js';
import type { ProductRoots } from '../../../model/product/types.js';

/** この検証器の ID(コアの接地と同じ J2)。 */
const VERIFIER_ID = 'J2';

/**
 * Cron の登録が住んでいる場所(リポジトリルート相対)。
 *
 * ファイル名は仕組みが決めている形(Vercel の規約)で、**その上の実装の木の位置だけが製品の宣言
 * から来る**。実装の木を持たない製品では登録の置き場も無いので null。
 */
export function cronConfigFile(roots: ProductRoots): string | null {
  const root = appPath(roots);
  return root === null ? null : joinPath(root, CRON_CONFIG_FILE_NAME);
}

/** Cron の登録ファイルの名前(Vercel の規約。実装の木の直下に置く)。 */
export const CRON_CONFIG_FILE_NAME = 'vercel.json';

/** J2 の指摘を組み立てる。 */
/** Cron の登録(ホストの設定ファイル = 実装の木)との突合の指摘。生成を止めない(`grounding: 'implementation'`)。 */
function j2Finding(args: Omit<Finding, 'verifier' | 'severity' | 'grounding'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args, grounding: 'implementation' };
}

/** Cron の登録 1 件。 */
export interface CronEntry {
  readonly path: string;
  readonly schedule: string;
}

/**
 * Cron の登録(実装の木の直下の `vercel.json` の `crons`)を読む。
 *
 * ファイルが無い / 読めない環境では空配列を返す(J2 は「宣言したのに登録が無い」側だけを
 * 指摘し、設定ファイルの不在そのものは扱わない)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param roots 製品が宣言した根(実装の木の位置)
 * @returns 登録された (path, schedule) の並び
 */
export function readCronEntries(repoRoot: string, roots: ProductRoots): readonly CronEntry[] {
  const relative = cronConfigFile(roots);
  if (relative === null) return [];
  const file = path.join(repoRoot, relative);
  if (!isFile(file)) return [];
  const text = tryReadText(file);
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const crons = (parsed as Record<string, unknown>)['crons'];
  if (!Array.isArray(crons)) return [];
  const entries: CronEntry[] = [];
  for (const item of crons) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const cronPath = record['path'];
    const schedule = record['schedule'];
    if (typeof cronPath === 'string' && typeof schedule === 'string') {
      entries.push({ path: cronPath, schedule });
    }
  }
  return entries;
}

/**
 * カタログの `scheduler: host` の行を、Cron の登録と双方向に突き合わせる。
 *
 * @param input ジョブカタログ・リポジトリルート・製品の根(ドメインモデルは使わない)
 * @returns 違反のリスト
 */
export function verifyCronRegistration(input: Pick<JobCheckInput, 'jobs' | 'repoRoot' | 'roots'>): Finding[] {
  const catalog = input.jobs.catalog;
  if (catalog === null) return [];
  if (!appGrounded(input.repoRoot, input.roots.app)) return [];
  const scheduled = catalog.jobs.filter((decl) => decl.schedule?.scheduler === 'host');
  return verifyCronParity(scheduled, input.repoRoot, input.roots);
}

/**
 * カタログの `schedule` と Cron の登録を双方向に突き合わせる。
 *
 * 一致の単位は (口, cron 式) の組である。口だけ合っていて間隔が違う状態を通すと、
 * 「10 分おきに動く」と読める仕様のまま日次で回る、が黙って成立する。
 */
function verifyCronParity(
  scheduled: readonly JobDecl[],
  repoRoot: string,
  roots: ProductRoots,
): Finding[] {
  const registered = readCronEntries(repoRoot, roots);
  const configFile = cronConfigFile(roots) ?? '';
  const findings: Finding[] = [];
  const declaredKeys = new Set<string>();

  for (const decl of scheduled) {
    const schedule = decl.schedule;
    if (schedule?.cron === undefined || schedule.endpoint === undefined) continue;
    const key = `${schedule.endpoint} ${schedule.cron}`;
    declaredKeys.add(key);
    const match = registered.find(
      (entry) => entry.path === schedule.endpoint && entry.schedule === schedule.cron,
    );
    if (match !== undefined) continue;
    const samePath = registered.find((entry) => entry.path === schedule.endpoint);
    findings.push(
      j2Finding({
        message:
          samePath === undefined
            ? `ジョブ ${decl.id} の口 ${schedule.endpoint} が ${configFile} に登録されていません`
            : `ジョブ ${decl.id} の schedule ${schedule.cron} が ${configFile} の登録(${samePath.schedule})と違います`,
        location: decl.location,
        suggestion:
          `${configFile} の crons に { "path": "${schedule.endpoint}", "schedule": "${schedule.cron}" } を書くか、` +
          'カタログ側を登録に合わせる(「いつ動くか」の正が 2 つに割れている状態を残さない)',
        counterexample: { job: decl.id, endpoint: schedule.endpoint, schedule: schedule.cron },
      }),
    );
  }

  const catalogLocation = scheduled[0]?.location;
  for (const entry of registered) {
    if (declaredKeys.has(`${entry.path} ${entry.schedule}`)) continue;
    if (catalogLocation === undefined) continue;
    findings.push(
      j2Finding({
        message: `${configFile} の Cron ${entry.path}(${entry.schedule})がジョブカタログにありません`,
        location: catalogLocation,
        suggestion:
          `${specPath(roots, 'backend/jobs.md')} の jobs に "- source: schedule / endpoint: ${entry.path} / schedule: \\"${entry.schedule}\\"" の行を足す` +
          '(定期実行の登録が仕様のどこにも現れない状態は暗黙の挙動そのものである)',
        counterexample: { endpoint: entry.path, schedule: entry.schedule },
      }),
    );
  }
  return findings;
}
