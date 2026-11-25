/**
 * 新しい形の章の**印**(状態と役)。色は意匠のトークンだけで、`book-face/face.css` の `.bf-state` / `.bf-rl` が持つ
 * (試作 v3.7〜v3.9 の規則。設計メモ §1-7-7〜9)。色だけで意味を伝えない: 状態は区分の語を表の列に、役は名前と形を持つ。
 *
 * - 状態の印: 区分(始まり・進行中・終わり・否定的)の地の色 + 本筋の番号「2/6」+ 終点は二重の枠。
 * - 役の印: 形が概念(誰にでも付く役 = 丸 / 対象との関係で決まる役 = 角 / 内部実行と未ログイン = 点線)。
 *   出番の少ない役(宣言した操作の数が、いちばん多い役の 1 割未満。内部実行は除く)は一回り小さく淡く。
 *
 * 中の文字はすべて逃がす(無害化の許可表の `span` と `class` だけで組む)。**アプリの語彙は 1 語も持たない。**
 */

import type { RoleFact } from '../../../../semantics/spec-book/access-facts.js';
import type { LifecycleFacts, StateFact } from '../../../../semantics/spec-book/lifecycle-facts.js';
import { esc } from '../face-html.js';
import { stepWords } from './words.js';

/** 状態の印。 */
export function stateChip(facts: LifecycleFacts, state: StateFact): string {
  const step = stepWords(state.step, facts.steps);
  const number = step.length === 0 ? '' : `<span class="bf-state-no">${esc(step)}</span>`;
  return `<span class="bf-state bf-state--${state.category}${state.final ? ' bf-state--final' : ''}">${number}${esc(state.label)}</span>`;
}

/** 出番の少ない役の割合(いちばん多い役の宣言した操作の数に対して)。 */
export const MINOR_SHARE = 0.1;

/**
 * 役の印を作る関数(製品全体の役の事実から 1 度だけ作る)。知らない役 ID は名前だけの印。
 *
 * @param internal 出番の少ない印を付けない役(内部実行の役 = `systemRoleId`。無ければ undefined)
 */
export function roleChips(roles: readonly RoleFact[], internal: string | undefined): (role: string) => string {
  const byId = new Map(roles.map((role) => [role.id, role]));
  const top = Math.max(0, ...roles.map((role) => role.declaredOperations));
  return (id) => {
    const role = byId.get(id);
    if (role === undefined) return `<span class="bf-rl">${esc(id)}</span>`;
    const shape = role.roleClass === 'relation' || role.roleClass === 'global' ? role.roleClass : 'internal';
    const minor = role.id !== internal && top > 0 && role.declaredOperations < top * MINOR_SHARE;
    return `<span class="bf-rl bf-rl--${shape}${minor ? ' bf-rl--minor' : ''}">${esc(role.label)}</span>`;
  };
}
