/**
 * 配線の側で、読み込んだモデルから**持ち主の id と読めたかどうかだけ**を取り出す(`lib/scope` はモデルを見ない)。
 *
 * モデルを引数で受けて id を取るだけで、検査の判定には使わない。取り出した結果は `lib/scope/owners.ts` の `ScopeOwnerInput`(id と真偽値だけ)。
 */

import type { AuthSpecModel } from '../model/auth/types.js';
import type { ConfigSpecModel } from '../model/config/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { GuaranteeSpecModel } from '../model/guarantee/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import type { ProductUses } from '../model/product/uses.js';
import type { QuerySpecModel } from '../model/query/types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { SpecModel } from '../model/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import type { ScopeOwnerInput } from '../scope/owners.js';

/**
 * 持ち主の id とカタログの有無を取り出す。
 *
 * @param uses 製品が採る種類
 * @param domain ドメイン仕様(不変条件の id)
 * @param actions action_spec(読めなければ null)
 * @param queries 読み取りクエリ
 * @param screens 画面
 * @param dataTables テーブル仕様
 * @param usecases ユースケース
 * @param jobs ジョブカタログ
 * @param auth 認証フロー
 * @param guarantees 保証台帳
 * @param external 外部連携カタログ
 * @param config 設定カタログ
 * @param designTokensLoaded デザイントークンを読めたか
 */
export function scopeOwnerInputOf(
  uses: ProductUses,
  domain: SpecModel,
  actions: ActionSpecModel | null,
  queries: QuerySpecModel,
  screens: ScreenSpecModel,
  dataTables: DataTableSpecModel,
  usecases: UsecaseSpecModel,
  jobs: JobSpecModel,
  auth: AuthSpecModel,
  guarantees: GuaranteeSpecModel,
  external: { readonly catalog: ExternalCatalogSpec | null },
  config: ConfigSpecModel,
  designTokensLoaded: boolean,
): ScopeOwnerInput {
  return {
    uses,
    actionIds: actions?.actions.map((action) => action.id) ?? [],
    scanEvents: actions?.scans.map((scan) => scan.event) ?? [],
    queryIds: queries.queries.map((query) => query.id),
    screenIds: screens.screens.map((screen) => screen.id),
    tableIds: dataTables.tables.map((table) => table.id),
    usecaseIds: usecases.usecases.map((usecase) => usecase.id),
    invariantIds: [...domain.aggregates.values()].flatMap((specs) => (specs.invariants?.invariants ?? []).map((invariant) => invariant.id)),
    catalogs: {
      jobs: jobs.catalog !== null,
      auth: auth.flow !== null,
      guarantees: guarantees.catalog !== null,
      external: external.catalog !== null,
      config: config.catalog !== null,
      designTokens: designTokensLoaded,
    },
  };
}
