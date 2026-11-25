/**
 * PATH の濾し(`lib/io/safe-path.ts`)が、外部コマンドを名前で引く口に効いていること(7 回目 C7-6)。
 * deps:check の本物の口(`cli/deps-check-io.ts` の `exec` = `npm audit` / `npm audit signatures` / `npm sbom`)と、
 * 題材の実 DB の `supabase`(`readLocalStack` / `resetWithWorkdir`)で、PATH の先頭の根の中・`node_modules/.bin` の偽物が動かず、
 * 根の外のものが動く。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { realDepsIo } from '../../../cli/deps-check-io.js';
import { readLocalStack, resetWithWorkdir } from '../../../lib/targets/supabase/samples/db-reset.js';

describe('外部コマンドの名前は根の外から引く(C7-6)', () => {
  let root = '';
  let outside = '';
  let inherited: string | undefined;
  let inheritedExpect: string | undefined;

  /** 決まった出力と終了コードの偽のコマンド。 */
  const fake = (dir: string, name: string, stdout: string, code = 0): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), `#!/bin/sh\necho ${JSON.stringify(stdout)}\necho ${JSON.stringify(stdout)} >&2\nexit ${String(code)}\n`, { mode: 0o755 });
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'safe-callers-root-'));
    outside = mkdtempSync(join(tmpdir(), 'safe-callers-outside-'));
    inherited = process.env['PATH'];
    inheritedExpect = process.env['ST_EXPECT_PROJECT_ID'];
  });
  afterEach(() => {
    if (inherited === undefined) delete process.env['PATH'];
    else process.env['PATH'] = inherited;
    if (inheritedExpect === undefined) delete process.env['ST_EXPECT_PROJECT_ID'];
    else process.env['ST_EXPECT_PROJECT_ID'] = inheritedExpect;
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  /** PATH の先頭に偽物の置き場(依存の .bin・根の中の bin)、その後ろに根の外の本物の代わり。 */
  const plant = (name: string, fakeOut: string, realOut: string, code = 0): void => {
    fake(join(root, 'framework', 'spec-tools', 'node_modules', '.bin'), name, fakeOut, code);
    fake(join(root, 'bin'), name, fakeOut, code);
    fake(join(outside, 'bin'), name, realOut, code);
    process.env['PATH'] = [join(root, 'framework', 'spec-tools', 'node_modules', '.bin'), join(root, 'bin'), join(outside, 'bin'), '/usr/bin', '/bin'].join(delimiter);
  };

  it('deps:check の exec(npm)', async () => {
    plant('npm', 'FAKE', 'REAL');
    const out = await realDepsIo(root).exec('npm', ['audit', '--json'], root);
    expect(out.stdout.trim()).toBe('REAL');
    expect(out.code).toBe(0);
  });

  it('題材の実 DB の supabase status(readLocalStack)', () => {
    const status = (url: string): string => JSON.stringify({ API_URL: url, ANON_KEY: 'a', SERVICE_ROLE_KEY: 's', DB_URL: 'd' });
    plant('supabase', status('http://fake'), status('http://real'));
    expect(readLocalStack(root)?.apiUrl).toBe('http://real');
  });

  /** db reset の前の照らし(stack-mark。safety1)を通す名指しと、名指しと同じ設定を置く。 */
  const named = (dir: string): void => {
    mkdirSync(join(dir, 'supabase'), { recursive: true });
    writeFileSync(join(dir, 'supabase', 'config.toml'), 'project_id = "mc-callers"\n');
    process.env['ST_EXPECT_PROJECT_ID'] = 'mc-callers';
  };

  it('題材の実 DB の supabase db reset(resetWithWorkdir。落ちる偽物の出力で、どちらが動いたかを見る)', async () => {
    plant('supabase', 'FAKE', 'REAL', 1);
    named(root);
    const result = await resetWithWorkdir(root, { apiUrl: 'http://127.0.0.1:9', anonKey: 'a', serviceRoleKey: 's', databaseUrl: 'd' }, root);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('REAL');
    expect(result.output).not.toContain('FAKE');
  });

  it('一時ツリーで回しても、リポジトリの根の中の偽物は動かない(8 回目 C8-6: 根は一時ツリーとリポジトリの両方)', async () => {
    plant('supabase', 'FAKE', 'REAL', 1);
    const workdir = mkdtempSync(join(tmpdir(), 'safe-callers-workdir-'));
    named(workdir);
    try {
      const result = await resetWithWorkdir(workdir, { apiUrl: 'http://127.0.0.1:9', anonKey: 'a', serviceRoleKey: 's', databaseUrl: 'd' }, root);
      expect(result.output).toContain('REAL');
      expect(result.output).not.toContain('FAKE');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
