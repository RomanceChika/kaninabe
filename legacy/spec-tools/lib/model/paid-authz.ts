/**
 * 有料の口の認可の役(`authz.role`)の**立て方**を役の台帳から引く(R5-9 と X8 が同じ 1 本を読む)。
 *
 * 有料の口の役は、セッションに運ばれた実行者の行の条件(`claim`)で決まるグローバルロールに限る —— 本文の上限を読む前に・課金の前に、
 * 対象の行を引かずに「この実行者はこの役か」を言えなければ、口の最初の関門に置けないからである。同じ条件を枠を消費する RPC
 * (`meter`)の本文が DB の行から読み直す(口の関門を忘れても RPC が落とす二重の守り)ので、X8 が「RPC の本文が同じ述語を持つ」ことを見るために
 * ここが述語の材料(役自身と、含意の先で行の条件を持つ役の `claim`)を返す。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない**(役の ID・欄は仕様から引く)。
 */

import type { RoleDef } from './types.js';
import type { ClaimParts } from './role-claim.js';
import { claimPartsOf } from './role-claim.js';
import { anonymousRoleId, impliedRoles, rowConditionRoles, systemRoleId } from './role-hierarchy.js';

/** 役を引いた結果。`problems` が空でなければ有料の口の役にできない。 */
export interface PaidRolePlan {
  /** 本文が突き合わせる述語の材料(役自身の `claim` と、含意の先で行の条件を持つ役の `claim`。宣言順)。 */
  readonly conditions: readonly ClaimParts[];
  /** 有料の口の役にできない理由(無ければ空)。 */
  readonly problems: readonly string[];
}

/** 引けなかった結果。 */
function unusable(problem: string): PaidRolePlan {
  return { conditions: [], problems: [problem] };
}

/**
 * 有料の口の役を引く。
 *
 * @param roles 役の台帳の全ロール
 * @param id `authz.role` の役の ID
 * @returns 述語の材料と、役にできない理由
 */
export function paidRolePlan(roles: readonly RoleDef[], id: string): PaidRolePlan {
  const role = roles.find((candidate) => candidate.id === id);
  if (role === undefined) return unusable(`authz.role="${id}" は役の台帳に実在しません`);
  if (role.binding !== undefined) {
    return unusable(`authz.role="${id}" は対象の行に依って立つ文脈依存の役です(口の関門は対象を引く前に、実行者だけで役を言えなければなりません)`);
  }
  if (id === systemRoleId(roles)) return unusable(`authz.role="${id}" は内部実行の役です(ブラウザから叩かれる口の役にできません)`);
  const anonymous = anonymousRoleId(roles);
  if (anonymous !== undefined && (id === anonymous || impliedRoles(roles, anonymous).has(id))) {
    return unusable(`authz.role="${id}" は未ログインにも立つ役です(有料の口を誰にでも開くことになります)`);
  }
  const conditions = [role, ...rowConditionRoles(roles, id)].flatMap((candidate) => {
    const parts = claimPartsOf(candidate);
    return parts === null ? [] : [parts];
  });
  if (conditions.length === 0) {
    return unusable(`authz.role="${id}" は実行者の行の条件(claim)を持ちません(枠を消費する RPC の本文が同じ述語を持つことを突き合わせられません)`);
  }
  return { conditions, problems: [] };
}
