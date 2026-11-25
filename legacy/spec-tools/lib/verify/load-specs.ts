/**
 * 仕様種ごとのローダー呼び出し(どのディレクトリを、どの起点から読むか)。
 *
 * 「どこにあるか」を知っているのはこの 1 ファイルだけである。検証器もローダー本体も
 * ツリーの位置を知らず(規約: scripts-code-quality.md)、配線(lib/compose/verify-pipeline.ts)は
 * 「読めたモデル」だけを受け取って群へ配る。
 *
 * どのローダーも**読めない環境で壊れない**。specs/backend/actions が無ければ null、
 * specs/backend/queries や specs/frontend が無ければ `available: false` の空モデルを返し、
 * 対応する群が「スキップした」と報告できる形にする。
 */

import path from 'node:path';
import type { Finding } from '../kernel/finding.js';
import { loadActionSpecModel } from '../model/trace/loader.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import { loadQuerySpecModel } from '../model/query/loader.js';
import type { QuerySpecModel } from '../model/query/types.js';
import { loadScreenSpecModel } from '../model/screen/loader.js';
import { loadAppRoutes } from '../screen/app-loader.js';
import type { AppRoutesModel } from '../model/screen/app-types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import { loadDataTableSpecModel } from '../model/data/loader.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import { loadNotificationSpecModel } from '../model/notification/loader.js';
import type { NotificationSpecModel } from '../model/notification/types.js';
import { loadJobSpecModel } from '../model/job/loader.js';
import type { JobSpecModel } from '../model/job/types.js';
import { loadConfigSpecModel } from '../model/config/loader.js';
import type { ConfigSpecModel } from '../model/config/types.js';
import { loadAuthSpecModel } from '../model/auth/loader.js';
import type { AuthSpecModel } from '../model/auth/types.js';
import { loadGuaranteeSpecModel } from '../model/guarantee/loader.js';
import { loadUxPrinciplesModel, UX_PRINCIPLES_FILE } from '../model/ux-principles/loader.js';
import type { UxPrinciplesModel } from '../model/ux-principles/types.js';
import type { GuaranteeSpecModel } from '../model/guarantee/types.js';
import { loadSurfaceSpecModel } from '../model/surface/loader.js';
import type { SurfaceSpecModel } from '../model/surface/types.js';
import { loadExternalSpecModel } from '../model/external/loader.js';
import type { ExternalSpecModel } from '../model/external/types.js';
import { loadUsecaseSpecModel } from '../model/usecase/loader.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import { detectRepoRoot } from '../io/paths.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import { appPath } from '../model/product/paths.js';
import { unavailableAppRoutes } from '../screen/app-loader.js';

/**
 * 読み込んだモデルと、モデルへ入れずに捨てた仕様・宣言の数(入力の状態を決める側が「欠けているか」を見るのに使う)。
 * 数が 0 なら、読み込みの診断が残っていてもモデルは欠けていない。
 */
export interface LoadedSpecs<T> {
  readonly model: T;
  readonly dropped: number;
}

/**
 * action_spec を読み込む(A0)。
 *
 * テストケース ID 台帳の材料になるため、トレース検証の実行より先に読む。
 * specs/backend/actions が無い / スキーマ違反で 1 件も読めない環境ではモデルが null。
 */
export function loadActions(domainRoot: string, findings: Finding[]): LoadedSpecs<ActionSpecModel | null> {
  const loaded = loadActionSpecModel(path.join(path.dirname(domainRoot), 'backend', 'actions'), {
    repoRoot: detectRepoRoot(domainRoot),
  });
  findings.push(...loaded.findings);
  return { model: loaded.model, dropped: loaded.dropped };
}

/**
 * query_spec を読み込む(Q0)。
 *
 * テストケース ID 台帳(A6 の orphan 判定・A9 の一意性検査の母集合)の材料になるため、
 * 各群の実行より先に読む。specs/backend/queries が無い環境では `available: false` の空モデル。
 */
export function loadQueries(domainRoot: string, findings: Finding[]): LoadedSpecs<QuerySpecModel> {
  const loaded = loadQuerySpecModel(path.join(path.dirname(domainRoot), 'backend', 'queries'), {
    repoRoot: detectRepoRoot(domainRoot),
  });
  findings.push(...loaded.findings);
  return { model: loaded.model, dropped: loaded.dropped };
}

/**
 * screen_spec / chrome_spec を読み込む(S0)。
 *
 * テストケース ID 台帳の材料になるため、各群の実行より先に読む。
 * specs/frontend/screens が無い環境では `available: false` の空モデル。
 */
export function loadScreens(
  domainRoot: string,
  findings: Finding[],
  roots: ProductRoots,
  layout: ProductLayout,
): LoadedSpecs<ScreenSpecModel> {
  const loaded = loadScreenSpecModel(path.join(path.dirname(domainRoot), 'frontend'), {
    repoRoot: detectRepoRoot(domainRoot),
    roots,
    layout,
  });
  findings.push(...loaded.findings);
  return { model: loaded.model, dropped: loaded.dropped };
}

/**
 * data_table(テーブル仕様)を読み込む(T0)。
 *
 * テストケース ID 台帳の材料になるため、各群の実行より先に読む。
 * specs/backend/data/tables が無い環境では `available: false` の空モデル。
 */
export function loadDataTables(domainRoot: string, findings: Finding[]): LoadedSpecs<DataTableSpecModel> {
  const loaded = loadDataTableSpecModel(
    path.join(path.dirname(domainRoot), 'backend', 'data', 'tables'),
    { repoRoot: detectRepoRoot(domainRoot) },
  );
  findings.push(...loaded.findings);
  return { model: loaded.model, dropped: loaded.dropped };
}

/**
 * 通知カタログ(notification_spec)を読み込む(N0)。
 *
 * テストケース ID 台帳の材料になるため、各群の実行より先に読む。
 * ファイルが無い環境では `available: false` の空モデル。
 */
export function loadNotifications(domainRoot: string, findings: Finding[]): LoadedSpecs<NotificationSpecModel> {
  const loaded = loadNotificationSpecModel(
    path.join(path.dirname(domainRoot), 'backend', 'notifications.md'),
    { repoRoot: detectRepoRoot(domainRoot) },
  );
  findings.push(...loaded.findings);
  return { model: loaded.model, dropped: loaded.dropped };
}

/**
 * ジョブカタログ(job_spec)を読み込む(J0)。
 *
 * テストケース ID 台帳の材料になるため、各群の実行より先に読む。
 * ファイルが無い環境では `available: false` の空モデル。
 */
export function loadJobs(domainRoot: string, findings: Finding[]): LoadedSpecs<JobSpecModel> {
  const loaded = loadJobSpecModel(path.join(path.dirname(domainRoot), 'backend', 'jobs.md'), {
    repoRoot: detectRepoRoot(domainRoot),
  });
  findings.push(...loaded.findings);
  return { model: loaded.model, dropped: loaded.dropped };
}

/**
 * 設定カタログ(config_spec)を読み込む(K0)。
 *
 * ファイルが無い環境では `available: false` の空モデル。
 * 実装の `process.env` 参照・雛形との突合は K1 / K2 が行う(このモデルはその材料)。
 */
export function loadConfig(domainRoot: string, findings: Finding[]): LoadedSpecs<ConfigSpecModel> {
  const loaded = loadConfigSpecModel(path.join(path.dirname(domainRoot), 'backend', 'config.md'), {
    repoRoot: detectRepoRoot(domainRoot),
  });
  findings.push(...loaded.findings);
  return { model: loaded.model, dropped: loaded.dropped };
}

/**
 * 認証フロー仕様(auth_spec)を読み込む(H0)。
 *
 * テストケース ID 台帳の材料になるため、各群の実行より先に読む。
 * ファイルが無い環境では `available: false` の空モデル。
 */
export function loadAuth(domainRoot: string, findings: Finding[]): LoadedSpecs<AuthSpecModel> {
  const loaded = loadAuthSpecModel(path.join(path.dirname(domainRoot), 'backend', 'auth.md'), {
    repoRoot: detectRepoRoot(domainRoot),
  });
  findings.push(...loaded.findings);
  return { model: loaded.model, dropped: loaded.dropped };
}

/**
 * 保証台帳(guarantee_spec)を読み込む(Z0)。
 *
 * テストケース ID 台帳の材料になるため、各群の実行より先に読む。
 * ファイルが無い環境では `available: false` の空モデル。
 */
export function loadGuarantees(domainRoot: string, findings: Finding[]): GuaranteeSpecModel {
  const loaded = loadGuaranteeSpecModel(path.join(path.dirname(domainRoot), 'backend', 'guarantees.md'), {
    repoRoot: detectRepoRoot(domainRoot),
  });
  findings.push(...loaded.findings);
  return loaded.model;
}

/**
 * UX 原則の台帳(ux_principles_spec)を読み込む(U8)。
 *
 * U 群の閾値とユースケースの予算の既定値が読むので、各群の実行より先に読む。
 * ファイルが無い環境では `available: false` の空モデル(検査器の定数が既定値になる)。
 */
export function loadUxPrinciples(domainRoot: string, findings: Finding[]): UxPrinciplesModel {
  const loaded = loadUxPrinciplesModel(path.join(path.dirname(domainRoot), 'frontend', UX_PRINCIPLES_FILE), {
    repoRoot: detectRepoRoot(domainRoot),
  });
  findings.push(...loaded.findings);
  return loaded.model;
}

/**
 * surface の仕様(surface_spec)を読み込む。
 *
 * T12 が「外から届く surface」の宣言を見るのに使う。ファイルが無い環境では `available: false` の
 * 空モデル(surface の仕様書をまだ開設していないリポジトリでは surface の生成そのものが無い)。
 *
 * @param domainRoot specs/domain の絶対パス
 * @param findings 違反の記録先
 * @returns 読み込んだモデル
 */
export function loadSurface(domainRoot: string, findings: Finding[]): LoadedSpecs<SurfaceSpecModel> {
  const loaded = loadSurfaceSpecModel(path.join(path.dirname(domainRoot), 'backend', 'surface.md'), {
    repoRoot: detectRepoRoot(domainRoot),
  });
  findings.push(...loaded.findings);
  return { model: loaded.model, dropped: loaded.dropped };
}

/**
 * 外部連携カタログ(external_spec)を読み込む(X0)。
 *
 * テストケース ID 台帳の材料になるため、各群の実行より先に読む。
 * ファイルが無い環境では `available: false` の空モデル。
 */
export function loadExternal(domainRoot: string, findings: Finding[]): LoadedSpecs<ExternalSpecModel> {
  const loaded = loadExternalSpecModel(path.join(path.dirname(domainRoot), 'backend', 'external.md'), {
    repoRoot: detectRepoRoot(domainRoot),
  });
  findings.push(...loaded.findings);
  return { model: loaded.model, dropped: loaded.dropped };
}

/**
 * ユースケース仕様(usecase_spec)を読み込む(Y0)。
 *
 * S・A・H 群の実行より後で使うため他の読み込みほど急がないが、他の仕様種と同じ配線に揃える
 * ため、他のローダーと並べてここに置く。specs/frontend/usecases が無い環境では
 * `available: false` の空モデル。
 */
export function loadUsecases(domainRoot: string, findings: Finding[]): LoadedSpecs<UsecaseSpecModel> {
  const loaded = loadUsecaseSpecModel(path.join(path.dirname(domainRoot), 'frontend', 'usecases'), {
    repoRoot: detectRepoRoot(domainRoot),
  });
  findings.push(...loaded.findings);
  return { model: loaded.model, dropped: loaded.dropped };
}

/**
 * 実装の木の側のルートを読み込む(S7 の突合先)。
 *
 * **走査の起点を決めるのはこの配線層だけ**である(検証器もローダーも実装の木の位置を知らない)。
 * 位置は**製品の宣言から来る** —— 宣言していない製品では走査そのものを行わず
 * `available: false` を返して S7 を飛ばす(`appGrounded` の第 1 段と同じ判定)。
 *
 * @param domainRoot ドメイン仕様の木の絶対パス(リポジトリルートの解決に使う)
 * @param roots 製品が宣言した根(実装の木の位置)
 * @param layout 置き場の配置(画面の器の走査の根・逆引き・リクエスト前段の置き場。アプリの枠の後段が与える)
 * @returns 実ルートとリクエスト前段の matcher。実装の木を宣言していなければ `available: false`
 */
export function appRoutes(domainRoot: string, roots: ProductRoots, layout: ProductLayout): AppRoutesModel {
  const repoRoot = detectRepoRoot(domainRoot);
  const appRoot = appPath(roots);
  if (appRoot === null) return unavailableAppRoutes(roots, layout);
  return loadAppRoutes(path.join(repoRoot, appRoot), { repoRoot, roots, layout });
}
