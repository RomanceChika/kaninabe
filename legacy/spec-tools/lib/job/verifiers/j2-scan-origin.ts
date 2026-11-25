/**
 * J2(続き)`scans` の発火元 — `scans` の 1 行ごとに、そのイベントを起こす発火元がちょうど 1 つある。
 *
 * `fires → scans`(`j2-endpoint-reach.ts`)は「ジョブが名指したイベントの走査が `scans` にある」向きだけで、
 * **逆向き**が閉じていなかった。ジョブから `fires` を消すと、`scans` の走査を起こすものが仕様のどこにも
 * 無くなるのに全部緑で、ハンドブックのジョブの章(どのジョブがどの走査を起こすか)は嘘になる
 * (独立レビュー m05b)。
 *
 * `actions/README.md` の `scans` は「画面以外から起きる遷移」の実装の宣言で、**発火元は 2 種類**ある。
 * この検査は `scans` の 1 行ごとに、次の合計がちょうど 1 であることを見る(新しい宣言の欄は足さない)。
 *
 * | 発火元 | 宣言の場所 |
 * |---|---|
 * | 時刻起点のジョブ | jobs.md の `fires: {イベント}`(1 本につき 1 つ) |
 * | サインイン時の同期の実行 | auth.md の `sign_in[].runs` に名指されたイベント(行が何本名指しても 1 つ) |
 *
 * 0 は「起こすものが無い走査」(`fires` の消し忘れ・`runs` の書き忘れ)、2 以上は「発火元が重なる」
 * (同じイベントを 2 本のジョブが起こす・ジョブが起こすものを `runs` も名指す)で、どちらも落ちる。
 * 受信 Webhook の `emits` と画面の `emits` は `scans` の外にある発火元(A10 が見る)なので数えない。
 *
 * **認証仕様が読めない構成**(auth.md はあるがスキーマ違反 = ローダーが別に報告している)では、`runs` 由来の
 * 行を判断できない。0 本の行は**未検査**として呼び出し側へ返し(CLI の scope 行に出す)、2 本以上の行(ジョブだけで
 * 決まる)は見る。auth.md が無いリポジトリは `runs` を持たないので、ジョブだけで数える。
 */

import type { AuthSpecModel } from '../../model/auth/types.js';
import type { ActionSpecModel, ScanDecl } from '../../model/trace/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { JobSpecModel } from '../../model/job/types.js';

/** この検証器の ID(J2 の続き)。 */
export const VERIFIER_ID = 'J2';

/** J2 の指摘を組み立てる。 */
function j2Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** J2(`scans` の発火元)の入力。 */
export interface ScanOriginInput {
  readonly jobs: JobSpecModel;
  /** 読み込み済みの action_spec(`scans` の宣言元)。 */
  readonly actions: ActionSpecModel;
  /** 読み込み済みの認証フロー仕様。無い環境は undefined(`runs` を持たないものとして数える)。 */
  readonly auth: AuthSpecModel | undefined;
}

/** `scans` の発火元の検証結果。 */
export interface ScanOriginResult {
  readonly findings: Finding[];
  /** 認証仕様が読めず、発火元を判断できなかった `scans` のイベント(0 本の行だけ)。 */
  readonly unchecked: readonly string[];
}

/** サインイン時に実行されるイベント(`sign_in[].runs` に名指されたもの)。 */
function signInEvents(auth: AuthSpecModel | undefined): ReadonlySet<string> {
  return new Set(auth?.flow?.branches.flatMap((branch) => branch.runs) ?? []);
}

/** イベントを `fires` で名指した時刻起点のジョブの ID。 */
function firingJobs(jobs: JobSpecModel, event: string): string[] {
  return (jobs.catalog?.jobs ?? []).filter((decl) => decl.schedule?.fires === event).map((decl) => decl.id);
}

/** 発火元の個数が 1 でない行の指摘。 */
function originFinding(scan: ScanDecl, jobIds: readonly string[], signIn: boolean): Finding {
  const origins = [...jobIds.map((id) => `ジョブ ${id}`), ...(signIn ? ['auth.md の sign_in[].runs'] : [])];
  return j2Finding({
    message:
      origins.length === 0
        ? `scans の ${scan.event} を起こす発火元がありません(fires で名指すジョブも、sign_in[].runs で名指す行も無い)`
        : `scans の ${scan.event} の発火元が ${origins.length} つあります(${origins.join(' / ')})。ちょうど 1 つにします`,
    location: scan.location,
    suggestion:
      origins.length === 0
        ? `時刻で起きる走査なら jobs.md のジョブに "fires: ${scan.event}" を、サインイン時に同期で実行するなら auth.md の ` +
          `sign_in の行の runs に ${scan.event} を書く。どちらでも起きないなら、scans の行が嘘なので消す(起こす主体は by と ` +
          'unscanned の宣言で言う)'
        : '同じイベントを起こす発火元を 1 つに絞る(2 本のジョブが同じ fires を持つ・ジョブが起こす走査を runs も名指す形は、' +
          'どちらが起こすのかを仕様が言えない)',
    counterexample: {
      event: scan.event,
      implementation: scan.implementation,
      jobs: jobIds.join(', '),
      sign_in: signIn ? 'yes' : 'no',
    },
  });
}

/**
 * `scans` の 1 行ごとに、発火元がちょうど 1 つあることを検証する。
 *
 * @param input ジョブカタログ・走査の宣言・認証フロー仕様
 * @returns 違反と、認証仕様が読めず判断できなかったイベント
 */
export function verifyScanOrigin(input: ScanOriginInput): ScanOriginResult {
  const authUnreadable = input.auth?.available === true && input.auth.flow === null;
  const signIn = signInEvents(input.auth);
  const findings: Finding[] = [];
  const unchecked: string[] = [];
  for (const scan of input.actions.scans) {
    const jobIds = firingJobs(input.jobs, scan.event);
    const named = signIn.has(scan.event);
    if (authUnreadable && jobIds.length === 0) {
      unchecked.push(scan.event);
    } else if (jobIds.length + (named ? 1 : 0) !== 1) {
      findings.push(originFinding(scan, jobIds, named));
    }
  }
  return { findings, unchecked };
}
