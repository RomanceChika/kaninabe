/**
 * 人が書く文(`summary:`)の**未記入**の数え方。
 *
 * 場所は 3 か所(`entity_spec` のトップ・`state_spec` の機械ごと・状態ごと。book-human-face.md §2)で、
 * 書かれていない場所は章に「(まだ書かれていない)」と出る。この数は**仕様から数える**(章の出力を数える
 * 数えかたとは別の道)ので、手引きの「未記入 N 件」と章の本文に出る数が合うかを構造テストが突き合わせる。
 * 純粋関数だけ。
 */

import type { AggregateSpecs } from '../../../model/types.js';

/** 集約 1 つの未記入の内訳。 */
export interface SummaryGaps {
  /** 章頭の 1 文(`entity_spec.summary`)。entity_spec が無い集約は数えない(0)。 */
  readonly entity: number;
  /** 節の要約(`machines[].summary`)。 */
  readonly machines: number;
  /** 段の場面(`states[].summary`)。 */
  readonly states: number;
  /** 書く場所の総数(未記入 + 記入済み)。 */
  readonly places: number;
}

/** 未記入の合計。 */
export function gapTotal(gaps: SummaryGaps): number {
  return gaps.entity + gaps.machines + gaps.states;
}

/**
 * 集約 1 つの未記入を数える。
 *
 * @param specs 集約の仕様
 */
export function summaryGaps(specs: AggregateSpecs): SummaryGaps {
  const entityPlaces = specs.entity === undefined ? 0 : 1;
  const entity = specs.entity !== undefined && specs.entity.summary === undefined ? 1 : 0;
  const machines = specs.stateMachines.filter((machine) => machine.summary === undefined).length;
  const states = specs.stateMachines.reduce(
    (sum, machine) => sum + machine.states.filter((state) => machine.stateSummaries[state] === undefined).length,
    0,
  );
  const places =
    entityPlaces + specs.stateMachines.length + specs.stateMachines.reduce((sum, machine) => sum + machine.states.length, 0);
  return { entity, machines, states, places };
}

/**
 * 章の範囲(親 + 節に畳んだ従属する集約)の未記入を、足して数える。
 * 従属する集約の章頭の 1 文・段の場面は、親の章の「従属する概念」の節に出るので、章の数に入る。
 *
 * @param scope 範囲の集約
 */
export function summaryGapsOf(scope: readonly AggregateSpecs[]): SummaryGaps {
  const all = scope.map((specs) => summaryGaps(specs));
  const sum = (pick: (gaps: SummaryGaps) => number): number => all.reduce((total, gaps) => total + pick(gaps), 0);
  return { entity: sum((gaps) => gaps.entity), machines: sum((gaps) => gaps.machines), states: sum((gaps) => gaps.states), places: sum((gaps) => gaps.places) };
}
