/**
 * A5 重複の禁止チェック。
 *
 * action-spec-writing.md の A5:「同じイベントを `handles` する `action_spec` が 2 つ以上ない」。
 *
 * 1 ドメインイベント : 1 Server Action の対応(ARCH-BE-0013)が崩れると、
 * 「このイベントの入口はどれか」が一意に決まらず、仕様 ⇔ 実装 ⇔ テストの突合が成立しない。
 * ID(`{aggregate}-{event}-action`)の重複も同じ理由で許さない。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { ActionSpec } from '../../model/trace/types.js';
import type { TraceInput } from '../input.js';

/** A5: handles と id の重複が無いことを検証する。 */
export const noDuplicateHandlesVerifier: TraceVerifier = {
  id: 'A5',
  title: '重複の禁止 — 1 つのイベントを handles する仕様は 1 つだけ',

  verify(input: TraceInput): Finding[] {
    return [
      ...duplicates(input.actions.actions, (action) => action.handles.raw, handlesFinding),
      ...duplicates(input.actions.actions, (action) => action.id, idFinding),
    ];
  },
};

/**
 * キーが重複しているグループを見つけ、2 件目以降に Finding を作る。
 * 1 件目は「正」の候補として残し、指摘は重複した側に付ける。
 */
function duplicates(
  actions: readonly ActionSpec[],
  key: (action: ActionSpec) => string,
  build: (action: ActionSpec, first: ActionSpec, value: string) => Finding,
): Finding[] {
  const first = new Map<string, ActionSpec>();
  const findings: Finding[] = [];
  for (const action of actions) {
    const value = key(action);
    const existing = first.get(value);
    if (existing === undefined) {
      first.set(value, action);
      continue;
    }
    findings.push(build(action, existing, value));
  }
  return findings;
}

/** 同じ handles を持つ仕様が複数ある場合の Finding。 */
function handlesFinding(action: ActionSpec, first: ActionSpec, value: string): Finding {
  return traceFinding('A5', {
    message: `ドメインイベント ${value} を handles する action_spec が複数あります`,
    location: { file: action.location.file, pointer: 'handles' },
    suggestion:
      `${first.location.file} と統合して 1 ファイルにするか、片方の handles を別のイベントに直す` +
      '(1 ドメインイベントの入口は 1 つ: ARCH-BE-0013)',
    counterexample: { handles: value, first: first.location.file, duplicate: action.location.file },
  });
}

/** 同じ id を持つ仕様が複数ある場合の Finding。 */
function idFinding(action: ActionSpec, first: ActionSpec, value: string): Finding {
  return traceFinding('A5', {
    message: `action_spec の id ${value} が複数のファイルで使われています`,
    location: { file: action.location.file, pointer: 'id' },
    suggestion: `id は "{aggregate}-{event}-action" で一意になる。handles と揃うように片方を直す(先行: ${first.location.file})`,
    counterexample: { id: value, first: first.location.file, duplicate: action.location.file },
  });
}
