/**
 * T10 **`context(X)` を与えるロールは X も読めなければならない**(中継表の RLS は重なる)。
 *
 * `scope: context(X)` のポリシーの `USING` 句は `EXISTS (select 1 from X …)` になり、その
 * 副問い合わせは**実行者の権限で**走る —— X 自身の RLS がその実行者に X の行を見せないなら、
 * EXISTS は偽になり、対象の行も 1 つも返らない(2026-09-12 に実測。ARCH-SP-BE-0001
 * §中継表の RLS は重なる)。
 *
 * この形は**宣言としては書けてしまう**。ポリシーの本文は出るし、名前の突合も本文の突合も通る ——
 * 気づけるのは挙動テストだけで、しかもそこで分かるのは「返る行が宣言と違う」までであって、
 * 原因(中継表が読めない)を報告してはくれない。だから宣言の段で言う。
 *
 * 見るのは「そのロール(と `implies` で必ず持つロール)が X を `none` でない `scope` で読めるか」
 * だけである。読める根拠が `own` / `context` なら「その行を読める場合に限り」通るので、ここでは
 * 行ごとの成否までは追わない —— 追おうとすると束縛の解決をもう 1 度書くことになる。
 * したがって severity は **warning**(「必ず 0 行になる」と言い切れるのは `none` のときだけ)。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { impliedRoles } from '../../model/role-hierarchy.js';
import { findAccessSpec } from '../../semantics/domain-lookup.js';
import type { DataTableSpecModel } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T10';

/**
 * `context(X)` の読み取りを与えるロールが、中継する X も読めるかを見る。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param dataTables 読み込み済みの data_table(RLS を生成している表だけが対象)
 * @returns 違反のリスト(warning)
 */
export function verifyContextReadable(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  if (!dataTables.available) return [];
  const findings: Finding[] = [];
  for (const table of dataTables.tables) {
    const access = table.entity === undefined ? null : findAccessSpec(domain, table.entity);
    if (access === null || table.policiesMigration === undefined) continue;
    for (const rule of access.reads) {
      if (rule.scope.kind !== 'context') continue;
      const relay = findAccessSpec(domain, rule.scope.entity);
      if (relay === null || readable(relay, rule.by, domain)) continue;
      findings.push({
        verifier: VERIFIER_ID,
        severity: 'warning',
        message: `${table.table} は ${rule.by} に scope: context(${rule.scope.entity}) を与えていますが、${rule.by} は ${rule.scope.entity} を読めません(EXISTS の中も実行者の RLS で評価されるので 1 行も返りません)`,
        location: access.location,
        suggestion:
          `${rule.scope.entity} の access_spec に ${rule.by}(または ${rule.by} が implies で必ず持つロール)の` +
          `読み取りを宣言するか、この表の ${rule.by} の scope を context(${rule.scope.entity}) 以外にする`,
        counterexample: { table: table.table, by: rule.by, relay: rule.scope.entity },
      });
    }
  }
  return findings;
}

/** そのロール(と `implies` で必ず持つロール)が中継表を `none` でない scope で読めるか。 */
function readable(relay: ReturnType<typeof findAccessSpec>, by: string, domain: SpecModel): boolean {
  const held = new Set<string>([by, ...impliedRoles(domain.roles.roles, by)]);
  return (relay?.reads ?? []).some((rule) => held.has(rule.by) && rule.scope.kind !== 'none');
}
