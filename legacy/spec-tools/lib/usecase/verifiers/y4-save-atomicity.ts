/**
 * Y4 保存点の原子性の前提のチェック。
 *
 * usecase-spec-writing.md の Y4:「保存点の内側の途中状態(作成された実体の初期状態)が、
 * その保存点の中で実行する後続の遷移の from に入っている(例: entry.create → draft、
 * entry.submit の from に draft)」。
 *
 * これは束⑯c(保存点 → 複合 RPC の生成)の前提を仕様の時点で検査するものである。
 * 複合 RPC は「作った直後の状態で後続の遷移が起こせる」ことを当然の前提にするため、
 * その前提が崩れている(作成の初期状態が後続イベントの from に無い)保存点は、
 * 生成しても実行時に必ず 0 行(競合)になる —— 仕様の時点でエラーにする。
 *
 * 判定は**保存点の内側だけ**で行う(ADR-0011 §4: 保存点の間はドメインの状態そのものが境界
 * であり、原子性を要求しない)。同じ集約を保存点の中で複数回作る宣言は想定していないため、
 * 保存点ごとに集約 1 つにつき最初の作成だけを記録する。
 */

import type { AggregateSpecs } from '../../model/types.js';
import type { UsecaseSaveDecl, UsecaseSpec } from '../../model/usecase/types.js';
import type { Finding, UsecaseVerifier } from '../verifier.js';
import { usecaseFinding } from '../verifier.js';
import type { UsecaseInput } from '../derive.js';
import { groundOperation } from '../../semantics/operation-ground.js';

/** Y4: 保存点の内側で、作成の初期状態が後続の遷移の from に入っていることを検証する。 */
export const saveAtomicityVerifier: UsecaseVerifier = {
  id: 'Y4',
  title: '保存点の原子性の前提 — 作成の初期状態が、同じ保存点内の後続の遷移の from にある',

  verify(input: UsecaseInput): Finding[] {
    if (!input.usecases.available) return [];
    return input.usecases.usecases.flatMap((usecase) =>
      usecase.saves.flatMap((save) => checkSave(usecase, save, input)),
    );
  },
};

/** 保存点 1 つ分を検証する。 */
function checkSave(usecase: UsecaseSpec, save: UsecaseSaveDecl, input: UsecaseInput): Finding[] {
  const findings: Finding[] = [];
  // 集約名 → { 機械名 → 初期状態 }。この保存点でここまでに作られたものだけを持つ。
  const createdInitials = new Map<string, ReadonlyMap<string, string>>();

  for (const step of save.steps) {
    const grounding = groundOperation(input.domain, step.op);
    if (grounding.kind === 'create') {
      if (!createdInitials.has(grounding.entry.aggregate)) {
        createdInitials.set(grounding.entry.aggregate, initialStatesOf(input.domain.aggregates.get(grounding.entry.aggregate)));
      }
      continue;
    }
    if (grounding.kind !== 'transition') continue;
    const initials = createdInitials.get(grounding.entry.aggregate);
    if (initials === undefined) continue; // この保存点で作られたものではない(前の保存点・既存の実体)
    const initial = initials.get(grounding.entry.machine.machine);
    if (initial === undefined) continue; // その機械の初期状態を宣言できていない(state_spec 側の別問題)
    if (grounding.entry.event.from.includes(initial)) continue;

    findings.push(
      usecaseFinding('Y4', {
        message:
          `${save.id} で作った ${grounding.entry.aggregate} の初期状態(${initial})が、` +
          `同じ保存点内の ${step.op} の from(${grounding.entry.event.from.join(', ')})にありません`,
        location: step.location,
        suggestion:
          `${step.op} の直前に、${grounding.entry.aggregate} を初期状態 ${initial} から ${step.op} の from へ運ぶ` +
          '手順を挟むか、この保存点を分ける(保存点の内側は全部か無しかであり、初期状態から直接起こせない遷移を混ぜられない)',
        counterexample: { usecase: usecase.name, save: save.id, op: step.op, initial },
      }),
    );
  }
  return findings;
}

/** 集約の全状態機械について「機械名 → 初期状態」を返す。 */
function initialStatesOf(specs: AggregateSpecs | undefined): ReadonlyMap<string, string> {
  return new Map((specs?.stateMachines ?? []).map((machine) => [machine.machine, machine.initial]));
}
