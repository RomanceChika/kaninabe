/**
 * S12 error 到達可能性のチェック。
 *
 * screen-spec-writing.md §states:「`reads` の `query_spec` がどれも `params` を持たない画面は
 * `error` を宣言しない — 読み取りの `invalid_input` は `params` の検査から出るものであり、
 * `params` が無ければ到達しない。宣言すると、実装に到達しない分岐が生まれ、それを緑にするために
 * 偽のエラーを注入するテストが要る(画面が守っているものは 1 つも増えない)」。
 *
 * この規則はもともと機械執行していなかった(2026-09-05 まで)。第 1 段のハンドブック状態別
 * プレビュー(⑩b)を作る過程で `check_item_admin` / `venue_admin` / `workshop_list` の 3 画面が
 * 実際にこの規則へ違反していたことが判明した(前者2つは実装が「起こりえない」と自覚して
 * `throw` しており、`workshop_list` は防御的に表示だけ描いていた)。今後の再発を防ぐため、
 * ここで初めて機械執行する。
 *
 * **`reads` が空の画面は対象外。** `login` / `tutorial_chat` のように読み取りを 1 つも持たない
 * 画面の `error` は、読み取りの `invalid_input` とは無関係な理由(OAuth コールバック・AI
 * ストリーミングの失敗)に基づくことがあり、この規則が塞ぎたい「到達しない読み取りエラー」の
 * 対象ではない。
 */

import type { Finding, ScreenVerifier } from '../verifier.js';
import { screenFinding } from '../verifier.js';
import type { QuerySpecModel } from '../../model/query/types.js';
import type { ScreenInput, ScreenSpec } from '../../model/screen/types.js';

/** S12: params 無しの reads だけの画面は states.requires に error を書けない。 */
export const errorReachabilityVerifier: ScreenVerifier = {
  id: 'S12',
  title: 'error 到達可能性 — params 無しの reads だけの画面は error を宣言できない',

  verify(input: ScreenInput): Finding[] {
    if (!input.queries.available) return [];
    return input.screens.screens.flatMap((screen) => check(screen, input.queries));
  },
};

/** 画面 1 枚を見る。 */
function check(screen: ScreenSpec, queries: QuerySpecModel): Finding[] {
  if (!screen.requiredStates.includes('error')) return [];
  // 読み取りを 1 つも持たない画面の error は、読み取り由来ではない理由がありうる(JSDoc 参照)。
  if (screen.reads.length === 0) return [];

  const hasParamfulRead = screen.reads.some((read) => {
    const query = queries.queries.find((candidate) => candidate.id === read.id);
    // 実在しない参照は S2 が指摘済み。ここでは「否定できない」側に倒して誤検出を避ける(読み取りクエリが阻害で読めずに落ちたものもここ — 保留しなくても偽の指摘にならない)。
    // **ここに届くのは、読めて仕様を落としただけの阻害まで**。置き場ごと無い・読めない阻害は `verify` の `available` の判定で実行されず、行は `verify/operation-input-notes.ts` が言う。
    if (query === undefined) return true;
    return query.params.length > 0;
  });
  if (hasParamfulRead) return [];

  return [
    screenFinding('S12', {
      message: `${screen.name} の reads(${screen.reads.map((read) => read.id).join(', ')})は` +
        'どれも params を持たないため、states.requires の error に到達できません',
      location: screen.location,
      suggestion:
        'states.requires から error を外す(読み取りの invalid_input は params の検査から出るものであり、' +
        'params の無い query_spec では起こりえない。実装側は「起こりえない」ことを assert して throw する ' +
        '既存の慣習(member_admin / invitation_admin 等)に合わせるとよい)',
      counterexample: { screen: screen.name, reads: screen.reads.map((read) => read.id).join(', ') },
    }),
  ];
}
