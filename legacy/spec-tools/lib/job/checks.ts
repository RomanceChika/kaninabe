/**
 * ジョブ仕様の検査(J 群)の登録 — どの検査を、どの順で実行するか。
 *
 * 実行口(`run.ts`)はここの `JOB_STEPS` を上から回すだけである。並びは**違反の並び**を決める(J1 → J2 の接地 → HTTP の入口の衝突 → HTTP の入口の閉世界 →
 * J2 の Cron の登録の突合 → … → J3 → J4 → J5 → J6 → J7)。
 * **後段が受け持つ検査(J2 の Cron の登録の突合・J3・J4)は口(`JOB_CHECK_SLOTS`)の ID で段に載る**。口に当たる検査を登録した後段があれば
 * それを実行し、無ければ空を返す(埋まっていない口は `missingTargetChecks` が未実施と報告する。後段の値はここでは読まない)。
 * ID は各検証器のファイルが持つ `VERIFIER_ID` と、口の表を参照する。全検査の表(`lib/compose/all-checks.ts`)は `JOB_CHECKS` を読む。
 * **口の表の全口がここで呼ばれること**は `__tests__/unit/job/run-targets.test.ts` が固定する。
 */

import type { Finding } from '../kernel/finding.js';
import type { CheckEntry } from '../kernel/check-entry.js';
import { J0_VERIFIER_ID } from '../model/job/loader.js';
import type { JobRunInput } from './run.js';
import { JOB_CHECK_SLOTS, type JobCheckInput, type ResolvedJobChecks } from './target-checks.js';
import { VERIFIER_ID as J1, verifyJobEffectParity } from './verifiers/j1-effect-parity.js';
import { VERIFIER_ID as J2_ENDPOINT, verifyEndpointReach } from './verifiers/j2-endpoint-reach.js';
import { VERIFIER_ID as J2_EMITS, verifyEmits } from './verifiers/j2-emits.js';
import { VERIFIER_ID as J2_ENTRY } from './verifiers/j2-entry-collision.js';
import { VERIFIER_ID as J2_CLOSED, type EntryClosedResult } from './verifiers/j2-entry-closed.js';
import { VERIFIER_ID as J2_GUARD, verifyEntryOriginGuard } from './verifiers/j2-entry-origin-guard.js';
import { VERIFIER_ID as J2_ORIGIN, type ScanOriginResult } from './verifiers/j2-scan-origin.js';
import { VERIFIER_ID as J2_SCHEDULE, verifyScheduleGrounding } from './verifiers/j2-schedule-grounding.js';
import { VERIFIER_ID as J5, verifyAnonymize } from './verifiers/j5-anonymize.js';
import { VERIFIER_ID as J6, verifyFailureMeaning } from './verifiers/j6-failure-meaning.js';
import { VERIFIER_ID as J7, verifyEndsSessions } from './verifiers/j7-ends-sessions.js';

/** 実行口が 1 回だけ作って各検査へ配る材料(後段が登録した検査を口に当てた結果・走査の発火元・入口の衝突)。 */
export interface JobStepContext {
  /** 後段の検査 1 本が受け取る入力(リポジトリルートは I/O のため実行口が渡す)。 */
  readonly checkInput: JobCheckInput;
  /** 登録された検査を口に当てた結果。 */
  readonly targets: ResolvedJobChecks;
  /** `scans` の発火元の検査の結果(`unchecked` は実行口が持ち帰る)。 */
  readonly origin: ScanOriginResult;
  /** HTTP の入口の衝突(ジョブのカタログの有無に依らず実行口が先に求める)。 */
  readonly entry: readonly Finding[];
  /** HTTP の入口の閉世界(実装の木の全入口が宣言に当たる。同じく実行口が先に求める。実行の状態と保留した理由は実行口が持ち帰る)。 */
  readonly closed: EntryClosedResult;
}

/** 実行の段 1 つ(検査 1 本)。 */
export interface JobStep extends CheckEntry {
  /** 検査を実行し、違反を返す。 */
  run(input: JobRunInput, context: JobStepContext): Finding[];
}

/**
 * 後段が受け持つ口の段(口の表の ID と題を使う。口に当たる検査が無ければ何も言わない)。
 *
 * @param id - 口の ID
 * @param part - 同じ ID の段と見分ける宣言(同じ ID の段が他にもあるときだけ)
 * @returns 口の段
 */
function slotStep(id: string, part?: string): JobStep {
  const slot = JOB_CHECK_SLOTS.find((candidate) => candidate.id === id);
  if (slot === undefined) throw new Error(`口の表(JOB_CHECK_SLOTS)に ${id} がありません`);
  return { id: slot.id, ...(part === undefined ? {} : { part }), title: `${slot.unseen}(後段が登録する)`, run: (_input, context) => context.targets.byId.get(slot.id)?.verify(context.checkInput) ?? [] };
}

/** 実行の順(違反の並びを決める)。 */
export const JOB_STEPS: readonly JobStep[] = [
  { id: J1, title: 'ジョブカタログ ⇔ 効果(state_spec の effects・access_spec の writes[].effects)の双方向閉世界', run: (i) => verifyJobEffectParity(i.domain, i.jobs, i.roots) },
  {
    id: J2_SCHEDULE,
    part: '接地',
    title: '時刻で起きるジョブの接地(実装・Route Handler・起こすイベント・発火時刻の供給元)',
    run: (i, c) => verifyScheduleGrounding({ ...c.checkInput, layout: i.layout }),
  },
  { id: J2_ENTRY, part: '入口の衝突', onGeneratedTree: true, title: 'HTTP の入口の衝突(ジョブの起動口と受信口が同じ URL を取らない)', run: (_i, c) => [...c.entry] },
  { id: J2_CLOSED, part: '入口の閉世界', onGeneratedTree: true, title: 'HTTP の入口の閉世界(実装の木の全入口が、ジョブ・受信・認証・外部連携の宣言のどれかに当たる)', run: (_i, c) => [...c.closed.findings] },
  {
    id: J2_GUARD,
    part: 'cookie の口の出どころ',
    onGeneratedTree: true,
    title: 'cookie で認証する手書きの口(送信の連携の endpoints)が、状態を変える要求の出どころを確かめる部品を呼ぶ',
    run: (i) =>
      verifyEntryOriginGuard({
        jobs: i.jobs,
        external: i.external.state === 'loaded' ? i.external.value : undefined,
        auth: i.auth,
        repoRoot: i.repoRoot,
        roots: i.roots,
        layout: i.layout,
      }),
  },
  slotStep(J2_SCHEDULE, 'Cron の登録の突合'),
  { id: J2_EMITS, part: 'emits', title: '走査が積む通知の宣言(emits)の接地', run: (i) => verifyEmits(i.jobs, i.roots) },
  {
    id: J2_ENDPOINT,
    part: '起動口',
    title: 'Cron の起動口と走査の接地(fires / due_from が実装に届く)',
    run: (i) => verifyEndpointReach({ jobs: i.jobs, actions: i.actions, repoRoot: i.repoRoot, roots: i.roots, layout: i.layout }),
  },
  { id: J2_ORIGIN, part: '発火元', title: 'scans の発火元(1 行ごとにちょうど 1 つ)', run: (_i, c) => c.origin.findings },
  slotStep('J3'),
  slotStep('J4'),
  { id: J5, title: '匿名化する効果の宣言(集約・発火元・語の 3 点と、認証フローの主語の認証基盤の呼び出し)', run: (i) => verifyAnonymize(i.domain, i.jobs, i.roots, i.auth) },
  { id: J6, title: '失敗時の挙動の意味(行の種類と on_failure の語の対)', run: (i) => verifyFailureMeaning(i.jobs, i.roots) },
  { id: J7, title: 'セッションを終える効果の宣言(集約・発火元・語の 3 点)と、アカウントを止める遷移の宣言漏れ(R11)', run: (i) => verifyEndsSessions(i.domain, i.jobs, i.auth, i.roots) },
];

/** J 群の全検査(ローダーの J0 を含む。後段が受け持つ口の ID も載る。全検査の表が読む)。 */
export const JOB_CHECKS: readonly CheckEntry[] = [
  { id: J0_VERIFIER_ID, title: 'job_spec のスキーマ適合(ローダーが実施)' },
  ...JOB_STEPS,
];
