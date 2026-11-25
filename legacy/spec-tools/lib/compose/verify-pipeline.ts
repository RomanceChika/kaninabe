/**
 * 検証の実行配線(どの仕様種を読み、どの群を、どの順で実行するか)。
 *
 * ここに集めてあるのは「群を 1 本の流れにつなぐ」責務だけである。個々の検査は
 * lib/{verify,trace,query,screen,docs,spec-index} の純粋関数が持ち、この層は
 * **入力の読み込みと配り方**しか知らない。CLI(cli/verify-docs.ts)は引数の解釈と
 * 出力の整形だけを担い、群が増えても変わらない。
 *
 * 配線を CLI に置かずここに置くのは、検査を 1 つ足しても CLI が変わらないようにするためである。
 * **実行状況の 1 行報告は `log` で受け取る**ので、このモジュール自体は console を触らない(規約: scripts-code-quality.md)。
 *
 * 各群のチェック内容の正:
 *   V 群: docs/rules/process/common/specification/standards/domain-spec-writing.md
 *   A 群: docs/rules/process/backend/specification/standards/action-spec-writing.md
 *   Q 群: docs/rules/process/backend/specification/standards/query-spec-writing.md
 *   S 群: docs/rules/process/frontend/specification/standards/screen-spec-writing.md
 *   T 群: docs/rules/architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md §テーブル仕様
 *   N 群: docs/rules/process/backend/specification/standards/notification-spec-writing.md
 *   J 群: docs/rules/process/backend/specification/standards/job-spec-writing.md
 *   K 群: docs/rules/process/backend/specification/standards/config-spec-writing.md
 *   H 群: docs/rules/process/backend/specification/standards/auth-spec-writing.md
 *   M 群: docs/rules/meta/standards/ の各ポリシー(M7〜M9 = 用語の台帳: term-ledger-writing.md)
 *   W 群: docs/rules/process/common/specification/playbooks/dsl-extension-triage.md §軸と語
 *         (W5 = 拡張候補の台帳 legacy/spec-tools/extension-candidates.md。他の全群の結果を見るので最後に実行する)
 *
 * @oversize 全群の読み込みと実行を、1 本の流れ(P 群 → 仕様種の読み込み → 入力の状態の組み立て → V 群 → 各群 → W5)で上から下へ読み通せるようにする配線。
 *   順序が意味を持つ(P 群の宣言が読めなければ以降を飛ばす・A 群の入力の状態を T / J / S / Y / U 群へ同じ値で配る・W5 は最後)ので、`runAllVerifications` の
 *   1 関数の中に並べてある。
 * @split-review 割る案は 2 つ。(1) 読み込み(各仕様種のローダーの呼び出しと入力の状態の組み立て)と実行(各群の呼び出し)を 2 ファイルに割る案: 実行の側が
 *   読み込みの結果(入力の状態 10 本ほか・台帳・テストの走査結果)を全部引数で受ける形になり、1 つの流れを 2 枚の間で行き来して読むことになる。
 *   (2) 群ごとの呼び出しを群のファイルへ出す案: すでに `pipeline-groups*.ts` / `*-group.ts` が群ごとに持っていて、ここに残るのは呼び出しの並びと
 *   入力の配り方だけである。どちらも採らない。
 */

import { loadSpecModel } from '../model/loader.js';
import type { JobTargetRegistry } from '../job/target-checks.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { SpecModel } from '../model/types.js';
import { createGuardServices } from '../guard/services.js';
import type { Finding } from '../kernel/finding.js';
import type { VerifyContext } from '../check-api/contract.js';
import type { ProgressLog } from '../verify/group-contract.js';
import type { TestScanResult, TcRegistry } from '../testcase/types.js';
import { buildTcRegistry } from '../testcase/index.js';
import { availableLoad, catalogInput, inputValue } from '../kernel/input-state.js';
import { selectionOf } from '../model/product/uses.js';
import { runTrace } from '../verify/pipeline-trace.js';
import { runDocs } from '../verify/docs-group.js';
import { runTerms } from '../verify/terms-group.js';
import { runQueryVerification } from '../query/run.js';
import type { QuerySpecModel } from '../model/query/types.js';
import { inboundSignatureKeys } from '../config/inbound-keys.js';
import { type DataRunArgs, runAuth, runConfig, runDataTables, runGuarantees, runNotifications, runSpecIndex } from './verify-pipeline-groups.js';
import { runExternal } from '../verify/external-group.js';
import { runRisk } from '../verify/risk-group.js';
import { scanRichTextSites } from '../risk/rich-text-scan.js';
import { runJobs } from '../verify/jobs-group.js';
import { blockedScreenInputs, runScreens } from '../verify/screens-group.js';
import { readPreviewFragments } from '../generate/book-inputs-loader.js';
import type { ProductRoots } from '../model/product/types.js';
import { runDesign, runGenerality, runUx } from '../verify/pipeline-groups-quality.js';
import { usecaseBudgetDefaultsOf } from '../ux-principles/limits.js';
import { runUsecases } from '../verify/usecase-group.js';
import { gatesInputOf, logReachabilityGaps, reachabilityGapsOf } from '../verify/reachability-notes.js';
import { logOperationInputGaps } from '../verify/operation-input-notes.js';
import {
  appRoutes,
  loadActions,
  loadAuth,
  loadConfig,
  loadSurface,
  loadDataTables,
  loadExternal,
  loadGuarantees,
  loadJobs,
  loadNotifications,
  loadQueries,
  loadScreens,
  loadUsecases,
  loadUxPrinciples,
} from '../verify/load-specs.js';
import { collectRetiredTcIds, collectTcEntries } from '../spec-index/sources.js';
import { loadFrameworkGuaranteeLedger } from '../model/guarantee/framework-loader.js';
import { detectRepoRoot, PRODUCT_DECL_FILE } from '../io/paths.js';
import type { AuthConfigVerifier } from '../auth/platform-config.js';
import { enforcedMfaScope } from '../model/auth/mfa.js';
import { runProduct } from '../product/run.js';
import { scanApplicationRefs } from '../verify/application-ref-scan.js';
import { runDomainWithZ3 } from '../verify/domain-group.js';
import { collectSkipNotes } from '../verify/skip-notes.js';
import { loadExtension, runExtension } from '../verify/extension-group.js';
import { knownCheckIds } from './all-checks.js';
import { mfaAcceptances } from '../auth/verifiers/h6-mfa-requirement.js';
import { logSinkAcceptances } from '../config/verifiers/k5-log-sink.js';
import { bearerAcceptances } from '../risk/verifiers/r16-bearer.js';
import { notBoundaryAcceptances } from '../verify/verifiers/tenant-not-boundary.js';
import type { ExtensionLedgerModel } from '../model/extension/types.js';

/** runAllVerifications の入力。 */
export interface PipelineOptions {
  /** `docs/specs/domain` の絶対パス。他のツリー(backend / frontend / rules / app)はここから導く。 */
  readonly domainRoot: string;
  /** プラットフォームの設定(DB のロール名など)。T 群が生成 SQL を組み立てて前提を見るのに使う。値を選ぶのは組み立ての根だけ。 */
  readonly platform: DataRunArgs['platform'];
  /** 後段が登録した検査と選んだ後段(`verifyInputsOf(選んだ後段)`。`NO_JOB_TARGETS` は後段なしで、受け持つ検査は未実施と報告される)。後段の型は読まない = 束ね役は後段の登録の契約を読まない。 */
  readonly jobTargets: JobTargetRegistry;
  /** プラットフォームの後段が登録した H5(サインインの方式と公開スキーマの突合。`verifyInputsOf(選んだ後段)` が渡す。省略・null は登録なし = 未実施と報告される)。 */
  readonly authConfig?: AuthConfigVerifier | null;
  /** 置き場の配置(役割 → パス。Route Handler の位置・ソースの根を引く。`verifyInputsOf(選んだ後段)` が渡す。値を選ぶのは組み立ての根だけ)。 */
  readonly layout: ProductLayout;
  /** 実行状況の 1 行報告。省略すると何も報告しない(テストから静かに呼べるようにするため)。 */
  readonly log?: ProgressLog;
  /**
   * 仕組みの根の絶対パス(仕組み自身の見張りテストと保証台帳 `framework/guarantees.md` の置き場)。**省略は「渡していない」**で、
   * Z3 は未実施と名指しする(単体テスト用。CLI は `frameworkHostRoot()` を必ず渡す)。製品の `uses`・台帳・実装の木に依らず読む。
   */
  readonly frameworkRoot?: string;
  /**
   * 生成の後の木の回し直し(J 群と X 群は段の宣言 `onGeneratedTree` の段だけを回す。題材の通し実行が使う。fix27 A2)。ほかの群は全部回るので、
   * 呼び手は指摘を `generatedTreeCheckIds()` の ID で絞る。省略は全部の段(CLI の verify)。
   */
  readonly generatedTreeOnly?: boolean;
}

/** runAllVerifications の結果。 */
export interface PipelineResult {
  /** 全群の Finding(実行順)。 */
  readonly findings: readonly Finding[];
  /**
   * ドメインモデルを構築できたか。
   * false なら V2 以降は 1 つも実行していない(CLI がその旨を出す)。
   */
  readonly modelBuilt: boolean;
  /**
   * 実行中に「飛ばした」と報告した進捗行(`app/` が無い等で検査の範囲が縮んだ範囲)。
   * CLI がサマリの末尾に件数を出す —— 範囲が縮んだ検査を緑が広く見せないため。
   */
  readonly skipNotes: readonly string[];
  /** 拡張候補の台帳(警告の区分に使う。製品に依らないので、モデルを構築できなかった実行でも載る)。 */
  readonly extensionLedger: ExtensionLedgerModel;
}

/** 何もしない報告先。 */
const SILENT: ProgressLog = () => undefined;

/**
 * 製品が置いたプレビューの断片を画面の検査の入力にする(S22)。
 *
 * @param repoRoot リポジトリルート
 * @param roots 製品の根
 * @returns 入力の断片(置き場が無ければ空)
 */
function previewsOf(repoRoot: string, roots: ProductRoots): { readonly previews?: ReadonlyMap<string, string> } {
  const previews = readPreviewFragments(repoRoot, roots);
  return previews === undefined ? {} : { previews };
}

/**
 * 全群の検証を実行する。仕様種はすべてここで読み、テストケース ID 台帳は 1 回だけ作って
 * 各群へ配る(同じ事実の入力口を 1 つに保つため。A9 は仕様種の有無に依存しない)。
 *
 * @param options 走査の起点と実行状況の報告先
 * @returns 全 Finding と、モデルを構築できたか
 */
export async function runAllVerifications(options: PipelineOptions): Promise<PipelineResult> {
  const { domainRoot } = options;
  const collector = collectSkipNotes(options.log ?? SILENT);
  const log = collector.log;
  const extension = loadExtension();
  const extensionLedger = extension.model;

  // P 群を最初に実行する。**走査ルートそのものがこの宣言から出る**ので、宣言が読めないうちは
  // 他の群を実行しても嘘の位置を見ることになる(空振りの緑が一番危ない)。
  const repoRoot = detectRepoRoot(domainRoot);
  const product = runProduct(repoRoot);
  const findings: Finding[] = [...product.findings];
  const roots = product.product.roots;
  const uses = product.uses;
  if (roots === null || uses === null) {
    log(`P 群(製品の根の宣言): ${PRODUCT_DECL_FILE} を読めないため以降の群はスキップしました。`);
    return { findings, modelBuilt: false, skipNotes: collector.notes, extensionLedger };
  }
  log(`P 群(製品の根の宣言): ${PRODUCT_DECL_FILE} の根を読みました(実装の木 ${roots.app ?? '(宣言なし)'})。`);

  const { model, findings: loadFindings } = loadSpecModel(domainRoot);
  findings.push(...loadFindings);
  if (model === null) return { findings, modelBuilt: false, skipNotes: collector.notes, extensionLedger };

  const applicationRefScan = scanApplicationRefs(repoRoot, roots, options.layout);
  // A0 は読み込んだ側がここで 1 回だけ全体へ足す。V 群・A 群の入力の状態(`actionsInput`)には同じ診断を別に渡す。
  // **採っていない種類は読み込まない**(置き場が無いと A0 が「ディレクトリが見つかりません」と言うが、採っていないなら無くて正しい。
  // 置き場にあるのに採っていない形は P2 が見ている)。採ったのに無い・読めないのは従来どおり A0 と P2 が言う。
  const actionLoadFindings: Finding[] = [];
  const actionsLoaded = selectionOf(uses, 'actions') === 'selected' ? loadActions(domainRoot, actionLoadFindings) : { model: null, dropped: 0 };
  const actions = actionsLoaded.model;
  findings.push(...actionLoadFindings);
  // Q0 は A13 の jobs と同じく、読み込んだ側がここで 1 回だけ全体へ足す。索引の要求(関係の層)には同じ診断を別に渡す(全体へは足し直さない)。
  const queryLoadFindings: Finding[] = [];
  const queriesLoaded = loadQueries(domainRoot, queryLoadFindings);
  const queries = queriesLoaded.model;
  findings.push(...queryLoadFindings);
  // S0 は読み込んだ側がここで 1 回だけ全体へ足す。画面の到達の入力の状態(reachabilityGaps)には同じ診断を別に渡す。
  const screenLoadFindings: Finding[] = [];
  const screensLoaded = loadScreens(domainRoot, screenLoadFindings, roots, options.layout);
  const screens = screensLoaded.model;
  findings.push(...screenLoadFindings);
  // T0 は読み込んだ側がここで 1 回だけ全体へ足す。A 群・V 群の入力の状態(`dataTablesInput`)には同じ診断を別に渡す。
  const dataTableLoadFindings: Finding[] = [];
  const dataTablesLoaded = loadDataTables(domainRoot, dataTableLoadFindings);
  const dataTables = dataTablesLoaded.model;
  findings.push(...dataTableLoadFindings);
  // N0 は読み込んだ側がここで 1 回だけ全体へ足す。操作の属性の導出が読む材料の入力の状態(`notificationsInput`)には、落とした数だけを別に渡す。
  const notificationsLoaded = loadNotifications(domainRoot, findings);
  const notifications = notificationsLoaded.model;
  // J0 は読み込んだ側がここで 1 回だけ全体へ足す。A13 には同じ診断を別に渡す(入力の状態の一部)が、全体へは足し直さない(二重に数えない)。
  const jobLoadFindings: Finding[] = [];
  const jobsLoaded = loadJobs(domainRoot, jobLoadFindings);
  const jobs = jobsLoaded.model;
  findings.push(...jobLoadFindings);
  // K0 は読み込んだ側がここで 1 回だけ全体へ足す。X 群(X2)の入力の状態(`configInput`)には同じ診断を別に渡す。
  const configLoadFindings: Finding[] = [];
  const configLoaded = loadConfig(domainRoot, configLoadFindings);
  const config = configLoaded.model;
  findings.push(...configLoadFindings);
  // H0 は読み込んだ側がここで 1 回だけ全体へ足す。画面の到達の入力の状態(関門 `gates`。reachabilityGaps)には同じ診断を別に渡す。
  const authLoadFindings: Finding[] = [];
  const authLoaded = loadAuth(domainRoot, authLoadFindings);
  const auth = authLoaded.model;
  findings.push(...authLoadFindings);
  const guarantees = loadGuarantees(domainRoot, findings);
  // 仕組みの保証台帳は製品の `uses` に依らず読む(製品が外せない義務)。Z0 は読み込んだ側がここで 1 回だけ全体へ足す。
  const frameworkLedger = loadFrameworkGuaranteeLedger(options.frameworkRoot);
  if (frameworkLedger.state !== 'not_requested') findings.push(...frameworkLedger.findings);
  const uxPrinciples = loadUxPrinciples(domainRoot, findings);
  // Y0 は読み込んだ側がここで 1 回だけ全体へ足す。置き場の取り合い(A2 の続き)の入力の状態(`usecasesInput`)には同じ診断を別に渡す。
  const usecaseLoadFindings: Finding[] = [];
  const usecasesLoaded = loadUsecases(domainRoot, usecaseLoadFindings);
  const usecases = usecasesLoaded.model;
  findings.push(...usecaseLoadFindings);
  // X0 は読み込んだ側がここで 1 回だけ全体へ足す。A 群(A10)の入力の状態(`externalInput`)には同じ診断を別に渡す。
  const externalLoadFindings: Finding[] = [];
  const externalLoaded = loadExternal(domainRoot, externalLoadFindings);
  const external = externalLoaded.model;
  findings.push(...externalLoadFindings);
  // SQL の公開面(surface_spec)の読み込みの診断は読み込んだ側がここで 1 回だけ全体へ足す。T 群の入力の状態(`surfaceInput`)には同じ診断を別に渡す。
  const surfaceLoadFindings: Finding[] = [];
  const surfaceLoaded = loadSurface(domainRoot, surfaceLoadFindings);
  const surface = surfaceLoaded.model;
  findings.push(...surfaceLoadFindings);

  // 他の種類を読む検査へ渡す入力の状態(未選択 / 阻害 / 読込済み)。選択は `uses` の宣言で決め、ファイルの有無から推定しない。
  // 読み込みの error があっても、**モデルから仕様を落としていなければ**(`dropped` が 0。id の不一致のように読めた上での違反)読込済みとして
  // 検査を回す。落としたとき(読めずに捨てた仕様・行がある)だけ阻害。どの種類も落とした数を数える(カタログ 1 枚の中の行も含む)。
  const actionsInput = catalogInput(selectionOf(uses, 'actions'), {
    model: { available: actions !== null, catalog: actions },
    findings: actionLoadFindings,
    dropped: actionsLoaded.dropped,
  });
  // action_spec を読む群(T / J / S / Y / U)へ渡すのは、A 群・V 群と**同じ入力の状態**から取った値(読込済みのときだけモデル。未選択も阻害も null)。
  // 読めなかった仕様があるモデルを群ごとに部分のまま使うと、A 群が止まるのに他の群は走る食い違いになる。台帳の材料(下の `registry`)は読めた宣言を全部集めるので、生の `actions` を使う。
  const actionsForGroups = inputValue(actionsInput) ?? null;
  const dataTablesInput = catalogInput(
    selectionOf(uses, 'data_tables'),
    availableLoad(dataTables, dataTableLoadFindings, dataTablesLoaded.dropped),
  );
  const externalInput = catalogInput(selectionOf(uses, 'external'), { model: external, findings: externalLoadFindings, dropped: externalLoaded.dropped });
  // 置き場の取り合い(A2 の続き)が読むユースケース仕様は、`uses` で絞る(採っていない種類の仕様が置き場に残っていても主張に入れない。生成側の `isOpen('usecases')` と同じ基準)。
  const usecasesInput = catalogInput(selectionOf(uses, 'usecases'), availableLoad(usecases, usecaseLoadFindings, usecasesLoaded.dropped));
  // 画面・UX・ユースケース・ジョブの検査が他の種類から引く材料の入力の状態(使えなかったことは下の `logOperationInputGaps` が言う)。
  const notificationsInput = catalogInput(selectionOf(uses, 'notifications'), { model: notifications, findings: [], dropped: notificationsLoaded.dropped });
  const screensInput = catalogInput(selectionOf(uses, 'screens'), availableLoad(screens, screenLoadFindings, screensLoaded.dropped));
  // 認証フローの関門の入力の状態(画面の到達と、ユースケースの前提の導出が読む。画面の到達の入力の状態〔`reachabilityGaps`〕と同じ値)。
  const gatesInput = gatesInputOf(uses, auth, authLoadFindings, authLoaded.dropped);

  // V 群は**仕様種を読み終えてから**実行する(V16 は action_spec の input を、V17 は data_table の機構の宣言まで見るため)。
  const ctx: VerifyContext = {
    guards: createGuardServices(),
    roots,
    ...(applicationRefScan.available ? { applicationRefs: applicationRefScan } : {}),
    actions: actionsInput,
    dataTables: dataTablesInput,
  };
  findings.push(...(await runDomainWithZ3(model, ctx, log)));

  const registry = buildTcRegistry(
    collectTcEntries({
      actions,
      queries,
      screens,
      dataTables,
      notifications,
      jobs,
      auth,
      guarantees,
      frameworkGuarantees: frameworkLedger.state === 'loaded' ? frameworkLedger.model : null,
      external,
      usecases,
    }),
    collectRetiredTcIds(actions),
  );
  findings.push(...runSpecIndex(registry, log));
  const jobsInput = catalogInput(selectionOf(uses, 'jobs'), { model: jobs, findings: jobLoadFindings, dropped: jobsLoaded.dropped });
  const configInput = catalogInput(selectionOf(uses, 'config'), { model: config, findings: configLoadFindings, dropped: configLoaded.dropped });
  const trace = runTrace(
    {
      model,
      domainRoot,
      actions: actionsInput,
      registry,
      jobs: jobsInput,
      dataTables: dataTablesInput,
      guards: ctx.guards,
      external: externalInput,
      roots,
      layout: options.layout,
      usecases: usecasesInput,
      ...(options.frameworkRoot === undefined ? {} : { frameworkRoot: options.frameworkRoot }),
    },
    log,
  );
  findings.push(...trace.findings);
  findings.push(...runQueries(model, queries, trace.tests, registry, ctx.guards, log));
  const queriesInput = catalogInput(selectionOf(uses, 'queries'), availableLoad(queries, queryLoadFindings, queriesLoaded.dropped));
  const surfaceInput = catalogInput(selectionOf(uses, 'surface'), availableLoad(surface, surfaceLoadFindings, surfaceLoaded.dropped));
  // T 群は、テーブル仕様と、裏づけに読むほかの種類(action_spec・ジョブ・ユースケース・外部連携・surface)を**入力の状態のまま**受ける
  // (未選択 = 裏づけが無い事実 / 阻害 = 依る判定を出さず、見ていないことを行で言う)。
  const dataArgs = {
    model,
    dataTables: dataTablesInput,
    queries: queriesInput,
    guards: ctx.guards,
    registry,
    tests: trace.tests,
    actions: actionsInput,
    jobs: jobsInput,
    usecases: usecasesInput,
    external: externalInput,
    surface: surfaceInput,
    repoRoot,
    roots,
    platform: options.platform,
    layout: options.layout,
  };
  findings.push(...runDataTables(dataArgs, log));
  findings.push(...runNotifications(model, notifications, jobsInput, roots, log));
  findings.push(...runJobs(model, jobs, domainRoot, roots, log, options.jobTargets, options.layout, externalInput, actionsForGroups ?? undefined, auth, screens, options.generatedTreeOnly));
  findings.push(...runConfig(config, domainRoot, roots, options.layout, log, inboundSignatureKeys(external.catalog)));
  findings.push(
    ...runAuth({ model, auth, screens: screensInput, registry, tests: trace.tests, domainRoot, roots, layout: options.layout, actions: actionsInput, authConfig: options.authConfig ?? null }, log),
  );
  findings.push(...runGuarantees({ model, guarantee: guarantees, registry, tests: trace.tests, frameworkLedger }, log));
  findings.push(...runExternal({ model, external: externalInput, config: configInput, dataTables: dataTablesInput, actionSpecs: actionsInput, registry, tests: trace.tests, domainRoot, roots, layout: options.layout, mfaEnforced: enforcedMfaScope(auth.flow?.mfa) !== null, ...(options.generatedTreeOnly === true ? { generatedTreeOnly: true } : {}) }, log));
  // R 群(危ない形)は役の根拠の欄の書き手を、作成・遷移の入力(action_spec・ユースケース)と内部実行の入口(認証フロー・受信・走査)まで追うので、
  // それらの種類を入力の状態のまま受ける(阻害なら依る判定を出さず、見ていないことを行で言う)。
  const authInput = catalogInput(selectionOf(uses, 'auth'), {
    model: { available: auth.available, catalog: auth.flow },
    findings: authLoadFindings,
    dropped: authLoaded.dropped,
  });
  findings.push(
    ...runRisk(
      { model, actions: actionsInput, dataTables: dataTablesInput, auth: authInput, external: externalInput, jobs: jobsInput, config: configInput, richText: scanRichTextSites(repoRoot, roots, options.layout), screenRoutes: screens.available ? screens.screens.map(({ id, route, location }) => ({ id, route, location })) : null },
      log,
      options.jobTargets,
    ),
  );
  // 画面の到達を読む検査(S13・S16・Y3・Y5)が共有する、画面と認証フローの関門の入力の状態(使えないとき判定を出さず、下で行を言う)。
  const reachabilityGaps = reachabilityGapsOf({ domain: model, screens, loadFindings: screenLoadFindings, dropped: screensLoaded.dropped, uses, auth, authLoadFindings, authDropped: authLoaded.dropped });
  findings.push(
    ...runScreens(
      {
        model,
        queries,
        screens,
        app: appRoutes(domainRoot, roots, options.layout),
        ...previewsOf(detectRepoRoot(domainRoot), roots),
        registry,
        tests: trace.tests,
        auth,
        usecases,
        actions: actionsForGroups,
        // 確認の要否の導出が読むカタログは読めた分だけ(読めなかった分は下の `logOperationInputGaps` が見ていないと言う)。
        catalogs: { dataTables, notifications, jobs },
        reachabilityGaps,
        // 読み取りクエリ・ユースケースが阻害なら、それに依る画面の判定は出さない(下の `logOperationInputGaps` が検査ごとに言う)。
        blockedInputs: blockedScreenInputs({ queries: queriesInput, usecases: usecasesInput }),
      },
      ctx.guards,
      roots,
      options.layout,
      log,
    ),
  );
  findings.push(
    ...runUsecases(
      {
        domain: model,
        usecases,
        actions: actionsForGroups,
        screens,
        gates: gatesInput,
        catalogs: { dataTables, notifications, jobs },
        budgetDefaults: usecaseBudgetDefaultsOf(uxPrinciples),
      },
      { guards: ctx.guards, dataTables: dataTablesInput, actions: actionsInput, registry, tests: trace.tests, reachabilityGaps },
      log,
    ),
  );
  logReachabilityGaps(reachabilityGaps, { usecases, screens }, log);
  // 他の種類から引く材料(action_spec・確認の要否の導出が読むカタログ・ジョブが読む画面・画面が読む読み取りクエリとユースケース・通知が読むジョブ・認証フローが読む画面)のうち、
  // 採ったのに使えなかったものは、読む検査ごとに見ていないと言う。
  // 群ごとに渡すのは読めた分(カタログ・画面)か、読込済みのときだけのモデル(action_spec)。落とした表は表の名前つきで言う。
  logOperationInputGaps(
    {
      actions: actionsInput,
      dataTables: dataTablesInput,
      notifications: notificationsInput,
      jobs: jobsInput,
      screens: screensInput,
      queries: queriesInput,
      usecases: usecasesInput,
      config: configInput,
    },
    {
      screens: screens.available,
      usecases: usecases.available,
      jobs: jobs.available,
      // HTTP の入口の衝突はジョブのカタログの有無に依らず、実装の木を宣言していれば回る(`runJobVerification` の `entryCollisionRan` = `roots.app !== null` と同じ条件)。
      jobEntries: roots.app !== null,
      notifications: notifications.available,
      auth: auth.available,
      generality: true,
    },
    log,
  );
  findings.push(
    ...runUx(model, screens, uxPrinciples, ctx.guards, { catalogs: { dataTables, notifications, jobs }, actions: actionsInput }, log),
  );
  findings.push(...runDesign(domainRoot, roots, options.layout, log));
  findings.push(...runGenerality(model, notifications, jobs, config, domainRoot, roots, options.layout, log));
  findings.push(...runDocs(domainRoot, roots, log));
  findings.push(...runTerms(domainRoot, roots, log));
  // W5 は他の全群の結果を見るので最後。受け入れた危険の宣言(警告の acceptance の突合相手)は読めた仕様から集める
  findings.push(...runExtension(extension, findings, knownCheckIds(), [...mfaAcceptances(auth.flow), ...bearerAcceptances(model), ...logSinkAcceptances(config), ...notBoundaryAcceptances(model)], log));
  return { findings, modelBuilt: true, skipNotes: collector.notes, extensionLedger };
}

/**
 * クエリ検証(Q 群)を実行し、実行状況を一行で残す。
 *
 * specs/backend/queries が無い環境では検証をスキップし、その旨を報告して壊れないようにする。
 */
function runQueries(
  model: SpecModel,
  queries: QuerySpecModel,
  tests: TestScanResult,
  registry: TcRegistry,
  guards: VerifyContext['guards'],
  log: ProgressLog,
): Finding[] {
  const result = runQueryVerification({ domain: model, queries, tests, registry, context: { guards } });
  if (!result.available) {
    log('Q 群(読み取りクエリ仕様): specs/backend/queries が無いためスキップしました。');
    return result.findings;
  }
  const scope = tests.available ? 'Q1〜Q8' : 'Q1〜Q8(実装の木が無いため Q6 の @tc 突合はスキップ)';
  const exceptionCount = queries.queries.reduce((sum, query) => sum + query.exceptions.length, 0);
  log(
    `Q 群(読み取りクエリ仕様): query_spec ${result.queryCount} 件に対し ${scope} を実行しました` +
      `(ESLint 免除・理由つき受け入れ ${exceptionCount} 件)。`,
  );
  return result.findings;
}
