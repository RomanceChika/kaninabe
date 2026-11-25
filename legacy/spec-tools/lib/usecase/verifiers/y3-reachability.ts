/**
 * Y3 到達のチェック。
 *
 * usecase-spec-writing.md の Y3:「actor が start から、各 step を出す画面に届く」。
 * 探索そのものは S13(状態×ロールの到達)と同じ関係の層(lib/relations/screen-reachability/)の
 * `reach` で(`{event}.success` を辺として辿らない・経路上の画面にロールが入れること)、
 * 起点を `{ kind: 'screen', id: start }`(ユースケースの `start`)にして問う点だけが S13 と異なる。
 *
 * 免除は S13 と同じ器(specs/frontend/screens/README.md の `unreachable_states`)を直接は
 * 使わない —— usecase の到達不能は「ある(状態, ロール)の組に画面が無い」という S13 の
 * 母集合とは別の問い(「特定の起点から特定のロールで」)なので、二重の免除入力を作らず、
 * まず画面 or usecase の steps 自体を直すことを促す(usecase-spec-writing.md「Y3 の免除」)。
 */

import type { UsecaseSpec } from '../../model/usecase/types.js';
import type { Finding, UsecaseContext, UsecaseVerifier } from '../verifier.js';
import { usecaseFinding } from '../verifier.js';
import type { UsecaseInput } from '../derive.js';
import { deriveScreens } from '../derive.js';

/** Y3: actor が start から、各手順を出す画面に届くことを検証する。 */
export const reachabilityVerifier: UsecaseVerifier = {
  id: 'Y3',
  title: '到達 — actor が start から、各手順を出す画面に届く',

  verify(input: UsecaseInput, ctx: UsecaseContext): Finding[] {
    if (!input.usecases.available) return [];
    if (ctx.reachabilityGaps.length > 0) return []; // 画面の到達の入力が使えない(行は呼び手が言う)
    return input.usecases.usecases.flatMap((usecase) => checkReach(usecase, input));
  },
};

/** 1 ユースケース分の到達を検証する。 */
function checkReach(usecase: UsecaseSpec, input: UsecaseInput): Finding[] {
  if (!input.screens.available) return [];
  const derivation = deriveScreens(usecase, input);
  if (!derivation.startReachable) {
    return [
      usecaseFinding('Y3', {
        message: `actor(${usecase.actor})は start(${usecase.start})に入れません`,
        location: { file: usecase.location.file, pointer: 'start' },
        suggestion:
          `${usecase.start} の for に ${usecase.actor}(またはそれを含意するロール)を足すか、` +
          '入れる画面を start に選び直す',
        counterexample: { usecase: usecase.name, actor: usecase.actor, start: usecase.start },
      }),
    ];
  }
  return derivation.unresolvedOps.map((op) =>
    usecaseFinding('Y3', {
      message: `${op} を actor(${usecase.actor})が start(${usecase.start})から届く画面から実行できません`,
      location: { file: usecase.location.file, pointer: 'saves' },
      suggestion:
        `${op} を宣言する画面のうち、${usecase.actor} が入れて start から navigations で届く画面を作るか、` +
        '既存の画面の for / navigations を直す(S13 の要件と同じ)',
      counterexample: { usecase: usecase.name, actor: usecase.actor, op },
    }),
  );
}
