/**
 * トレース検証(A 群)の実行配線(`lib/compose/verify-pipeline.ts` から分けた 1 群ぶん)。
 *
 * 実行の結果から、範囲の表記(実装の木が無いときの縮み)と、**入力の状態を報告する検査の未実施 / 阻害**を
 * 実行ログへ 1 行ずつ残す。検査そのものは `lib/trace/run.ts` が持ち、ここは報告の整形だけである。
 */

import path from 'node:path';
import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { VerifyContext } from '../check-api/contract.js';
import { inputValue, type CatalogInput } from '../kernel/input-state.js';
import type { ProgressLog } from './group-contract.js';
import { runTraceVerification, type TraceRunResult } from '../trace/run.js';
import { APP_ONLY_TRACE_VERIFIERS } from '../trace/verifiers/index.js';
import { verifyPlacementCollision } from '../trace/verifiers/a2-placement-collision.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { TcRegistry } from '../testcase/types.js';
import type { ScanWithFramework } from '../testcase/index.js';
import type { JobCatalogSpec } from '../model/job/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import type { ProductRoots } from '../model/product/types.js';
import { detectRepoRoot } from '../io/paths.js';
import { appPath } from '../model/product/paths.js';
import { describeCheckRun, describeInputGapNote, describeUnusableInput } from './check-run-report.js';
import { describePlacementGaps } from './placement-notes.js';
import { verifierRange } from './verifier-range.js';

/** `runTrace` の入力(位置引数で 12 個以上並べると、取り違えても型が通るものが多い)。 */
export interface TraceGroupArgs {
  readonly model: SpecModel;
  /** `docs/specs/domain` の絶対パス(実装の木の位置はここから導く)。 */
  readonly domainRoot: string;
  readonly actions: CatalogInput<ActionSpecModel>;
  readonly registry: TcRegistry;
  readonly jobs: CatalogInput<JobCatalogSpec>;
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  readonly guards: VerifyContext['guards'];
  readonly external: CatalogInput<ExternalCatalogSpec>;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
  readonly usecases: CatalogInput<UsecaseSpecModel>;
  /** 仕組みの根の絶対パス。省略は「渡していない」(Z3 が未実施と名指す。CLI は必ず渡す)。 */
  readonly frameworkRoot?: string;
}

/** トレース検証(A 群)を実行し、実行状況を一行で残す(実装の木の位置は specs/domain から導く)。 */
export function runTrace(
  args: TraceGroupArgs,
  log: ProgressLog,
): { findings: Finding[]; tests: ScanWithFramework } {
  const { model, domainRoot, actions, registry, jobs, dataTables, guards, external, roots, layout, usecases, frameworkRoot } = args;
  const repoRoot = detectRepoRoot(domainRoot);
  const appRoot = appPath(roots);
  const result = runTraceVerification(model, {
    actions,
    appRoot: appRoot === null ? null : path.join(repoRoot, appRoot),
    repoRoot,
    roots,
    layout,
    registry,
    jobs,
    dataTables,
    guards,
    external,
    ...(frameworkRoot === undefined ? {} : { frameworkRoot }),
  });

  // A2 の続き(置き場の取り合い)は、読めた仕様だけから主張を作る — action_spec に依らない分(保存点どうし・フォームのファイル名・受信の配線)は
  // action_spec が読めなくても見る(下の早期 return の前)。作れない主張の分は、見ていないことを行で言う。
  const loadedActions = inputValue(actions);
  const placement = verifyPlacementCollision({
    domain: model,
    actions: loadedActions,
    usecases: inputValue(usecases),
    external: inputValue(external),
    roots,
    layout,
  });
  const placementGaps = describePlacementGaps({ actions, usecases, external }, roots.app !== null);

  if (result.actionsGap !== null) {
    // 検査ごとの前提で起動を決める: action_spec が前提の検査は実行しないが、前提がそれでない検査(A13)は実行している。
    // 「スキップ」と「実行」を別の語で言い分ける(実行した検査が、群ごと飛んだ行に埋もれて消えない)。
    // 飛んだ理由は入力の状態が言う(採っていない = 正しく飛んだ / 採ったのに渡せない = 阻害。原因の error は別に出ている)。
    const ran = result.checkRuns.filter((entry) => entry.run.status === 'executed').map((entry) => entry.id);
    log(
      `A 群(仕様⇔テストのトレース): ${describeUnusableInput(result.actionsGap)}ため、action_spec が前提の検査はスキップしました` +
        `(action_spec を要らない検査で実行したもの: ${ran.length === 0 ? 'なし' : ran.join('・')})。`,
    );
    logCheckNotes(result, log);
    for (const line of placementGaps) log(line);
    return { findings: [...result.findings, ...placement], tests: result.tests };
  }
  for (const line of placementGaps) log(line);
  const registered = verifierRange(result.verifierIds);
  const skipped = `(実装の木が無いため A2 の実装側と A6、A10 の実装実在チェック、${APP_ONLY_TRACE_VERIFIERS.join('・')} はスキップ)`;
  const scope = result.appAvailable ? registered : `${registered}${skipped}`;
  const declaredActions = loadedActions?.actions ?? [];
  const uxOverrideCount = declaredActions.filter(
    (action) => action.ux !== undefined && action.ux.reason !== undefined && action.ux.reason.trim() !== '',
  ).length;
  const exceptionCount = declaredActions.reduce((sum, action) => sum + action.exceptions.length, 0);
  log(
    `A 群(仕様⇔テストのトレース): action_spec ${result.actionCount} 件に対し ${scope} を実行しました` +
      `(ux 上書き・理由つき受け入れ ${uxOverrideCount} 件 / ESLint 免除・理由つき受け入れ ${exceptionCount} 件)。`,
  );
  logCheckNotes(result, log);
  return { findings: [...result.findings, ...placement], tests: result.tests };
}

/**
 * 入力の状態を報告する検査のうち、実行しなかったもの(未実施 / 阻害)と、
 * 使えなかった入力のために見ていないことがあったもの(一部の判定を出さなかったものも含む)を、理由つきで 1 行ずつ残す(実行したものは言わない。群の要約行がすでに言う)。
 */
function logCheckNotes(result: TraceRunResult, log: ProgressLog): void {
  for (const checkRun of result.checkRuns) {
    const note = describeCheckRun(checkRun);
    if (note !== null) log(note);
  }
  for (const gapRun of result.gapRuns) log(describeInputGapNote(gapRun.id, gapRun.note));
}
