/**
 * 保存点の**結末と再送の見立て**(束 ⑳-5a2)。
 *
 * `eq-save-cases.ts` の組み合わせとは別に、ここにあるのは「計画の形から決まるもの」だけである —— どちらも
 * 実測の期待になるので、実行する側が推測で埋めないように設計図が運ぶ。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { BuiltSave } from '../usecase/plan-build.js';
import { statesOf } from './eq-save-axes.js';
import { anchorStep } from '../usecase/param-source-facts.js';

/** 結末と再送の見立てに要る入力。 */
export interface EqSaveShapeInput {
  readonly domain: SpecModel;
  readonly built: BuiltSave;
}

/**
 * 再送の 2 回目に何が起きるか(**計画から決まる**)。
 *
 * | 値 | 計画の形 | 2 回目 |
 * |---|---|---|
 * | `idempotent` | 作成の手順(最初の作成 = 錨)があり、その表が再送で既存の行を返す(`resend.returns_existing: true`) | 既存の行を読み直して同じ形を返す(行は増えない。同じ実行者の再送なので作成者の条件を通る) |
 * | `conflict` | 錨の表が再送で既存の行を返さない(`returns_existing: false`)/ 作成が無く、最初の手順が「外の集約の状態」を条件にする遷移 | 同じ id の行がある・その手順で状態が動いているので競合になる |
 * | `unknown` | どちらでもない | 再送の軸を実行しない(何が起きるかを宣言から言えない) |
 */
export type EqResendOutcome = 'idempotent' | 'conflict' | 'unknown';

/**
 * 結末の状態が載る列(予測状態を持つ状態機械の列を選ぶ)。
 *
 * @param input ドメイン仕様と組み立て済みの保存点
 * @returns 状態の列名。状態を持たない結末なら null
 */
export function resultStateColumnOf(input: EqSaveShapeInput): string | null {
  const result = input.built.facts.result;
  if (result.state === null) return null;
  const fields = findEntitySpec(input.domain, result.entity)?.fields ?? [];
  for (const field of fields) {
    if (field.type.kind !== 'state') continue;
    if (statesOf(input.domain, field.type.machine).includes(result.state)) return field.name;
  }
  return null;
}

/**
 * 再送の 2 回目に何が起きるか(計画の形から決まる)。
 *
 * @param input ドメイン仕様と組み立て済みの保存点
 * @returns 再送の見立て
 */
export function resendOutcomeOf(input: EqSaveShapeInput): EqResendOutcome {
  const first = input.built.plan.steps[0];
  if (first === undefined) return 'unknown';
  // 錨は**最初の作成**の手順である(複合 RPC の先頭の再送の枝と同じ見方。`save-readback.ts` の `readbackPlans`)。錨が最初の手順で
  // なくても、再送の枝は手順を実行する前に錨の行の実在を見るので、2 回目に起きることは錨の表の宣言が決める(点検 21 回目 A21-1:
  // 委任しない枝の保存点も、再送と入力を変えた押し直しの性質の対象にする)。
  const anchor = anchorOf(input);
  if (anchor !== undefined) {
    // 再送の方針は錨の表の宣言(`resend`)が決める。宣言の無い表は verify(T6 / Y12)が止めるので、ここでは言わない。
    if (anchor.resend === undefined) return 'unknown';
    return anchor.resend.returnsExisting ? 'idempotent' : 'conflict';
  }
  const from = input.built.facts.steps[0]?.stateFrom;
  if (first.kind === 'transition' && from !== undefined && from !== null && from.kind === 'external') {
    return 'conflict';
  }
  return 'unknown';
}

/**
 * 保存点の冪等の錨(最初の作成の手順。作成を持たない保存点は無し)。決め方は `usecase/param-source-facts.ts` の `anchorStep` の 1 か所
 * (点検 22 回目 C の O22-3。以前はここ・`save-readback.ts`・`param-source.ts` に同じ式の写しがあった)。
 *
 * @param input ドメイン仕様と組み立て済みの保存点
 * @returns 錨の手順
 */
export function anchorOf(input: EqSaveShapeInput): BuiltSave['plan']['steps'][number] | undefined {
  return anchorStep(input.built.plan);
}
