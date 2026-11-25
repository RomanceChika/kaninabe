/**
 * 状態と役の印(`<span>`)。集約の章と全体の章が使う。
 *
 * 語は持たない(状態の名前と役の名前は事実から、段の数字の語は `spec/words.ts` から引く)。
 */

import type { RoleFact } from '../../../../semantics/spec-book/access-facts.js';
import type { LifecycleFacts, StateFact } from '../../../../semantics/spec-book/lifecycle-facts.js';
import { MINOR_SHARE } from '../spec/chips.js';
import { stepWords } from '../spec/words.js';
import { el, type Html } from './markup.js';

/** 状態の印。 */
export function stateChip(facts: LifecycleFacts, state: StateFact): Html {
  const step = stepWords(state.step, facts.steps);
  return el(
    'span',
    {
      class: ['bf-state', `bf-state--${state.category}`, state.final && 'bf-state--final'],
    },
    step.length === 0 ? null : el('span', { class: 'bf-state-no' }, step),
    state.label,
  );
}

/** 役の印(形 = 全体の役は丸・関係の役は角・内部は点線。出番の少ない役は小さく薄く)。 */
export function roleChips(roles: readonly RoleFact[], internal: string | undefined): (role: string) => Html {
  const byId = new Map(roles.map((role) => [role.id, role]));
  const top = Math.max(0, ...roles.map((role) => role.declaredOperations));
  return (id) => {
    const role = byId.get(id);
    if (role === undefined) return el('span', { class: 'bf-rl' }, id);
    const shape = role.roleClass === 'relation' || role.roleClass === 'global' ? role.roleClass : 'internal';
    const minor = role.id !== internal && top > 0 && role.declaredOperations < top * MINOR_SHARE;
    return el('span', { class: ['bf-rl', `bf-rl--${shape}`, minor && 'bf-rl--minor'] }, role.label);
  };
}
