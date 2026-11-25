/**
 * 外部連携カタログ検証(X 群)の配線(`lib/compose/verify-pipeline-groups.ts` が呼ぶ)。
 *
 * 入力の読み込み位置と報告の文言だけを持つ(M 群の `docs-group.ts` と同じ形)。
 */

import type { Finding } from '../kernel/finding.js';
import type { ProgressLog } from './group-contract.js';
import type { SpecModel } from '../model/types.js';
import type { ConfigCatalogSpec } from '../model/config/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { CatalogInput } from '../kernel/input-state.js';
import { describeInputGap, describeInputGapNote } from './check-run-report.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { TestScanResult, TcRegistry } from '../testcase/types.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import { runExternalVerification } from '../external/run.js';
import { detectRepoRoot } from '../io/paths.js';

/** 利用者に出る X 群の範囲(群まるごと見ていないときの行の ID。検証器を足したら `lib/external/checks.ts` の登録とここを動かす)。 */
const X_SCOPE = 'X1〜X8';

/** 外部連携カタログ検証への入力(位置引数で並べると数が多く、取り違えても型が通ってしまう)。 */
export interface ExternalRunArgs {
  readonly model: SpecModel;
  /** 外部連携カタログの入力の状態(製品が `external` を採っているか(`uses`)と読み込みの結果から、呼び手が `catalogInput` で作る)。 */
  readonly external: CatalogInput<ExternalCatalogSpec>;
  /** 設定カタログの入力の状態(X2 の接地先。製品が `config` を採っているか(`uses`)と読み込みの結果から、呼び手が `catalogInput` で作る)。 */
  readonly config: CatalogInput<ConfigCatalogSpec>;
  /** テーブル仕様の入力の状態(製品が `data_tables` を採っているか(`uses`)と読み込みの結果から、呼び手が `catalogInput` で作る)。 */
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  /** action_spec の入力の状態(X7 が利用者の入力で書ける欄を引く。任意)。 */
  readonly actionSpecs?: CatalogInput<ActionSpecModel>;
  readonly registry: TcRegistry;
  readonly tests: TestScanResult;
  readonly domainRoot: string;
  /** 製品が宣言した根(X1 / X6 が実装の木を見る)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(X1 が基盤の層と土台の表を引く)。 */
  readonly layout: ProductLayout;
  /** 製品が多要素認証を要求するか(X8 が有料の口の多要素認証の配線を求めるか決める。省略は要求しない)。 */
  readonly mfaEnforced?: boolean;
  /** 生成の後の木の回し直し(段の宣言 `onGeneratedTree` の段だけ。`ExternalRunInput.generatedTreeOnly`)。 */
  readonly generatedTreeOnly?: boolean;
}

/**
 * 外部連携カタログ検証(X 群)を実行し、実行状況を一行で残す。
 *
 * カタログが読込済みでないときは、**採っていない**(`uses` に無い)なら検証をスキップしてその旨を報告し(正しく飛んだ)、
 * **採ったのに渡せない**(置き場に仕様が無い・読めない・仕様を落とした)なら「見ていない」を名指す
 * (`X1〜X8: 阻害 — …`。原因の error は X0 と P 群が出している)。置き場にはあるが読めないときは、台帳だけを見る X4 は実行し、
 * 宣言を読む検査を見ていないことを同じ形で言う。
 * X1 は実装(app/src/infrastructure/)を、X2 は設定カタログを見るので、リポジトリルートと
 * 設定カタログの入力の状態を渡す。X1(b) の内部テーブル名と X5(a) の RPC の接地先はテーブル仕様で、X2 の接地先は設定カタログで、
 * 使えないときは判定を出さず、見ていないことを群の要約行の後で対象を名指して言う。
 */
export function runExternal(args: ExternalRunArgs, log: ProgressLog): Finding[] {
  const result = runExternalVerification({
    domain: args.model,
    external: args.external,
    config: args.config,
    dataTables: args.dataTables,
    ...(args.actionSpecs === undefined ? {} : { actionSpecs: args.actionSpecs }),
    repoRoot: detectRepoRoot(args.domainRoot),
    roots: args.roots,
    layout: args.layout,
    ...(args.mfaEnforced === true ? { mfaEnforced: true } : {}),
    ...(args.generatedTreeOnly === true ? { generatedTreeOnly: true } : {}),
    registry: args.registry,
    tests: args.tests,
  });
  if (!result.available) {
    if (result.inputGap?.state === 'blocked') {
      log(describeInputGap(X_SCOPE, result.inputGap, `外部連携カタログの検査(${X_SCOPE})は見ていません`));
    } else {
      log('X 群(外部連携カタログ): specs/backend/external.md が無いためスキップしました。');
    }
    return result.findings;
  }
  if (result.catalogGap !== null) {
    log('X 群(外部連携カタログ): 宣言を読めないため、台帳だけを見る検査を実行しました。');
    log(describeInputGapNote(X_SCOPE, result.catalogGap));
    // 台帳だけを見る X4 も、実装の木が無ければ @tc の突合は飛ぶ(宣言を読めないことと別の理由。緑が広く見せない)。
    if (!result.testsAvailable) log('X 群(外部連携カタログ): 実装の木が無いため X4 の @tc 突合はスキップしました。');
    return result.findings;
  }
  const skipped = [
    ...(result.appGrounded ? [] : ['X1 のアダプタ・ディレクトリの突合', 'X6 の実行時の約束の突合']),
    ...(result.testsAvailable ? [] : ['X4 の @tc 突合']),
  ];
  const scope = skipped.length === 0 ? X_SCOPE : `${X_SCOPE}(実装の木が無いため ${skipped.join(' と ')}はスキップ)`;
  log(`X 群(外部連携カタログ): 連携 ${result.integrationCount} 件に対し ${scope} を実行しました。`);
  // 入力が使えないために判定を出さなかった対象(X1 / X5 はテーブル仕様 — X1 は阻害のときだけ・X5 は未選択も / X2 は設定カタログの阻害)。
  for (const gap of result.gaps) log(describeInputGapNote(gap.id, gap.note));
  return result.findings;
}
