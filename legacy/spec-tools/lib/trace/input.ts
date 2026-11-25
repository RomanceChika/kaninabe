/**
 * 仕様 ⇔ テストのトレース検証(A 群)への入力 `TraceInput`。
 *
 * 3 つの独立した入力と、いくつかの任意の入力からなる。
 * 1. `SpecModel`      — ドメイン仕様(specs/domain)。既存の loader が構築する。
 * 2. `ActionSpecModel` — Server Action 仕様(specs/backend/actions)。lib/model/trace/loader が構築する。
 * 3. `TestScanResult`  — app/ の走査結果(@spec / @tc アノテーションと実装ファイルの実在)。
 *
 * **他の仕様種のモデル(job・data_table・external・台帳)を抱えてよいのはここだけ**である。
 * action_spec の宣言の型(`types.ts`)は他の種類のモデルを import しない —— 検査が種類をまたいで
 * 事実を突き合わせるための入力の袋は、宣言の型と別のファイルに置く。
 */

import type { GuardServices } from '../guard/ast.js';
import type { SpecModel } from '../model/types.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import type { TcRegistry, TestScanResult } from '../testcase/types.js';
import type { JobCatalogSpec, JobSpecModel } from '../model/job/types.js';
import { inputValue, unusableOf, type CatalogInput, type InputGapNote } from '../kernel/input-state.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { SpecKind } from '../model/product/uses.js';

/** トレース検証器(A1〜A9)への唯一の入力。 */
export interface TraceInput {
  readonly domain: SpecModel;
  readonly actions: ActionSpecModel;
  readonly tests: TestScanResult;
  /**
   * 全仕様種のテストケース ID 台帳(lib/testcase/registry.ts)。CLI が構築したものを受け取る。
   *
   * A6 の orphan 判定は「どの仕様にも宣言が無い `@tc`」を探すものであり、判定の母集合は
   * action_spec だけではない。A9 の一意性検査も仕様種をまたいで見る必要がある。
   * どちらも母集合は 1 つなので、仕様種ごとの ID を検査へ横渡しせず台帳を引く。
   */
  readonly registry: TcRegistry;
  /**
   * ジョブカタログ(A13 の材料)の**入力の状態**。任意の欄ではなく**必須**である。
   *
   * 以前は `jobs?: JobSpecModel` で、欄が無い・`available: false`・カタログ null のどれでも A13 が
   * **何も言わずに通った**(「読めない環境で壊れない」規約)。採っていない製品にはそれで正しいが、
   * **採ったのに読めない**製品も同じ見え方になる。今は 3 つに分けて渡す ——
   * 未選択(`uses` に `jobs` が無い)/ 阻害(採ったのに無い・読めない・壊れている)/ 読込済み(0 件もここ)。
   * 読み込みの診断(J0)は読み込んだ側が全体へ足しており、A13 は二重に数えない。
   * 他の任意の欄は、同じ形へ 1 本ずつ移す(部品化 ②-b)。
   */
  readonly jobs: CatalogInput<JobCatalogSpec>;
  /**
   * テーブル仕様(data_table)の**入力の状態**(A15 が「その操作が呼ぶ定型 RPC の引数」を読み、A18 が執行点を探し、
   * A19 が計画の読み取りを組むのに使う)。任意の欄ではなく**必須**である。
   *
   * 以前は `dataTables?` で、欄が無い・`available: false` のどちらでも上の 3 つが**何も言わずに通った**。
   * 今は 3 つに分けて渡す —— 未選択(`uses` に `data_tables` が無い)/ 阻害(採ったのに無い・読めない・壊れている)/
   * 読込済み(0 件もここ)。使えないとき、依る判定は出さず、見ていないことを実行ログが 1 行で報告する(`InputGapNote`)。
   * 読み込みの診断(T0)は読み込んだ側が全体へ足しており、ここでは二重に数えない。
   */
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  /**
   * ガード式のパーサー(A14 が「そのガードに現れる変数」を数えるのに使う)。
   *
   * 他の A 群は仕様の宣言だけを突き合わせるので不要であり、無い環境(テストヘルパ)でも
   * 壊れないよう任意にしてある(A14 は未指定なら何も見ない)。
   */
  readonly guards?: GuardServices;
  /**
   * 外部連携カタログの**入力の状態**(A10 が**第 3 の発火元**を数えるのに使う)。任意の欄ではなく**必須**である。
   *
   * `direction: inbound` の連携が `emits` するイベントは「外から届いて起きる」ので、
   * 走査(時刻で起きる)の宣言も免除も要らない —— カタログにその行があること自体が
   * 「誰が起こすのか」の宣言である。
   *
   * **未選択は「第 3 の発火元は無い」という事実**(製品が受信を採っていない)で、発火元の母集合は 2 本で判定してよい。
   * **阻害は「分からない」**で、発火元が足りないと誤って error を出さないよう、external に依る判定
   * (「このイベントは起こす口が無い」)だけを出さず、見ていないことを実行ログが 1 行で報告する(`InputGapNote`)。
   */
  readonly external: CatalogInput<ExternalCatalogSpec>;
  /** 製品が宣言した根(道案内のパスを組み立てる)。 */
  readonly roots: ProductRoots;
  /**
   * 置き場の配置(アプリの枠の後段が与える `ProductLayout`)。**必須**(省略して黙って通る口を残さない)。
   * 実装の木の走査の根(`trace/scan.ts`)・Server Action の実在の位置(A2)・実装ファイルのパス → 操作 ID の逆引き(A11 / A14)が、配置の役割から引く
   * (以前は `src/app/_actions` ・`src/operation` の綴りをここで直書きしていた。部品化 ③-c4b)。
   */
  readonly layout: ProductLayout;
}

/**
 * **actions が無くても検査できる**検査(入力の状態を報告する検査)が受け取る入力。`TraceInput` の部分である。
 *
 * 検査の起動は、**検査ごとの本当の前提**で決める。A13 の前提はジョブカタログ(と製品の根)で、action_spec ではない
 * —— actions を採らない製品でも、ジョブを採っていれば A13 は走る。空の action_spec を作って渡す形にはしない
 * (見ていない集合を「空」と偽ることになる)。別の種類へ検査を移すときは、その検査が実際に読む欄だけをここに足す。
 */
export type CatalogRunInput = Pick<TraceInput, 'roots' | 'jobs'>;

/**
 * ジョブカタログを「あれば読む」側(A15 / A19 の実行計画の組み立て)へ渡す形。
 *
 * 読込済みのときだけカタログを渡す。未選択・阻害は「そのカタログがまだ無い」と同じ扱い
 * (`undefined`)で、**見えない事実を別の近似で補わない**(`semantics/operation-catalogs.ts` と同じ規約)。
 * 阻害のとき部分のモデルを渡さないのは、読み込みの error が残るカタログで計画を組むと「見た」と報告してしまうため
 * (J0 の error はすでに全体に載っている)。
 */
export function jobModelOf(input: TraceInput): JobSpecModel | undefined {
  return input.jobs.state === 'loaded' ? { available: true, catalog: input.jobs.value } : undefined;
}

/**
 * ジョブカタログを採っているのに検査へ渡せない(阻害)か。
 *
 * `jobModelOf` が阻害のとき `undefined` を返すのは「見えない事実を別の近似で補わない」ためだが、それだけだと
 * 「ジョブが無い」と読めてしまい、欠けた事実から判定(副作用がキューに積まれる種別かの判定など)が出る。
 * ジョブに依る判定を持つ検査は、この印を計画の組み立てへ渡して**その部分の判定を出さない**。
 */
export function jobsBlockedOf(input: TraceInput): boolean {
  return input.jobs.state === 'blocked';
}

/**
 * ジョブに依る判定を出さなかった対象を、見ていないことの記録にする(対象が無い・阻害でなければ空)。
 * 検査の全体が入力に依る形(テーブル仕様の `dataTablesGap`)と同じ `InputGapNote` で、依る判定の対象を名指す。
 *
 * @param input 検査への入力
 * @param subjects 判定を出さなかった対象(重複しない名前)
 */
export function jobsGaps(input: TraceInput, subjects: readonly string[]): readonly InputGapNote[] {
  if (input.jobs.state !== 'blocked' || subjects.length === 0) return [];
  const gap = unusableOf(input.jobs, 'jobs' satisfies SpecKind);
  return gap === null ? [] : [{ gap, consequence: 'jobs に依る判定は出していません(ほかの判定は実行済み)', subjects }];
}

/**
 * テーブル仕様を読む検査へ渡す形(読込済みのときだけ。未選択・阻害は undefined)。
 *
 * undefined は「無い」とも「分からない」とも読めるので、使えなかった理由は `dataTablesGap` で別に報告する。
 */
export function dataTablesOf(input: TraceInput): DataTableSpecModel | undefined {
  return inputValue(input.dataTables);
}

/**
 * テーブル仕様が使えないために見ていないことの記録(使えるなら null)。
 *
 * @param input 検査への入力
 * @param consequence 見ていないこと(文末。句点は付けない)
 * @param subjects 判定を出さなかった対象(名指せるとき)
 */
export function dataTablesGap(input: TraceInput, consequence: string, subjects?: readonly string[]): InputGapNote | null {
  const gap = unusableOf(input.dataTables, 'data_tables' satisfies SpecKind);
  if (gap === null) return null;
  return subjects === undefined ? { gap, consequence } : { gap, consequence, subjects };
}

/**
 * 読めずにモデルへ入れなかった表のファイル(テーブル仕様が「仕様を落とした」阻害のときだけ。それ以外は空)。
 * 落とした表の宣言(test_cases など)は信用しないので、台帳には載っていない。台帳に無いことから「宣言が無い」と言わないために、
 * 検査は落とした表の名前空間を別に知る必要がある。
 */
export function droppedTableFilesOf(input: TraceInput): readonly string[] {
  return input.dataTables.state === 'blocked' ? (input.dataTables.partial?.droppedTables ?? []) : [];
}

/**
 * 落とした表のファイル → フロントマターの entity 名(読めたものだけ。`TC-EQ-{ENTITY}-…` の名前空間を知るのに使う)。
 * 落とした表が無ければ空。
 */
export function droppedTableEntitiesOf(input: TraceInput): Readonly<Record<string, string>> {
  return input.dataTables.state === 'blocked' ? (input.dataTables.partial?.droppedEntities ?? {}) : {};
}
