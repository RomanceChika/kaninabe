/**
 * S16 保存点(usecase_spec の `saves[]`)を宣言した画面の整合。
 *
 * 画面が `usecases:` に保存点を宣言したとき、次の 3 つを見る。
 *
 * 1. **実在** —— その鍵(`{ユースケース名}.{保存点 ID}`)の保存点が usecase_spec にある
 * 2. **手順の露出** —— 保存点の各手順の操作が、この画面の `actions`(重ね表示を含む)にも
 *    並んでいる。**保存点を宣言した画面は、その手順を個別の操作としても持ち続けてよい**
 *    (下書きの編集・世話役の代理入力の経路が要る)。逆に、宣言していない操作を 1 回の保存で
 *    実行するのは「画面が何を起こすか」の宣言が嘘になる
 * 3. **起点からの到達** —— そのユースケースの `start` から、この画面へ辿れる
 *    (辿れないなら、その保存点はそのタスクの経路に無い)
 *
 * 手順の順序・原子性・引数の解決は Y 群が見る。ここは**画面の側の宣言**だけを見る。
 */

import { loadedGates, screenReachabilityOfModels, type ScreenReachability } from '../../relations/screen-reachability/index.js';
import type { UsecaseSaveDecl, UsecaseSpec } from '../../model/usecase/types.js';
import type { ScreenInput, ScreenSpec } from '../../model/screen/types.js';
import type { ScreenContext, ScreenVerifier } from '../verifier.js';
import { foreignBlocked, screenFinding, type Finding } from '../verifier.js';

/** S16 の実装。 */
export const usecaseExposureVerifier: ScreenVerifier = {
  id: 'S16',
  title: '保存点を宣言した画面が、その手順を操作としても持ち、起点から辿れる',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    if (!input.usecases.available) return [];
    if (ctx.reachabilityGaps.length > 0) return []; // 画面の到達の入力が使えない(行は呼び手が言う)
    const findings: Finding[] = [];
    const reachability = screenReachabilityOfModels(input.domain, input.screens, loadedGates(input.auth.flow?.gates ?? []));
    for (const screen of input.screens.screens) {
      for (const ref of screen.usecases) {
        findings.push(...checkOne(screen, ref, input, reachability, foreignBlocked(ctx, 'usecases')));
      }
    }
    return findings;
  },
};

/** 保存点 1 件の宣言を見る。 */
function checkOne(
  screen: ScreenSpec,
  ref: ScreenSpec['usecases'][number],
  input: ScreenInput,
  reachability: ScreenReachability,
  usecasesBlocked: boolean,
): Finding[] {
  const found = findSave(input, ref.id);
  if (found === null) {
    // usecase_spec が阻害(読めずに落とした保存点がある)なら、見つからないのは「落とした」かもしれないので「保存点は usecase_spec にありません」と言わない。
    // 見つかった保存点の手順の露出・起点からの到達は読めた分で判定できる(行は呼び手が言う)。
    if (usecasesBlocked) return [];
    return [
      screenFinding('S16', {
        message: `usecases の ${ref.id} という保存点は usecase_spec にありません`,
        location: ref.location,
        suggestion:
          '鍵は `{ユースケース名}.{保存点 ID}` である(例: entry_self.register)。' +
          'usecase_spec の saves[] に無い保存点は画面から起こせない',
        counterexample: { screen: screen.name, usecase: ref.id },
      }),
    ];
  }
  return [...checkSteps(screen, ref, found.save), ...checkReach(screen, ref, found.usecase, reachability)];
}

/** 保存点の全手順が、この画面の操作としても宣言されているか。 */
function checkSteps(
  screen: ScreenSpec,
  ref: ScreenSpec['usecases'][number],
  save: UsecaseSaveDecl,
): Finding[] {
  const declared = new Set([
    ...screen.actions.map((action) => action.id),
    ...screen.overlays.flatMap((overlay) => overlay.actions),
  ]);
  return save.steps
    .filter((step) => !declared.has(step.op))
    .map((step) =>
      screenFinding('S16', {
        message: `保存点 ${ref.id} の手順 ${step.op} を、この画面は操作として宣言していません`,
        location: ref.location,
        suggestion:
          `actions に ${step.op} を足す(保存点を宣言した画面は、その手順を個別の操作としても` +
          '持ち続けてよい)。持たせたくないなら、その手順を保存点から外す',
        counterexample: { screen: screen.name, usecase: ref.id, step: step.op },
      }),
    );
}

/** そのユースケースの起点から、この画面へ辿れるか。 */
function checkReach(
  screen: ScreenSpec,
  ref: ScreenSpec['usecases'][number],
  usecase: UsecaseSpec,
  reachability: ScreenReachability,
): Finding[] {
  const reachable = reachability.reach(usecase.actor, { kind: 'screen', id: usecase.start });
  if (reachable.screenIds.has(screen.id)) return [];
  return [
    screenFinding('S16', {
      message: `保存点 ${ref.id} の起点(${usecase.start})からこの画面へ辿れません`,
      location: ref.location,
      suggestion:
        'ユースケースの start からこの画面までの navigations を繋ぐか、' +
        'usecase_spec の start をこの画面が辿れる画面に直す',
      counterexample: { screen: screen.name, usecase: ref.id, start: usecase.start },
    }),
  ];
}

/** 鍵(`{ユースケース名}.{保存点 ID}`)から保存点を引く。 */
function findSave(
  input: ScreenInput,
  key: string,
): { readonly usecase: UsecaseSpec; readonly save: UsecaseSaveDecl } | null {
  for (const usecase of input.usecases.usecases) {
    for (const save of usecase.saves) {
      if (`${usecase.name}.${save.id}` === key) return { usecase, save };
    }
  }
  return null;
}
