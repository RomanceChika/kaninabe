/**
 * 外部連携カタログ → 実行時の期待表(`app/src/domain/generated/external-expectations.ts`)の生成器。
 *
 * カタログが宣言する**実行時の約束**(待ち時間の上限 `timeout_ms`・有限回の再試行の上限
 * `retry_max`・二重反映を何が防ぐか `idempotency_source`)を、アダプタの実装が読める形に写す。
 *
 * **なぜ生成物にするのか。** これらの軸は束 ⑳ 以前、パーサが形を見るだけで**どこにも接地して
 * いなかった**(検査の漏れ探し 2026-09-12 §1。`timeout_ms: 5000 → 1` に変えても verify はエラー 0)。
 * アダプタが同じ数値を自分の側に `const TIMEOUT_MS = 5000` と書き写していたためで、
 * 仕様を直しても実装は動かない。値の住所を 1 つ(この生成物)にすれば、写し間違いという
 * 状態が存在しなくなる —— config.ts / jobs.ts / notifications.ts と同じ流儀である。
 *
 * 接地を見るのは X6(`lib/external/verifiers/x6-runtime-grounding.ts`)であり、
 * 「アダプタがこの表を読んでいること」「生の数値で待ち時間を書いていないこと」を突き合わせる。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { ExternalCatalogSpec, IntegrationDecl } from '../../model/external/types.js';
import { IDEMPOTENCY_SOURCES } from '../../model/external/types.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral, tsString } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 期待表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'external-expectations.ts');

/** 連携 1 件を実行時の期待値のリテラルに写す(宣言が無い軸は鍵ごと出さない)。 */
function expectationLiteral(integration: IntegrationDecl): LiteralValue {
  return {
    id: integration.id,
    ...(integration.direction !== 'outbound' || integration.timeoutMs === undefined ? {} : { timeoutMs: integration.timeoutMs }),
    ...(integration.retryMax === undefined ? {} : { retryMax: integration.retryMax }),
    ...(integration.idempotencySource === undefined
      ? {}
      : { idempotencySource: integration.idempotencySource }),
  };
}

/** 期待表の本体(連携 id → 実行時の期待値)。 */
function tableLiteral(catalog: ExternalCatalogSpec): LiteralValue {
  const table: Record<string, LiteralValue> = {};
  for (const integration of catalog.integrations) table[integration.id] = expectationLiteral(integration);
  return table;
}

/** 期待表のファイル全体を組み立てる。 */
function renderFile(catalog: ExternalCatalogSpec): string {
  const ids = catalog.integrations.map((integration) => tsString(integration.id));
  return [
    generatedHeader([catalog.location.file]),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment(['二重反映を何が防ぐかの値域(カタログの語彙ではなく体系側の値域)。']),
    `export type IdempotencySource = ${IDEMPOTENCY_SOURCES.map(tsString).join(' | ')};`,
    '',
    docComment(['連携 id の値域(カタログの integrations が正)。']),
    `export type ExternalIntegrationId = ${ids.length === 0 ? 'never' : ids.join(' | ')};`,
    '',
    docComment([
      '連携 1 件の**実行時の約束**。',
      '',
      '`timeoutMs` は `direction: outbound` の行だけ、`retryMax` は `retry: inline` の行だけ、',
      '`idempotencySource` は `effect: write` の行だけが持つ(条件付き必須の軸なので任意型)。',
    ]),
    'export interface ExternalExpectation {',
    '  readonly id: ExternalIntegrationId;',
    '  readonly timeoutMs?: number;',
    '  readonly retryMax?: number;',
    '  readonly idempotencySource?: IdempotencySource;',
    '}',
    '',
    docComment([
      '外部連携の実行時の期待値(閉世界)。',
      '',
      'アダプタは待ち時間・再試行の上限をここから読む —— 同じ数値を実装側へ書き写さない。',
      '「読んでいること」と「生の数値を書いていないこと」は X6 が突き合わせる。',
      '',
      '`as const` にするのは、**宣言の無い軸を読もうとしたら型エラーにする**ためである',
      '(`retry: inline` でない行の `.retryMax` は存在しないので、コンパイルが止める)。',
      '形そのものは `satisfies` が `ExternalExpectation` に照らして見る。',
    ]),
    `export const EXTERNAL_EXPECTATIONS = ${frozen(`${renderLiteral(tableLiteral(catalog))} as const satisfies Readonly<Record<ExternalIntegrationId, ExternalExpectation>>`)};`,
    '',
  ].join('\n');
}

/**
 * 外部連携カタログから実行時の期待表を生成するジェネレーター。
 * 出力は app/src/domain/generated/external-expectations.ts の 1 ファイル(全置換)。
 */
export const externalExpectationsGenerator: DocGenerator = {
  id: 'code-external-expectations',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.external?.catalog;
    if (catalog === undefined || catalog === null) return [];
    return [{ file: outputFile(ctx.roots), content: renderFile(catalog), wholeFile: true }];
  },
};
