/**
 * Y5 予算のチェック(warning)。
 *
 * usecase-spec-writing.md の Y5:「導出した手数・画面・概念・前提・入力・確認が
 * `budget`(無ければ規約の既定)を超えたら warning。免除は理由つき
 * (usecase の `accept: [{ metric, reason }]`)」。
 *
 * ADR-0011 §6「認知の予算」の実装であり、cognitive-load.md の「数えられないものは守れない」
 * をそのまま検査にしたものである。**エラーにしないのは意図である** —— 手数や入力の多さは
 * 「絶対にあってはならない」ものではなく、レビューで気づくべき信号だからである
 * (U 群の経験則と同じ扱い。ux-lint.md を参照)。
 */

import type { UsecaseSpec } from '../../model/usecase/types.js';
import type { UsecaseBudgetMetric } from '../../model/usecase/types.js';
import type { Finding, UsecaseContext, UsecaseVerifier } from '../verifier.js';
import { usecaseFinding } from '../verifier.js';
import type { UsecaseInput } from '../derive.js';
import { acceptedFor, effectiveBudget } from '../derive.js';
import { deriveUsecaseMetrics, metricValue } from '../derive-effort.js';

/** 予算の指標ごとの日本語名(Finding の文面用)。 */
const METRIC_LABELS: Readonly<Record<UsecaseBudgetMetric, string>> = {
  steps: '手数(保存の回数)',
  screens: '画面',
  concepts: '概念',
  preconditions: '前提',
  inputs: '入力',
  confirmations: '確認',
};

/** Y5: 導出した 6 指標が予算(既定または宣言)を超えていないことを検証する(warning)。 */
export const budgetVerifier: UsecaseVerifier = {
  id: 'Y5',
  title: '予算 — 手数・画面・概念・前提・入力・確認が予算(既定または宣言)を超えていない',

  verify(input: UsecaseInput, ctx: UsecaseContext): Finding[] {
    if (!input.usecases.available) return [];
    // 使えない入力に依る指標だけ数えない(ほかは従来どおり。行は呼び手が言う): 画面の到達の入力(画面・関門)が使えないとき通る画面と前提(start に入る関門の数)、
    // action_spec が阻害のとき入力と確認(action_spec の入力欄と上書きに依る)。未選択は「無い」事実で、従来どおり数える。
    const uncounted = uncountedMetrics(ctx);
    return input.usecases.usecases.flatMap((usecase) => checkBudget(usecase, input, uncounted));
  },
};

/** 使えない入力のために数えない指標。 */
function uncountedMetrics(ctx: UsecaseContext): ReadonlySet<UsecaseBudgetMetric> {
  return new Set<UsecaseBudgetMetric>([
    ...(ctx.reachabilityGaps.length > 0 ? (['screens', 'preconditions'] as const) : []),
    ...(ctx.actions.state === 'blocked' ? (['inputs', 'confirmations'] as const) : []),
  ]);
}

/** 1 ユースケース分の予算超過を検証する。 */
function checkBudget(usecase: UsecaseSpec, input: UsecaseInput, uncounted: ReadonlySet<UsecaseBudgetMetric>): Finding[] {
  const metrics = deriveUsecaseMetrics(usecase, input);
  const budget = effectiveBudget(usecase, input.budgetDefaults);
  const findings: Finding[] = [];

  for (const metric of Object.keys(budget) as UsecaseBudgetMetric[]) {
    if (uncounted.has(metric)) continue;
    const value = metricValue(metrics, metric);
    const limit = budget[metric];
    if (value <= limit) continue;
    const accepted = acceptedFor(usecase, metric);
    if (accepted !== undefined) continue; // 理由つきで受け入れ済み(warning ごと出さない)

    findings.push(
      usecaseFinding('Y5', {
        severity: 'warning',
        message: `${METRIC_LABELS[metric]}が予算(${limit})を超えています(実測 ${value})`,
        location: { file: usecase.location.file, pointer: metric === 'steps' ? 'saves' : 'budget' },
        suggestion:
          `隣り合う手順を 1 つの保存点にまとめる(ADR-0011 §3 の 2 段目。手数は saves の長さで数える)か、` +
          `本当に必要なら usecase_spec に "accept: [{ metric: ${metric}, reason: {理由} }]" を足して受け入れる`,
        counterexample: { usecase: usecase.name, metric, value: String(value), budget: String(limit) },
      }),
    );
  }
  return findings;
}
