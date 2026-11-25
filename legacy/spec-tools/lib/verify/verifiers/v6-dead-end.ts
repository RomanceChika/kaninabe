/**
 * V6 デッドエンド。
 *
 * final でない状態には必ず出ていく遷移があることを検査する
 * (domain-spec-writing.md V1〜V12 表 V6 行)。出口の無い非 final 状態は
 * 「そこに入ったら二度と動けないが終わりでもない」状態であり、
 * final の書き忘れかイベントの書き忘れのどちらかを意味する。
 */

import { allMachines, type SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';

/**
 * デッドエンド状態を検出する検証器。
 * 自己ループ(from と to が同じイベント)も出ていく遷移として数える。
 */
export const deadEndVerifier: Verifier = {
  id: 'V6',
  title: 'デッドエンド — final 以外の状態に出ていく遷移がある',

  verify(model: SpecModel, _ctx: VerifyContext): Finding[] {
    const findings: Finding[] = [];

    for (const { machine } of allMachines(model)) {
      const finals = new Set(machine.final);
      const hasExit = new Set<string>();
      for (const event of machine.events) {
        for (const from of event.from) hasExit.add(from);
      }

      for (const state of machine.states) {
        if (finals.has(state) || hasExit.has(state)) continue;
        findings.push({
          verifier: 'V6',
          severity: 'error',
          message: `${machine.machine}: 状態 ${state} から出る遷移がありません(final でもない)`,
          location: machine.location,
          suggestion: `${state} を from に含むイベントを追加するか、終端状態であれば final に ${state} を加えてください。`,
          counterexample: { machine: machine.machine, state },
        });
      }
    }

    return findings;
  },
};
