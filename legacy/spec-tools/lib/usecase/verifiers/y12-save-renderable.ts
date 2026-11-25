/**
 * Y12 保存点が**複合 RPC に写せる形**である。
 *
 * usecase-spec-writing.md §保存点に置ける手順の形 の要求を、Y8(引数の供給元が決まるか)の
 * 次の段として見る —— 決まった供給元が plpgsql の字面に写せるか、である。写せない形は 2 つ。
 *
 *   - **計算値(`computes`)を持つ遷移**・編集の副作用。値を決めるのが TS 側なので、
 *     複合 RPC の中には置き場が無い。
 *   - **再送の入力の要約の置き場**(仕組みの表 `resend_digests`)が要るのに宣言が無い保存点(点検 21 回目 A21-1。判定は
 *     `usecase/resend-policy.ts` の `resendDigestStoreProblem` で、生成器も同じ 1 本を呼ぶ)。
 *   - **再送のときに読み直せない手順**。複合 RPC の再送は「最初に作る行から参照の鎖を辿る」
 *     形しか持たないので、鎖に乗らない手順は写せない —— 保存点の**外**にある別集約への遷移、
 *     親を持たない兄弟行を N 行作る形がこれに当たる。
 *
 * **これは Y8 / Y10 と同じ「生成の前借り」である。** 束 ⑱ の 4 題材が、この 3 つの形すべてで
 * 「`verify` は緑のまま `generate` が例外で落ちる」を実測した —— 仕様の問題がスタック
 * トレースとして出るので、何をどう直せばよいかが読めない状態だった。供給元が写せるかの判定は
 * `save-renderable.ts` が、再送の読み直しが写せるかの判定は `save-readback.ts` の
 * `readbackPlans` が持ち、生成器(code-usecase-rpc.ts)も**同じ関数**を呼ぶので、検査と生成が
 * 食い違わない。
 */

import type { Finding } from '../../kernel/finding.js';
import { inputValue } from '../../kernel/input-state.js';
import type { UsecaseInput } from '../derive.js';
import type { PlanProblem, SavePlan } from '../step-plan.js';
import { planSave } from '../step-plan.js';
import type { ResolvedParam } from '../param-source.js';
import { resolveSaveParams } from '../param-source.js';
import { narrowCompositeParams } from '../save-renderable.js';
import { readbackPlans } from '../save-readback.js';
import { resendDigestStoreProblem } from '../resend-policy.js';
import type { DataTableSpec } from '../../model/data/types.js';
import { usecaseFinding, type UsecaseContext, type UsecaseVerifier } from '../verifier.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'Y12';

/** Y12 の実装。 */
export const saveRenderableVerifier: UsecaseVerifier = {
  id: VERIFIER_ID,
  title: '保存点が複合 RPC に写せる(供給元と再送の読み直し)',

  verify(input: UsecaseInput, ctx: UsecaseContext): Finding[] {
    // data_table が使えない(未選択・阻害)環境では何も見ない(見ていないことは実行ログが言う)。
    const dataTables = inputValue(ctx.dataTables);
    if (dataTables === undefined) return [];
    if (ctx.actions.state === 'blocked') return []; // action_spec が分からない(実行計画が入力欄を引く。行は呼び手が言う)
    const findings: Finding[] = [];
    for (const usecase of input.usecases.usecases) {
      for (const save of usecase.saves) {
        const planned = planSave(usecase, save, {
          domain: input.domain,
          actions: input.actions,
          dataTables,
        });
        // 接地・解決の失敗そのものは Y8 が反例つきで報告するので、ここでは二重に言わない。
        if (!planned.ok) continue;
        const resolved = resolveSaveParams(planned.plan, input.domain);
        if (!resolved.ok) continue;
        const narrowed = narrowCompositeParams(planned.plan, resolved.steps);
        const problems = narrowed.ok ? readbackProblemsOf(planned.plan, resolved.steps, dataTables.tables) : narrowed.problems;
        findings.push(...problems.map((problem) => toFinding(problem, usecase.location.file, save.id)));
      }
    }
    return findings;
  },
};

/** 再送で読み直せない手順・再送の入力の要約の置き場が無いことの問題(字面にするのは生成器だけ)。 */
function readbackProblemsOf(plan: SavePlan, steps: readonly (readonly ResolvedParam[])[], tables: readonly DataTableSpec[]): readonly PlanProblem[] {
  const readback = readbackPlans(plan, steps);
  if (!readback.ok) return readback.problems;
  const store = resendDigestStoreProblem(readback.resend, tables);
  return store === null ? [] : [store];
}

/** 写せない理由を Finding(3 点セット + 反例)に写す。 */
function toFinding(problem: PlanProblem, file: string, saveId: string): Finding {
  return usecaseFinding(VERIFIER_ID, {
    message: problem.message,
    location: { file, pointer: `saves.${saveId}` },
    suggestion: problem.suggestion,
    counterexample: problem.counterexample,
  });
}
