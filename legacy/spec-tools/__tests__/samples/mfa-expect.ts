/**
 * 題材の通し実行が**多要素認証の要求を書き込みの入口へ通す生成物**について確かめること(auth-spec-writing.md §mfa)。
 *
 * 題材ごとに書くのは 1 行(`expectMfaWired(run, …)`)だけにする —— 見る中身は題材に依らない。
 *
 *   1. 生成された Server Action(単発の操作・保存点)が**全部**、セッションが多要素認証を済ませたかを解決して渡す
 *   2. 実行器を呼ぶ組み立ての根が**全部**、それを実行器への命令に載せる
 *   3. 束(`runtime-bindings.ts`)が宣言どおりの範囲を運ぶ(どのロールに掛かるかは実行器がここから読む)
 *
 * 要求を外した・認証フロー仕様を持たない題材は `expectMfaAbsent` で「1 か所も現れない」を見る。
 */

import { expect } from 'vitest';
import type { SampleRun } from './harness.js';

/**
 * 置き場は**パスではなく中身の印**で見分ける(置き場の綴りは配置が決めるもので、ここに書き写さない)。
 * Server Action はサーバーの関数の印で始まり、組み立ての根は実行器を組む。
 */
const isAction = (content: string): boolean => content.startsWith("'use server';");

/** 束の生成物(生成物の置き場の下のファイル名)。 */
const isBindings = (file: string): boolean => file.endsWith('/runtime-bindings.ts');

/** 実行器を呼ぶ組み立ての根(受信口の配線は実行器を通らない内部実行なので外れる)。 */
function planCompositions(run: SampleRun): readonly (readonly [string, string])[] {
  return [...run.generatedFiles].filter(([, content]) => !isAction(content) && content.includes('runPlanOperation(') && content.includes('export function create'));
}

/** 束の本文(1 本だけある)。 */
function bindingsOf(run: SampleRun): string | undefined {
  return [...run.generatedFiles].find(([file]) => isBindings(file))?.[1];
}

/**
 * 要求を宣言した題材で、書き込みの入口の全部に執行の配線が入っていることを確かめる。
 *
 * @param run 通し実行の結果
 * @param scope 束に載るべき範囲の字面(例: `mfa: { scope: 'all' }`)
 */
export function expectMfaWired(run: SampleRun, scope: string): void {
  const actions = [...run.generatedFiles].filter(([, content]) => isAction(content));
  expect(actions.length).toBeGreaterThan(0);
  const unwiredActions = actions
    .filter(([, content]) => !(content.includes('  const actorMfa = await resolveSessionMfa().catch((cause: unknown) => {') && content.includes('parsed.data, actorMfa, intentKeyOf(intent)).catch(')))
    .map(([file]) => file);
  expect(unwiredActions).toEqual([]);
  const compositions = planCompositions(run);
  expect(compositions.length).toBeGreaterThan(0);
  expect(compositions.filter(([, content]) => !content.includes('run(deps, { actorId, actorClaims, actorMfa, input, idempotencyKey })')).map(([file]) => file)).toEqual([]);
  expect(bindingsOf(run)).toContain(`  ${scope},\n});`);
}

/**
 * 要求を外した・持たない題材で、執行の配線が 1 か所も現れないことを確かめる(外した製品の生成物は変わらない)。
 *
 * @param run 通し実行の結果
 */
export function expectMfaAbsent(run: SampleRun): void {
  const mentioning = [...run.generatedFiles]
    .filter(([file, content]) => (isAction(content) || content.includes('runPlanOperation(') || isBindings(file)) && (content.includes('actorMfa') || content.includes('mfa:')))
    .map(([file]) => file);
  expect(mentioning).toEqual([]);
}
