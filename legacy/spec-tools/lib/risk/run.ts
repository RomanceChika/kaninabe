/**
 * 危ない形の検査(R 群)の実行口。
 *
 * 登録(`checks.ts`)の段を上から回し、違反を返す。R2 は他の種類の仕様(action_spec・data_table・認証フロー・
 * 外部連携・ジョブ)を材料に読むので、材料は**入力の状態のまま**受ける —— 未選択は「その種類の宣言が無い」という事実として
 * 空で判定し、阻害(採ったのに読めない)は依る判定を出さずに、見ていないことを実行ログに 1 行ずつ言う(他の群と同じ流儀)。
 * 純関数の束ねであり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { Finding } from '../kernel/finding.js';
import { inputValue, unusableOf, type CatalogInput, type InputGapNote } from '../kernel/input-state.js';
import type { SpecModel } from '../model/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { AuthFlowSpec } from '../model/auth/types.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { ConfigCatalogSpec } from '../model/config/types.js';
import type { JobCatalogSpec } from '../model/job/types.js';
import type { GroundWritersInput } from './verifiers/r2-ground-writers.js';
import type { AbuseInput } from './verifiers/r5-abuse.js';
import type { BearerInput, BearerScreenRoute } from './verifiers/r16-bearer.js';
import type { RichTextScan } from './rich-text-scan.js';
import { RISK_STEPS } from './checks.js';

/** 実行口の材料(他の種類は入力の状態のまま)。 */
export interface RiskInputs {
  readonly model: SpecModel;
  readonly actions: CatalogInput<ActionSpecModel>;
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  readonly auth: CatalogInput<AuthFlowSpec>;
  readonly external: CatalogInput<ExternalCatalogSpec>;
  /** 設定カタログ(R5-7 が有料の口の回数の枠の `source` の実在を引く)。 */
  readonly config: CatalogInput<ConfigCatalogSpec>;
  readonly jobs: CatalogInput<JobCatalogSpec>;
  /** 書式つきの本文を描く口への渡し方の走査(R15。実装の木を走査できなければ `available: false`)。 */
  readonly richText: RichTextScan;
  /** 画面の route(R16 が動的セグメントに `bearer` の欄が載っていないかを見る。画面を読めなかったら空 = 見ない)。 */
  readonly screenRoutes: readonly BearerScreenRoute[] | null;
}

/** 段へ渡す材料(読込済みの値だけ)。 */
export interface RiskRunInput {
  readonly groundWriters: GroundWritersInput;
  /** R5 の材料(未ログインの書き込み: ドメイン仕様と、R5-4 が生成器の判定を聞く data_table。有料の口 R5-7 / R5-8: 外部連携と、枠の `source` の接地先の config)。 */
  readonly abuse: AbuseInput;
  /** R15 の材料(書式つきの本文を描く口への渡し方)。 */
  readonly richText: RichTextScan;
  /** R16 の材料(`bearer` の欄の宣言・列の既定値と関数の引数・画面の route)。 */
  readonly bearer: BearerInput;
}

/** R 群の結果(違反と、阻害の入力のために見ていないこと)。 */
export interface RiskRun {
  readonly findings: Finding[];
  /** 阻害の入力ごとの「見ていないこと」(R2 の材料。実行ログに 1 行ずつ出す)。 */
  readonly gaps: InputGapNote[];
}

/** R2 が他の種類から引く材料 1 つ(阻害なら依る判定を出さず、見ていないことを行で言う)。 */
interface RiskSource {
  /** 材料の種類(入力の欄の名前)。 */
  readonly kind: 'actions' | 'dataTables' | 'auth' | 'external' | 'jobs' | 'config';
  /** 実行ログに出す種類の名前(`product.md` の `uses` の綴り)。 */
  readonly input: string;
  /** 内部実行の入口の追跡に使う材料か(阻害なら、追えない書き込みの判定を出さない)。 */
  readonly trace: boolean;
  /** 使えないときに見ていないこと。 */
  readonly consequence: string;
}

/**
 * R2 が引く材料の全数(**阻害を言う名指しの表**。構造テスト `foreign-readers.test.ts` がこの表を引く)。
 * 作成・遷移の入力(action_spec)・既定値と受信の記録の表(data_table)は経路の材料、
 * 認証フロー・外部連携・ジョブは内部実行の入口の材料である。
 */
export const RISK_SOURCES: readonly RiskSource[] = [
  { kind: 'actions', input: 'actions', trace: false, consequence: '作成・遷移の入力が役の根拠の欄を書く経路は見ていません' },
  { kind: 'dataTables', input: 'data_tables', trace: true, consequence: '作成の既定値が役を与える経路と、受信の記録の表の入口と、未ログインの作成の天井を生成器が出せるか(R5-4)は見ていません' },
  { kind: 'auth', input: 'auth', trace: true, consequence: 'サインインの決定表の入口は見ていません' },
  { kind: 'external', input: 'external', trace: true, consequence: '受信 Webhook の入口は見ていません' },
  { kind: 'jobs', input: 'jobs', trace: true, consequence: '時刻の走査の入口は見ていません' },
  { kind: 'config', input: 'config', trace: false, consequence: '有料の口の回数の枠が挙げる設定の id が config カタログに実在するか(R5-7)は見ていません' },
];

/** 阻害の材料(未選択は事実として無いので数えない)。 */
function blockedSources(inputs: RiskInputs): { readonly source: RiskSource; readonly note: InputGapNote }[] {
  return RISK_SOURCES.flatMap((source) => {
    const input: CatalogInput<unknown> = inputs[source.kind];
    const gap = unusableOf(input, source.input);
    return gap?.state === 'blocked' ? [{ source, note: { gap, consequence: source.consequence } }] : [];
  });
}

/**
 * R 群を実行する(実行ログへの報告は束ね役 `lib/verify/risk-group.ts` が行う)。
 *
 * @param inputs 材料(入力の状態のまま)
 * @returns 違反と、阻害の入力のために見ていないこと
 */
export function runRiskChecks(inputs: RiskInputs): RiskRun {
  const blocked = blockedSources(inputs);
  const dataTables = inputValue(inputs.dataTables);
  const input: RiskRunInput = {
    groundWriters: {
      model: inputs.model,
      actions: inputValue(inputs.actions),
      dataTables,
      catalogs: { auth: inputValue(inputs.auth), external: inputValue(inputs.external), jobs: inputValue(inputs.jobs), dataTables },
      blockedSources: blocked.filter(({ source }) => source.trace).map(({ source }) => source.input),
    },
    abuse: { model: inputs.model, dataTables, external: inputValue(inputs.external), config: inputs.config },
    richText: inputs.richText,
    bearer: { model: inputs.model, tables: dataTables === undefined ? null : dataTables.tables, screens: inputs.screenRoutes },
  };
  const findings: Finding[] = [];
  const withheld: string[] = [];
  for (const step of RISK_STEPS) {
    const run = step.run(input);
    findings.push(...run.findings);
    withheld.push(...run.withheld);
  }
  const gaps = blocked.map(({ source, note }) => (source.trace && withheld.length > 0 ? { ...note, subjects: withheld } : note));
  return { findings, gaps };
}
