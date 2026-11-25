/**
 * 設定の project_id が使い捨ての stack の道具の期待どおりかの照らし(`@kaninabe/runtime/testing/local/expected-project.mts`。点検 20 回目 C20-1)。
 *
 * 道具が設定を共用に戻した後も命令が走り続けると、次の `db reset` が共用の stack を作り直す。照らしは DB を作り直す・変える CLI の前で
 * 止める二の線である。ここは照らしそのもの(表)と、題材の通し実行の `db reset`(resetWithWorkdir)が期待と違う設定では CLI を回さないことを見る。
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXPECT_PROJECT_ENV, projectIdOf, refuseUnexpectedProject, unexpectedProject } from '@kaninabe/runtime/testing/local/expected-project';
import { resetWithWorkdir } from '../../../../../lib/targets/supabase/samples/db-reset.js';

describe('project_id を読む', () => {
  it.each([
    ['1 本', 'project_id = "mc-a"\n[api]\nport = 1', 'mc-a'],
    ['注釈つき', 'project_id = "mc-a" # x', 'mc-a'],
    ['空白なし', 'project_id="mc-a"', 'mc-a'],
    ['無い', '[api]\nport = 1', null],
    ['2 本', 'project_id = "a"\nproject_id = "b"', null],
    ['字下げ(表の中の別の欄)', '  project_id = "a"', null],
    ['タブの区切り(点検 22 回目 O22-5)', 'project_id\t=\t"mc-a"', 'mc-a'],
  ])('%s', (_name, text, expected) => {
    expect(projectIdOf(text)).toBe(expected);
  });
});

describe('期待との照らし', () => {
  it('環境変数の名前は道具と同じ(既定の期待はそこから読む)', () => {
    expect(EXPECT_PROJECT_ENV).toBe('ST_EXPECT_PROJECT_ID');
  });

  it('期待が無い・空なら見ない(共用の stack で回す普通の実行)', () => {
    expect(unexpectedProject('project_id = "system-template"', undefined)).toBeNull();
    expect(unexpectedProject('project_id = "system-template"', '')).toBeNull();
  });

  it('期待と同じなら null', () => {
    expect(unexpectedProject('project_id = "mc-x"', 'mc-x')).toBeNull();
  });

  it.each([
    ['共用に戻っている', 'project_id = "system-template"', 'system-template'],
    ['別の使い捨て', 'project_id = "mc-y"', 'mc-y'],
    ['読めない', '', '読めない'],
  ])('%s なら止める 1 行(読めた値と期待を名指す)', (_name, text, shown) => {
    const line = unexpectedProject(text, 'mc-x');
    expect(line).toContain(`(${shown})`);
    expect(line).toContain(`${EXPECT_PROJECT_ENV}=mc-x`);
  });
});

describe('作業場所の設定で照らす(CLI の決まりの <root>/supabase/config.toml)', () => {
  let root = '';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'expected-project-'));
    mkdirSync(join(root, 'supabase'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('期待どおりなら通し、違えば・無ければ投げ、期待が無ければ読みもしない', () => {
    writeFileSync(join(root, 'supabase', 'config.toml'), 'project_id = "mc-x"\n');
    expect(() => refuseUnexpectedProject(root, 'mc-x')).not.toThrow();
    writeFileSync(join(root, 'supabase', 'config.toml'), 'project_id = "system-template"\n');
    expect(() => refuseUnexpectedProject(root, 'mc-x')).toThrow(/system-template/);
    expect(() => refuseUnexpectedProject(join(root, 'none'), 'mc-x')).toThrow(/読めない/);
    expect(() => refuseUnexpectedProject(join(root, 'none'), undefined)).not.toThrow();
  });
});

describe('題材の通し実行の db reset は、設定が期待と違えば CLI を回さずに赤', () => {
  let workdir = '';
  let bin = '';
  let inheritedPath: string | undefined;
  let inheritedExpect: string | undefined;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'expected-project-wd-'));
    bin = mkdtempSync(join(tmpdir(), 'expected-project-bin-'));
    mkdirSync(join(workdir, 'supabase'));
    // 偽の supabase: 呼ばれたら印のファイルを書いて赤で終わる(待ち合わせに進まない)。
    writeFileSync(join(bin, 'supabase'), `#!/bin/sh\ntouch ${JSON.stringify(join(bin, 'called'))}\nexit 1\n`, { mode: 0o755 });
    inheritedPath = process.env['PATH'];
    inheritedExpect = process.env[EXPECT_PROJECT_ENV];
    process.env['PATH'] = [bin, '/usr/bin', '/bin'].join(delimiter);
  });
  afterEach(() => {
    if (inheritedPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = inheritedPath;
    if (inheritedExpect === undefined) delete process.env[EXPECT_PROJECT_ENV];
    else process.env[EXPECT_PROJECT_ENV] = inheritedExpect;
    rmSync(workdir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });
  const stack = { apiUrl: 'http://127.0.0.1:9', anonKey: 'a', serviceRoleKey: 's', databaseUrl: 'd' };

  it('写した設定が共用に戻っていれば、supabase を呼ばずに ok: false と理由', async () => {
    writeFileSync(join(workdir, 'supabase', 'config.toml'), 'project_id = "system-template"\n');
    process.env[EXPECT_PROJECT_ENV] = 'mc-x';

    const result = await resetWithWorkdir(workdir, stack, workdir);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('system-template');
    expect(existsSync(join(bin, 'called'))).toBe(false);
  });

  it('期待どおりなら supabase を呼ぶ(偽物は赤で終わる)', async () => {
    writeFileSync(join(workdir, 'supabase', 'config.toml'), 'project_id = "mc-x"\n');
    process.env[EXPECT_PROJECT_ENV] = 'mc-x';

    const result = await resetWithWorkdir(workdir, stack, workdir);

    expect(result.ok).toBe(false);
    expect(existsSync(join(bin, 'called'))).toBe(true);
  });
});
