/**
 * 実装の範囲の「持ち主の一覧」と「読めなかった種類」を、読み込みの結果から 1 つの関数で組み立てる(配線が持っていた組み立て)。
 *
 * 持ち主を集める(`scopeOwners`)ところと、P14 が「仕様から消えた」と数えてよいかを決める読み込みの成否(`unloadedKinds`・`invariantsUnloaded`)は
 * 同じ材料から出るので、1 か所に置く(別々に組むと、持ち主は載っているのに成否は「読めた」になるなど、食い違いを作れる)。
 */

import type { ScopeOwner } from '../kernel/scope-owner.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { AuthSpecModel } from '../model/auth/types.js';
import type { ConfigSpecModel } from '../model/config/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { GuaranteeSpecModel } from '../model/guarantee/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import type { ProductUses, SpecKind } from '../model/product/uses.js';
import type { QuerySpecModel } from '../model/query/types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import type { SpecModel } from '../model/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import type { Finding } from '../kernel/finding.js';
import { scopeOwners, unloadedKinds } from './owners.js';

/** 持ち主の一覧と読み込みの成否。 */
export interface ScopeUniverse {
  /** 持ち主の一覧(印の持ち主と `implemented` に書ける id の正)。 */
  readonly owners: readonly ScopeOwner[];
  /** 採ったのに error なく読めなかった種類。 */
  readonly unloaded: readonly SpecKind[];
  /** 不変条件(ドメイン仕様)の読み込みに error があったか(不変条件の持ち主は種類を持たないので別の欄)。 */
  readonly invariantsUnloaded: boolean;
}

/**
 * 持ち主の一覧と読み込みの成否を組み立てる。
 *
 * 入力は読み込んだモデルだが、読むのは持ち主の id だけ(検査の判定には使わない)。入力の型を名前つきの型にしないのは、
 * 他の種類の生のモデルを持つ入力の欄の全数を固定する構造テスト(`foreign-readers.test.ts`)の対象に、この集約を数えないため
 * (読み込みの阻害は `clean` で受けて P14 が名指す。持ち主の抽出は検査ではない)。
 *
 * @param input 読み込んだモデルと成否
 */
export function scopeUniverseOf(input: {
  readonly uses: ProductUses;
  readonly domain: SpecModel;
  readonly actions: ActionSpecModel | null;
  readonly queries: QuerySpecModel;
  readonly screens: ScreenSpecModel;
  readonly dataTables: DataTableSpecModel;
  readonly usecases: UsecaseSpecModel;
  readonly jobs: JobSpecModel;
  readonly auth: AuthSpecModel;
  readonly guarantees: GuaranteeSpecModel;
  readonly external: { readonly catalog: ExternalCatalogSpec | null };
  readonly config: ConfigSpecModel;
  /** デザイントークンの仕様を読めたか。 */
  readonly designTokensLoaded: boolean;
  /** 種類ごとの「読み込みが error なく済んだか」(載っていない種類は済んだものとして扱う。`cleanLoad` で作る)。 */
  readonly clean: Readonly<Partial<Record<SpecKind, boolean>>>;
  /** ドメイン仕様の読み込みが error なく済んだか。 */
  readonly domainClean: boolean;
}): ScopeUniverse {
  const owners = scopeOwners({
    uses: input.uses,
    actionIds: input.actions?.actions.map((action) => action.id) ?? [],
    scanEvents: input.actions?.scans.map((scan) => scan.event) ?? [],
    queryIds: input.queries.queries.map((query) => query.id),
    screenIds: input.screens.screens.map((screen) => screen.id),
    tableIds: input.dataTables.tables.map((table) => table.id),
    usecaseIds: input.usecases.usecases.map((usecase) => usecase.id),
    invariantIds: [...input.domain.aggregates.values()].flatMap((specs) => (specs.invariants?.invariants ?? []).map((invariant) => invariant.id)),
    catalogs: {
      jobs: input.jobs.catalog !== null,
      auth: input.auth.flow !== null,
      guarantees: input.guarantees.catalog !== null,
      external: input.external.catalog !== null,
      config: input.config.catalog !== null,
      designTokens: input.designTokensLoaded,
    },
  });
  const unloaded = unloadedKinds(input.uses, { ...input.clean, design_tokens: input.designTokensLoaded });
  return { owners, unloaded, invariantsUnloaded: !input.domainClean };
}

/**
 * 種類の読み込みが error なく済んだか(読めた仕様があり、読み込みの error も落とした仕様も無い)。
 *
 * @param available 仕様を読めたか
 * @param loadFindings その種類の読み込みの指摘
 * @param dropped 読めずに落とした仕様の数
 */
export function cleanLoad(available: boolean, loadFindings: readonly Finding[], dropped: number): boolean {
  return available && dropped === 0 && !loadFindings.some((finding) => finding.severity === 'error');
}

/** `scopeUniverseOf` の入力(テストが組み立てるための別名)。 */
export type ScopeUniverseInput = Parameters<typeof scopeUniverseOf>[0];
