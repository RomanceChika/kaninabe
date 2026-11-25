/**
 * L2 網羅スイープ — ⑥ 状態 × 可視性の行を state_spec から機械的に導出する。
 *
 * S14(状態の可視性)が判定する母集合(状態機械の全状態)を、判定せずに**事実だけ**並べる。
 * 「可視性」列の探索(`findStateVisibility`)は S14 とまったく同じものを共有する
 * ── 判定する側(検査)と判定しない側(この台帳)が違う探索を書くと、片方だけが直る事故が起きる。
 *
 * 状態の行には自然な `test_cases` の出どころが無い(state_spec 自身は test_cases を持たない)ため
 * `evidence` は常に空にする。この章は「一通り試す」の網羅であって、可視性の裏付けは
 * S14 が仕様の閉世界の中で機械的に検査している(テストではなく仕様同士の突合で保証する形)。
 */

import type { SpecModel } from '../../model/types.js';
import { allMachines } from '../../model/types.js';
import { anonymousRoleId } from '../../model/role-hierarchy.js';
import { entityNameOfAggregate } from '../../semantics/domain-index.js';
import { stateFieldOf } from '../../semantics/state-admit.js';
import { findStateVisibility } from '../../screen/state-visibility.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import type { L2Row } from './l2-sweep-types.js';
import { gateDecls, gatesOf } from './gates-input.js';
import { gatesBlocked, gatesUnverifiedNote } from '../../relations/screen-reachability/index.js';

/** 状態 × 可視性の行を全件組み立てる(screen_spec が無い環境では空)。 */
export function buildStateRows(model: SpecModel, ctx: GenerateContext): L2Row[] {
  const screens = ctx.screens;
  if (screens === undefined || !screens.available) return [];
  const queries = ctx.queries?.available === true ? ctx.queries.queries : [];
  const gatesInput = gatesOf(ctx);
  const gatesUnknown = gatesBlocked(gatesInput);
  const gates = gateDecls(gatesInput);
  const anonymousRole = anonymousRoleId(model.roles.roles);

  const rows: L2Row[] = [];
  for (const { aggregate, machine } of allMachines(model)) {
    const stateField = stateFieldOf(model, aggregate, machine.machine);
    if (stateField === undefined) continue;
    const entityName = entityNameOfAggregate(model, aggregate);

    for (const state of machine.states) {
      // 関門が分からない(採ったのに読めない)とき、空の関門で探した「可視性」を事実として書かない(「無し」と断定しない)。
      const cell = gatesUnknown
        ? gatesUnverifiedNote('可視性')
        : visibilityCell(
            findStateVisibility(ctx.guards, model, queries, screens.screens, gates, anonymousRole, aggregate, entityName, stateField, state),
          );
      rows.push({
        section: '状態',
        subject: `${machine.machine}.${state}`,
        aspect: '可視性',
        detail: machine.stateLabels[state] ?? state,
        evidence: [],
        extra: [cell],
      });
    }
  }
  return rows;
}

/** `findStateVisibility` の結果を 1 セル分の文字列にする(0 件は「無し」)。 */
function visibilityCell(witnesses: ReturnType<typeof findStateVisibility>): string {
  if (witnesses.length === 0) return '無し';
  return [...new Map(witnesses.map((w) => [`${w.screen.name}/${w.query.name}/${w.role}`, w])).values()]
    .map((w) => `${w.screen.name}(${w.role})via ${w.query.name}`)
    .join(', ');
}

