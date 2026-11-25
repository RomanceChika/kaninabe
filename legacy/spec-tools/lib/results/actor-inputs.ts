/**
 * 結果表のシミュレーションで、作成の規則が縛る入力の欄に実行者本人か他人の id を置く(一致の証明の軸 `actorInputs`)。
 *
 * 実 DB 版は `framework/runtime/testing/equivalence/world.mts` の `withActorInputs` で、規則は同じである ——
 * 本人は実行者の id、他人は「雛形の値が実行者でなければそれ、実行者なら world の別の実行者の行」。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { EqAxisValue, EqWorld } from '../world/index.js';
import type { SimulatedSubject, SimulatedValue } from './simulated-world.js';
import { simulatedRowId } from './simulated-world.js';

/**
 * 作成の規則が縛る入力の欄に、実行者本人か他人の id を置く。
 *
 * @param subject シミュレーションで決めた相手
 * @param values 組み合わせが選んだ軸の値
 * @param world その集約の world(他人の id を引く)
 * @returns 入力を置き直した相手
 */
export function withActorInputs(subject: SimulatedSubject, values: readonly EqAxisValue[], world: EqWorld): SimulatedSubject {
  const choices = values.flatMap((value) => value.actorInputs ?? []);
  if (choices.length === 0) return subject;
  const first: Record<string, SimulatedValue> = { ...(subject.inputs[0] ?? {}) };
  const others = world.actors
    .map((candidate) => (candidate.row === null ? null : simulatedRowId(candidate.row)))
    .filter((id): id is string => id !== null && id !== subject.actorId);
  for (const choice of choices) {
    if (choice.who === 'self') {
      first[choice.column] = subject.actorId;
      continue;
    }
    const current = first[choice.column];
    if (typeof current !== 'string' || current === subject.actorId || current === '') first[choice.column] = others[0] ?? null;
  }
  return { ...subject, inputs: [first, ...subject.inputs.slice(1)] };
}
