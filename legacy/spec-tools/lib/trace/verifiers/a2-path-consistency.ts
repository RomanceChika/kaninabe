/**
 * A2 パスとの一致チェック。
 *
 * action-spec-writing.md の A2:「ファイルパス `actions/{aggregate}/{event}.md` が `handles` と一致する」。
 *
 * 仕様・実装・ドメインの 3 つを ID で機械突合できるようにするため、置き場所そのものが
 * 対応関係を表す(specs/backend/actions/README.md の対応表)。ここでは 2 方向を見る。
 * 1. 仕様側: `actions/{aggregate}/{event}.md` が `handles` と一致するか。
 * 2. 実装側: Server Action の実装が、配置の役割 `operation-entry` の位置に実在するか(server-actions.md の配置規約。
 *    いまの Next.js の配置では `app/src/app/_actions/{aggregate}/{event}.ts`)。位置は置き場の配置から引く(部品化 ③-c4b)。
 *
 * 実装側は app/ を走査できたときだけ検査する(仕様だけのリポジトリでは判断材料が無い)。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { ActionSpec } from '../../model/trace/types.js';
import type { TraceInput } from '../input.js';
import { layoutPath } from '../../model/product/layout.js';
import { absentFor } from '../../kernel/scope-owner.js';

/** A2: 仕様ファイルの置き場所と実装ファイルの置き場所が handles と一致するかを検証する。 */
export const pathConsistencyVerifier: TraceVerifier = {
  id: 'A2',
  title: 'パスとの一致 — 仕様と実装の配置が handles に対応する',

  verify(input: TraceInput): Finding[] {
    const findings: Finding[] = [];
    const implemented = new Set(input.tests.actionFiles);

    for (const action of input.actions.actions) {
      const specFinding = checkSpecPath(action);
      if (specFinding !== null) findings.push(specFinding);
      if (!input.tests.available) continue;
      const implFinding = checkImplPath(action, implemented, input);
      if (implFinding !== null) findings.push(implFinding);
    }
    return findings;
  },
};

/** 仕様ファイルが `{aggregate}/{event}.md` に置かれているかを見る。 */
function checkSpecPath(action: ActionSpec): Finding | null {
  const expected = `${action.handles.machine}/${action.handles.event}.md`;
  if (action.relPath === expected) return null;
  return traceFinding('A2', {
    message: `仕様ファイルの置き場所が handles(${action.handles.raw})と一致しません`,
    location: { file: action.location.file, pointer: 'handles' },
    suggestion:
      `このファイルを specs/backend/actions/${expected} へ移すか、` +
      `handles を置き場所に合わせて "${pathToEvent(action.relPath)}" に直す(1 ファイル 1 アクション)`,
    counterexample: { handles: action.handles.raw, expected_path: expected, actual_path: action.relPath },
  });
}

/** 実装ファイルが、配置の `operation-entry`(Server Action の入口)の位置に実在するかを見る。 */
function checkImplPath(
  action: ActionSpec,
  implemented: ReadonlySet<string>,
  input: TraceInput,
): Finding | null {
  // 実装の木を持たない製品・配置が決められないキーは、見る相手が無い(配置の定義の検査が、役割の宣言そのものの欠落を先に止める)。
  const expected = layoutPath(input.layout, input.roots.app, 'operation-entry', action.handles.raw);
  if (expected === null) return null;
  if (implemented.has(expected)) return null;
  const missing = traceFinding('A2', {
    message: `handles(${action.handles.raw})に対応する Server Action の実装がありません`,
    location: { file: action.location.file, pointer: 'handles' },
    suggestion: `${expected} を作る(配置の正: server-actions.md の _actions/{aggregate}/{event}.ts)`,
    counterexample: { handles: action.handles.raw, expected_impl: expected },
    grounding: 'implementation',
  });
  return absentFor({ kind: 'action', id: action.id }, missing);
}

/** `entry/submit.md` → `entry.submit`。置き場所から導かれる handles をメッセージに出すため。 */
function pathToEvent(relPath: string): string {
  return relPath.replace(/\.md$/, '').split('/').join('.');
}
