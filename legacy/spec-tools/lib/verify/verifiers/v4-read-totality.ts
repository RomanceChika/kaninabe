/**
 * V4 全域性(読み取り)。
 *
 * access_spec の `reads` は全ロールについて明示必須(domain-spec-writing.md
 * §access_spec)。`scope: none` を書かない限りエラーにすることで、
 * 「書き忘れて公開」を構造的に起こさない(PRIN-0009)。
 *
 * roles.md に定義された全ロール × 各 access_spec の直積を回し、
 * reads に現れないロールを 1 件ずつ報告する。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';

/**
 * 読み取り権限の全域性を検査する検証器。
 * access_spec が存在する集約のみを対象とする(access.md 自体の欠落は V1 の担当)。
 */
export const readTotalityVerifier: Verifier = {
  id: 'V4',
  title: '全域性(読み取り) — 全ロールの reads が明示されている',

  verify(model: SpecModel, _ctx: VerifyContext): Finding[] {
    const findings: Finding[] = [];
    const roles = model.roles.roles;

    for (const aggregate of model.aggregates.values()) {
      const access = aggregate.access;
      if (access === undefined) continue;

      const declared = new Set(access.reads.map((r) => r.by));
      for (const role of roles) {
        if (declared.has(role.id)) continue;
        findings.push({
          verifier: 'V4',
          severity: 'error',
          message: `${access.entity}: ロール ${role.id} の読み取りスコープが未定義です`,
          location: access.location,
          suggestion: `access.md の reads に "- by: ${role.id}" を追加し、scope に own / context(...) / all / none のいずれかを明示してください。見せない場合も scope: none を書く必要があります。`,
          counterexample: { entity: access.entity, role: role.id },
        });
      }
    }

    return findings;
  },
};
