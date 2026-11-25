/**
 * V25 写しの集約は、状態機械の写像(システム)以外で書かれない。
 *
 * entity_spec の `mirror: true`(写し。V12 が snapshot.to と双方向で突き合わせる)は、その表への `delete` を
 * 破壊的な書き込みから外す(写しが消えても元は残る)。その免除が成り立つのは、写しの行が**写像の遷移だけで**
 * 作られ・消されるときである —— 人が作れる・消せる・書き換えられる行なら、それは写しではなく元のデータであり、
 * 消せば取り返しがつかない。
 *
 * そこで写しの集約の access_spec の `creates` / `writes` / `deletes` は、**システムのロール**
 * (role_spec の `kind: system`。写像の遷移を実行する主体)の規則だけを許す。ほかのロールの規則が 1 つでもあれば error。
 */

import type { Finding } from '../../kernel/finding.js';
import type { Verifier } from '../../check-api/contract.js';
import type { SourceLocation, SpecModel } from '../../model/types.js';
import { systemRoleId } from '../../model/role-hierarchy.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'V25';

/** 書き込みの規則の種類(access_spec のキー)。 */
const WRITE_KEYS = ['creates', 'writes', 'deletes'] as const;

/** V25 の検証器。 */
export const mirrorAccessVerifier: Verifier = {
  id: VERIFIER_ID,
  title: '写しの集約は写像(システム)以外で書かれない — creates / writes / deletes は system の規則だけ',

  verify(model: SpecModel): Finding[] {
    const system = systemRoleId(model.roles.roles);
    const findings: Finding[] = [];
    for (const specs of model.aggregates.values()) {
      const entity = specs.entity;
      if (entity?.mirror !== true) continue;
      const access = specs.access;
      if (access === undefined) continue;
      for (const key of WRITE_KEYS) {
        const rules: readonly { readonly by: string; readonly location: SourceLocation }[] = access[key];
        for (const rule of rules) {
          if (system !== undefined && rule.by === system) continue;
          findings.push({
            verifier: VERIFIER_ID,
            severity: 'error',
            message:
              system === undefined
                ? `${entity.entity} は写し(mirror: true)ですが、role_spec にシステムのロール(kind: system)が無いので ${key} の規則 by: ${rule.by} を写像の書き込みと認められません`
                : `${entity.entity} は写し(mirror: true)なのに、${key} にシステム(${system})以外の規則 by: ${rule.by} があります`,
            location: rule.location,
            suggestion:
              `写しの行は写像の遷移(state_spec の effects[].snapshot)だけが作り・消す。人が ${key} できる行なら写しではないので、` +
              `entity_spec の mirror を外し(その削除は破壊的な書き込みに数えられる)、写しの遷移は別の集約に分ける`,
            counterexample: { entity: entity.entity, key, by: rule.by },
          });
        }
      }
    }
    return findings;
  },
};
