/**
 * 保証台帳の名前空間の予約(台帳が 2 本になったとき、ID を**全体で一意**に保つための線引き)。
 *
 * 保証台帳は 2 本ある —— 製品のもの(`specs/backend/guarantees.md`)と、仕組みが自分自身について持つもの(`framework/guarantees.md`)。
 * 保証 ID・テストケース ID・文書 ID を「持ち主つきのキー」にすると、それらを引く全ての消費者(台帳の索引・ハンドブックの表・
 * 変異の目録・見張りテストの突合)が `(持ち主, ID)` の組に変わる。そこで**綴りを予約して、ID だけで全体に一意**にする:
 *
 * - 仕組みの台帳: 保証 ID は `fw_` 始まり・テストケース ID は `TC-FW-` 始まり・文書 ID は `framework-guarantee-catalog`
 * - 製品の台帳: それらを**使えない**(Z0 の error)
 *
 * 台帳をまたぐ ID の衝突は、この予約があれば綴りの違反として Z0 に現れる(Map が後勝ちで黙って上書きする箇所を構造的に作らない)。
 */

import type { ActionTestCase } from '../../testcase/types.js';
import type { LedgerOwner } from '../../kernel/ledger-owner.js';
import type { SpecReporter } from '../parse-common.js';
import type { GuaranteeDecl } from './types.js';

/** 製品の保証台帳の文書 ID(1 プロジェクト 1 カタログ)。 */
export const GUARANTEE_CATALOG_ID = 'guarantee-catalog';

/** 仕組みの保証台帳の文書 ID。 */
export const FRAMEWORK_GUARANTEE_CATALOG_ID = 'framework-guarantee-catalog';

/** 仕組みの台帳の保証 ID の接頭辞。 */
export const FRAMEWORK_GUARANTEE_ID_PREFIX = 'fw_';

/** 仕組みの台帳のテストケース ID の接頭辞。 */
export const FRAMEWORK_TC_ID_PREFIX = 'TC-FW-';

/**
 * 台帳の持ち主が宣言できる文書 ID。
 *
 * @param owner 台帳の持ち主
 * @returns 文書 ID
 */
export function catalogIdOf(owner: LedgerOwner): string {
  return owner === 'framework' ? FRAMEWORK_GUARANTEE_CATALOG_ID : GUARANTEE_CATALOG_ID;
}

/**
 * 保証 ID・テストケース ID が持ち主の名前空間に収まっているかを見る。
 *
 * 仕組みの台帳では予約の綴りを**必ず**使い、製品の台帳では**使わない**。
 *
 * @param owner 台帳の持ち主
 * @param guarantees 読み終えた保証の全数
 * @param testCases 読み終えたテストケースの全数
 * @param reporter 違反の記録先
 */
export function checkNamespace(
  owner: LedgerOwner,
  guarantees: readonly GuaranteeDecl[],
  testCases: readonly ActionTestCase[],
  reporter: SpecReporter,
): void {
  for (const decl of guarantees) {
    const reserved = decl.id.startsWith(FRAMEWORK_GUARANTEE_ID_PREFIX);
    if (owner === 'framework' && !reserved) {
      reporter.error(
        `guarantees.${decl.id}`,
        `仕組みの台帳の保証 ${decl.id} が ${FRAMEWORK_GUARANTEE_ID_PREFIX} 始まりではありません`,
        `仕組みの台帳の保証 ID は ${FRAMEWORK_GUARANTEE_ID_PREFIX} 始まりに直す(製品の台帳と ID が衝突しないための予約)`,
        { guarantee: decl.id, owner },
      );
    } else if (owner === 'product' && reserved) {
      reporter.error(
        `guarantees.${decl.id}`,
        `製品の台帳の保証 ${decl.id} が仕組みの予約(${FRAMEWORK_GUARANTEE_ID_PREFIX} 始まり)の綴りです`,
        `${FRAMEWORK_GUARANTEE_ID_PREFIX} 始まりは仕組みの台帳(framework/guarantees.md)の保証 ID の予約。別の綴りに直す`,
        { guarantee: decl.id, owner },
      );
    }
  }
  for (const testCase of testCases) {
    const reserved = testCase.id.startsWith(FRAMEWORK_TC_ID_PREFIX);
    if (owner === 'framework' && !reserved) {
      reporter.error(
        `test_cases.${testCase.id}`,
        `仕組みの台帳のテストケース ${testCase.id} が ${FRAMEWORK_TC_ID_PREFIX} 始まりではありません`,
        `仕組みの台帳のテストケース ID は ${FRAMEWORK_TC_ID_PREFIX} 始まりに直す(製品の台帳と ID が衝突しないための予約)`,
        { test_case: testCase.id, owner },
      );
    } else if (owner === 'product' && reserved) {
      reporter.error(
        `test_cases.${testCase.id}`,
        `製品の台帳のテストケース ${testCase.id} が仕組みの予約(${FRAMEWORK_TC_ID_PREFIX} 始まり)の綴りです`,
        `${FRAMEWORK_TC_ID_PREFIX} 始まりは仕組みの台帳(framework/guarantees.md)のテストケース ID の予約。別の綴りに直す`,
        { test_case: testCase.id, owner },
      );
    }
  }
}
