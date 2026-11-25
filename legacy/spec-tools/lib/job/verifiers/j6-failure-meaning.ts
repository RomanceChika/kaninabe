/**
 * J6 失敗時の挙動の意味 — 行の種類と、`on_failure` の語が宣言した意味(`means`)の対を見る。
 *
 * `on_failure` の語は製品の語彙なので、体系は綴りを比べない。語の側が「この語は、失敗したらこうなる」と
 * `means` で宣言する(`kind` の語の `in_transaction` / `declares` と同じ型)ので、ここは**行と語の対**だけを
 * 見る。これが無いと `on_failure` は誰にも読まれない欄になり、2 本の行の値を入れ替えても全部緑のままになる
 * (積まれて実行される行が「積まれること自体が結線の誤り」と宣言され、積まれない行がリトライすると宣言される)。
 *
 * | 行の種類 | 選んでよい意味 |
 * |---|---|
 * | 書き込みと同じトランザクションで実現される(`kind` の語が `in_transaction`) | `never_queued` |
 * | 時刻起点(`source: schedule`) | `next_run` |
 * | キューに積まれる(`source: outbox` / `manual` で上のどちらでもない) | `retry_to_dead` / `pending_decision` |
 *
 * `pending_decision`(まだ決めていない)を選んだ行は、行の種類に合っていても**行ごとに warning** を出す。
 * 警告は台帳に載らなければ未分類になり、`verify --fail-on-unclassified` の門が止める —— 「未定のまま出荷しない・
 * 決めたら別の値に直す」を機械で執行する(これが無いと、キューに積まれる行すべてが未定でも緑・無音で通る)。
 * 免除の口は無い。
 *
 * 読み手はこの検査だけである(生成物 `jobs.ts` の `onFailure` を実行時が読む形にはしていない)。
 */

import type { Finding } from '../../kernel/finding.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { JobDecl, JobFailureMeaning, JobSpecModel } from '../../model/job/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'J6';

/** 行の種類。 */
type RowClass = 'in_transaction' | 'schedule' | 'queued';

/** 行の種類ごとに選んでよい意味(行の種類は体系の軸だけで決まる)。 */
const ALLOWED_MEANS: Readonly<Record<RowClass, readonly JobFailureMeaning[]>> = {
  in_transaction: ['never_queued'],
  schedule: ['next_run'],
  queued: ['retry_to_dead', 'pending_decision'],
};

/** 行の種類を人が読む言い方にする(指摘の文面)。 */
const ROW_CLASS_TEXT: Readonly<Record<RowClass, string>> = {
  in_transaction: '書き込みと同じトランザクションで実現される行(kind の語が in_transaction)',
  schedule: '時刻で起きる行(source: schedule)',
  queued: 'キューに積まれる行(source: outbox / manual)',
};

/** J6 の指摘を組み立てる(既定は error。未定の行だけ warning)。 */
function j6Finding(args: Omit<Finding, 'verifier' | 'severity'>, severity: Finding['severity'] = 'error'): Finding {
  return { verifier: VERIFIER_ID, severity, ...args };
}

/** 行の種類を決める(同一トランザクションで実現される行が先。`in_transaction` は outbox の行だけが持てる)。 */
function rowClassOf(decl: JobDecl): RowClass {
  if (decl.inTransaction === true) return 'in_transaction';
  return decl.source === 'schedule' ? 'schedule' : 'queued';
}

/** 失敗時の扱いが未定の行の warning(台帳に載らないので未分類 = 門が止める)。 */
function pendingFinding(decl: JobDecl, jobsPath: string): Finding {
  return j6Finding(
    {
      message: `ジョブ ${decl.id} の on_failure ${decl.onFailure} は意味 pending_decision(失敗時の扱いが未定)を宣言しています`,
      location: decl.location,
      suggestion:
        `${jobsPath} の ${decl.id} の on_failure を、失敗時の扱いを決めた語(意味が retry_to_dead の語など)に直す。` +
        '未定のままは出荷できない(verify --fail-on-unclassified が止める)',
      counterexample: { job: decl.id, on_failure: decl.onFailure, means: 'pending_decision' },
    },
    'warning',
  );
}

/**
 * 行の `on_failure` の語が宣言した意味が、行の種類と合っているかを見る。
 *
 * @param jobs 読み込み済みのジョブカタログ
 * @param roots 製品が宣言した根(道案内のパス)
 * @returns 違反のリスト
 */
export function verifyFailureMeaning(jobs: JobSpecModel, roots: ProductRoots): Finding[] {
  const catalog = jobs.catalog;
  if (catalog === null) return [];
  const jobsPath = specPath(roots, 'backend/jobs.md');
  const meanings = new Map(catalog.vocabulary.on_failure.map((term) => [term.id, term.means]));

  return catalog.jobs.flatMap((decl) => {
    const means = meanings.get(decl.onFailure);
    // 意味が読めない語(宣言の欠落)は J0 が報告している。ここで重ねて鳴らさない。
    if (means === undefined) return [];
    const rowClass = rowClassOf(decl);
    const allowed = ALLOWED_MEANS[rowClass];
    if (allowed.includes(means)) return means === 'pending_decision' ? [pendingFinding(decl, jobsPath)] : [];
    return [
      j6Finding({
        message:
          `ジョブ ${decl.id} の on_failure ${decl.onFailure} は意味 ${means} を宣言していますが、` +
          `${ROW_CLASS_TEXT[rowClass]}が選べる意味は ${allowed.join(' / ')} です`,
        location: decl.location,
        suggestion:
          `${jobsPath} の ${decl.id} の on_failure を、意味が ${allowed.join(' / ')} の語に直す。` +
          '行の種類に合う語が語彙に無ければ、vocabulary.on_failure に足して means を宣言する' +
          '(機械が読むのは語の means であり、語の綴りは比べない)',
        counterexample: { job: decl.id, on_failure: decl.onFailure, means, allowed: allowed.join(',') },
      }),
    ];
  });
}
