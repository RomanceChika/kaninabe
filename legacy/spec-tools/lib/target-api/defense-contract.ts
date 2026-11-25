/**
 * 後段の登録の契約のうち、**ブラウザ側の守りの宣言の持ち主と床**の検査(`selectTargetSet` が呼ぶ)。
 *
 * 宣言(`browserDefense`)を持てるのはアプリの枠の後段(`role: app_frame`)だけで、その後段は**必ず**持つ(持たない枠を選ぶと、
 * 全応答のヘッダも文書の CSP も黙って消える)。値が床を下回れば理由を名指す(`browserDefenseProblems`)。
 * 契約の本体(`contract.ts`)とは読む材料が違う(宣言の床の表を読む)ので、ファイルを分けてある。
 */

import { browserDefenseProblems } from '../model/product/browser-defense.js';
import type { BrowserDefenseProfile } from '../model/product/browser-defense.js';
import type { TargetRole } from '../kernel/target-role.js';

export type { BrowserDefenseProfile };

/** 検査が読む後段の欄(契約の `Target` の一部)。 */
export interface DefenseHolder {
  readonly id: string;
  readonly role: TargetRole;
  readonly browserDefense?: BrowserDefenseProfile;
}

/**
 * ブラウザ側の守りの宣言の持ち主と床の違反。
 *
 * @param targets 選んだ後段
 * @returns 違反(空なら満たす)
 */
export function defenseProblems(targets: readonly DefenseHolder[]): string[] {
  const problems: string[] = [];
  for (const target of targets) {
    if (target.role !== 'app_frame') {
      if (target.browserDefense !== undefined) {
        problems.push(`後段 ${target.id} は役割が ${target.role} なのに、ブラウザ側の守りの宣言を持っています(持てるのは app_frame の後段だけ)`);
      }
      continue;
    }
    if (target.browserDefense === undefined) problems.push(`後段 ${target.id} は role: app_frame なのに、ブラウザ側の守りの宣言(browserDefense)がありません`);
    else problems.push(...browserDefenseProblems(target.browserDefense).map((problem) => `後段 ${target.id} のブラウザ側の守り: ${problem}`));
  }
  return problems;
}
