/**
 * 題材の表の照らし(`sample-coverage-check.ts`)と、生成した試験の結末の数え方(`wiring-tests.ts` の `kindOutcomes`)のユニットテスト(fix27 A2)。
 *
 * 赤にするもの(負例)と通すもの(正例)を表で揃える: 生成したのに 0 回・生成したのに行の無い生成物・古い行・回数の食い違い・n/a の条件が崩れた・
 * ホストに無い部品の食い違い・落ちた it・読み込めない試験・拒否の観測の食い違い・名指しの行の欠け・未対応の理由が空。
 */

import { describe, expect, it } from 'vitest';
import type { CoverageRow } from '../../../../../lib/targets/supabase/samples/sample-coverage-check.js';
import { SAMPLE_COVERAGE } from '../../../../samples/sample-coverage.js';
import { preCommitProblems, runProblems, type PreCommitObservation, type RunObservation } from '../../../../../lib/targets/supabase/samples/sample-coverage-check.js';
import { kindOutcomes, type KindOutcome } from '../../../../../lib/targets/supabase/samples/wiring-tests.js';

const PRE: CoverageRow = { stage: 'pre-app', gate: 'pre-commit', runs: 2 };
const LINT: CoverageRow = { stage: 'lint', gate: '未対応', runs: 0, pending: '段 2' };
const J2: CoverageRow = { stage: 'generated-tree', gate: 'pre-commit', runs: 1 };
const X8: CoverageRow = { stage: 'generated-tree', gate: 'pre-commit', runs: 0, na: { reason: '有料の連携が無い', when: 'no-paid-integration' } };
const OP: CoverageRow = { stage: 'wiring', gate: 'merge-check と夜間', runs: 3 };
const GUARD: CoverageRow = { stage: 'wiring', gate: 'merge-check と夜間', runs: 1 };
const CRON_OFF: CoverageRow = { stage: 'wiring', gate: 'merge-check と夜間', runs: 0, na: { reason: '時刻起点のジョブが無い', when: 'no-scheduled-job', ungenerated: true } };
const RB_KEY = '突合:rollback-retry-parity.test.ts';
const RB_NA: CoverageRow = { stage: 'db', gate: 'merge-check と夜間', runs: 0, na: { reason: '手書きの RPC が無い', when: 'no-handwritten-rpc' } };
const RB_RUN: CoverageRow = { stage: 'db', gate: 'merge-check と夜間', runs: 1 };
const BD: CoverageRow = { stage: 'wiring', gate: 'merge-check と夜間', runs: 6, refusal: 1 };

/** 正例の表。 */
const TABLE = { s: { 'verify:pre-app': PRE, 'guard:require-assertions': GUARD, 'lint:eslint': LINT, 'check:J2': J2, 'check:X8': X8, 'test:op': OP, 'test:bd': BD } };

/** 正例の pre-commit の観測。 */
const PRE_OK: PreCommitObservation = { checks: { J2: 1, X8: 0 }, checkErrors: [], testKinds: ['bd', 'op'], paid: 0, scheduled: 0, handwritten: 0 };

/** 結末 1 つ。 */
function outcome(passed: number, extra: Partial<KindOutcome> = {}): KindOutcome {
  return { passed, failed: 0, missing: [], broken: [], ...extra };
}

/** 正例の実行の観測。 */
const RUN_OK: RunObservation = { kinds: new Map([['op', outcome(3)], ['bd', outcome(6)]]), refusal: new Map([['bd', 1]]), assertionProbe: 1, paid: 0, scheduled: 0, handwritten: 0 };

describe('preCommitProblems', () => {
  it('正例: 表どおりなら食い違い無し', () => {
    expect(preCommitProblems('s', PRE_OK, TABLE)).toEqual([]);
  });

  it.each([
    ['表に無い題材', 't', PRE_OK, TABLE, '[表に無い題材] t'],
    ['生成の後に回し直す検査が増えたのに行が無い', 's', { ...PRE_OK, checks: { J2: 1, X8: 0, X9: 1 } }, TABLE, '[行の無い生成物] s × check:X9'],
    ['回し直す検査が無くなったのに行が残る', 's', { ...PRE_OK, checks: { J2: 1 } }, TABLE, '[古い行] s × check:X8'],
    ['試験を生成した生成器に行が無い', 's', { ...PRE_OK, testKinds: ['bd', 'op', 'new'] }, TABLE, '[行の無い生成物] s × test:new'],
    ['生成器が試験を出さなくなったのに行が残る', 's', { ...PRE_OK, testKinds: ['op'] }, TABLE, '[古い行] s × test:bd'],
    ['見た相手の数の食い違い', 's', { ...PRE_OK, checks: { J2: 2, X8: 0 } }, TABLE, '[回数の食い違い] s × check:J2'],
    ['生成の後に見る相手が 0 で n/a でない', 's', { ...PRE_OK, checks: { J2: 0, X8: 0 } }, { s: { ...TABLE.s, 'check:J2': { ...J2, runs: 0 } } }, '[0 回の行] s × check:J2'],
    ['有料の連携が現れたら X8 の n/a は崩れる', 's', { ...PRE_OK, paid: 1 }, TABLE, '[n/a の条件が崩れた] s × check:X8'],
    ['回し直しの指摘(error)は赤', 's', { ...PRE_OK, checkErrors: ['[J2] 宣言の無い口'] }, TABLE, '[回し直しの赤] s'],
    ['回し直す前の verify の行の回数は回し直す検査の数', 's', PRE_OK, { s: { ...TABLE.s, 'verify:pre-app': { ...PRE, runs: 3 } } }, '[回数の食い違い] s × verify:pre-app'],
    ['名指しの行(ESLint)が無い', 's', PRE_OK, { s: { 'verify:pre-app': PRE, 'guard:require-assertions': GUARD, 'check:J2': J2, 'check:X8': X8, 'test:op': OP, 'test:bd': BD } }, '[名指しの行が無い] s × lint:eslint'],
    ['名指しの行(assertion の無い it が赤になる守り)が無い', 's', PRE_OK, { s: { 'verify:pre-app': PRE, 'lint:eslint': LINT, 'check:J2': J2, 'check:X8': X8, 'test:op': OP, 'test:bd': BD } }, '[名指しの行が無い] s × guard:require-assertions'],
    ['時刻起点のジョブが無い間は生成しない行なのに、生成した(見るものの無い試験)', 's', { ...PRE_OK, testKinds: ['bd', 'cron', 'op'] }, { s: { ...TABLE.s, 'test:cron': CRON_OFF } }, '[見るものの無い試験を生成した] s × test:cron'],
    ['時刻起点のジョブが現れたのに、生成しない行のまま(生成が要る)', 's', { ...PRE_OK, scheduled: 1 }, { s: { ...TABLE.s, 'test:cron': CRON_OFF } }, '[n/a の条件が崩れた] s × test:cron'],
    ['未対応の行の中身が空', 's', PRE_OK, { s: { ...TABLE.s, 'lint:eslint': { ...LINT, pending: ' ' } } }, '[未対応の理由が空] s × lint:eslint'],
    ['時刻起点のジョブが現れたら Cron の n/a は崩れる', 's', { ...PRE_OK, testKinds: ['bd', 'op', 'cron'], scheduled: 1 }, { s: { ...TABLE.s, 'test:cron': { ...OP, runs: 2, na: { reason: '空の表', when: 'no-scheduled-job' } } } }, '[n/a の条件が崩れた] s × test:cron'],
  ] as const)('負例: %s', (_name, sample, observed, table, head) => {
    const problems = preCommitProblems(sample, observed, table);
    expect(problems.some((problem) => problem.startsWith(head)), problems.join('\n')).toBe(true);
  });
});

describe('掴む順の逆順の実 DB の試験の行(条件つきの n/a)', () => {
  it('手書きの RPC が無く n/a なら食い違い無し', () => {
    expect(preCommitProblems('s', PRE_OK, { s: { ...TABLE.s, [RB_KEY]: RB_NA } })).toEqual([]);
  });

  it('手書きの RPC が現れたのに n/a のままなら赤(逆順の試験が回っていない)', () => {
    const problems = preCommitProblems('s', { ...PRE_OK, handwritten: 1 }, { s: { ...TABLE.s, [RB_KEY]: RB_NA } });
    expect(problems.some((problem) => problem.startsWith(`[n/a の条件が崩れた] s × ${RB_KEY}`) && problem.includes('手書きの RPC 1 件')), problems.join('\n')).toBe(true);
  });

  it('手書きの RPC があり、回す行(n/a でない)なら食い違い無し', () => {
    expect(preCommitProblems('s', { ...PRE_OK, handwritten: 2 }, { s: { ...TABLE.s, [RB_KEY]: RB_RUN } })).toEqual([]);
  });

  it('手書きの RPC が 0 件なのに回す行なら赤(相手が無い)', () => {
    const problems = preCommitProblems('s', PRE_OK, { s: { ...TABLE.s, [RB_KEY]: RB_RUN } });
    expect(problems.some((problem) => problem.startsWith(`[相手の無い突合] s × ${RB_KEY}`)), problems.join('\n')).toBe(true);
  });
});

describe('生成しない行(na.ungenerated)の正例', () => {
  it('時刻起点のジョブが無く、生成もされていなければ食い違い無し(古い行にも、行の無い生成物にもならない)', () => {
    expect(preCommitProblems('s', PRE_OK, { s: { ...TABLE.s, 'test:cron': CRON_OFF } })).toEqual([]);
    expect(runProblems('s', 'wiring', RUN_OK, { s: { ...TABLE.s, 'test:cron': CRON_OFF } })).toEqual([]);
  });

  it('時刻起点のジョブが現れて生成され、行が回数つきなら食い違い無し', () => {
    const table = { s: { ...TABLE.s, 'test:cron': { ...OP, runs: 2 } } };
    expect(preCommitProblems('s', { ...PRE_OK, testKinds: ['bd', 'cron', 'op'], scheduled: 1 }, table)).toEqual([]);
  });
});

describe('runProblems', () => {
  it('正例: 表どおりなら食い違い無し(実 DB の段には照らす行が無い)', () => {
    expect(runProblems('s', 'wiring', RUN_OK, TABLE)).toEqual([]);
    expect(runProblems('s', 'db', { ...RUN_OK, kinds: new Map(), refusal: new Map() }, TABLE)).toEqual([]);
  });

  it('正例: ホストに無い部品は名指しが表と一致すれば通す', () => {
    const table = { s: { ...TABLE.s, 'test:op': { ...OP, runs: 0, absent: { modules: ['@/x'], reason: '手書きの口' } } } };
    expect(runProblems('s', 'wiring', { ...RUN_OK, kinds: new Map([['op', outcome(0, { missing: ['@/x'] })], ['bd', outcome(6)]]) }, table)).toEqual([]);
  });

  it.each([
    ['通った it の数の食い違い', { ...RUN_OK, kinds: new Map([['op', outcome(2)], ['bd', outcome(6)]]) }, TABLE, '[回数の食い違い] s × test:op'],
    ['落ちた it は赤', { ...RUN_OK, kinds: new Map([['op', outcome(3, { failed: 1 })], ['bd', outcome(6)]]) }, TABLE, '[落ちた試験] s × test:op'],
    ['it の無いファイル・解けない部品以外の読み込みの失敗は赤', { ...RUN_OK, kinds: new Map([['op', outcome(3, { broken: ['a.test.ts: No test found'] })], ['bd', outcome(6)]]) }, TABLE, '[読み込めない試験] s × test:op'],
    ['表が名指さない部品で読み込みが落ちた', { ...RUN_OK, kinds: new Map([['op', outcome(3, { missing: ['@/y'] })], ['bd', outcome(6)]]) }, TABLE, '[ホストに無い部品の食い違い] s × test:op'],
    ['関門を外しても赤にならない(拒否を観測しない)', { ...RUN_OK, refusal: new Map([['bd', 0]]) }, TABLE, '[拒否の観測の食い違い] s × test:bd'],
    ['段で実行した生成器に行が無い', { ...RUN_OK, kinds: new Map([['op', outcome(3)], ['bd', outcome(6)], ['new', outcome(1)]]) }, TABLE, '[行の無い生成物] s × test:new'],
    ['段の行の生成器が実行されなかった', { ...RUN_OK, kinds: new Map([['bd', outcome(6)]]) }, TABLE, '[古い行] s × test:op'],
    ['生成したのに 0 回(理由なし)', { ...RUN_OK, kinds: new Map([['op', outcome(0)], ['bd', outcome(6)]]) }, { s: { ...TABLE.s, 'test:op': { ...OP, runs: 0 } } }, '[0 回の行] s × test:op'],
    ['assertion の無い it が赤にならない(設定が requireAssertions を持たない)', { ...RUN_OK, assertionProbe: 0 }, TABLE, '[守りが効かない] s × guard:require-assertions'],
    ['assertion の無い it を実行していない', { ...RUN_OK, assertionProbe: undefined }, TABLE, '[守りを観測していない] s × guard:require-assertions'],
    ['守りの行の回数が 0', RUN_OK, { s: { ...TABLE.s, 'guard:require-assertions': { ...GUARD, runs: 0 } } }, '[守りの行が 0] s × guard:require-assertions'],
    ['拒否の観測を 0 で宣言した', RUN_OK, { s: { ...TABLE.s, 'test:bd': { ...BD, refusal: 0 } } }, '[拒否の観測が 0] s × test:bd'],
  ] as const)('負例: %s', (_name, observed, table, head) => {
    const problems = runProblems('s', 'wiring', observed, table);
    expect(problems.some((problem) => problem.startsWith(head)), problems.join('\n')).toBe(true);
  });
});

describe('kindOutcomes(vitest の JSON の報告を生成器ごとに数える)', () => {
  const report = JSON.stringify({
    testResults: [
      { name: '/t/app/a.test.ts', assertionResults: [{ status: 'passed' }, { status: 'passed' }, { status: 'failed' }] },
      { name: '/t/app/b.test.ts', message: "Cannot find module '../x' imported from /t/app/b.test.ts", assertionResults: [] },
      { name: '/t/app/c.test.ts', message: 'No test found in suite c.test.ts', assertionResults: [] },
      { name: '/t/app/other.test.ts', assertionResults: [{ status: 'passed' }] },
    ],
  });
  const kindOf = (file: string): string | null => (file.endsWith('other.test.ts') ? null : 'k');

  it('通った・落ちた it、解けない部品、そのほかの読み込みの失敗を分けて数え、数えないファイルは外す', () => {
    expect(kindOutcomes(report, kindOf).get('k')).toEqual({ passed: 2, failed: 1, missing: ['../x'], broken: ['c.test.ts: No test found in suite c.test.ts'] });
    expect([...kindOutcomes(report, kindOf).keys()]).toEqual(['k']);
  });
});

describe('表の形', () => {
  it('どの題材も名指しの行を持ち、拒否の観測は 1 以上・n/a と未対応は理由が空でない', () => {
    for (const [sample, rows] of Object.entries(SAMPLE_COVERAGE)) {
      expect(rows['verify:pre-app'], sample).toBeDefined();
      expect(rows['lint:eslint']?.pending?.trim(), sample).not.toBe('');
      expect(rows['guard:require-assertions']?.runs, sample).toBe(1);
      for (const [key, row] of Object.entries(rows)) {
        if (row.refusal !== undefined) expect(row.refusal, `${sample} × ${key}`).toBeGreaterThan(0);
        if (row.na !== undefined) expect(row.na.reason.trim(), `${sample} × ${key}`).not.toBe('');
        if (row.absent !== undefined) expect(row.absent.reason.trim(), `${sample} × ${key}`).not.toBe('');
      }
    }
  });
});
