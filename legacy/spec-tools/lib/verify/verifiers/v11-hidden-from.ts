/**
 * V11 のうち、**隠し列の相手(`access_spec` の `fields_hidden[].from`)の接地**を見る部分。
 *
 * 外から届く surface のビューは、`from` に並んだロールの読み取り規則(`reads`)を**マスクの述語から外す**
 * ことで列を隠す(`lib/sql/api-views.ts` の `visiblePlans`)。外す相手は `reads[].by` との**字面の一致**で
 * 決まるので、綴りを違えたロール(`from: [anonymus]`)はどの規則も外さず、**隠したつもりの相手に素の列が出る**。
 *
 * 見るのは 3 つ。
 *
 * | 何 | なぜ |
 * |---|---|
 * | roles.md に実在する | 未定義のロールは誰からも隠さない(他の口と同じ `undefinedRoleFinding`。呼び出しは `v11-role-grounding.ts` の使用の列挙) |
 * | その access_spec の `reads` に現れる | 外す相手は `reads[].by` との一致で決まる。reads に無いロールは外す規則を持たず、隠す宣言が何もしない(全域性の V4 が別に止めるが、隠し列の宣言の側からも名指す) |
 * | 内部実行のロール(`kind: system`)でない | 内部実行は RLS を迂回し、マスクの述語の外で無条件に解ける(`api-views.ts` の `readPlans` が落とす)。隠せない相手を「隠した」と宣言させない |
 *
 * `scope: none` のロールは受け入れる —— 今は行ごと見えないので何もしないが、後で読み取りを開いた日に
 * 宣言がそのまま効く(先回りの宣言であり、空手形ではない)。
 */

import type { AccessSpec, RoleDef } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { systemRoleId } from '../../model/role-hierarchy.js';

/**
 * `fields_hidden[].from` のロールが、その access_spec の reads に現れ、内部実行のロールでないことを見る。
 *
 * 未定義のロールはここでは黙る(使用の列挙が `undefinedRoleFinding` で報告する)。
 *
 * @param access その集約のアクセス宣言
 * @param roles role_spec の全ロール(id → 定義)
 * @returns 違反のリスト
 */
export function checkHiddenFrom(access: AccessSpec, roles: ReadonlyMap<string, RoleDef>): Finding[] {
  const readers = new Set(access.reads.map((rule) => rule.by));
  const system = systemRoleId([...roles.values()]);
  const findings: Finding[] = [];
  for (const rule of access.fieldsHidden) {
    for (const roleId of rule.from) {
      if (!roles.has(roleId)) continue;
      if (roleId === system) {
        findings.push(systemFinding(access, rule.field, roleId, rule.location));
        continue;
      }
      if (!readers.has(roleId)) findings.push(notReaderFinding(access, rule.field, roleId, rule.location));
    }
  }
  return findings;
}

/** 内部実行のロールから隠すと宣言した(隠せない)。 */
function systemFinding(access: AccessSpec, field: string, roleId: string, location: AccessSpec['location']): Finding {
  return {
    verifier: 'V11',
    severity: 'error',
    message: `${access.entity} の fields_hidden(${field})の from にある ${roleId} は内部実行のロール(kind: system)で、列を隠せません`,
    location,
    suggestion:
      `from から ${roleId} を外してください。内部実行は RLS を迂回するので、surface のマスクの述語の外で無条件に列を読みます` +
      '(隠せない相手を「隠した」と宣言すると、読み手が守られていると誤って読みます)',
    counterexample: { entity: access.entity, field, role: roleId },
  };
}

/** その access_spec の reads に現れないロールから隠すと宣言した(外す規則が無い)。 */
function notReaderFinding(access: AccessSpec, field: string, roleId: string, location: AccessSpec['location']): Finding {
  return {
    verifier: 'V11',
    severity: 'error',
    message: `${access.entity} の fields_hidden(${field})の from にある ${roleId} は、この access_spec の reads に現れません`,
    location,
    suggestion:
      `reads に "- by: ${roleId}" の規則を書くか、from を reads に現れるロールに直してください。` +
      '列を隠すのは「from のロールの読み取り規則をマスクの述語から外す」ことなので、reads に無いロールの宣言は何も隠しません。',
    counterexample: { entity: access.entity, field, role: roleId },
  };
}
