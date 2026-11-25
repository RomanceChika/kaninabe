/**
 * 実行計画の 1 手順を、**字面になる前の値**として組み立てる(束 ⑳-5b-b)。
 *
 * これまで手順の値は生成器の中で直接 TS の字面になっていた(`renderStepLiteral`)。読む相手が
 * 2 つになったので —— 生成物(`usecase-plans.ts` / `operation-plans.ts`)と、ハンドブックの
 * 結果表が実行器に渡す計画 —— 組み立てを 1 か所にし、字面はその写しにする。
 *
 * ここが持つのは「仕様から導いた値」だけである。規則表・遷移表は生成物では**識別子**
 * (`entryCreateRules`)、結果表では**値そのもの**になるので、この型には載せない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SaveStepPlan, StepKind } from './step-plan.js';
import type {
  UsecaseClaimFact,
  UsecaseFactSource,
  UsecaseGuardFact,
  UsecaseRoleFact,
  UsecaseStepFacts,
} from './plan-facts-types.js';

/**
 * 実行計画の 1 手順の値(規則表・遷移表を除く全部)。
 *
 * 欄の名前と並びは生成物の型(`plan-types.ts` の `RunStepPlan`)と同じである —— 同じ 1 つの
 * 値の 2 つの姿なので、名前が食い違うと「どちらが正か」が生まれる。
 */
export interface RunStepData {
  /** 操作 ID(ドメインイベント ID または予約 ID。拒否が載せるのはこちら)。 */
  readonly op: string;
  /** 入力・結果の鍵(usecase_spec の `as`。書かなければ `op`)。 */
  readonly alias: string;
  /** 人の言葉での見出し。 */
  readonly label: string;
  readonly kind: StepKind;
  readonly aggregate: string;
  readonly repeat: boolean;
  /** 「自分として」の宣言(`defaults.self`)。 */
  readonly self: boolean;
  /** 遷移のイベント名(遷移以外では null)。 */
  readonly event: string | null;
  /** 遷移元の状態の供給元(遷移以外では null)。 */
  readonly stateFrom: UsecaseFactSource | null;
  readonly guardFacts: readonly UsecaseGuardFact[];
  readonly roleFacts: readonly UsecaseRoleFact[];
  readonly claimFacts: readonly UsecaseClaimFact[];
  /** この手順が認めるロールごとの、併せて満たす行の条件(無ければ持たない。ADR-0018)。 */
  readonly roleGates?: NonNullable<UsecaseStepFacts['roleGates']>;
  /** この手順が認めるロールのうち、この経路では立たないもの。 */
  readonly unresolvableRoles: readonly string[];
  /** 入力から受け取る欄(入力スキーマの鍵と一致する)。 */
  readonly inputKeys: readonly string[];
}

/**
 * 接地済みの手順と解決済みの事実から、実行計画の 1 手順の値を組み立てる。
 *
 * @param step 接地済みの手順
 * @param facts その手順の解決済みの事実(無ければ空として組む)
 * @returns 実行計画の 1 手順の値
 */
export function runStepData(step: SaveStepPlan, facts: UsecaseStepFacts | undefined): RunStepData {
  return {
    op: step.op,
    alias: step.alias,
    label: step.label,
    kind: step.kind,
    aggregate: step.entity,
    repeat: step.repeat,
    self: step.defaultsSelf,
    event: step.event === null ? null : step.event.id,
    stateFrom: facts?.stateFrom ?? null,
    guardFacts: facts?.guardFacts ?? [],
    roleFacts: facts?.roleFacts ?? [],
    claimFacts: facts?.claimFacts ?? [],
    ...(facts?.roleGates === undefined ? {} : { roleGates: facts.roleGates }),
    unresolvableRoles: facts?.unresolvableRoles ?? [],
    inputKeys: facts?.inputKeys ?? [],
  };
}
