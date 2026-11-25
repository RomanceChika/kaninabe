/**
 * ドメイン仕様検証(V 群)の配線(lib/compose/verify-pipeline.ts が呼ぶ)。
 *
 * 責務は他の run* ヘルパーと同じ「検証器を回して実行状況を 1 行報告する」だけである。
 *
 * **なぜ V 群にも進捗行が要るのか。** `app/` を読めない環境では V10 の
 * `kind: application` の 2 つの下位検査(ref の実在・呼び出し口の実在)が黙って飛ぶ。
 * A/Q/T/J/K/H/Z/X/S/G の 10 群は「実装の木が無いため … はスキップ」と明示するのに、
 * **V 群だけは 1 行も出さなかった**(検査の漏れ探し 2026-09-12 §3 の実測)。
 * 飛んだことが実行ログに出ないスキップは、緑を実際より広く見せる。
 */

import type { SpecModel } from '../model/types.js';
import { ALL_VERIFIERS } from './verifiers/index.js';
import type { Finding } from '../kernel/finding.js';
import type { VerifyContext } from '../check-api/contract.js';
import type { ProgressLog } from './group-contract.js';
import { verifierRange } from './verifier-range.js';
import { logDomainInputGaps } from './domain-input-notes.js';
import { withZ3Satisfiability } from './z3-satisfiability.js';
import { withZ3Reachability } from './z3-reachability.js';

/** `enforced_by` の `kind: application` の宣言数(スキップした件数を報告するために数える)。 */
function countApplicationEnforcements(model: SpecModel): number {
  let count = 0;
  for (const [, specs] of model.aggregates) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      count += invariant.enforcedBy.filter((enforcement) => enforcement.kind === 'application').length;
    }
  }
  return count;
}

/**
 * ドメイン仕様の検証(V 群)を実行し、実行状況を一行で残す。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @param ctx 共有サービスと、読み込み済みの他仕様種
 * @param log 実行状況の報告先
 * @returns 全 Finding
 */
function runDomain(model: SpecModel, ctx: VerifyContext, log: ProgressLog): Finding[] {
  const findings: Finding[] = [];
  for (const verifier of ALL_VERIFIERS) findings.push(...verifier.verify(model, ctx));

  const scope = verifierRange(ALL_VERIFIERS.map((verifier) => verifier.id));
  const skipped =
    ctx.applicationRefs === undefined
      ? `(実装の木が無いため V10 の kind: application の突合 ${countApplicationEnforcements(model)} 件はスキップ)`
      : '';
  log(`V 群(ドメイン仕様): 集約 ${model.aggregates.size} 件に対し ${scope}${skipped} を実行しました。`);
  // 他の種類(action_spec / data_table)が使えなかったために見ていない判定(V16〜V19)を、検査ごとに 1 行ずつ。
  logDomainInputGaps(ctx, log);
  return findings;
}

/**
 * 充足性の判定を **Z3 に差し替えてから** V 群を実行する。
 *
 * **検証の流れで非同期なのはここだけ**である。判定器は既製品(Z3。WASM なので API が async)で
 * あり、検証器そのものは同期の純粋関数のままである —— そのため「問いを先に集めて解き、答えの表を
 * 引くだけの GuardServices を渡す」という 2 段になる(z3-satisfiability.ts)。
 *
 * **V 群より後の群にはこの差し替えを渡さない。** 後続が使うのは `canCoexist`(同期)であり、
 * そこは自作の列挙器のまま = 先読みである(規約: scripts-code-quality.md)。
 *
 * 差し替えは 2 つある —— 式 1 本の充足性(V9 / V10。`z3-satisfiability.ts`)と、遷移を時間軸に
 * 展開した有界到達性(V21。`z3-reachability.ts`)である。どちらも「先読みで問いを集め、Z3 に
 * 解かせ、表を引くだけの GuardServices を渡す」という同じ 2 段で、判定器は 1 つの Z3 を共有する。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @param ctx 共有サービスと、読み込み済みの他仕様種(充足性判定は差し替える前のもの)
 * @param log 実行状況の報告先
 * @returns 全 Finding
 */
export async function runDomainWithZ3(
  model: SpecModel,
  ctx: VerifyContext,
  log: ProgressLog,
): Promise<Finding[]> {
  const solved = await withZ3Satisfiability(model, ctx);
  const reached = await withZ3Reachability(model, solved.ctx);
  const findings = runDomain(model, reached.ctx, log);
  log(`  充足性の判定: Z3 が式 ${solved.solved} 件を解きました(自作の列挙器は先読み)。`);
  const seconds = (reached.stats.elapsedMs / 1000).toFixed(1);
  log(
    `  到達性の判定: Z3 が問い ${reached.stats.solved} 件を解きました` +
      `(関与する機械の組 ${reached.stats.worlds} 組・最大 ${reached.stats.maxBound} 手・所要 ${seconds} 秒)。`,
  );
  return findings;
}
