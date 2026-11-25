/**
 * U5 フォーム長の上限。
 *
 * ux-lint.md の U5:「1 つの状態で同時に編集できるフィールドの数が 台帳の閾値(`budget`)を超えない」。
 *
 * U4 と同型の検査で、数える対象がボタンではなく入力欄になっただけである。母集合は
 * access_spec の `writes`(誰がどの状態でどのフィールドを編集できるか)であり、
 * **画面が編集フォームを持つと宣言した時点で、その長さは仕様から決まっている**。
 *
 * ロールで絞るのは、画面の `for` から編集できない規則まで数えると、
 * 同じエンティティを複数のロールが別々に編集する設計で必ず過大に出るためである(S4 と同じ交差)。
 */

import type { SpecModel } from '../../model/types.js';
import type { GuardServices } from '../../guard/ast.js';
import type { ScreenRef, ScreenSpec } from '../../model/screen/types.js';
import { canonicalActionId, rolesIntersect } from '../../semantics/action-ground.js';
import { declaredActionRefs } from '../../model/screen/declared-actions.js';
import { findUpdate, isUpdateId } from '../../semantics/domain-index.js';
import type { WriteRule } from '../../model/types.js';
import { axisReferencedBy, createStateScope, entityStateView } from '../../semantics/entity-state-axes.js';
import type { UxInput, UxIssue } from '../../model/ux/types.js';
import { limitsOf, type UxContext } from '../context.js';
import type { UxVerifier } from '../verifier.js';
import { acceptHint, uxIssue } from '../verifier.js';

/** U5: 状態ごとの編集可能フィールド数が閾値を超えていないかを検査する。 */
export const formLengthVerifier: UxVerifier = {
  id: 'U5',
  title: 'フォーム長 — 1 つの状態で編集できるフィールドが台帳の閾値(目安)以下',

  verify(input: UxInput, ctx: UxContext): UxIssue[] {
    const limit = limitsOf(ctx).maxWritableFields;
    return input.screens.screens.flatMap((screen) =>
      declaredActionRefs(screen)
        .filter((ref) => isUpdateId(ref.id))
        .flatMap((ref) => check(screen, ref, input.domain, ctx.guards, limit)),
    );
  },
};

/** 1 つの編集操作について、その画面が並べるフォームの長さを状態ごとに数える。 */
function check(
  screen: ScreenSpec,
  ref: ScreenRef,
  domain: SpecModel,
  guards: GuardServices,
  limit: number,
): UxIssue[] {
  const id = canonicalActionId(domain, ref.id) ?? ref.id;
  const entry = findUpdate(domain, id);
  // 接地しない編集 ID は S2 がエラーにする。ここで重ねて指摘しない。
  if (entry === null) return [];

  const rules = entry.rules.filter((rule) => rolesIntersect(domain, screen.forRoles, [rule.by]));
  if (rules.length === 0) return [];

  // 数えるのは「その writes が実際に絞っている軸」の状態だけである。直交する別の軸
  // (催しの掲載状態)で数えると、条件の変数が食い違って全状態で同じ数が出る。
  const view = entityStateView(domain, entry.entity);
  const axis = view === null ? null : axisReferencedBy(view, rules.map((rule) => rule.when), guards);
  if (view === null || axis === null) {
    const fields = fieldsOf(rules);
    return fields.length > limit ? [tooLong(screen, ref, id, null, fields, limit)] : [];
  }

  const scope = createStateScope(domain, guards, view.aggregate, axis.stateField);
  const issues: UxIssue[] = [];
  for (const state of axis.machine.states) {
    const fields = fieldsOf(rules.filter((rule) => scope.appliesIn(rule.when, state)));
    if (fields.length <= limit) continue;
    issues.push(tooLong(screen, ref, id, `${axis.machine.machine}.${state}`, fields, limit));
  }
  return issues;
}

/** 規則群が許すフィールドの和(同じフィールドを 2 つの規則が挙げても 1 つの入力欄)。 */
function fieldsOf(rules: readonly WriteRule[]): readonly string[] {
  return [...new Set(rules.flatMap((rule) => rule.fields))];
}

/** 同時に編集できるフィールドが多すぎる。 */
function tooLong(
  screen: ScreenSpec,
  ref: ScreenRef,
  id: string,
  state: string | null,
  fields: readonly string[],
  limit: number,
): UxIssue {
  const where = state === null ? '' : `状態 ${state} で`;
  const subject = state === null ? id : `${id}/${state}`;
  return uxIssue('U5', [screen.id], subject, {
    message: `画面 ${screen.name} の ${ref.id} は${where} ${fields.length} 個のフィールドを同時に編集させます(目安 ${limit} 個)`,
    location: ref.location,
    suggestion:
      `フォームを手順に分けるか、access_spec の writes を状態・ロールで絞る。` +
      `一度に埋めさせるのが業務上正しいなら閾値そのものを見直してよい(ux-lint.md §閾値)。` +
      acceptHint('U5', subject),
    counterexample: {
      screen: screen.name,
      ...(state === null ? {} : { state }),
      fields: fields.join(', '),
      limit: String(limit),
    },
  });
}
