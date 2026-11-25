/**
 * U1 破壊的操作の確認。
 *
 * ux-lint.md の U1:「確認が要る操作は、確認の重ね表示(`overlays` かつ `opened_by` を持つもの)の中から発火する」。
 *
 * 「取り返しのつかない操作には確認を挟む」は最も広く共有された UX の経験則である。**どの操作に確認が要るかは
 * 宣言から導かれる方針(`confirmRequired`)そのもの**で、画面の生成・S19・Y5 と同じ導出を読む(`../confirm.ts`)。
 * 確認ダイアログの有無は `overlays` + `opened_by` として画面仕様に現れているので、
 * この経験則は**構造の照合**に落ちる。action_spec の `ux` で「確認は要らない」と上書きした操作は
 * 要らないものとして扱う(導出を信じない理由は action_spec の側に残る)。
 *
 * `opened_by` を要求するのは、**開くきっかけを持たない重ね表示は確認になっていない**ためである
 * (どこから開くとも書かれていない overlay に操作を置いても、押す前に挟まる保証が仕様に無い)。
 */

import type { SpecModel } from '../../model/types.js';
import type { ScreenRef, ScreenSpec } from '../../model/screen/types.js';
import { canonicalActionId } from '../../semantics/action-ground.js';
import { declaredActionRefs } from '../../model/screen/declared-actions.js';
import { attributesOf, confirmReason } from '../confirm.js';
import type { UxInput, UxIssue } from '../../model/ux/types.js';
import type { UxContext } from '../context.js';
import type { UxVerifier } from '../verifier.js';
import { acceptHint, uxIssue } from '../verifier.js';

/** U1: 確認が要る操作が確認を経て発火されるかを検査する。 */
export const destructiveConfirmVerifier: UxVerifier = {
  id: 'U1',
  title: '破壊的操作の確認 — 確認が要る操作は確認の重ね表示から発火する',

  verify(input: UxInput, ctx: UxContext): UxIssue[] {
    if (ctx.actions?.state === 'blocked') return []; // action_spec が分からない(上書きと入力の事実を引けない。行は呼び手が言う)
    return input.screens.screens.flatMap((screen) => check(screen, input.domain, ctx));
  },
};

/** 1 画面分の検査。宣言した操作のうち、確認が要るのに確認を経ないものを指摘する。 */
function check(screen: ScreenSpec, domain: SpecModel, ctx: UxContext): UxIssue[] {
  const canonical = (id: string): string => canonicalActionId(domain, id) ?? id;
  const confirmed = confirmedActions(screen, canonical);
  const seen = new Set<string>();
  const issues: UxIssue[] = [];

  for (const ref of declaredActionRefs(screen)) {
    const id = canonical(ref.id);
    if (confirmed.has(id) || seen.has(id)) continue;
    const attrs = attributesOf(domain, ctx, id);
    if (!attrs.confirmRequired) continue;
    seen.add(id);
    issues.push(missingConfirmation(screen, ref, id, confirmReason(attrs)));
  }
  return issues;
}

/**
 * 確認を経て発火されると言える操作の集合。
 *
 * 条件は「重ね表示の `actions` に載っている」かつ「その重ね表示に `opened_by` がある」。
 * 画面本体の `actions` にも同じ操作が書かれている場合は**確認済みとして扱う** —
 * 重ね表示を開くボタンとダイアログ内の実行ボタンを両方宣言する書き方があり、
 * 宣言の重複だけを理由に警告すると、正しく確認を挟んだ画面ほど怒られることになる。
 */
function confirmedActions(
  screen: ScreenSpec,
  canonical: (id: string) => string,
): ReadonlySet<string> {
  const confirmed = new Set<string>();
  for (const overlay of screen.overlays) {
    if (overlay.openedBy === undefined) continue;
    for (const action of overlay.actions) confirmed.add(canonical(action.id));
  }
  return confirmed;
}

/** 確認を経ずに発火される、確認が要る操作。 */
function missingConfirmation(screen: ScreenSpec, ref: ScreenRef, id: string, reason: string): UxIssue {
  const written = ref.id;
  return uxIssue('U1', [screen.id], id, {
    message: `${written} は確認が要る操作(${reason})ですが、確認の重ね表示を経ずに発火されます`,
    location: ref.location,
    suggestion:
      `この画面の overlays に確認用の重ね表示を足し(開くきっかけを opened_by に書く)、` +
      `その actions に ${written} を移す。` +
      `確認がかえって業務の邪魔になるなら、導出を信じない理由を action_spec の ux(confirm: none + reason)に書くか、` +
      `この画面だけ受け入れる(${acceptHint('U1', id)})`,
    counterexample: { screen: screen.name, action: written, why: reason },
  });
}
