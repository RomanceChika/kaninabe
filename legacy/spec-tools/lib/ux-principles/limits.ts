/**
 * 台帳から閾値を引く(台帳が無い・行が無いときは検査器の定数が既定値)。
 *
 * 閾値の変更が「コードの書き換え」から「仕様の編集」になる、というのが台帳の見返りの 1 つである。
 * 検査のコードは閾値の値を持たない — 持つのは**既定値**(台帳をまだ開設していない製品の安全側)だけで、
 * ユースケースの予算(`DEFAULT_USECASE_BUDGET` と `budget:`)と同じ形である。
 */

import type { UsecaseBudgetMetric } from '../model/usecase/types.js';
import { DEFAULT_USECASE_BUDGET, USECASE_BUDGET_METRICS } from '../model/usecase/types.js';
import type { UxLimits } from '../model/ux/types.js';
import { MAX_SIMULTANEOUS_ACTIONS, MAX_WRITABLE_FIELDS } from '../model/ux/types.js';
import type { UxPrinciplesModel } from '../model/ux-principles/types.js';

/** 検査 ID が見張る原則の閾値(無ければ undefined)。 */
function limitOf(model: UxPrinciplesModel, check: string): number | undefined {
  return model.spec?.principles.find((principle) => principle.enforcedBy === check && principle.budget !== undefined)
    ?.budget?.limit;
}

/**
 * U 群の閾値を台帳から引く。
 *
 * @param model 読み込み済みの台帳(`available: false` なら既定値)
 * @returns U4(同時操作数)と U5(フォーム長)の閾値
 */
export function uxLimitsOf(model: UxPrinciplesModel): UxLimits {
  return {
    maxSimultaneousActions: limitOf(model, 'U4') ?? MAX_SIMULTANEOUS_ACTIONS,
    maxWritableFields: limitOf(model, 'U5') ?? MAX_WRITABLE_FIELDS,
  };
}

/** 台帳の行 id `Y5-{指標}` の形。 */
function usecaseMetricRowId(metric: UsecaseBudgetMetric): string {
  return `Y5-${metric}`;
}

/**
 * ユースケースの認知の予算(Y5)の既定値を台帳から引く。`budget:` を書かない usecase_spec はこの値と比べられる。
 *
 * @param model 読み込み済みの台帳(`available: false` なら `DEFAULT_USECASE_BUDGET`)
 * @returns 指標ごとの既定の上限
 */
export function usecaseBudgetDefaultsOf(model: UxPrinciplesModel): Readonly<Record<UsecaseBudgetMetric, number>> {
  const defaults: Record<UsecaseBudgetMetric, number> = { ...DEFAULT_USECASE_BUDGET };
  for (const metric of USECASE_BUDGET_METRICS) {
    const row = model.spec?.principles.find(
      (principle) => principle.enforcedBy === 'Y5' && principle.id === usecaseMetricRowId(metric),
    );
    if (row?.budget !== undefined) defaults[metric] = row.budget.limit;
  }
  return defaults;
}

/** 台帳に書くべき Y5 の行の id(U8 が揃っていることを見る)。 */
export function usecaseMetricRowIds(): readonly string[] {
  return USECASE_BUDGET_METRICS.map(usecaseMetricRowId);
}
