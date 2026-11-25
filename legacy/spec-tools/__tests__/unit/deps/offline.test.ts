/**
 * lockfile の通信の要らない検査(`deps:check:offline`。6 回目 C6-3)のテスト。
 *
 * (1) 本体 `runDepsOffline` の表(許さない lockfile・配信元と固定・同梱・形の赤と、通る形)、(2) **依存を入れる前に走る**ことの確認として、
 * CLI を tsx ではなく素の `node`(`--import ./cli/ts-js-resolve.mjs`)で一時の根に対して起動し、終了コードと出力を見る。
 */

import { spawnSync } from 'node:child_process';
import { withoutGitEnv } from '../../helpers/git-env.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatDepsOffline, runDepsOffline } from '../../../lib/deps/offline.js';
import { fakeIo, lockfile, registryUrl, SRI } from './helpers.js';

const TOOL_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('runDepsOffline(通信しない部分だけ)', () => {
  const good = lockfile([{ key: 'node_modules/a', version: '1.0.0' }]);
  const run = (files: Readonly<Record<string, string>>) => runDepsOffline(fakeIo({ files }));

  it.each([
    ['正しい lockfile だけ', { 'package.json': '{"name":"r"}', 'package-lock.json': good }, []],
    ['許さない lockfile(大文字を混ぜた綴りも)', { 'package.json': '{"name":"r"}', 'package-lock.json': good, 'x/NPM-Shrinkwrap.json': '{}' }, ['x/NPM-Shrinkwrap.json:lockfile-foreign']],
    ['.npmrc(12 回目 C12-8)', { 'package.json': '{"name":"r"}', 'package-lock.json': good, '.npmrc': 'script-shell=./x.sh\n' }, ['.npmrc:lockfile-foreign']],
    ['下の木の .npmrc', { 'package.json': '{"name":"r"}', 'package-lock.json': good, 'x/.npmrc': 'registry=https://example.test/\n' }, ['x/.npmrc:lockfile-foreign']],
    ['別のホスト', { 'package.json': '{}', 'package-lock.json': lockfile([{ key: 'node_modules/a', version: '1.0.0', resolved: 'https://evil.invalid/a-1.0.0.tgz' }]) }, ['package-lock.json:lockfile-source']],
    ['integrity が無い', { 'package.json': '{}', 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/a': { version: '1.0.0', resolved: registryUrl('a', '1.0.0') } } }) }, ['package-lock.json:lockfile-integrity']],
    ['C6-1 の形(親の表に無い同梱)', { 'package.json': '{}', 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/p': { version: '1.0.0', resolved: registryUrl('p', '1.0.0'), integrity: SRI, bundleDependencies: ['only'] }, 'node_modules/p/node_modules/evil': { version: '1.0.0', inBundle: true } } }) }, ['package-lock.json:lockfile-bundle', 'package-lock.json:lockfile-unresolved', 'package-lock.json:lockfile-integrity']],
    ['JSON でない', { 'package.json': '{}', 'package-lock.json': 'x' }, ['package-lock.json:lockfile-shape']],
    ['宣言の無いリンク', { 'package.json': '{}', 'package-lock.json': lockfile([{ key: 'node_modules/a', version: '1.0.0', resolved: 'vendor/a', link: true }]) }, ['package-lock.json:lockfile-link']],
  ] as const)('%s', (_name, files, expected) => {
    const report = run(files);
    expect(report.findings.map((finding) => `${finding.lockfile}:${finding.id}`)).toEqual(expected);
    expect(report.ok).toBe(expected.length === 0);
  });

  it('入れ子の lockfile も見る(発見は deps:check と同じ)', () => {
    const report = run({ 'package.json': '{}', 'package-lock.json': good, 'docs/package.json': '{}', 'docs/package-lock.json': 'x' });
    expect(report.lockfiles).toEqual(['package-lock.json', 'docs/package-lock.json']);
    expect(report.findings.map((finding) => finding.lockfile)).toEqual(['docs/package-lock.json']);
  });

  it('出力の最後の行は本数と赤の件数', () => {
    expect(formatDepsOffline(run({ 'package.json': '{}', 'package-lock.json': good })).at(-1)).toContain('赤 0 件');
    const lines = formatDepsOffline(run({ 'package.json': '{}', 'package-lock.json': good, 'yarn.lock': '' }));
    expect(lines[0]).toContain('yarn.lock');
    expect(lines.at(-1)).toContain('赤 1 件');
  });
});

describe('CLI は素の node で走る(依存を入れる前に回せる)', () => {
  let root = '';
  beforeAll(() => {
    mkdirSync(path.join(TOOL_ROOT, 'tmp'), { recursive: true });
    root = mkdtempSync(path.join(TOOL_ROOT, 'tmp', 'deps-offline-'));
    writeFileSync(path.join(root, 'product.md'), '---\nroots: {}\n---\n');
    writeFileSync(path.join(root, 'package.json'), '{"name":"r"}');
    writeFileSync(path.join(root, 'package-lock.json'), lockfile([{ key: 'node_modules/a', version: '1.0.0' }]));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const cli = (): ReturnType<typeof spawnSync> =>
    spawnSync(process.execPath, ['--import', './cli/ts-js-resolve.mjs', 'cli/deps-check-offline.ts', '--root', root], { cwd: TOOL_ROOT, encoding: 'utf8', env: { ...withoutGitEnv(), INIT_CWD: '' } });

  it('正しい lockfile なら 0 で終わる', () => {
    const result = cli();
    expect(result.stdout).toContain('赤 0 件');
    expect(result.status).toBe(0);
  });

  it('許さない lockfile があれば 1 で終わり、名指す', () => {
    writeFileSync(path.join(root, 'Npm-Shrinkwrap.json'), '{}');
    const result = cli();
    expect(result.stdout).toContain('Npm-Shrinkwrap.json');
    expect(result.status).toBe(1);
    rmSync(path.join(root, 'Npm-Shrinkwrap.json'));
  });

  it('.npmrc があれば 1 で終わり、名指す(本物の一覧はドットの名前を返さない。12 回目 C12-8)', () => {
    writeFileSync(path.join(root, '.npmrc'), 'script-shell=./x.sh\n');
    const result = cli();
    expect(result.stdout).toContain('.npmrc');
    expect(result.status).toBe(1);
  });
});
