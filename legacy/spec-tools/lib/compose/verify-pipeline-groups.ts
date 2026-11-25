/**
 * 仕様種ごとの群の実行と「何件見たか」の 1 行報告。
 *
 * 配線の本体(lib/compose/verify-pipeline.ts)が持つのは**順序**だけで、各群を呼ぶときの引数の組み立てと
 * 実行状況の文言はここに置く。責務の線は「順序 / 群ごとの呼び方」である。
 *
 * 仕様種に紐づかない群(U 群の経験則・G 群の視覚・W 群の語彙漏れ)は
 * [pipeline-groups-quality.ts](./pipeline-groups-quality.ts) にある。
 *
 * どの関数も**読めない環境で壊れない**。対応する仕様種が無ければ検証をスキップし、
 * その旨を報告して空の Finding を返す(規約: scripts-code-quality.md)。
 */

import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { Finding } from '../kernel/finding.js';
import type { ProgressLog } from '../verify/group-contract.js';
import { runSpecIndexVerification } from '../spec-index/run.js';
import type { TcRegistry, TestScanResult } from '../testcase/types.js';
import type { ScanWithFramework } from '../testcase/index.js';
import { runDataTableVerification } from '../data/run.js';
import type { SurfaceSpecModel } from '../model/surface/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { QuerySpecModel } from '../model/query/types.js';
import type { CatalogInput } from '../kernel/input-state.js';
import { describeInputGap, describeInputGapNote, describeSurfaceUnsupported } from '../verify/check-run-report.js';
import { runNotificationVerification } from '../notification/run.js';
import type { NotificationSpecModel } from '../model/notification/types.js';
import type { JobCatalogSpec } from '../model/job/types.js';
import { runConfigVerification } from '../config/run.js';
import type { ConfigSpecModel } from '../model/config/types.js';
import { runAuthVerification } from '../auth/run.js';
import type { AuthConfigVerifier } from '../auth/platform-config.js';
import { describeAuthConfigRun } from '../verify/check-run-report.js';
import type { AuthSpecModel } from '../model/auth/types.js';
import { runGuaranteeVerification } from '../guarantee/run.js';
import type { GuaranteeSpecModel } from '../model/guarantee/types.js';
import type { FrameworkLedgerLoad } from '../model/guarantee/framework-loader.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import { detectRepoRoot } from '../io/paths.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';

/**
 * 台帳検査(A9)を実行し、実行状況を一行で残す。
 *
 * この群だけは仕様種の有無に依存しない。action_spec が無い構成でも、query_spec どうしの
 * ID 重複はここで落ちる(仕様種ごとの実行条件の内側に置くと、その組み合わせが無検査になる)。
 */
export function runSpecIndex(registry: TcRegistry, log: ProgressLog): Finding[] {
  log(`台帳(テストケース ID): 全仕様の宣言 ${registry.entries.length} 件に対し A9 を実行しました。`);
  return runSpecIndexVerification(registry);
}

/** テーブル仕様検証への入力(位置引数で並べると数が多く、取り違えても型が通ってしまう)。 */
export interface DataRunArgs {
  readonly model: SpecModel;
  /** テーブル仕様の入力の状態(製品が `data_tables` を採っているか(`uses`)と読み込みの結果から、呼び手が `catalogInput` で作る)。 */
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  /** query_spec の入力の状態(製品が `queries` を採っているか(`uses`)と読み込みの結果から、呼び手が `catalogInput` で作る)。 */
  readonly queries: CatalogInput<QuerySpecModel>;
  readonly guards: GuardServices;
  readonly registry: TcRegistry;
  readonly tests: TestScanResult;
  /** T6 / T11 が宣言した input の欄の到達・実行計画の導出に使う action_spec の入力の状態。 */
  readonly actions: CatalogInput<ActionSpecModel>;
  /** 実行計画の導出が effects の宛先を引くジョブカタログの入力の状態。 */
  readonly jobs: CatalogInput<JobCatalogSpec>;
  /** T11 が**保存点**の一致の証明の生成可否を、T12 が api スキーマの土台の順序を見るのに使う usecase_spec の入力の状態。 */
  readonly usecases: CatalogInput<UsecaseSpecModel>;
  /** T12 が api スキーマの土台の順序を見るのに使う external_spec(受信の RPC も api に関数を作る)の入力の状態。 */
  readonly external: CatalogInput<ExternalCatalogSpec>;
  /** T12 が**外から届く surface**(土台の宣言・手書きで残すビュー・権限の宣言)を見るのに使う surface_spec の入力の状態。 */
  readonly surface: CatalogInput<SurfaceSpecModel>;
  /** 製品が宣言した根(道案内のパスと走査位置)。 */
  readonly roots: ProductRoots;
  /** T17 が `handwritten` が名指した migration を読むのに使う(リポジトリルートの絶対パス)。 */
  readonly repoRoot: string;
  /** プラットフォームの設定(T7 が RLS の本文を組み立てるのに使う。値を選ぶのは組み立ての根)。 */
  readonly platform: PlatformProfile;
  /** 置き場の配置(T3 が突合テストの置き場 = テスト支援の土台の位置を引く)。 */
  readonly layout: ProductLayout;
}

/**
 * 利用者に出る T 群の範囲(検証器を足したらここも動かす)。
 *
 * 範囲は `lib/data/checks.ts` の登録(`DATA_STEPS`)が正であり、この文字列はその写しである —— 数が合わなく
 * なると「回していない検査があるように見える」/「回した検査が隠れる」のどちらかになる
 * (独立レビュー ③-3 F-4 の実測: T12〜T15 の 4 本が印字から隠れていた)。
 */
const T_SCOPE = 'T1〜T18';

/**
 * テーブル仕様検証(T 群)を実行し、実行状況を一行で残す。
 *
 * テーブル仕様が読込済みでないときは検証をスキップする。**採っていない**(`uses` に無い)なら、その旨を報告して壊れないようにする
 * (正しく飛んだ)。**採ったのに渡せない**(置き場に仕様が無い・読めない・仕様を落とした)なら「T 群は見ていない」を名指す
 * (`T1〜T18: 阻害 — …`。原因の error は T0 と P 群が出している)。**仕様を落とした**ときだけは、表ごとに自己完結の段を読めた表で実行し
 * (要約行に実行した段の ID を並べる)、表の全体を前提とする段(欠けた表が偽の指摘を生む段)は止めて、段ごとに「阻害 — …は見ていません」の行で言う。
 * T2(索引の期待値)は query_spec と関数の `lookup` から索引の要求を導く(関係の層)。query_spec が
 * 使えない(未選択・阻害)ときは、その分を導かず「T2: 未実施 / 阻害」の行で言う(`lookup` の分は見る)。
 * T6 / T11 / T12 が裏づけに読むほかの種類(action_spec・ジョブ・ユースケース・外部連携・surface)が**阻害**のときは、依る判定を出さず、
 * 段ごとに「阻害 — …は見ていません」の行で言う(未選択は裏づけが無い事実なので黙る)。
 * T3(テスト突合)は台帳を引き、`@tc` の照合だけは app/ を走査できたときに限る。
 */
export function runDataTables(args: DataRunArgs, log: ProgressLog): Finding[] {
  const { model, ...rest } = args;
  const result = runDataTableVerification({ domain: model, ...rest });
  if (!result.available) {
    if (result.tablesGap?.state === 'blocked') {
      log(describeInputGap(T_SCOPE, result.tablesGap, `テーブル仕様の検査(${T_SCOPE})は見ていません`));
    } else {
      log('T 群(テーブル仕様): specs/backend/data/tables が無いためスキップしました。');
    }
    return result.findings;
  }
  // 仕様を落としたときは、自己完結の段だけを読めた分で実行している(範囲は実行した段の ID を並べて言う)。
  const partial = result.tablesGap !== null;
  const ran = partial ? result.ranIds.join('・') : T_SCOPE;
  const notes = [result.testsAvailable || !result.ranIds.includes('T3') ? null : '実装の木が無いため T3 の @tc 突合はスキップ'].filter(
    (note): note is string => note !== null,
  );
  const scope = notes.length === 0 ? ran : `${ran}(${notes.join(' / ')})`;
  const dropped = result.droppedTables;
  const droppedNote = dropped.length === 0 ? '' : `(読めずに落ちた表 ${dropped.length} 件: ${dropped.join('・')})`;
  const tables = partial ? `読めた data_table ${result.tableCount} 件${droppedNote}` : `data_table ${result.tableCount} 件`;
  log(`T 群(テーブル仕様): ${tables}に対し ${scope} を実行しました。`);
  // 仕様を落としたため止めた、表の全体を前提とする段(読めた表だけの判定は偽の指摘を生む)。
  for (const gap of result.wholeGaps) log(describeInputGapNote(gap.id, gap.note));
  for (const gap of result.indexGaps) {
    log(describeInputGap('T2', gap, `${gap.input} から導く索引の要求は見ていません(ほかの入力から導く要求は実行済み)`));
  }
  for (const gap of result.stepGaps) log(describeInputGapNote(gap.id, gap.note));
  if (result.surfaceUnsupported !== null) {
    log(describeSurfaceUnsupported('T12', result.surfaceUnsupported, 'SQL の公開面(土台・ビュー)の出どころの判定'));
  }
  return result.findings;
}

/**
 * 通知仕様検証(N 群)を実行し、実行状況を一行で残す。
 *
 * カタログ(specs/backend/notifications.md)が無い環境では検証をスキップし、その旨を報告する。
 * ジョブカタログが阻害のとき、走査の `emits` に依る判定は出さず、検査ごとの行で言う(`verify/operation-input-notes.ts`)。
 */
export function runNotifications(
  model: SpecModel,
  notifications: NotificationSpecModel,
  jobs: CatalogInput<JobCatalogSpec>,
  roots: ProductRoots,
  log: ProgressLog,
): Finding[] {
  const result = runNotificationVerification({ domain: model, notifications, jobs, roots });
  if (!result.available) {
    log('N 群(通知仕様): specs/backend/notifications.md が無いためスキップしました。');
    return result.findings;
  }
  log(`N 群(通知仕様): 通知 ${result.notificationCount} 件に対し N0〜N2 を実行しました。`);
  return result.findings;
}

/**
 * 設定仕様検証(K 群)を実行し、実行状況を一行で残す。
 *
 * カタログ(specs/backend/config.md)が無い環境では検証をスキップし、その旨を報告する。
 * K1 は実装の `process.env` 参照を、K2 は雛形(実装の木の `.env.example`)を、K3 は置き場の読み口
 * (`vocabulary.target[].read_by`)を見るので、リポジトリルートを渡す。
 */
export function runConfig(
  config: ConfigSpecModel,
  domainRoot: string,
  roots: ProductRoots,
  layout: ProductLayout,
  log: ProgressLog,
  inboundKeys: readonly string[] = [],
): Finding[] {
  const result = runConfigVerification({ config, repoRoot: detectRepoRoot(domainRoot), roots, layout, inboundKeys });
  if (!result.available) {
    log('K 群(設定仕様): specs/backend/config.md が無いためスキップしました。');
    return result.findings;
  }
  const scope = result.scanned ? 'K1・K2' : 'K2(実装の木が無いため K1 の実装走査はスキップ)';
  const reader =
    result.readerTargetCount > 0
      ? `・K3(読み口を宣言した置き場 ${result.readerTargetCount} 本)`
      : '(読み口を宣言した置き場が無いため K3 は何も見ない)';
  log(`K 群(設定仕様): 設定 ${result.variableCount} 件に対し ${scope}${reader}・K4・K5・K6 を実行しました。`);
  for (const note of result.notes) log(note);
  return result.findings;
}

/** 認証フロー仕様検証への入力(位置引数で並べると数が多く、取り違えても型が通ってしまう)。 */
export interface AuthRunArgs {
  readonly model: SpecModel;
  readonly auth: AuthSpecModel;
  /** 画面仕様の入力の状態(着地・関門の送り先の接地先。阻害なら H2 / H4 は判定を出さず、検査ごとの行で言う)。 */
  readonly screens: CatalogInput<ScreenSpecModel>;
  readonly registry: TcRegistry;
  readonly tests: TestScanResult;
  readonly domainRoot: string;
  /** 製品が宣言した根(H2 が実装の木の有無を判定するのに使う)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(H6 が認証の組み立ての根を引く)。 */
  readonly layout: ProductLayout;
  /** action_spec の入力の状態(H6 が手書きの入口を引く)。 */
  readonly actions: CatalogInput<ActionSpecModel>;
  /** プラットフォームの後段が登録した H5(省略・null は登録なし = 未実施と報告する)。 */
  readonly authConfig?: AuthConfigVerifier | null;
}

/**
 * 認証フロー仕様検証(H 群)を実行し、実行状況を一行で残す。
 *
 * 仕様(specs/backend/auth.md)が無い環境では検証をスキップし、その旨を報告する。
 * H2 は着地先の画面(画面仕様)と関門の実装(app/)を、H3 は台帳と app/ の走査結果を、H5 はプラットフォームのローカル設定を見る
 * (H5 の本体はプラットフォームの後段が登録する。登録が無い・設定ファイルが無いときは「H5: 未実施 — …」の行で言う)。
 */
export function runAuth(args: AuthRunArgs, log: ProgressLog): Finding[] {
  const result = runAuthVerification({
    domain: args.model,
    auth: args.auth,
    screens: args.screens,
    repoRoot: detectRepoRoot(args.domainRoot),
    roots: args.roots,
    layout: args.layout,
    actions: args.actions,
    registry: args.registry,
    tests: args.tests,
    authConfig: args.authConfig ?? null,
  });
  if (!result.available) {
    log('H 群(認証フロー仕様): specs/backend/auth.md が無いためスキップしました。');
    for (const note of describeAuthConfigRun(result.authConfig)) log(note);
    return result.findings;
  }
  const skipped = [
    // 採ったのに読めない(阻害)ときは、材料の行が検査ごとに言う(同じ原因を 2 行で数えない)。採っていないなら画面を前提にする検査は無い。
    result.screensUnselected ? '画面仕様を採っていないため H2・H4 と H6・H8 の画面との突合はスキップ' : null,
    result.testsAvailable ? null : '実装の木が無いため H3 はスキップ',
  ].filter((note) => note !== null);
  const scope = skipped.length === 0 ? 'H1〜H4・H6〜H9' : `H1〜H4・H6〜H9(${skipped.join(' / ')})`;
  const configNotes = describeAuthConfigRun(result.authConfig);
  const withConfig = result.authConfig.state === 'checked' ? `${scope}・H5` : scope;
  log(`H 群(認証フロー仕様): サインインの分岐 ${result.branchCount} 件に対し ${withConfig} を実行しました。`);
  for (const note of configNotes) log(note);
  return result.findings;
}

/** 保証台帳検証への入力(位置引数で並べると数が多く、取り違えても型が通ってしまう)。 */
export interface GuaranteeRunArgs {
  readonly model: SpecModel;
  readonly guarantee: GuaranteeSpecModel;
  readonly registry: TcRegistry;
  readonly tests: ScanWithFramework;
  /** 仕組みの保証台帳の読み込みの結果(省略は渡していない = 未実施。CLI は必ず渡す)。 */
  readonly frameworkLedger?: FrameworkLedgerLoad;
}

/**
 * 保証台帳検証(Z 群)を実行し、実行状況を一行で残す。
 *
 * 製品のカタログ(specs/backend/guarantees.md)が無い環境では製品の分(Z1・Z2)をスキップし、その旨を報告する。
 * 仕組みの台帳に依る Z3 は製品の台帳に依らず走る(仕組みの根を渡していなければ、未実施の行を残す)。
 * Z1 は台帳と app/ の走査結果を見る。verify の「エラー 0」条件には Z2 の warning は影響しない
 * (planned の件数だけ出るのが正解 — guarantee-spec-writing.md)。
 */
export function runGuarantees(args: GuaranteeRunArgs, log: ProgressLog): Finding[] {
  const result = runGuaranteeVerification({
    domain: args.model,
    guarantee: args.guarantee,
    registry: args.registry,
    tests: args.tests,
    ...(args.frameworkLedger === undefined ? {} : { frameworkLedger: args.frameworkLedger }),
  });
  const framework = result.frameworkScanned
    ? `仕組みの保証 ${result.frameworkGuaranteeCount} 件・仕組みの注釈 ${result.frameworkMatched} 件を突き合わせ(Z3)`
    : null;
  if (!result.available) {
    log(
      'Z 群(保証台帳): specs/backend/guarantees.md が無いため製品の分(Z1・Z2)はスキップしました' +
        `${framework === null ? '' : `。${framework}`}。`,
    );
  } else {
    const scope = result.testsAvailable ? 'Z1・Z2' : 'Z1・Z2(実装の木が無いため Z1 の @tc 突合はスキップ)';
    log(
      `Z 群(保証台帳): 保証 ${result.guaranteeCount} 件に対し ${scope} を実行しました` +
        `${framework === null ? '' : `。${framework}`}。`,
    );
  }
  for (const note of result.notes) log(note);
  return result.findings;
}