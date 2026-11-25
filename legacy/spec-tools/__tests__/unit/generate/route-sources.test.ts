/**
 * Route Handler の生テキストを読む(`generate/route-sources.ts`)のテスト。
 *
 * 母集合は「カタログの `endpoint` を持つ行」で、読めるのは実在したものだけ(実在しない口は載せない —— J2 が指摘する)。
 * 一時ディレクトリにリポジトリの形を作って、実ファイルを読む口まで通す。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRouteSources } from '../../../lib/generate/route-sources.js';
import { jobModel, notScheduledJob, outboxJob, scheduledJob } from '../../helpers/job-builder.js';
import { authEntry, authLogout, authModel } from '../../helpers/auth-builder.js';
import { layoutPath } from '../../../lib/model/product/layout.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../helpers/platform.js';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 一時ディレクトリに木を作る(パス → 本文)。 */
function repo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'route-sources-'));
  created.push(root);
  for (const [relative, text] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }
  return root;
}

describe('readRouteSources', () => {
  const CATALOG = jobModel([
    outboxJob('notify_organizer_new_entry'),
    scheduledJob('run_due_jobs', { endpoint: '/api/jobs/run' }),
    scheduledJob('close_due_workshops', { endpoint: '/api/deadlines/run' }),
    scheduledJob('same_route_again', { endpoint: '/api/jobs/run' }),
    notScheduledJob('not_wired_yet', 'まだ結線していない'),
  ]);

  it('起動口を持つ行の Route Handler のうち、実在するものだけをリポジトリルート相対で読む', () => {
    const root = repo({ 'app/src/app/api/jobs/run/route.ts': 'export const GET = 1;\n' });

    const sources = readRouteSources(root, TEST_ROOTS, TEST_LAYOUT, CATALOG);

    expect([...sources.entries()]).toEqual([['app/src/app/api/jobs/run/route.ts', 'export const GET = 1;\n']]);
  });

  it('配置を差し替えると、その配置の起動口の位置を読む(Next.js の位置は読まない)', () => {
    const root = repo({
      'app/server_code/endpoints/api/jobs/run.handler.ts': 'export const GET = 2;\n',
      'app/src/app/api/jobs/run/route.ts': 'export const GET = 1;\n',
    });

    const sources = readRouteSources(root, TEST_ROOTS, FOREIGN_LAYOUT, CATALOG);

    expect([...sources.entries()]).toEqual([['app/server_code/endpoints/api/jobs/run.handler.ts', 'export const GET = 2;\n']]);
  });

  it('認証フロー仕様の開始・ログアウトの口も読む(cookie で認証する手書きの口。見張りテストが本文の import を代役に差し替える)', () => {
    const start = layoutPath(TEST_LAYOUT, TEST_ROOTS.app, 'http-entry', '/api/auth/sign-in') ?? '';
    const logout = layoutPath(TEST_LAYOUT, TEST_ROOTS.app, 'http-entry', '/api/auth/logout') ?? '';
    const root = repo({ [start]: 'export const POST = 1;\n', [logout]: 'export const POST = 2;\n' });

    const sources = readRouteSources(root, TEST_ROOTS, TEST_LAYOUT, undefined, undefined, authModel({ start: authEntry('start'), logout: authLogout() }));

    expect([...sources.keys()].sort()).toEqual([logout, start].sort());
    expect(readRouteSources(root, TEST_ROOTS, TEST_LAYOUT, undefined, undefined, authModel()).size).toBe(0);
  });

  it('配置が起動口の役割を宣言していなければ何も読まない', () => {
    const root = repo({ 'app/src/app/api/jobs/run/route.ts': 'export const GET = 1;\n' });

    expect(readRouteSources(root, TEST_ROOTS, {}, CATALOG).size).toBe(0);
  });

  it('カタログが無ければ空', () => {
    expect(readRouteSources(repo({}), TEST_ROOTS, TEST_LAYOUT, undefined).size).toBe(0);
    expect(readRouteSources(repo({}), TEST_ROOTS, TEST_LAYOUT, { available: false, catalog: null }).size).toBe(0);
  });

  it('実装の木を持たない製品では何も読まない', () => {
    const root = repo({ 'app/src/app/api/jobs/run/route.ts': 'export const GET = 1;\n' });

    expect(readRouteSources(root, { ...TEST_ROOTS, app: null }, TEST_LAYOUT, CATALOG).size).toBe(0);
  });
});
