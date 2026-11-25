/**
 * Y2 順序の整合のチェック。
 *
 * usecase-spec-writing.md の Y2:「各 step の入力に前の step の結果の id が要る場合、
 * その step が前にある」。生成 `action-inputs`(ここでは action_spec の `input` そのもの)の
 * `ref(...)` 型フィールドと、「作成の集約」の対応から導く。
 *
 * 判定は保存点をまたいだユースケース全体の宣言順で行う(ADR-0011 §4: 保存点の間は
 * ドメインの状態がそのまま境界になるので、後の保存点が前の保存点で作った実体を
 * 参照するのは正しい依存であり、エラーにしない)。
 *
 * 逆順(後で作るはずのものを先に参照する)だけをエラーにする。参照先の `{entity}.create` が
 * このユースケースの steps に現れない場合は「ユースケースの外(前提・context)から来る」と
 * みなし、何も指摘しない。
 */

import type { SpecModel } from '../../model/types.js';
import type { ActionSpec } from '../../model/trace/types.js';
import type { UsecaseSpec } from '../../model/usecase/types.js';
import type { Finding, UsecaseContext, UsecaseVerifier } from '../verifier.js';
import { usecaseFinding } from '../verifier.js';
import type { UsecaseInput } from '../derive.js';
import { actionFor, flattenSteps } from '../derive.js';
import { groundOperation } from '../../semantics/operation-ground.js';
import { findField } from '../../semantics/domain-index.js';

/** Y2: 手順の入力が指す集約の作成が、その手順より前にあることを検証する。 */
export const stepOrderVerifier: UsecaseVerifier = {
  id: 'Y2',
  title: '順序の整合 — 手順の入力が参照する集約は、その手順より前で作られている',

  verify(input: UsecaseInput, ctx: UsecaseContext): Finding[] {
    if (!input.usecases.available) return [];
    if (ctx.actions.state === 'blocked') return []; // action_spec が分からない(入力欄を読めない。行は呼び手が言う)
    return input.usecases.usecases.flatMap((usecase) => checkOrder(usecase, input));
  },
};

/** 1 ユースケース分の順序を検証する。 */
function checkOrder(usecase: UsecaseSpec, input: UsecaseInput): Finding[] {
  const flat = flattenSteps(usecase);
  // {entity}.create の登場位置(通し番号)。同じ集約を複数回作る宣言は無い前提だが、
  // 最初の 1 つで足りる(以降のどれかより後ろに参照があれば違反)。
  const createIndex = new Map<string, number>();
  for (const { step, index } of flat) {
    const grounding = groundOperation(input.domain, step.op);
    if (grounding.kind === 'create' && !createIndex.has(grounding.entry.entity)) {
      createIndex.set(grounding.entry.entity, index);
    }
  }

  const findings: Finding[] = [];
  for (const { save, step, index } of flat) {
    const action = actionFor(input.actions, step.op);
    if (action === undefined) continue; // 未接地(action_spec 不在)は Y1 / A 群の役目
    for (const violated of refEntitiesCreatedLater(input.domain, action, createIndex, index)) {
      findings.push(
        usecaseFinding('Y2', {
          message: `${save.id} の手順 ${step.op} は ${violated} の作成より前に置かれています`,
          location: step.location,
          suggestion: `steps の並びを直し、${violated}.create をこの手順より前に置く`,
          counterexample: { usecase: usecase.name, save: save.id, op: step.op, refers: violated },
        }),
      );
    }
  }
  return findings;
}

/**
 * その手順の入力(ref 型フィールド)が指す集約のうち、`.create` がこの手順**より後**に
 * 現れているものを返す(逆順の違反)。参照先の作成がユースケースに無い/より前にあるものは
 * 含めない。
 */
function refEntitiesCreatedLater(
  domain: SpecModel,
  action: ActionSpec,
  createIndex: ReadonlyMap<string, number>,
  index: number,
): readonly string[] {
  const violated = new Set<string>();
  for (const ref of action.input) {
    const field = findField(domain, ref.entity, ref.field);
    if (field === null || field.type.kind !== 'ref') continue;
    const target = field.type.entity;
    const createdAt = createIndex.get(target);
    if (createdAt !== undefined && createdAt > index) violated.add(target);
  }
  return [...violated];
}
