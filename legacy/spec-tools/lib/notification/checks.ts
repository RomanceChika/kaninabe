/**
 * 通知仕様の検査(N 群)の登録 — どの検査を、どの順で実行するか。
 *
 * 実行口(`run.ts`)はここの `NOTIFICATION_STEPS` を上から回すだけである。並びは**違反の並び**を決める。
 * ID は各検証器のファイルが持つ `VERIFIER_ID` を参照する。全検査の表は `NOTIFICATION_CHECKS` を読む。
 */

import type { Finding } from '../kernel/finding.js';
import type { CheckEntry } from '../kernel/check-entry.js';
import { N0_VERIFIER_ID } from '../model/notification/loader.js';
import type { NotificationRunInput } from './run.js';
import { VERIFIER_ID as N1, verifyEffectParity } from './verifiers/n1-effect-parity.js';
import { VERIFIER_ID as N2, verifyPersonMention } from './verifiers/n2-person-mention.js';

/** 実行の段 1 つ(検査 1 本)。 */
export interface NotificationStep extends CheckEntry {
  /** 検査を実行し、違反を返す。 */
  run(input: NotificationRunInput): Finding[];
}

/** 実行の順(違反の並びを決める)。 */
export const NOTIFICATION_STEPS: readonly NotificationStep[] = [
  { id: N1, title: '通知カタログ ⇔ 発火元(effects・走査の emits)の閉世界', run: (i) => verifyEffectParity(i.domain, i.notifications, i.jobs, i.roots) },
  { id: N2, title: '本人を名指すメンション(person_from)の接地', run: (i) => verifyPersonMention(i.domain, i.notifications, i.jobs) },
];

/** N 群の全検査(ローダーの N0 を含む。全検査の表が読む)。 */
export const NOTIFICATION_CHECKS: readonly CheckEntry[] = [
  { id: N0_VERIFIER_ID, title: '通知カタログのスキーマ適合(ローダーが実施)' },
  ...NOTIFICATION_STEPS,
];
