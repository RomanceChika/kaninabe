/**
 * V3 全域性(遷移)。
 *
 * 「書いていないから起こらない」を許さないための中核チェック。
 * 各状態機械の 全状態 × 全イベント のマスが、次の 3 つのいずれかに
 * 必ず分類されることを検査する(domain-spec-writing.md §state_spec)。
 *
 * 1. 定義済み: 状態が event.from に含まれる
 * 2. 個別禁止: forbidden ブロックに (event, state) の理由がある
 * 3. 包括禁止: event.otherwiseForbidden に理由がある
 *
 * どれにも当たらないマスは「暗黙の禁止」であり、理由が書かれていないため
 * エラーとする。全マスの手書きは要求せず、イベントごとの包括理由 1 つを最低ラインとする。
 */

import { allMachines, type SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';

/** 理由として有効な文字列か(空・空白のみは「書いていない」と見なす)。 */
function hasReason(text: string | undefined): boolean {
  return text !== undefined && text.trim().length > 0;
}

/**
 * 遷移テーブルの全域性を検査する検証器。
 * 未分類のマスごとに 1 件、反例(状態・イベント)つきの Finding を返す。
 */
export const transitionTotalityVerifier: Verifier = {
  id: 'V3',
  title: '全域性(遷移) — 全状態 × 全イベントが定義済みか理由付き禁止に分類される',

  verify(model: SpecModel, _ctx: VerifyContext): Finding[] {
    const findings: Finding[] = [];

    for (const { machine } of allMachines(model)) {
      for (const event of machine.events) {
        if (hasReason(event.otherwiseForbidden)) continue;

        const covered = new Set<string>(event.from);
        for (const fb of machine.forbidden) {
          if (fb.event !== event.id || !hasReason(fb.reason)) continue;
          for (const state of fb.from) covered.add(state);
        }

        for (const state of machine.states) {
          if (covered.has(state)) continue;
          findings.push({
            verifier: 'V3',
            severity: 'error',
            message: `${machine.machine}: 状態 ${state} × イベント ${event.id} が未定義です(otherwise_forbidden もなし)`,
            location: event.location,
            suggestion: `イベント ${event.id} に otherwise_forbidden で禁止理由を書くか、状態 ${state} を from に加えるか、forbidden ブロックに {event: ${event.id}, from: [${state}], reason: ...} を書いてください。`,
            counterexample: { machine: machine.machine, state, event: event.id },
          });
        }
      }
    }

    return findings;
  },
};
