/**
 * 外部連携カタログの検査(X 群)の登録 — どの検査を、どの順で実行するか。
 *
 * 実行口(`run.ts`)はここの `EXTERNAL_STEPS` を上から回すだけである。並びは**違反の並び**を決める
 * (X4 のテスト突合は台帳だけを見るので、カタログを構築できなかったときも回り、並びの最後に置く)。
 * ID は各検証器のファイルが持つ `VERIFIER_ID` を参照する。全検査の表(`lib/compose/all-checks.ts`)は `EXTERNAL_CHECKS` を読む。
 */

import type { Finding } from '../kernel/finding.js';
import type { CheckEntry } from '../kernel/check-entry.js';
import { catalogInput, type CatalogInput } from '../kernel/input-state.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import { X0_VERIFIER_ID } from '../model/external/loader.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { ExternalRunInput } from './run.js';
import { VERIFIER_ID as X1, verifyAdapterClosedWorld, type AdapterClosedWorldInput } from './verifiers/x1-adapter-closed-world.js';
import { VERIFIER_ID as X2, verifyConfigGrounding, type ConfigGroundingInput } from './verifiers/x2-config-grounding.js';
import { VERIFIER_ID as X3, verifySendsGrounding } from './verifiers/x3-sends-grounding.js';
import { VERIFIER_ID as X4, verifyExternalTestTrace } from './verifiers/x4-test-trace.js';
import { VERIFIER_ID as X5, verifyInboundGrounding, type InboundGroundingInput } from './verifiers/x5-inbound-grounding.js';
import { VERIFIER_ID as X6, verifyRuntimeGrounding } from './verifiers/x6-runtime-grounding.js';
import { VERIFIER_ID as X7, verifyNeutralize, type NeutralizeInput } from './verifiers/x7-neutralize.js';
import { VERIFIER_ID as X8, verifyPaidEntry, type PaidEntryInput } from './verifiers/x8-paid-entry.js';

/** X1 に渡す入力(検査と、見ていないことの報告 `adapterClosedWorldGaps` が同じ入力を読む)。 */
export function closedWorldInputOf(input: ExternalRunInput, catalog: ExternalCatalogSpec): AdapterClosedWorldInput {
  return { domain: input.domain, dataTables: input.dataTables, catalog, repoRoot: input.repoRoot, roots: input.roots, layout: input.layout };
}

/** X2 に渡す入力(検査と、見ていないことの報告 `configGroundingGaps` が同じ入力を読む)。 */
export function configInputOf(input: ExternalRunInput, catalog: ExternalCatalogSpec): ConfigGroundingInput {
  return { catalog, config: input.config };
}

/** X5 に渡す入力(検査と、見ていないことの報告 `inboundGroundingGaps` が同じ入力を読む)。 */
export function inboundInputOf(input: ExternalRunInput, catalog: ExternalCatalogSpec): InboundGroundingInput {
  return { domain: input.domain, catalog, dataTables: input.dataTables, roots: input.roots };
}

/** X7 に渡す action_spec の入力の状態(実行口が渡さなければ未選択 = 入力を持つ操作は無い、として扱う)。 */
export function neutralizeActionsOf(input: ExternalRunInput): CatalogInput<ActionSpecModel> {
  return input.actionSpecs ?? catalogInput<ActionSpecModel>('unselected');
}

/** X8 に渡す入力。 */
export function paidEntryInputOf(input: ExternalRunInput, catalog: ExternalCatalogSpec): PaidEntryInput {
  return { catalog, domain: input.domain, dataTables: input.dataTables, repoRoot: input.repoRoot, roots: input.roots, layout: input.layout, mfaEnforced: input.mfaEnforced === true };
}

/** X7 に渡す入力(検査と、見ていないことの報告 `neutralizeGaps` が同じ入力を読む)。 */
export function neutralizeInputOf(input: ExternalRunInput, catalog: ExternalCatalogSpec): NeutralizeInput {
  return { domain: input.domain, catalog, repoRoot: input.repoRoot, roots: input.roots, actionSpecs: neutralizeActionsOf(input) };
}

/**
 * 実行の段 1 つ(検査 1 本)。**カタログの宣言を読む段**(`readsCatalog: true`)は、読込済みのカタログを引数で受ける型にしてあり、
 * 実行口(`run.ts`)が**カタログが無いとき段を呼ばない**(飛ぶ条件はこの宣言を見る実行口の 1 か所。段ごとに書かない)。
 * 台帳などカタログに依らない段(`readsCatalog: false`)はカタログを受けない。カタログが無い分は実行口が「阻害 — …は見ていません」と言う。
 */
export type ExternalStep = CheckEntry &
  (
    | {
        /** カタログの宣言を読む段(カタログが無いとき実行しない)。 */
        readonly readsCatalog: true;
        /** 検査を実行し、違反を返す。 */
        run(input: ExternalRunInput, catalog: ExternalCatalogSpec): Finding[];
      }
    | {
        /** カタログに依らない段(台帳などだけを見る。カタログが無くても実行する)。 */
        readonly readsCatalog: false;
        /** 検査を実行し、違反を返す。 */
        run(input: ExternalRunInput): Finding[];
      }
  );

/** 実行の順(違反の並びを決める)。 */
export const EXTERNAL_STEPS: readonly ExternalStep[] = [
  { id: X1, title: 'アダプタの閉世界(ディレクトリ・基盤の層・鍵の無いときの縮退)', readsCatalog: true, run: (i, c) => verifyAdapterClosedWorld(closedWorldInputOf(i, c)) },
  { id: X2, title: '設定への接地(鍵・URL が設定カタログに実在する)', readsCatalog: true, run: (i, c) => verifyConfigGrounding(configInputOf(i, c)) },
  { id: X3, title: '送る情報の接地(sends.fields が entity_spec に実在する)', readsCatalog: true, run: (i, c) => verifySendsGrounding(i.domain, c) },
  { id: X5, title: '受信の軸の接地(direction: inbound の署名・記録・遷移)', readsCatalog: true, run: (i, c) => verifyInboundGrounding(inboundInputOf(i, c)) },
  { id: X6, title: '実行時の約束(timeout_ms / retry_max / idempotency_source)の接地', readsCatalog: true, run: (i, c) => verifyRuntimeGrounding({ catalog: c, repoRoot: i.repoRoot, roots: i.roots, layout: i.layout }) },
  { id: X7, title: '外へ送る自由文の無害化(sends.neutralize の部品をアダプタが呼ぶ・none は編集できる欄を送らない・bearer を送らない)', readsCatalog: true, run: (i, c) => verifyNeutralize(neutralizeInputOf(i, c)) },
  { id: X8, onGeneratedTree: true, title: '有料の口の執行(有料の連携に届く口は runPaidEntry で包まれ、上限・役を生成物から読み、有料の処理は handler の中だけ。meter の RPC は役を DB の行で確かめ原子的に消費する)', readsCatalog: true, run: (i, c) => verifyPaidEntry(paidEntryInputOf(i, c)) },
  { id: X4, title: 'テスト突合(外部連携カタログ ⇔ テスト)', readsCatalog: false, run: (i) => verifyExternalTestTrace(i.domain, i.registry, i.tests) },
];

/**
 * 登録の段を上から回す(**カタログの宣言を読む段を飛ばす条件はここ 1 か所**)。
 *
 * @param input 実行口の入力
 * @param catalog 読込済みのカタログ(構築できなかった・欠けているときは null)
 * @returns 全段の違反(登録の順)
 */
export function runExternalSteps(input: ExternalRunInput, catalog: ExternalCatalogSpec | null): Finding[] {
  return EXTERNAL_STEPS.filter((step) => input.generatedTreeOnly !== true || step.onGeneratedTree === true).flatMap((step) => {
    if (!step.readsCatalog) return step.run(input);
    return catalog === null ? [] : step.run(input, catalog);
  });
}

/** X 群の全検査(ローダーの X0 を含む。全検査の表が読む)。 */
export const EXTERNAL_CHECKS: readonly CheckEntry[] = [
  { id: X0_VERIFIER_ID, title: 'external_spec のスキーマ適合(ローダーが実施)' },
  ...EXTERNAL_STEPS,
];
