/**
 * V7 final 不変。
 *
 * final と宣言した状態から出ていく遷移が無いことを検査する
 * (domain-spec-writing.md V1〜V12 表 V7 行)。final は「そこで終わり」の
 * 宣言であり、from に現れるならその宣言が嘘になる。
 *
 * V6(デッドエンド)と対になるチェックで、両者を合わせて
 * 「final ⇔ 出口が無い」が全状態で成り立つことを保証する。
 */

import { allMachines, type SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';

/**
 * final 状態から出る遷移を検出する検証器。
 * (final 状態, それを from に含むイベント) の組ごとに 1 件の Finding を返す。
 */
export const finalImmutabilityVerifier: Verifier = {
  id: 'V7',
  title: 'final 不変 — final 状態から出る遷移がない',

  verify(model: SpecModel, _ctx: VerifyContext): Finding[] {
    const findings: Finding[] = [];

    for (const { machine } of allMachines(model)) {
      const finals = new Set(machine.final);
      for (const event of machine.events) {
        for (const from of event.from) {
          if (!finals.has(from)) continue;
          findings.push({
            verifier: 'V7',
            severity: 'error',
            message: `${machine.machine}: ${from} は final ですが ${event.id} の from に含まれています`,
            location: event.location,
            suggestion: `イベント ${event.id} の from から ${from} を外すか、${from} が終端でないなら final から外してください。final から再開する操作は新しいエンティティの生成として表現します。`,
            counterexample: { machine: machine.machine, state: from, event: event.id },
          });
        }
      }
    }

    return findings;
  },
};
