/**
 * Y6 達成条件のチェック。
 *
 * usecase-spec-writing.md の Y6:「done がドメインの評価器で評価できる式であり、steps の
 * 最後の遷移の `to` と矛盾しない」。評価可能性そのもの(パースでき、実在の状態フィールドと
 * 状態を指すか)は Y1 が見ているので、Y6 は**整合**(最後の手順と食い違っていないか)だけを見る。
 *
 * 「最後の手順」はユースケース全体(保存点をまたいで平坦化した列)の最後の 1 件である ——
 * done は保存点をすべて終えたあとの達成条件であり、個々の保存点の途中経過ではない。
 * 最後の手順が遷移でない(作成・削除・編集)、または done が参照する集約・状態機械と
 * 無関係なら、矛盾のしようがないので何も指摘しない。
 */

import type { UsecaseSpec } from '../../model/usecase/types.js';
import type { Finding, UsecaseContext, UsecaseVerifier } from '../verifier.js';
import { usecaseFinding } from '../verifier.js';
import type { UsecaseInput } from '../derive.js';
import { flattenSteps } from '../derive.js';
import { groundOperation } from '../../semantics/operation-ground.js';
import { doneShape } from './y1-reference-existence.js';

/** Y6: done が評価可能で、steps の最後の遷移の to と矛盾しないことを検証する。 */
export const doneConsistencyVerifier: UsecaseVerifier = {
  id: 'Y6',
  title: '達成条件 — done が評価可能で、steps の最後の遷移の to と矛盾しない',

  verify(input: UsecaseInput, ctx: UsecaseContext): Finding[] {
    if (!input.usecases.available) return [];
    return input.usecases.usecases.flatMap((usecase) => checkConsistency(usecase, input, ctx));
  },
};

/** 1 ユースケース分の整合を検証する。 */
function checkConsistency(usecase: UsecaseSpec, input: UsecaseInput, ctx: UsecaseContext): Finding[] {
  const shape = doneShape(usecase, input.domain, ctx.guards);
  if (shape === null) return []; // 評価できない場合は Y1 がすでに指摘している

  const flat = flattenSteps(usecase);
  const last = flat[flat.length - 1];
  if (last === undefined) return []; // saves が空はスキーマ違反(Y0)で既にエラーになっている

  const grounding = groundOperation(input.domain, last.step.op);
  if (grounding.kind !== 'transition') return []; // 最後が作成/削除/編集なら比べる相手が無い
  if (grounding.entry.aggregate !== shape.aggregate || grounding.entry.machine.machine !== shape.machine) {
    return []; // done が別の集約・機械を指しているので、この手順とは無関係(矛盾ではない)
  }
  if (grounding.entry.event.to === shape.state) return [];

  return [
    usecaseFinding('Y6', {
      message:
        `done(${shape.aggregate}.${shape.stateField} == ${shape.state})が、` +
        `最後の手順 ${last.step.op} の到達状態(${grounding.entry.event.to})と矛盾します`,
      location: { file: usecase.location.file, pointer: 'done' },
      suggestion: `done を "${shape.aggregate}.${shape.stateField} == ${grounding.entry.event.to}" に直すか、最後の手順を done と揃える`,
      counterexample: {
        usecase: usecase.name,
        done: usecase.done,
        lastOp: last.step.op,
        lastTo: grounding.entry.event.to,
      },
    }),
  ];
}
