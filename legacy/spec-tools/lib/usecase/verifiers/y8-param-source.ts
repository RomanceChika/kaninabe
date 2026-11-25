/**
 * Y8 保存点の全手順の全引数が「引数名 → 供給元」の規約で解決できる。
 *
 * usecase-spec-writing.md §引数名 → 供給元 の要求:
 *   - 各手順が呼ぶ RPC が data_table に実在すること(命名規約から導いた名前)
 *   - その RPC の `params` が 1 本残らず規約の値域で解決できること
 *   - `defaults.self` が指す欄(実行者を指す参照欄)が一意に決まること
 *
 * **これは生成の前借りである。** 複合 RPC の生成(code-usecase-rpc.ts)は同じ
 * `planSave` / `resolveSaveParams` を呼び、決まらない引数があれば生成できない。検査が先に
 * 同じ問いを立てておくことで、「generate が黙って何も出さない」ではなく「verify が
 * 反例つきで止まる」になる(決められないことは仕様の問題として止める、の執行点)。
 */

import type { Finding } from '../../kernel/finding.js';
import { inputValue } from '../../kernel/input-state.js';
import type { UsecaseInput } from '../derive.js';
import type { PlanProblem } from '../step-plan.js';
import { planSave } from '../step-plan.js';
import { resolveSaveParams } from '../param-source.js';
import { usecaseFinding, type UsecaseContext, type UsecaseVerifier } from '../verifier.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'Y8';

/** Y8 の実装。 */
export const paramSourceVerifier: UsecaseVerifier = {
  id: VERIFIER_ID,
  title: '保存点の全手順の全引数が規約で解決できる',

  verify(input: UsecaseInput, ctx: UsecaseContext): Finding[] {
    // data_table が使えない(未選択・阻害)環境では何も見ない(見ていないことは実行ログが言う)。
    const dataTables = inputValue(ctx.dataTables);
    if (dataTables === undefined) return [];
    if (ctx.actions.state === 'blocked') return []; // action_spec が分からない(引数の供給元に入力欄を引く。行は呼び手が言う)
    const findings: Finding[] = [];
    for (const usecase of input.usecases.usecases) {
      for (const save of usecase.saves) {
        const planned = planSave(usecase, save, {
          domain: input.domain,
          actions: input.actions,
          dataTables,
        });
        if (!planned.ok) {
          findings.push(...planned.problems.map((problem) => toFinding(problem, usecase.location.file, save.id)));
          continue;
        }
        const resolved = resolveSaveParams(planned.plan, input.domain);
        if (resolved.ok) continue;
        findings.push(...resolved.problems.map((problem) => toFinding(problem, usecase.location.file, save.id)));
      }
    }
    return findings;
  },
};

/** 接地・解決の失敗を Finding(3 点セット + 反例)に写す。 */
function toFinding(problem: PlanProblem, file: string, saveId: string): Finding {
  return usecaseFinding(VERIFIER_ID, {
    message: problem.message,
    location: { file, pointer: `saves.${saveId}` },
    suggestion: problem.suggestion,
    counterexample: problem.counterexample,
  });
}
