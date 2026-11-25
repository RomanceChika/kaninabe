/**
 * テーブル仕様の検査(T 群)への入力 2 つ。
 *
 *   - `DataRunInput` … 実行口(`run.ts`)が受ける入力。テーブル仕様そのものと、検査が**裏づけに読むほかの種類**
 *     (action_spec・ジョブ・ユースケース・外部連携・surface)を、どれも入力の状態(未選択 / 阻害 / 読込済み)で受ける。
 *     任意の欄(`actions?:` …)にすると、**採っていない製品**と**採ったのに読めない製品**が同じ見え方(裏づけが無いだけ)になる。
 *     台帳・走査結果・ガード式のパーサー・リポジトリルートも**必須**にして、段が「渡されなかったから飛ぶ・見ない」条件を持たないようにしている
 *     (段が飛ぶ条件は入力の状態だけにする = 登録の `reads` が宣言する)。
 *   - `DataStepInput<K>` … 段(検証器)が見る入力。読込済みの値だけを渡し(未選択・阻害は `undefined`)、
 *     阻害を事実として「無い」と読むと誤報になる 2 か所(ジョブ・surface)だけ印(`jobsBlocked` / `surfaceBlocked`)を添える。
 *     **段が見られる裏づけは、登録の `reads` に宣言した種類 `K` だけ**である(`narrowStepInput` が実行時に絞り、型でも絞る):
 *     宣言を足し忘れて裏づけを読むと、型エラーになる(読めたとしても `undefined`)。宣言は報告(`dataStepGaps`)の源でもあるので、
 *     「読むのに宣言が無い」「宣言があるのに読まない」が静かにずれることがない。
 *     使えなかった入力の報告は `checks.ts` の `dataStepGaps` が受け持つ(段は報告しない)。
 */

import type { GuardServices } from '../guard/ast.js';
import { inputValue, mapCatalogInput, type CatalogInput } from '../kernel/input-state.js';
import type { SurfaceSpecModel } from '../model/surface/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { ExternalCatalogSpec, ExternalSpecModel } from '../model/external/types.js';
import type { JobCatalogSpec, JobSpecModel } from '../model/job/types.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import type { ProductRoots } from '../model/product/types.js';
import type { QuerySpecModel } from '../model/query/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import type { SpecModel } from '../model/types.js';
import type { TcRegistry, TestScanResult } from '../testcase/types.js';

/** runDataTableVerification の入力。 */
export interface DataRunInput {
  /** 構築済みのドメイン仕様モデル。 */
  readonly domain: SpecModel;
  /**
   * テーブル仕様の入力の状態(製品が `data_tables` を採っているか(`uses`)と読み込みの結果から、呼び手が `catalogInput` で作る)。
   * 読込済みでなければ(未選択も阻害も)T 群は全部は実行しない。**どちらで実行しなかったか**は結果の `tablesGap` が言う。
   * 例外は**仕様を落とした阻害**(`partial` が付く)で、表ごとに自己完結の段(登録の `needsWhole` でないもの)だけは読めた分で実行する
   * (欠けた表が偽の error を生む段は止めて名指す)。読み込みの診断(T0)は読み込んだ側が全体へ足しており、ここでは二重に数えない。
   */
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  /**
   * query_spec の入力の状態。T2(索引の期待値)が導出の入力に使う。使えない入力の分は索引の要求を導かず、
   * 実行結果の `indexGaps` に理由を載せる(関数の `lookup` が要求する索引は、query_spec が使えなくても見る)。
   */
  readonly queries: CatalogInput<QuerySpecModel>;
  /** ガード式のパース(T2 が filters・binding の解決に、T11 が実行計画の接地に使う)。 */
  readonly guards: GuardServices;
  /** テストケース ID 台帳(T3 が data_table の宣言を、T4 が境界の見張りテストを引く)。 */
  readonly registry: TcRegistry;
  /** app/ の走査結果(T3 の `@tc` 突合。読めない構成ではテストケースの宣言だけを見る)。 */
  readonly tests: TestScanResult;
  /** action_spec の入力の状態。T6 が宣言した `input` の欄の到達を、T11 が実行計画の導出を見るのに使う。 */
  readonly actions: CatalogInput<ActionSpecModel>;
  /** ジョブカタログの入力の状態。T11 の実行計画の導出が effects の宛先を引く。 */
  readonly jobs: CatalogInput<JobCatalogSpec>;
  /** usecase_spec の入力の状態。T11 が**保存点**の一致の証明の生成可否を、T12 が公開面のスキーマの土台の順序を見るのに使う。 */
  readonly usecases: CatalogInput<UsecaseSpecModel>;
  /** external_spec の入力の状態。T12 が**公開面のスキーマの土台の順序**を見るのに使う(受信の RPC も公開面のスキーマに関数を作る)。 */
  readonly external: CatalogInput<ExternalCatalogSpec>;
  /** surface_spec の入力の状態。T12 が **SQL の公開面(surface)**の宣言(土台の順序・手書きで残すビュー・権限の宣言)を見るのに使う。 */
  readonly surface: CatalogInput<SurfaceSpecModel>;
  /**
   * リポジトリルートの絶対パス(**必須**)。**T17 が `handwritten` が名指した migration を読む**のに使う
   * (J3 が DB 内のスケジューラの登録を読むのと同じ構え)。`supabase/migrations` が無い構成ではその下位検査は何も見ないが、
   * 「渡されなかったから見ない」ことはない(任意の欄にすると、省略した呼び手の T17 が黙って何も見なくなる)。
   */
  readonly repoRoot: string;
  /** 製品が宣言した根(道案内のパスと走査位置)。 */
  readonly roots: ProductRoots;
  /** プラットフォームの設定。T7 が RLS のポリシーと補助関数の本文を組み立てて前提を見るのに使う(値を選ぶのは組み立ての根)。 */
  readonly platform: PlatformProfile;
  /** 置き場の配置。T3 が突合テストの置き場(テスト支援の土台の位置)を引く(値を選ぶのは組み立ての根)。 */
  readonly layout: ProductLayout;
}

/** 段が裏づけに読める種類(`DataRunInput` の入力の状態の欄と同じ名前)と、段へ渡す読込済みの値の型。 */
export interface DataBackingValues {
  readonly actions: ActionSpecModel;
  readonly jobs: JobSpecModel;
  readonly usecases: UsecaseSpecModel;
  readonly external: ExternalSpecModel;
  readonly surface: SurfaceSpecModel;
}

/** 段が裏づけに読める種類。 */
export type DataBackingKind = keyof DataBackingValues;

/** 段が見る入力のうち、裏づけの種類に依らない部分(読込済みのテーブル仕様と、台帳・走査結果など)。 */
export interface DataStepBase {
  readonly domain: SpecModel;
  readonly dataTables: DataTableSpecModel;
  readonly guards: GuardServices;
  readonly registry: TcRegistry;
  readonly tests: TestScanResult;
  readonly repoRoot: string;
  readonly roots: ProductRoots;
  readonly platform: PlatformProfile;
  readonly layout: ProductLayout;
}

/**
 * 宣言した種類 `K` の裏づけ(読込済みなら値・使えないなら `undefined`)。ジョブと surface は、阻害を事実の「無い」と読まないための印も付く。
 *   - `jobsBlocked` … ジョブカタログを採っているのに渡せない(`jobs` が undefined でも「ジョブが無い」とは読まない。
 *     副作用がキューに積まれる種別かの判定を出さない)
 *   - `surfaceBlocked` … surface_spec を採っているのに渡せない(`surface` が undefined でも「権限の宣言が無い」とは読まない)
 */
export type DataBacking<K extends DataBackingKind> = { readonly [P in K]?: DataBackingValues[P] } & ('jobs' extends K
  ? { readonly jobsBlocked: boolean }
  : unknown) &
  ('surface' extends K ? { readonly surfaceBlocked: boolean } : unknown);

/** 段が見る入力。`K` は段が登録の `reads` に宣言した裏づけの種類(省略は全種類 = 実行口が段へ配る前の完全な入力)。 */
export type DataStepInput<K extends DataBackingKind = DataBackingKind> = DataStepBase & DataBacking<K>;

/**
 * 実行口の入力から、完全な段の入力を作る(テーブル仕様が検査へ渡せる形のときだけ呼ぶ。部分のモデルを渡してよい)。
 * 段へはここから `narrowStepInput` で宣言した種類だけに絞って渡す。
 *
 * @param input 実行口の入力
 * @param dataTables 検査に使うテーブル仕様(読込済みの値、または仕様を落としたときの読めた分)
 */
export function stepInputOf(input: DataRunInput, dataTables: DataTableSpecModel): DataStepInput {
  const jobs = inputValue(mapCatalogInput(input.jobs, (catalog): JobSpecModel => ({ available: true, catalog })));
  const external = inputValue(mapCatalogInput(input.external, (catalog): ExternalSpecModel => ({ available: true, catalog })));
  const actions = inputValue(input.actions);
  const usecases = inputValue(input.usecases);
  const surface = inputValue(input.surface);
  return {
    domain: input.domain,
    dataTables,
    guards: input.guards,
    registry: input.registry,
    tests: input.tests,
    ...(actions === undefined ? {} : { actions }),
    ...(jobs === undefined ? {} : { jobs }),
    ...(usecases === undefined ? {} : { usecases }),
    ...(external === undefined ? {} : { external }),
    ...(surface === undefined ? {} : { surface }),
    jobsBlocked: input.jobs.state === 'blocked',
    surfaceBlocked: input.surface.state === 'blocked',
    repoRoot: input.repoRoot,
    roots: input.roots,
    platform: input.platform,
    layout: input.layout,
  };
}

/**
 * 完全な段の入力を、段が宣言した裏づけの種類だけに絞る(**宣言していない種類は渡さない** = 段からは `undefined` ですらなく、型に無い)。
 * 絞る場所は実行口のこの 1 か所で、段ごとのクロージャに任せない。
 *
 * @param full 完全な段の入力
 * @param kinds 段が登録の `reads` に宣言した種類
 */
export function narrowStepInput<K extends DataBackingKind>(full: DataStepInput, kinds: readonly K[]): DataStepInput<K> {
  const { actions, jobs, usecases, external, surface, jobsBlocked, surfaceBlocked, ...base } = full;
  const wanted: ReadonlySet<DataBackingKind> = new Set(kinds);
  const has = (kind: DataBackingKind): boolean => wanted.has(kind);
  const narrowed = {
    ...base,
    ...(has('actions') && actions !== undefined ? { actions } : {}),
    ...(has('jobs') && jobs !== undefined ? { jobs } : {}),
    ...(has('jobs') ? { jobsBlocked } : {}),
    ...(has('usecases') && usecases !== undefined ? { usecases } : {}),
    ...(has('external') && external !== undefined ? { external } : {}),
    ...(has('surface') && surface !== undefined ? { surface } : {}),
    ...(has('surface') ? { surfaceBlocked } : {}),
  };
  // 型を戻す理由: 絞った欄の有無は実行時の `kinds` で決まり、型の `K` に依る条件付きの欄を式から組み立てられない(宣言の写しなので `kinds` と型は同じ `K` から来る)。
  return narrowed as DataStepInput<K>;
}
