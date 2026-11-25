/**
 * 検証の実行配線(`lib/compose/verify-pipeline.ts`)が呼ぶ群の実行口と、全検査の表の群(`ALL_CHECK_GROUPS`)の対応を固定する構造テスト。
 *
 * 群を足したのに表への登録を忘れる形(配線には呼び出しがあり、表に群が無い)と、表に群を足したのに配線で呼び忘れる形(その逆)の
 * 両方を赤にする。新しい接頭辞の群も、配線に実行口の呼び出しを足した時点でここの表に 1 行足すことになり、足し忘れは赤になる。
 * 対応は人が書く(実行口の名前から群の名前は導けない)が、書き忘れは両側から拾われる。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_CHECK_GROUPS } from '../../../lib/compose/all-checks.js';

/** 配線の実行口 → その実行口が受け持つ表の群(1 つの実行口が複数の群を回すこともある)。 */
const RUNNER_GROUPS: Readonly<Record<string, readonly string[]>> = {
  runProduct: ['製品の根(P)'],
  runDomainWithZ3: ['ドメイン仕様(V)'],
  runSpecIndex: ['テストケース ID の台帳(A9)'],
  runTrace: ['action_spec(A)'],
  runQueries: ['query_spec(Q)'],
  runDataTables: ['data_table(T)'],
  runNotifications: ['通知カタログ(N)'],
  runJobs: ['ジョブカタログ(J)'],
  runConfig: ['設定カタログ(K)'],
  runAuth: ['認証フロー仕様(H)'],
  runGuarantees: ['保証台帳(Z)'],
  runExternal: ['外部連携カタログ(X)'],
  runRisk: ['危ない形(R)'],
  runScreens: ['screen_spec(S)'],
  runUsecases: ['usecase_spec(Y)'],
  runUx: ['UX 検査(U)', 'UX 原則の台帳(U8)'],
  runDesign: ['視覚層(G)'],
  runGenerality: ['語彙漏れ(W1〜W4)'],
  runDocs: ['ルール文書(M0〜M6)'],
  runTerms: ['用語の台帳(M7〜M12)'],
  runExtension: ['拡張候補の台帳(W5)'],
};

/** `runAllVerifications` の本文から、`run` で始まる実行口の呼び出しの名前を集める。 */
function calledRunners(): readonly string[] {
  const source = readFileSync(fileURLToPath(new URL('../../../lib/compose/verify-pipeline.ts', import.meta.url)), 'utf8');
  const start = source.indexOf('export async function runAllVerifications');
  const end = source.indexOf('\n}\n', start);
  expect(start, '配線の入口が見つかりません').toBeGreaterThanOrEqual(0);
  const body = source.slice(start, end);
  const names = [...body.matchAll(/\b(run[A-Z][A-Za-z0-9]*)\(/gu)].map((match) => match[1] ?? '');
  return [...new Set(names)].filter((name) => name !== 'runAllVerifications');
}

describe('配線が呼ぶ群の実行口 ⇔ 全検査の表の群', () => {
  const called = calledRunners();

  it('配線の本文から実行口を読めている', () => {
    expect(called.length).toBeGreaterThan(10);
  });

  it('配線が呼ぶ実行口は、すべてここの対応に載っている(新しい群の呼び出しを足したら、表の群も足す)', () => {
    expect(called.filter((name) => RUNNER_GROUPS[name] === undefined)).toEqual([]);
  });

  it('ここの対応にある実行口は、すべて配線が呼んでいる(腐った行を残さない)', () => {
    expect(Object.keys(RUNNER_GROUPS).filter((name) => !called.includes(name))).toEqual([]);
  });

  it('対応が指す群は、すべて全検査の表にある', () => {
    const registered = new Set(ALL_CHECK_GROUPS.map((group) => group.group));

    expect(Object.values(RUNNER_GROUPS).flat().filter((group) => !registered.has(group))).toEqual([]);
  });

  it('全検査の表の群は、どれもいずれかの実行口に対応している(表にだけあって実行されない群を作らない)', () => {
    const covered = new Set(Object.values(RUNNER_GROUPS).flat());

    expect(ALL_CHECK_GROUPS.map((group) => group.group).filter((group) => !covered.has(group))).toEqual([]);
  });

  it('1 つの群を受け持つ実行口は 1 つだけ(二重に回さない)', () => {
    const owners = Object.values(RUNNER_GROUPS).flat();

    expect(owners.length).toBe(new Set(owners).size);
  });
});
