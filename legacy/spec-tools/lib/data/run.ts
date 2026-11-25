/**
 * テーブル仕様検証(T 群)の実行口。
 *
 * ローダー(T0)が構築したモデルを検証器(T1〜T18)に流すところまでをまとめる。
 * 配線(lib/compose/verify-pipeline.ts)はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。チェック内容の正は ARCH-SP-BE-0001 §テーブル仕様。
 */

import { unusableOf, type InputGapNote, type UnusableInput } from '../kernel/input-state.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import { deriveIndexRequirements, type InputGap } from '../relations/index-requirements/index.js';
import { surfaceUnsupportedReason } from '../sql/platform-sql.js';
import { DATA_STEPS, dataStepGaps } from './checks.js';
import { VERIFIER_ID as T12_ID } from './verifiers/t12-ddl-migration.js';
import { stepInputOf, type DataRunInput } from './input.js';
import type { Finding } from '../kernel/finding.js';

export type { DataRunInput, DataStepInput } from './input.js';

/** runDataTableVerification の結果。 */
export interface DataRunResult {
  readonly findings: Finding[];
  /** T 群を 1 本でも実行したか(読込済み、または仕様を落としたが自己完結の段を読めた分で実行した)。false なら 1 本も実行していない(理由は `tablesGap`)。 */
  readonly available: boolean;
  /**
   * テーブル仕様を渡せなかった理由(未選択 = 製品が採っていない / 阻害 = 採ったのに渡せない)。読込済みなら null。
   * 阻害で `available` が true のときは、仕様を落としたため**自己完結の段だけ**を読めた分で実行した(止めた段は `wholeGaps`)。
   * 実行ログが、どちらで実行しなかったかを言い分ける。
   */
  readonly tablesGap: UnusableInput | null;
  /** 実行した段の検査器 ID(登録の順)。読込済みなら全段、仕様を落としたときは自己完結の段だけ、実行しなかったときは空。 */
  readonly ranIds: readonly string[];
  /** 読み込めた data_table の件数(CLI のサマリ表示用。仕様を落としたときは読めた分)。 */
  readonly tableCount: number;
  /** 読めずにモデルへ入れなかった表のファイル(ファイル全体が読めなかったもの・表の中で行を落としたもの。仕様を落としたときだけ。要約が名指す)。 */
  readonly droppedTables: readonly string[];
  /** app/ を走査できたか。false なら T3 の `@tc` 突合はスキップされている。 */
  readonly testsAvailable: boolean;
  /** T2 が索引の要求を導くのに使えなかった入力(未選択・阻害。空 = 全部の入力を使った)。T2 を止めたときは `wholeGaps` が言うので空。 */
  readonly indexGaps: readonly InputGap[];
  /**
   * 段が裏づけに読むほかの種類が**阻害**のため、見ていないことがあった段(検査器 ID ごと・阻害された入力ごとに 1 件)。
   * 未選択は載らない(裏づけが無いのは事実)。実行ログが 1 行ずつ報告する(`describeInputGapNote`)。実行した段だけ。
   */
  readonly stepGaps: readonly { readonly id: string; readonly note: InputGapNote }[];
  /**
   * 仕様を落としたため、表の全体を前提とする段(登録の `needsWhole`)を止めた記録(検査器 ID ごとに 1 件)。仕様を落としていなければ空。
   * 欠けた表で「無いこと」を主張する検査を回さず、見ていないことを名指す。
   */
  readonly wholeGaps: readonly { readonly id: string; readonly note: InputGapNote }[];
  /**
   * 後段が SQL の公開面(surface)を API として外へ出す能力を持たない理由(後段が宣言した reason)。持つなら null。
   * 持たない構成では T12 の公開面の判定(土台・ビュー・権限の出どころ)を見ていない —— 実行ログが**未対応**と言う(黙って緑にしない)。
   * T12 を実行しなかったとき(`available: false`)は null(言う相手の検査が動いていない)。
   */
  readonly surfaceUnsupported: string | null;
}

/**
 * data_table の検証(T1〜T18)を実行する。
 *
 * テーブル仕様が読込済みでなければ(採っていない・採ったのに無い・読めない・仕様を落とした)T 群は全部は実行せず、
 * どちらだったかを `tablesGap` で返す(部分のモデルで「無いこと」を主張する検査を回さない)。**仕様を落とした**ときだけは、読めた表で
 * 自己完結の段(`needsWhole` でない段)を実行し、表の全体を前提とする段は止めて `wholeGaps` で名指す。T2 は query_spec 側の入力の状態も要るため、
 * 使えない入力の分は導かず、`indexGaps` で返す。裏づけに読むほかの種類(action_spec・ジョブ・ユースケース・外部連携・api)が
 * 使えないときは、依る判定を出さず(未選択は裏づけが無い事実として判定する)、阻害だけを `stepGaps` で返す。
 *
 * @param input ドメインモデルとテーブル仕様・裏づけの入力の状態・台帳・走査結果
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runDataTableVerification(input: DataRunInput): DataRunResult {
  const testsAvailable = input.tests.available;
  const tablesGap = unusableOf(input.dataTables, 'data_tables');
  const usable = usableTables(input, tablesGap);
  if (usable === null) {
    return { findings: [], available: false, tablesGap, ranIds: [], tableCount: 0, droppedTables: [], testsAvailable, indexGaps: [], stepGaps: [], wholeGaps: [], surfaceUnsupported: null };
  }
  const steps = DATA_STEPS.filter((step) => usable.gap === null || !step.needsWhole);
  // 索引の要求は query_spec と関数の `lookup` から導く(T2 の材料。使えなかった入力は `indexGaps` で返す)。
  const derived = deriveIndexRequirements({ domain: input.domain, guards: input.guards, queries: input.queries, dataTables: input.dataTables });
  const stepInput = stepInputOf(input, usable.model);
  return {
    findings: steps.flatMap((step) => step.run(stepInput, derived)),
    available: true,
    tablesGap: usable.gap,
    ranIds: steps.map((step) => step.id),
    tableCount: usable.model.tables.length,
    droppedTables: usable.model.droppedTables ?? [],
    testsAvailable,
    indexGaps: usable.gap === null ? derived.gaps : [],
    stepGaps: dataStepGaps(input, steps),
    wholeGaps: usable.gap === null ? [] : wholeGapsOf(usable.gap),
    // 仕様を落としたとき T12(表の全体を前提とする段)は止まっている —— 止めた理由は `wholeGaps` が言うので、重ねない。
    surfaceUnsupported: steps.some((step) => step.id === T12_ID) ? surfaceUnsupportedReason(input.platform) : null,
  };
}

/**
 * 検査に使えるテーブル仕様。読込済みなら全体(`gap: null`)、仕様を落とした阻害なら読めた分(`gap` = その阻害)、
 * それ以外(未選択・置き場に無い・読めない・読み込みが行われていない)は null。
 */
function usableTables(input: DataRunInput, gap: UnusableInput | null): { readonly model: DataTableSpecModel; readonly gap: UnusableInput | null } | null {
  const tables = input.dataTables;
  if (tables.state === 'loaded') return { model: tables.value, gap: null };
  if (tables.state === 'blocked' && tables.partial !== undefined && gap !== null) return { model: tables.partial, gap };
  return null;
}

/** 仕様を落としたため止めた、表の全体を前提とする段の記録。 */
function wholeGapsOf(gap: UnusableInput): readonly { readonly id: string; readonly note: InputGapNote }[] {
  return DATA_STEPS.filter((step) => step.needsWhole).map((step) => ({
    id: step.id,
    note: { gap, consequence: '表の全体を前提とする判定(欠けた表が偽の指摘を生む)は見ていません(表ごとに自己完結の検査は読めた分で実行済み)' },
  }));
}
