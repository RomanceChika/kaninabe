/**
 * 保証台帳の検査(Z 群)の登録 — どの検査を、どの順で実行するか。
 *
 * 実行口(`run.ts`)はここの `GUARANTEE_STEPS` を上から回すだけである。並びは**違反の並び**を決める。
 * ID は各検証器のファイルが持つ `VERIFIER_ID` を参照する。全検査の表は `GUARANTEE_CHECKS` を読む。
 */

import type { Finding } from '../kernel/finding.js';
import type { CheckEntry } from '../kernel/check-entry.js';
import { Z0_VERIFIER_ID } from '../model/guarantee/loader.js';
import type { FrameworkLedgerLoad } from '../model/guarantee/framework-loader.js';
import type { GuaranteeRunInput } from './run.js';
import { VERIFIER_ID as Z1, verifyGuaranteeTestTrace } from './verifiers/z1-test-trace.js';
import { VERIFIER_ID as Z2, verifyPlannedGuarantees } from './verifiers/z2-planned.js';
import { VERIFIER_ID as Z3, verifyFrameworkGuarantees } from './verifiers/z3-framework-scan.js';

/** 呼び手が仕組みの台帳を渡さなかったとき(単体テスト用。CLI は必ず渡す)。 */
const NOT_REQUESTED: FrameworkLedgerLoad = { state: 'not_requested' };

/** 実行の段 1 つ(検査 1 本)。 */
export interface GuaranteeStep extends CheckEntry {
  /** 検査を実行し、違反を返す。 */
  run(input: GuaranteeRunInput): Finding[];
}

/** 実行の順(違反の並びを決める)。 */
export const GUARANTEE_STEPS: readonly GuaranteeStep[] = [
  { id: Z1, title: 'テスト突合(保証台帳 ⇔ テスト)', run: (i) => verifyGuaranteeTestTrace(i.domain, i.registry, i.tests) },
  {
    id: Z2,
    title: '未執行の警告(status: planned の保証を毎回言い立てる。製品の台帳と仕組みの台帳の両方)',
    run: (i) => [
      ...verifyPlannedGuarantees(i.guarantee),
      ...(i.frameworkLedger?.state === 'loaded' ? verifyPlannedGuarantees(i.frameworkLedger.model) : []),
    ],
  },
  {
    id: Z3,
    title: '仕組みの走査 ⇔ 仕組みの台帳(製品の採る種類・台帳・実装の木に依らず、仕組み自身の見張りテストを突き合わせる)',
    run: (i) => verifyFrameworkGuarantees(i.registry, i.tests, i.frameworkLedger ?? NOT_REQUESTED),
  },
];

/** Z 群の全検査(ローダーの Z0 を含む。全検査の表が読む)。 */
export const GUARANTEE_CHECKS: readonly CheckEntry[] = [
  { id: Z0_VERIFIER_ID, title: 'guarantee_spec のスキーマ適合(ローダーが実施)' },
  ...GUARANTEE_STEPS,
];
