/**
 * V11 の `claim` の側(実行者自身の行の欄が根拠のロールの接地)。
 *
 * `v11-role-grounding.ts` から読まれる葉である。指す欄が実在し、`session: true` で、型と書き方が
 * 合っていることを見る(ADR-0018)。
 */

import type { SpecModel, RoleDef } from '../../model/types.js';
import { findField } from '../../semantics/domain-index.js';
import type { Finding } from '../../kernel/finding.js';
import { claimPartsOf, claimText, rowConditionOf } from '../../model/role-claim.js';
import { rowConditionRoles } from '../../model/role-hierarchy.js';
import { collectMachineStates, finiteValuesOfField } from '../../model/field-values.js';

/**
 * `claim`(実行者自身の行の欄が根拠のロール)の接地を見る。
 *
 * 指す欄が実在し、`session: true` を宣言し、型と書き方が合っていること。どれが欠けても、
 * 実行器は「DB を読まずにこのロールを立てる」ことができない。
 *
 * - boolean の欄は `claim: {entity}.{field}`(値は書かない)
 * - state / enum の欄は値を添える(`== {値}` / `in [{値}, ...]`)。値は欄の値域になければならない
 *   —— 綴りが違うと**誰にも立たないロール**になり、黙って全員を締め出す
 */
export function checkClaim(model: SpecModel, role: RoleDef): Finding[] {
  const parts = claimPartsOf(role);
  if (parts === null) return [];
  const claim = claimText(role);
  const field = findField(model, parts.entity, parts.field);
  if (field === null) return [claimFinding(role, claim, `${parts.entity} に ${parts.field} という欄がありません`)];
  if (!field.session) {
    return [claimFinding(role, claim, `${role.claim ?? ''} は session: true を宣言していません`)];
  }
  const type = field.type;
  if (type.kind === 'boolean') {
    return parts.values === null
      ? []
      : [claimFinding(role, claim, `${role.claim ?? ''} は boolean の欄なので値は書けません(claim: ${role.claim ?? ''} とだけ書く)`)];
  }
  if (type.kind !== 'state' && type.kind !== 'enum') {
    return [claimFinding(role, claim, `${role.claim ?? ''} の型は ${type.kind} であって boolean / enum / state ではありません`)];
  }
  if (parts.values === null) {
    return [
      claimFinding(
        role,
        claim,
        `${role.claim ?? ''} は ${type.kind} の欄なので、立つ値を添えます(${role.claim ?? ''} == {値} / ${role.claim ?? ''} in [{値}, ...])`,
      ),
    ];
  }
  const allowed = finiteValuesOfField(type, collectMachineStates(model));
  if (allowed === null) {
    return [claimFinding(role, claim, `${role.claim ?? ''} の状態機械が定義されていません`)];
  }
  const unknown = parts.values.filter((value) => !allowed.includes(value));
  if (unknown.length > 0) {
    return [
      claimFinding(
        role,
        claim,
        `${unknown.join(' / ')} は ${role.claim ?? ''} の値域(${allowed.join(' / ')})にありません`,
      ),
    ];
  }
  // 値の集合が値域を覆い尽くす条件は常に真で、何も絞らない。条件を満たさない実行者(負例)を world に
  // 立てられないので、挙動テストは空振りする —— 黙って空にせず、書き方の誤りとして指摘する。
  const values = parts.values;
  if (allowed.every((value) => values.includes(value))) {
    return [
      claimFinding(
        role,
        claim,
        `値の集合が ${role.claim ?? ''} の値域(${allowed.join(' / ')})を全部含むので、条件が常に真です` +
          '(何も絞らず、条件を満たさない実行者を world に立てられません)',
      ),
    ];
  }
  return [];
}

/**
 * 自分の `claim` と含意の先の `claim` が**同じ欄で矛盾していないか**(値の集合の共通部分が空)。
 *
 * ロール R は「自分の根拠 AND 含意の先の行の条件」(E2)で立つので、同じ欄に共通部分の無い条件が重なると
 * **誰にも立たないロール**になる。world はどちらかの値を黙って選ぶしかなくなるので、宣言の矛盾として落とす。
 *
 * @param roles 全ロール定義
 * @param role 検査するロール
 * @returns 矛盾する欄ごとの指摘
 */
export function checkClaimConflict(roles: readonly RoleDef[], role: RoleDef): Finding[] {
  const own = rowConditionOf(role);
  const implied = rowConditionRoles(roles, role.id);
  const gated = implied.flatMap((gate) => {
    const condition = rowConditionOf(gate);
    return condition === null ? [] : [{ id: gate.id, condition }];
  });
  const sources = [...(own === null ? [] : [{ id: role.id, condition: own }]), ...gated];
  const findings: Finding[] = [];
  sources.forEach((left, index) => {
    for (const right of sources.slice(index + 1)) {
      const a = left.condition;
      const b = right.condition;
      if (a.field !== b.field || a.values === undefined || b.values === undefined) continue;
      if (a.values.some((value) => b.values?.includes(value) === true)) continue;
      findings.push(
        claimFinding(
          role,
          claimText(role),
          `${left.id} の条件(${a.values.join(' / ')})と ${right.id} の条件(${b.values.join(' / ')})が欄 ${a.field} で` +
            '矛盾しています(共通の値が無いので、このロールは誰にも立ちません)',
        ),
      );
    }
  });
  return findings;
}

/** `claim` の接地不足の Finding。 */
function claimFinding(role: RoleDef, claim: string, reason: string): Finding {
  return {
    verifier: 'V11',
    severity: 'error',
    message: `ロール ${role.id} の claim を解決できません(${reason})`,
    location: role.location,
    suggestion:
      'claim が指せるのは「実行者に対応する集約(session: true を持つ集約)の boolean / enum / state の欄」で、' +
      'その欄自身も session: true を宣言していなければならない(enum / state は立つ値を添える)。' +
      '欄を entity_spec に足して session: true を付けるか、そのロールの根拠を binding(対象の行との突合)に変える',
    counterexample: { role: role.id, claim, reason },
  };
}
