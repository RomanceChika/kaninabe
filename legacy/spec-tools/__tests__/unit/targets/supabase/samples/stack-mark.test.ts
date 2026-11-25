/**
 * 実 DB の足場が名指しの無い stack に触れない既定(`@kaninabe/runtime/testing/local/stack-mark.mts`。安全の束 safety1 (a))。
 *
 * 印(`ST_EXPECT_PROJECT_ID`)も GitHub がホストする runner の印も無ければ、CLI を 1 つも回さずに赤。ここは判定の表と、足場の 3 つの口
 * (起動の `ensureLocalSupabase`・migration の `applyMigrations`・題材の通し実行の `resetWithWorkdir`)が印なしでは偽の supabase を呼ばないこと、
 * 印ありでは今までどおり呼ぶことを見る(負例と正例)。
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbLock } from '@kaninabe/runtime/testing/local/db-lock';
import { applyMigrations, ensureLocalSupabase } from '@kaninabe/runtime/testing/local/local-supabase';
import { onHostedRunner, requireStackMark, stackMarkEnv, stackMarkRefusal, type StackMarkEnv } from '@kaninabe/runtime/testing/local/stack-mark';
import { resetWithWorkdir } from '../../../../../lib/targets/supabase/samples/db-reset.js';

/** 印の 3 つ(既定は全部無し)。 */
function env(overrides: Partial<StackMarkEnv> = {}): StackMarkEnv {
  return { expected: undefined, githubActions: undefined, runnerEnvironment: undefined, ...overrides };
}

describe('名指しか使い捨ての runner が無ければ止める(判定の表)', () => {
  it.each<[string, StackMarkEnv, boolean]>([
    ['何も無い(手元の素の実行)', env(), false],
    ['名指しが空', env({ expected: '' }), false],
    ['名指しがある(値の照らしは別)', env({ expected: 'mc-x' }), true],
    ['人が共用を名指す', env({ expected: 'system-template' }), true],
    ['GitHub がホストする runner', env({ githubActions: 'true', runnerEnvironment: 'github-hosted' }), true],
    ['自前の runner(手元の機械でありうる)', env({ githubActions: 'true', runnerEnvironment: 'self-hosted' }), false],
    ['GITHUB_ACTIONS だけ', env({ githubActions: 'true' }), false],
    ['RUNNER_ENVIRONMENT だけ', env({ runnerEnvironment: 'github-hosted' }), false],
    ['GITHUB_ACTIONS の綴りが違う', env({ githubActions: 'True', runnerEnvironment: 'github-hosted' }), false],
  ])('%s', (_name, given, allowed) => {
    const refusal = stackMarkRefusal(given);
    if (allowed) expect(refusal).toBeNull();
    else expect(refusal).toContain('ST_EXPECT_PROJECT_ID');
    expect(onHostedRunner(given)).toBe(given.githubActions === 'true' && given.runnerEnvironment === 'github-hosted');
  });

  it('止める 1 行は、使い捨ての道具と人の入口(自分で名指す)の 2 つを言う', () => {
    const line = stackMarkRefusal(env()) ?? '';
    expect(line).toContain('使い捨ての stack の道具');
    expect(line).toContain('人が共用の stack で回すときだけ');
  });
});

describe('印の環境と、作業場所の設定との照らし', () => {
  const names = ['ST_EXPECT_PROJECT_ID', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT'] as const;
  let saved: Record<string, string | undefined> = {};
  let root = '';
  beforeEach(() => {
    saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    root = mkdtempSync(join(tmpdir(), 'stack-mark-'));
    mkdirSync(join(root, 'supabase'));
  });
  afterEach(() => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('今のプロセスの環境から 3 つを読む', () => {
    process.env['ST_EXPECT_PROJECT_ID'] = 'mc-a';
    process.env['GITHUB_ACTIONS'] = 'true';
    process.env['RUNNER_ENVIRONMENT'] = 'github-hosted';
    expect(stackMarkEnv()).toEqual({ expected: 'mc-a', githubActions: 'true', runnerEnvironment: 'github-hosted' });
  });

  it('印が無ければ設定を読む前に投げる(設定が無くても同じ文言)', () => {
    expect(() => requireStackMark(join(root, 'none'), env())).toThrow(/名指し/);
  });

  it('名指しが設定と同じなら通し、違えば・読めなければ投げる', () => {
    writeFileSync(join(root, 'supabase', 'config.toml'), 'project_id = "mc-x"\n');
    expect(() => requireStackMark(root, env({ expected: 'mc-x' }))).not.toThrow();
    expect(() => requireStackMark(root, env({ expected: 'system-template' }))).toThrow(/mc-x/);
    expect(() => requireStackMark(join(root, 'none'), env({ expected: 'mc-x' }))).toThrow(/読めない/);
  });

  it('使い捨ての runner は名指しが無くても通す。名指しがあれば runner でも照らす', () => {
    const runner = { githubActions: 'true', runnerEnvironment: 'github-hosted' };
    expect(() => requireStackMark(join(root, 'none'), env(runner))).not.toThrow();
    writeFileSync(join(root, 'supabase', 'config.toml'), 'project_id = "system-template"\n');
    expect(() => requireStackMark(root, env({ ...runner, expected: 'mc-x' }))).toThrow(/system-template/);
  });
});

describe('足場の 3 つの口は、印なしでは supabase を 1 度も呼ばない(負例)・印ありでは呼ぶ(正例)', () => {
  const names = ['PATH', 'ST_EXPECT_PROJECT_ID', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT'] as const;
  let saved: Record<string, string | undefined> = {};
  let workdir = '';
  let bin = '';
  const called = (): boolean => existsSync(join(bin, 'called'));
  beforeEach(() => {
    saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    workdir = mkdtempSync(join(tmpdir(), 'stack-mark-wd-'));
    bin = mkdtempSync(join(tmpdir(), 'stack-mark-bin-'));
    mkdirSync(join(workdir, 'supabase'));
    writeFileSync(join(workdir, 'supabase', 'config.toml'), 'project_id = "system-template"\n');
    // 偽の supabase: 呼ばれたら印のファイルを書いて赤で終わる(起動も作り直しもしない)。
    writeFileSync(join(bin, 'supabase'), `#!/bin/sh\ntouch ${JSON.stringify(join(bin, 'called'))}\nexit 1\n`, { mode: 0o755 });
    process.env['PATH'] = [bin, '/usr/bin', '/bin'].join(delimiter);
    for (const name of ['ST_EXPECT_PROJECT_ID', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT']) delete process.env[name];
  });
  afterEach(() => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(workdir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });
  const stack = { apiUrl: 'http://127.0.0.1:9', anonKey: 'a', serviceRoleKey: 's', databaseUrl: 'd' };
  const lock = { databaseUrl: 'd' } as unknown as DbLock;

  it('起動(ensureLocalSupabase): 印なしは状態も読まずに投げる', () => {
    expect(() => ensureLocalSupabase(workdir)).toThrow(/名指し/);
    expect(called()).toBe(false);
  });

  it('migration(applyMigrations): 印なしは投げる', () => {
    expect(() => applyMigrations(lock, workdir)).toThrow(/名指し/);
    expect(called()).toBe(false);
  });

  it('題材の通し実行(resetWithWorkdir): 印なしは ok: false と理由で、作り直さない', async () => {
    const result = await resetWithWorkdir(workdir, stack, workdir);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('名指し');
    expect(called()).toBe(false);
  });

  it('印あり(人が共用を名指す)なら、3 つとも今までどおり supabase を呼ぶ', async () => {
    process.env['ST_EXPECT_PROJECT_ID'] = 'system-template';
    expect(() => ensureLocalSupabase(workdir)).toThrow(/supabase/);
    expect(called()).toBe(true);
    rmSync(join(bin, 'called'));
    expect(() => applyMigrations(lock, workdir)).toThrow(/migration の適用に失敗/);
    expect(called()).toBe(true);
    rmSync(join(bin, 'called'));
    expect((await resetWithWorkdir(workdir, stack, workdir)).ok).toBe(false);
    expect(called()).toBe(true);
  });
});
