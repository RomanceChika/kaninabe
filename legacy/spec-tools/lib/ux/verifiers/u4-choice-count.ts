/**
 * U4 同時操作数の上限。
 *
 * ux-lint.md の U4:「1 つの状態で同時に並びうる操作の数が、台帳の閾値(`budget`)を超えない」。
 *
 * Hick の法則(選択肢が増えるほど決定時間が伸びる)とミラーの 7±2 の機械化である。
 * これが数えられるのは、**画面の宣言 ∩ 遷移表**という形でボタンの母集合が決まっているためで、
 * 「実装してみたらボタンが並びすぎた」と気づく前に、仕様を書く時点で数えられる。
 *
 * 数え方は 2 段である。
 *   1. **`kind:` を持つ部品(form / table / actions)は部品ごとに数える。** 部品の中のボタンは同じ場所に
 *      並ぶので、その部品の実数が「同時に選ばされる数」である(行のボタン = 遷移表との交差の結果・
 *      フォーム = 1・actions = 状態ごとのボタン数)。別々の部品に分かれて並ぶ操作を 1 つに足さない。
 *   2. **部品に載らない操作(手書きの部品が持つもの)は従来どおり画面の和**として数える。どの手書きの
 *      部品がどの操作を持つかは仕様に無いので、上界として全部を足す。
 * どちらも状態を固定して数える。状態を無視した検査は、正しく設計された画面を叱る側に寄る。
 */

import { allMachines, type SpecModel } from '../../model/types.js';
import type { LayoutComponent, ScreenSpec } from '../../model/screen/types.js';
import { canonicalActionId } from '../../semantics/action-ground.js';
import type { ActionSlot, VisibilityScope } from '../actions.js';
import { classifyActions, classifyIds, createVisibilityScope, machineNamesOf } from '../actions.js';
import type { UxInput, UxIssue } from '../../model/ux/types.js';
import { limitsOf, type UxContext } from '../context.js';
import type { UxVerifier } from '../verifier.js';
import { acceptHint, uxIssue } from '../verifier.js';

/** U4: 状態ごとの同時操作数が閾値を超えていないかを検査する。 */
export const choiceCountVerifier: UxVerifier = {
  id: 'U4',
  title: '同時操作数 — 1 つの状態で並ぶ操作が台帳の閾値(目安)以下',

  verify(input: UxInput, ctx: UxContext): UxIssue[] {
    const scope = createVisibilityScope(input.domain, ctx.guards);
    const limit = limitsOf(ctx).maxSimultaneousActions;
    return input.screens.screens.flatMap((screen) => check(screen, input.domain, scope, limit));
  },
};

/** 操作を載せる部品(`kind:` を持つもの)1 つ分。 */
interface OperationPart {
  readonly name: string;
  /** 状態によって並ぶ数が変わるボタン(`actions` / table の `actions`)。 */
  readonly buttons: readonly string[];
  /** 状態によらず 1 つ並ぶ操作(`kind: form` の操作・`kind: table` の編集)。 */
  readonly fixed: readonly string[];
}

/** 1 画面分の検査。部品ごとに数え、部品に載らない操作は画面の和で数える。 */
function check(screen: ScreenSpec, domain: SpecModel, scope: VisibilityScope, limit: number): UxIssue[] {
  const parts = operationParts(screen);
  const canonical = (id: string): string => canonicalActionId(domain, id) ?? id;
  const claimed = new Set(parts.flatMap((part) => [...part.buttons, ...part.fixed]).map(canonical));
  const rest = classifyActions(domain, screen).filter((slot) => !claimed.has(slot.id));

  const issues = countIn(screen, domain, scope, limit, rest, 0, null);
  for (const part of parts) {
    const buttons = classifyIds(domain, [...new Set(part.buttons)]);
    issues.push(...countIn(screen, domain, scope, limit, buttons, new Set(part.fixed.map(canonical)).size, part.name));
  }
  return issues;
}

/**
 * 操作の集まりを、触れる状態機械ごとにその全状態で数える。
 *
 * @param fixed 状態によらず常に並ぶ操作の数(フォームの操作など)
 * @param part 部品の名前(部品ごとの数え方のとき。画面の和なら null)
 */
function countIn(
  screen: ScreenSpec,
  domain: SpecModel,
  scope: VisibilityScope,
  limit: number,
  slots: readonly ActionSlot[],
  fixed: number,
  part: string | null,
): UxIssue[] {
  const machines = machineNamesOf(slots);
  // 状態機械に触れない集まり(予約 ID だけ・操作なし)は、宣言がそのまま同時操作数になる。
  if (machines.length === 0) {
    return slots.length + fixed > limit ? [tooMany(screen, part, null, slots, fixed, limit)] : [];
  }
  const issues: UxIssue[] = [];
  for (const name of machines) {
    const machine = allMachines(domain).find((ref) => ref.machine.machine === name)?.machine;
    if (machine === undefined) continue;
    for (const state of machine.states) {
      const visible = slots.filter((slot) => scope.visibleIn(slot, name, state));
      if (visible.length + fixed > limit) issues.push(tooMany(screen, part, `${name}.${state}`, visible, fixed, limit));
    }
  }
  return issues;
}

/** 画面の本体と重ね表示のレイアウトから、操作を載せる `kind:` の部品を集める(宣言順)。 */
function operationParts(screen: ScreenSpec): readonly OperationPart[] {
  const components = [screen.layout, ...screen.overlays.map((overlay) => overlay.layout)]
    .flatMap((layout) => layout.slots)
    .flatMap((slot) => slot.components);
  return components.flatMap(partOf);
}

/** 部品 1 つが載せる操作(`kind: detail` と手書きの部品は載せない)。 */
function partOf(component: LayoutComponent): readonly OperationPart[] {
  const ids = (refs: readonly { readonly id: string }[] | undefined): string[] => (refs ?? []).map((ref) => ref.id);
  switch (component.kind) {
    case 'form':
      return [{ name: component.name, buttons: [], fixed: ids(component.actionRefs) }];
    case 'actions':
      return [{ name: component.name, buttons: ids(component.buttonRefs), fixed: [] }];
    case 'table':
      return [
        {
          name: component.name,
          buttons: ids(component.buttonRefs),
          fixed: component.editRef === undefined ? [] : [component.editRef.id],
        },
      ];
    default:
      return [];
  }
}

/** 同時に並ぶ操作が多すぎる。 */
function tooMany(
  screen: ScreenSpec,
  part: string | null,
  state: string | null,
  visible: readonly ActionSlot[],
  fixed: number,
  limit: number,
): UxIssue {
  const where = state === null ? '' : `状態 ${state} で`;
  const what = part === null ? `画面 ${screen.name}` : `画面 ${screen.name} の部品 ${part}`;
  const subject = [part, state].filter((piece) => piece !== null).join('/');
  const count = visible.length + fixed;
  return uxIssue('U4', [screen.id], subject, {
    message: `${what}は${where}操作が ${count} 個同時に並びます(目安 ${limit} 個)`,
    location: screen.location,
    suggestion:
      `操作を減らすか、重ね表示・別画面へ分ける(状態で出し分けられるなら遷移表の from を見直す)。` +
      `手書きの部品が持つ操作は、部品を \`kind:\` の生成物にすると部品ごとの実数で数えられる。` +
      `一覧性が価値になる画面なら閾値そのものを見直してよい(ux-lint.md §閾値)。` +
      acceptHint('U4', subject),
    counterexample: {
      screen: screen.name,
      ...(part === null ? {} : { part }),
      ...(state === null ? {} : { state }),
      actions: visible.map((slot) => slot.id).join(', '),
      ...(fixed === 0 ? {} : { fixed: String(fixed) }),
      limit: String(limit),
    },
  });
}
