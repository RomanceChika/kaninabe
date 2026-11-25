/**
 * 仕組みの保証台帳(`framework/guarantees.md`)を読む I/O 境界。
 *
 * 製品の台帳(`loader.ts`)との違いは **「無い」の意味** である。製品の台帳が無いのは「まだ開設していない」正常な状態
 * (`available: false` で、Z 群はその分を飛ばす)だが、仕組みの台帳は**製品が外せない義務**なので、根を渡したのに
 * 無い・読めない・壊れている・読めずに落とした行があるときは **阻害(blocked)** と言う —— 空の台帳や空の走査で緑にならない。
 * 根を渡さなかったとき(単体テスト用。CLI は必ず渡す)は `not_requested` で、Z3 が未実施と名指しする。
 */

import path from 'node:path';
import type { Finding } from '../../kernel/finding.js';
import { FRAMEWORK_GUARANTEES_FILE } from '../../io/framework-paths.js';
import { loadGuaranteeSpecModel } from './loader.js';
import type { GuaranteeSpecModel } from './types.js';

/** 仕組みの台帳の読み込みの結果(未選択 / 阻害 / 読込済み)。 */
export type FrameworkLedgerLoad =
  | { readonly state: 'loaded'; readonly model: GuaranteeSpecModel; readonly findings: Finding[] }
  | { readonly state: 'blocked'; readonly reason: string; readonly findings: Finding[] }
  | { readonly state: 'not_requested' };

/**
 * 仕組みの保証台帳を読む。
 *
 * @param frameworkRoot 仕組みの根の絶対パス。省略は呼び手が根を渡さなかったことを表す(`not_requested`)
 * @returns 読込済み(モデルと Z0 の違反)/ 阻害(理由と Z0 の違反)/ 未選択
 */
export function loadFrameworkGuaranteeLedger(frameworkRoot: string | undefined): FrameworkLedgerLoad {
  if (frameworkRoot === undefined) return { state: 'not_requested' };
  const loaded = loadGuaranteeSpecModel(path.join(frameworkRoot, FRAMEWORK_GUARANTEES_FILE), {
    repoRoot: frameworkRoot,
    owner: 'framework',
  });
  if (!loaded.model.available) {
    return { state: 'blocked', reason: `${FRAMEWORK_GUARANTEES_FILE} がありません`, findings: loaded.findings };
  }
  if (loaded.model.catalog === null) {
    const first = loaded.findings[0]?.message;
    return {
      state: 'blocked',
      reason: `${FRAMEWORK_GUARANTEES_FILE} を読めません(ファイルを読めない、またはフロントマターが壊れています${first === undefined ? '' : `: ${first}`})`,
      findings: loaded.findings,
    };
  }
  if (loaded.dropped > 0) {
    return {
      state: 'blocked',
      reason: `${FRAMEWORK_GUARANTEES_FILE} の ${loaded.dropped} 件の行を読めずに落としました(台帳が欠けているので突合しません)`,
      findings: loaded.findings,
    };
  }
  return { state: 'loaded', model: loaded.model, findings: loaded.findings };
}
