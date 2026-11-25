import type { EqAxisValue } from './types.mjs';

/**
 * 一致の証明が、作成の規則が縛る入力の欄に**実行者本人か他人の id** を置く(軸の `actorInputs`)。
 *
 * 結果表のシミュレーション(`legacy/spec-tools/lib/results/actor-inputs.ts`)と同じ規則である。
 * **アプリの語彙は 1 語も持たない。**
 */

/**
 * 作成の規則が縛る入力の欄に、実行者本人か他人の id を置く(軸 `actorInputs`)。
 *
 * 他人は「雛形の値が実行者でなければそれ、実行者なら world の別の実行者」—— 雛形がたまたま本人を指す系統でも
 * 他人の側が本人にならないようにする。
 *
 * @param input 雛形から組んだ入力
 * @param selection 組み合わせ(軸の選択)
 * @param selection.axis 軸ごとに選んだ値
 * @param actorId 実行者の id
 * @param everyone world の実行者全員の id
 * @returns 置いたあとの入力
 */
export function withActorInputs(
  input: Readonly<Record<string, unknown>>,
  selection: { readonly axis: readonly EqAxisValue[] },
  actorId: string,
  everyone: readonly string[],
): Readonly<Record<string, unknown>> {
  const placed: Record<string, unknown> = { ...input };
  for (const choice of selection.axis.flatMap((value) => value.actorInputs ?? [])) {
    if (choice.who === 'self') {
      placed[choice.column] = actorId;
      continue;
    }
    const current = placed[choice.column];
    if (typeof current !== 'string' || current === actorId || current === '') {
      placed[choice.column] = everyone.find((id) => id !== actorId) ?? null;
    }
  }
  return placed;
}
