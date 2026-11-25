/**
 * 画面検証(S 群)の配線(lib/compose/verify-pipeline.ts が呼ぶ)。
 *
 * 入力の読み込み位置と報告の文言だけを持つ(M 群の `docs-group.ts` / X 群の `external-group.ts`
 * と同じ形)。
 */

import type { Finding } from '../kernel/finding.js';
import type { VerifyContext } from '../check-api/contract.js';
import type { ProgressLog } from './group-contract.js';
import type { SpecModel } from '../model/types.js';
import type { QuerySpecModel } from '../model/query/types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import type { AppRoutesModel } from '../model/screen/app-types.js';
import type { AuthSpecModel } from '../model/auth/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { TestScanResult, TcRegistry } from '../testcase/types.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import { runScreenVerification } from '../screen/run.js';
import type { ScreenContext, ScreenForeignInput } from '../screen/verifier.js';
import type { CatalogInput } from '../kernel/input-state.js';
import { deriveOperationAttributes } from '../semantics/operation-attributes.js';
import type { OperationCatalogs } from '../semantics/operation-catalogs.js';
import type { ReachabilityGap } from '../relations/screen-reachability/index.js';
import { describeMissingRole } from './check-run-report.js';
import { verifierRange } from './verifier-range.js';

/** 画面検証への入力(位置引数で並べると数が多く、取り違えても型が通ってしまう)。 */
export interface ScreenRunArgs {
  readonly model: SpecModel;
  readonly queries: QuerySpecModel;
  readonly screens: ScreenSpecModel;
  readonly app: AppRoutesModel;
  readonly registry: TcRegistry;
  readonly tests: TestScanResult;
  readonly auth: AuthSpecModel;
  /** 製品が置いたプレビューの断片(S22)。 */
  readonly previews?: ReadonlyMap<string, string>;
  readonly usecases: UsecaseSpecModel;
  /** 読み込み済みの action_spec(無ければ null)。 */
  readonly actions: ActionSpecModel | null;
  /** 操作の属性の導出が読むカタログ(S19 が確認の要否を、Y5 と同じ導出で出すのに使う。省略は「カタログがまだ無い」)。 */
  readonly catalogs?: OperationCatalogs;
  /** 画面の到達の入力のうち使えなかったもの(S13・S16 が判定を出さない。空は「使える」。**必須**)。行は呼び手(pipeline)が言う。 */
  readonly reachabilityGaps: readonly ReachabilityGap[];
  /** 画面の検査が他の種類から引く材料のうち阻害のもの(`blockedScreenInputs` で作る。**必須**)。阻害の材料に依る判定は出さない(行は呼び手が言う)。 */
  readonly blockedInputs: readonly ScreenForeignInput[];
}

/**
 * 画面の検査が他の種類から引く材料(読み取りクエリ・ユースケース)の入力の状態から、阻害のものを決める。
 * 未選択は事実として無い(載せない)・読込済みは使える(載せない)。
 *
 * @param states 材料の入力の状態
 */
export function blockedScreenInputs(states: {
  readonly queries: CatalogInput<unknown>;
  readonly usecases: CatalogInput<unknown>;
}): readonly ScreenForeignInput[] {
  return (['queries', 'usecases'] as const).filter((kind) => states[kind].state === 'blocked');
}

/**
 * 画面検証(S 群)を実行し、実行状況を一行で残す。
 *
 * specs/frontend/screens が無い環境では検証をスキップし、その旨を報告して壊れないようにする。
 */
export function runScreens(
  args: ScreenRunArgs,
  guards: VerifyContext['guards'],
  roots: ProductRoots,
  layout: ProductLayout,
  log: ProgressLog,
): Finding[] {
  const result = runScreenVerification({
    domain: args.model,
    queries: args.queries,
    screens: args.screens,
    app: args.app,
    registry: args.registry,
    tests: args.tests,
    auth: args.auth,
    usecases: args.usecases,
    ...(args.previews === undefined ? {} : { previews: args.previews }),
    context: {
      guards,
      roots,
      layout,
      manualOperations: manualOperationsOf(args.actions),
      operationInputs: operationInputsOf(args.actions),
      confirmRequiredOperations: confirmRequiredOperationsOf(args.model, args.catalogs ?? {}, args.actions),
      reachabilityGaps: args.reachabilityGaps,
      blockedInputs: args.blockedInputs,
    },
  });
  if (!result.available) {
    log('S 群(画面仕様): specs/frontend/screens が無いためスキップしました。');
    return result.findings;
  }
  const scope = [
    // 採ったのに読めない(阻害)ときは、材料の行が検査ごとに言う(同じ原因を 2 行で数えない)。
    args.queries.available || args.blockedInputs.includes('queries') ? null : 'query_spec が無いため reads の突合はスキップ',
    result.appAvailable ? null : args.app.placementProblem === undefined ? '実装の木が無いため S7 はスキップ' : 'S7 は置き場の配置が画面の器の走査を決められないため前提の失敗',
    result.testsAvailable ? null : '実装の木が無いため S8 の @tc 突合はスキップ',
    args.auth.available ? null : 'auth_spec が無いため S13 の role_gate 判定はスキップ',
  ].filter((note) => note !== null);
  const suffix = scope.length === 0 ? '' : `(${scope.join(' / ')})`;
  log(
    `S 群(画面仕様): screen_spec ${result.screenCount} 件 / chrome_spec ${result.chromeCount} 件に対し ` +
      `${verifierRange(result.verifierIds)}${suffix} を実行しました。`,
  );
  // 配置にリクエスト前段が無いなら、S7 の matcher の被覆は見ていない(黙って緑にしない。語は未実施と同じ = 範囲サマリの件数に入る)。
  if (args.app.requestGateMissing === true) log(describeMissingRole('S7', 'request-gate(リクエスト前段)', '要ログイン画面の matcher の被覆'));
  return result.findings;
}

/** `runner: manual` を宣言した操作の ID(S17 が、フォームの材料が計画に無い操作を載せていないかを見る)。 */
function manualOperationsOf(actions: ActionSpecModel | null): ReadonlySet<string> {
  return new Set(
    (actions?.actions ?? []).filter((action) => action.runner !== undefined).map((action) => action.handles.raw),
  );
}

/** 操作 ID → 入力の欄(S18 が、フォームの参照欄の選択肢の読みと操作の入力の ref の欄を突き合わせる)。 */
function operationInputsOf(actions: ActionSpecModel | null): ScreenContext['operationInputs'] {
  return new Map(
    (actions?.actions ?? []).map((action) => [
      action.handles.raw,
      action.input.map((item) => ({ entity: item.entity, field: item.field })),
    ]),
  );
}

/** 確認が要る操作の ID(S19 が、確認の器の要否を見る。Y5 と画面の生成が読むのと同じ導出 — 意味解析の層の 1 本)。 */
function confirmRequiredOperationsOf(
  model: SpecModel,
  catalogs: OperationCatalogs,
  actions: ActionSpecModel | null,
): ScreenContext['confirmRequiredOperations'] {
  return new Set(
    (actions?.actions ?? [])
      .filter((action) => deriveOperationAttributes(model, catalogs, action.handles.raw, action).confirmRequired)
      .map((action) => action.handles.raw),
  );
}
