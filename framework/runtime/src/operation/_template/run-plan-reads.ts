/**
 * 実行計画（`run-plan.ts`）が**実 DB から判断材料を読む**部分。
 *
 * 仕様: docs/rules/decisions/common/ADR-0012-db-as-authority.md ④
 *
 * `./run-plan-facts.ts` は「読んだ値を供給元ごとに引く」純関数だけを持ち、ここが「読む」ことそのものを
 * 持つ（読み取りの口 `../ports` に依存するのはこのファイルだけである）。
 */

import type { GuardValue } from '@kaninabe/runtime/engine';
import type { RunPlan } from '@kaninabe/runtime/plan';
import type { UsecaseFactReader } from '@kaninabe/runtime/ports';
import type { FactMap, PlanInputMap } from './run-plan-facts';
import { inputField } from './run-plan-facts';

/**
 * 判断材料の行を読む（1 集約 1 回）。
 *
 * 読めなかった行があれば `null` を返す —— 判断材料が揃わないので、定型の既定どおり
 * `forbidden` に写る（`./facts.ts`「見えない」と「権限が無い」を区別しない）。
 *
 * `reads` は**依存の無いものが先**に並んでいる（生成器が保証する）。`context` の供給元は
 * 「先に読んだ行の参照列」なので、この順で回せば必ず値が揃っている。
 */
export async function loadFacts(
  plan: RunPlan,
  reader: UsecaseFactReader,
  actorId: string | null,
  input: PlanInputMap,
): Promise<FactMap | null> {
  const facts: Record<string, GuardValue> = {};
  for (const read of plan.reads) {
    const id = readId(plan, read.idFrom, actorId, input, facts);
    if (typeof id !== 'string' || id === '') return null;
    const row = await reader.readFields(read.table, id, read.fields);
    if (row === null) return null;
    for (const field of read.fields) facts[`${read.entity}.${field}`] = row[field] ?? null;
  }
  return facts;
}

/** その読み取りを 1 行に絞る id。 */
function readId(
  plan: RunPlan,
  idFrom: RunPlan['reads'][number]['idFrom'],
  actorId: string | null,
  input: PlanInputMap,
  facts: FactMap,
): unknown {
  switch (idFrom.kind) {
    case 'actor':
      return actorId;
    case 'context':
      return facts[idFrom.ref];
    default:
      return inputField(plan, input, idFrom);
  }
}
