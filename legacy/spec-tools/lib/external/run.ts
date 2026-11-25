/**
 * 外部連携カタログ検証(X 群)の実行口。
 *
 * ローダー(X0)が構築したカタログを検証器(X1〜X8)に流すところまでをまとめる。
 * 配線(lib/compose/verify-pipeline.ts)はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。チェック内容の正は external-spec-writing.md。
 */

import { appGrounded } from '../io/paths.js';
import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { TestScanResult, TcRegistry } from '../testcase/types.js';
import type { ConfigCatalogSpec } from '../model/config/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import { inputValue, unusableOf, type CatalogInput, type InputGapNote, type UnusableInput } from '../kernel/input-state.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import { adapterClosedWorldGaps, VERIFIER_ID as X1 } from './verifiers/x1-adapter-closed-world.js';
import { configGroundingGaps, VERIFIER_ID as X2 } from './verifiers/x2-config-grounding.js';
import { inboundGroundingGaps, VERIFIER_ID as X5 } from './verifiers/x5-inbound-grounding.js';
import { neutralizeGaps, VERIFIER_ID as X7 } from './verifiers/x7-neutralize.js';
import { closedWorldInputOf, configInputOf, EXTERNAL_STEPS, inboundInputOf, neutralizeInputOf, runExternalSteps } from './checks.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/** runExternalVerification の入力。 */
export interface ExternalRunInput {
  /**
   * 生成の後の木の回し直し(段の宣言 `onGeneratedTree` の段だけを回す。題材の通し実行が使う。fix27 A2)。省略は全部の段。
   */
  readonly generatedTreeOnly?: boolean;
  /** 構築済みのドメイン仕様モデル(集約名・entity_spec の母集合)。 */
  readonly domain: SpecModel;
  /**
   * 外部連携カタログの入力の状態(未選択 / 阻害 / 読込済み。**必須**)。製品が `external` を採っているか(`uses`)と
   * 読み込みの結果から、呼び手が `catalogInput` で作る。読み込みの診断(X0)は読み込んだ側が全体へ足しており、ここでは二重に数えない。
   *
   *   - 未選択 / 置き場に仕様が無い・読み込みが行われていない … X 群は 1 本も実行しない(`inputGap` が理由)
   *   - 読めない・壊れている・読めなかった仕様がある(カタログを構築できない / 欠けている)… **宣言を読む検査**(X1・X2・X3・X5・X6・X7)は
   *     出さず(欠けた宣言で「無いこと」を主張しない)、見ていないことを `catalogGap` が言う。台帳だけを見る X4 は実行する
   *   - 読込済み … 全部実行する
   */
  readonly external: CatalogInput<ExternalCatalogSpec>;
  /**
   * 設定カタログの入力の状態(X2 の接地先。**必須**)。製品が `config` を採っているか(`uses`)と読み込みの結果から、呼び手が
   * `catalogInput` で作る。未選択は「設定カタログは無い」という事実(X2 は何も言わない)、阻害は「分からない」(X2 は判定を出さず、
   * 見ていないことを `gaps` が名指す)。
   */
  readonly config: CatalogInput<ConfigCatalogSpec>;
  /**
   * テーブル仕様の入力の状態(未選択 / 阻害 / 読込済み。**必須**)。X1(b) が `internal: true` のテーブル名の母集合に、
   * X5(a) が受信の RPC の接地先に使う。製品が `data_tables` を採っているか(`uses`)と読み込みの結果から、呼び手が
   * `catalogInput` で作る。使えないときの扱いは各検査器の入力の注釈(X1 は未選択を事実・阻害を名指して出さない / X5 は両方とも出さない)。
   */
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  /**
   * action_spec の入力の状態(X7 が「利用者が入力で書ける欄」を引く。任意 —— 渡さない・使えないときは、編集の規則に載る欄だけで判定する)。
   */
  readonly actionSpecs?: CatalogInput<ActionSpecModel>;
  /** リポジトリルートの絶対パス(X1 がアダプタの実装とディレクトリを見る)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(実装の木の位置)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(X1 が基盤の層の走査の根と土台の表を引く)。 */
  readonly layout: ProductLayout;
  /** 製品が多要素認証を要求するか(認証フロー仕様の `mfa` が `require`。X8 が有料の口の `resolveMfa` の配線を求めるか決める。省略は要求しない)。 */
  readonly mfaEnforced?: boolean;
  /** テストケース ID 台帳(X4 が external_spec の宣言を引く)。 */
  readonly registry: TcRegistry;
  /** app/ の走査結果(X4 の `@tc` 突合。読めない構成では X4 は何も見ない)。 */
  readonly tests: TestScanResult;
}

/** runExternalVerification の結果。 */
export interface ExternalRunResult {
  readonly findings: Finding[];
  /** カタログがあったか(読込済みか、読めなかっただけで置き場にはあるか)。false なら X1〜X8 は 1 本も実行していない(理由は `inputGap`)。 */
  readonly available: boolean;
  /**
   * カタログを渡せなかった理由(未選択 = 製品が採っていない / 阻害 = 採ったのに渡せない)。読込済みなら null。
   * 阻害のとき、`available` が true でも宣言を読む検査は実行していない(`catalogGap`)。
   */
  readonly inputGap: UnusableInput | null;
  /**
   * 宣言を読む検査(X1・X2・X3・X5・X6・X7)を、カタログを構築できなかった / 欠けているために実行しなかった記録。
   * 読込済みなら、置き場が無くて群ごと飛んだなら null(群の行が言う)。
   */
  readonly catalogGap: InputGapNote | null;
  /** 読み込めた連携の件数(CLI のサマリ表示用。カタログを構築できなかったときは 0)。 */
  readonly integrationCount: number;
  /** app/ を走査できたか。false なら X4 の @tc 突合はスキップされている。 */
  readonly testsAvailable: boolean;
  /**
   * app/ の木があるか。false なら X1 は 3 段そろって飛んでいる
   * (仕様と実装の突合であり、仕様だけを持つリポジトリでは成立しない)。
   * 飛ばしたことを CLI の scope 行に出すためにここで持ち帰る —— **検査していない範囲を
   * 緑が広く見せない**(S7 と同じ思想。束 ⑲-1)。
   */
  readonly appGrounded: boolean;
  /**
   * 入力が使えないために判定を出さなかった対象(X1 / X5 はテーブル仕様・X2 は設定カタログ)。検査器 ID ごと・見ていないことが 1 件でもあるものだけ。
   * 実行ログが 1 行ずつ報告する(`describeInputGapNote`)。カタログを構築できなかった(`catalog: null`)ときは空。
   */
  readonly gaps: readonly { readonly id: string; readonly note: InputGapNote }[];
}

/**
 * 外部連携カタログの検証(X1〜X8)を実行する。
 *
 * カタログが読込済みでなければ、**入力の状態**で扱いを分ける。採っていない(未選択)・置き場に仕様が無い・読み込みが行われていない
 * ときは検証をスキップし、その旨を報告できる形で返す(外部連携カタログをまだ開設していないリポジトリでも壊れない)。
 * 置き場にはあるが読めない・壊れている・読めなかった仕様があるとき(`available: true` かつ阻害)は、X1〜X3・X5・X6(宣言を読む検査)を
 * 実行せず(欠けた宣言で「無いこと」を主張しない)、見ていないことを `catalogGap` で返す。X4 は台帳だけを見るので実行する。
 *
 * @param input ドメインモデル・外部連携カタログの入力の状態・設定カタログ・台帳・走査結果
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runExternalVerification(input: ExternalRunInput): ExternalRunResult {
  const shape = {
    testsAvailable: input.tests.available,
    appGrounded: appGrounded(input.repoRoot, input.roots.app),
  };
  const inputGap = unusableOf(input.external, 'external');
  if (!placeExists(input.external)) {
    return { findings: [], available: false, inputGap, catalogGap: null, integrationCount: 0, gaps: [], ...shape };
  }
  const catalog = inputValue(input.external) ?? null;
  const findings = runExternalSteps(input, catalog);
  if (catalog === null) {
    return { findings, available: true, inputGap, catalogGap: catalogGapOf(inputGap), integrationCount: 0, gaps: [], ...shape };
  }
  return {
    findings,
    available: true,
    inputGap,
    catalogGap: null,
    integrationCount: catalog.integrations.length,
    gaps: [
      ...adapterClosedWorldGaps(closedWorldInputOf(input, catalog)).map((note) => ({ id: X1, note })),
      ...configGroundingGaps(configInputOf(input, catalog)).map((note) => ({ id: X2, note })),
      ...inboundGroundingGaps(inboundInputOf(input, catalog)).map((note) => ({ id: X5, note })),
      ...neutralizeGaps(neutralizeInputOf(input, catalog)).map((note) => ({ id: X7, note })),
    ],
    ...shape,
  };
}

/** 置き場にカタログがあるか(読込済み、または読めなかっただけ)。未選択・置き場に無い・読み込みが行われていないは false。 */
function placeExists(external: CatalogInput<ExternalCatalogSpec>): boolean {
  if (external.state === 'loaded') return true;
  return external.state === 'blocked' && (external.reason === 'load-failed' || external.reason === 'invalid');
}

/** 宣言を読む検査を実行しなかった記録(読込済みで構築できなかった形は無いので、`gap` が無ければ null)。 */
function catalogGapOf(gap: UnusableInput | null): InputGapNote | null {
  if (gap === null) return null;
  const ids = EXTERNAL_STEPS.filter((step) => step.readsCatalog).map((step) => step.id);
  return { gap, consequence: `外部連携の宣言を読む検査(${ids.join('・')})は見ていません(台帳だけを見る検査は実行済み)` };
}
