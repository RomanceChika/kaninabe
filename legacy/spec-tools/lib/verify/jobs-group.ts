/**
 * ジョブ仕様検証(J 群)の配線(lib/compose/verify-pipeline.ts が呼ぶ)。
 *
 * 入力の読み込み位置と報告の文言だけを持つ(外部連携の `external-group.ts` と同じ形。群ごとのファイルに分ける)。
 * 検査の束ね(どの検査をどの順に回すか)は `lib/job/run.ts` が持つ。
 */

import type { Finding } from '../kernel/finding.js';
import type { CatalogInput, UnusableInput } from '../kernel/input-state.js';
import type { ProgressLog } from './group-contract.js';
import { describeInputGap, describeJobScopeNotes, describeMissingTarget, describeNotApplicableTarget, describeUnreadable } from './check-run-report.js';
import { runJobVerification } from '../job/run.js';
import type { JobRunResult } from '../job/run.js';
import type { JobTargetRegistry } from '../job/target-checks.js';
import type { SpecModel } from '../model/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import type { AuthSpecModel } from '../model/auth/types.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import { detectRepoRoot } from '../io/paths.js';

/**
 * ジョブ仕様検証(J 群)を実行し、実行状況を一行で残す。
 *
 * カタログ(specs/backend/jobs.md)が無い環境では検証をスキップし、その旨を報告する。
 * J2 は実装の実在と Cron の登録(後段が登録する検査)を見るので、リポジトリルートを渡す。
 * 後段が受け持つ検査(`jobTargets`)の口が埋まっていなければ、実行しなかったことを「ID: 未実施 — …」で名指す(その役割の後段が選ばれていないのか、
 * 選ばれているが登録していないのかを分けて言う)。後段が理由つきで対象外と宣言した口は「ID: 対象外 — …」で別に言い、未実施に数えない。
 */
export function runJobs(
  model: SpecModel,
  jobs: JobSpecModel,
  domainRoot: string,
  roots: ProductRoots,
  log: ProgressLog,
  jobTargets: JobTargetRegistry,
  layout: ProductLayout,
  external: CatalogInput<ExternalCatalogSpec>,
  actions?: ActionSpecModel,
  auth?: AuthSpecModel,
  screens?: ScreenSpecModel,
  generatedTreeOnly?: boolean,
): Finding[] {
  const result = runJobVerification({
    ...(generatedTreeOnly === true ? { generatedTreeOnly } : {}),
    domain: model,
    jobs,
    repoRoot: detectRepoRoot(domainRoot),
    roots,
    layout,
    external,
    jobTargets,
    ...(actions === undefined ? {} : { actions }),
    ...(auth === undefined ? {} : { auth }),
    ...(screens === undefined ? {} : { screens }),
  });
  if (!result.available) {
    // ジョブのカタログが無くても、実装の木を宣言していれば HTTP の入口の衝突(J2 の続き)は実行している(見出しがスキップの一言で隠さない)。
    // 外部連携が阻害なら受信口の主張を作れないので、実行した分は画面の route だけと言い分ける(事実と違う見出しにしない)。
    const ran = result.entryGaps.length === 0 ? '受信口と画面の route の分' : '画面の route の分だけ(受信口の URL は外部連携の阻害のため見ていません)';
    const closed =
      result.entryClosed === 'ran'
        ? result.entryClosedUnreadable.length === 0
          ? '。HTTP の入口の閉世界(実装の木の全入口が宣言に当たる)も実行しました'
          : '。HTTP の入口の閉世界(実装の木の全入口が宣言に当たる)は、読めなかった場所があるので読めた部分だけ実行しました'
        : result.entryClosed === 'no_tree'
          ? '。HTTP の入口の閉世界は実装の木を走査するが、木のディレクトリが実在しないのでスキップしました'
          : '';
    log(
      result.entryCollisionRan
        ? `J 群(ジョブ仕様): specs/backend/jobs.md が無いためスキップしました(HTTP の入口の衝突 = J2 の続きだけは、実装の木があるので${ran}を実行しました${closed})。`
        : 'J 群(ジョブ仕様): specs/backend/jobs.md が無いためスキップしました。',
    );
    for (const line of closedWorldLines(result, [])) log(line);
    return result.findings;
  }
  const scope = result.appGrounded
    ? 'J1〜J7'
    : 'J1〜J7(実装の木が無いため J2 の実装・Route Handler・Cron 登録の突合はスキップ。HTTP の入口の閉世界も実装の木を走査するのでスキップ)';
  const unchecked =
    result.scanOriginUnchecked.length === 0
      ? ''
      : `(認証仕様が読めないため、scans の発火元は未検査: ${result.scanOriginUnchecked.join(' / ')})`;
  // 口が埋まっていない分(後段が無い・登録していない・対象外)は「実行しました」から除く(見出しが範囲を過大に言わない)。
  const narrowed = describeJobScopeNotes(result.missingTargetChecks, result.notApplicableTargetChecks);
  log(
    `J 群(ジョブ仕様): ジョブ ${result.jobCount} 件(うち時刻起点 ${result.scheduledCount} 件)に対し ${scope} を実行しました${narrowed}${unchecked}。`,
  );
  for (const line of closedWorldLines(result, result.entryGaps)) log(line);
  for (const slot of result.missingTargetChecks) log(describeMissingTarget(slot, result.appGrounded));
  for (const slot of result.notApplicableTargetChecks) log(describeNotApplicableTarget(slot, result.appGrounded));
  return result.findings;
}

/** 外部連携が阻害のとき、受信口の URL の衝突を見ていないこと(入口の衝突。J2 の続き)。 */
const COLLISION_UNSEEN = '受信口の URL とジョブの endpoint の衝突は見ていません(ジョブどうしの衝突は実行済み)';

/** 宣言を読めないとき、どの宣言にも当たらない入口の判定を保留したこと(入口の閉世界。J2 の続き)。 */
const CLOSED_UNSEEN =
  'どの宣言にも当たらない HTTP の入口(閉世界)の判定は出していません(1 本の URL に結べない入口と、認証の callback・送信の連携の口の実在は実行済み)';

/** 走査で読めなかった場所があるとき、閉世界で見ていないこと(入口の閉世界。J2 の続き)。 */
const CLOSED_UNREAD = '入口の閉世界は見ていません(読めた部分の入口の分類は実行済み。読めなかった部分の入口と、認証の callback・送信の連携の口の実在は判定していません)';

/**
 * HTTP の入口(J2 の続き)で、見ていないことの行。**実装の木が無いとき**は閉世界の行を言わない(見出しが「スキップ」で言う)。
 *   - 配置が入口の逆引きを持たず走査の根を決められない … 未実施
 *   - 走査で読めなかった場所がある … 阻害(読めなかった部分の入口を見ていない。完全な走査の「指摘 0」と同じに見せない)
 *   - 宣言を読めない種類がある … 阻害(その宣言に当たるはずの入口を、未宣言と誤って言わないため、未宣言の判定だけを保留した)
 *
 * **阻害の行は入力の種類ごとに 1 行**である。衝突の検査(`collisionGaps`)と閉世界の保留が同じ種類(外部連携)を指すときは、見ていないことを 1 行に畳む
 * (別の行にすると、同じ原因が範囲サマリの件数に 2 度数えられる)。
 *
 * @param result ジョブの検証の結果
 * @param collisionGaps 入口の衝突で受信口の URL を見られなかった入力(ジョブのカタログが無いときは、見出しが言うので空を渡す)
 */
function closedWorldLines(result: JobRunResult, collisionGaps: readonly UnusableInput[]): string[] {
  const lines: string[] = [];
  const unseen = new Map<string, { readonly gap: UnusableInput; readonly texts: string[] }>();
  for (const [gaps, text] of [[collisionGaps, COLLISION_UNSEEN], [result.entryClosedWithheld, CLOSED_UNSEEN]] as const) {
    for (const gap of gaps) {
      const entry = unseen.get(gap.input) ?? { gap, texts: [] };
      entry.texts.push(text);
      unseen.set(gap.input, entry);
    }
  }
  for (const { gap, texts } of unseen.values()) lines.push(describeInputGap('J2', gap, texts.join('。また、')));
  if (result.entryClosedUnreadable.length > 0) lines.push(describeUnreadable('J2', result.entryClosedUnreadable, CLOSED_UNREAD));
  if (result.entryClosed === 'no_placement') {
    lines.push('J2: 未実施 — 置き場の配置が HTTP の入口(http-entry)の逆引きを持たず走査の根を決められないため、実装の木の入口がどの宣言に当たるか(閉世界)は見ていません。');
  }
  return lines;
}
