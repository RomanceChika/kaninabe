/**
 * 5 回目の点検 C5-2 / C5-3 / C5-6 の回帰(deps:check の lockfile の許可表)。
 *
 * - C5-2: `npm-shrinkwrap.json` は同じ場所の `package-lock.json` より優先されるのに、検査は `package-lock.json` しか読まなかった。
 *   許すのは `package-lock.json` だけで、ほかの lockfile(shrinkwrap・yarn・pnpm・bun・deno)は置かれていること自体を赤にする。
 * - C5-3: `inBundle: true` を付けたエントリは検査の外だったが、`npm ci` は親が同梱していない `inBundle` を `resolved` から取る。
 *   外すのは「同梱を宣言した親の node_modules の下・resolved を持たない」ときだけ。
 * - C5-6: link の宣言照合が自己申告の `name` 欄で引いていた。キーのパスから導いた名前で引き、link の `name` 欄が違えば赤。
 */

import { describe, expect, it } from 'vitest';
import { FOREIGN_LOCKFILES, discoverForeignLockfiles, discoverLockfiles } from '../../../lib/deps/lockfile.js';
import { lockfilePinFindings } from '../../../lib/deps/lockfile-pins.js';
import { bundleProblem } from '../../../lib/deps/npm-lock-rules.js';
import type { LocalDeclarations } from '../../../lib/deps/lockfile-pins.js';
import { runDepsCheck } from '../../../lib/deps/run.js';
import { fakeIo, lockfile, registryUrl, SRI } from './helpers.js';

/** 親 `node_modules/p`(同梱の宣言は `bundle`)と、追加のエントリを持つ lockfile。 */
function lockWithParent(bundle: unknown, entries: Readonly<Record<string, Record<string, unknown>>>): string {
  const parent: Record<string, unknown> = { version: '1.0.0', resolved: registryUrl('p', '1.0.0'), integrity: SRI };
  if (bundle !== undefined) parent.bundleDependencies = bundle;
  return JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'r' }, 'node_modules/p': parent, ...entries } });
}

const ids = (text: string, local?: LocalDeclarations): string[] => lockfilePinFindings('l', text, local).map((f) => `${f.pkg}:${f.id}`);

describe('C5-3 / C6-1: inBundle は npm が同梱とみなす形・resolved も integrity も無いときだけ外す', () => {
  const bundled = { version: '1.0.0', inBundle: true };
  it.each([
    ['正しい同梱(親の配列にある名前)', ['b'], { 'node_modules/p/node_modules/b': bundled }, []],
    ['同梱物の依存(さらに入れ子。親の同梱を受け継ぐ)', ['b'], { 'node_modules/p/node_modules/b': bundled, 'node_modules/p/node_modules/b/node_modules/c': bundled }, []],
    ['C6-1 の反例: 親の宣言が true(npm は配列しか見ない)', true, { 'node_modules/p/node_modules/b': bundled }, ['b:lockfile-bundle', 'b:lockfile-unresolved', 'b:lockfile-integrity']],
    ['C6-1 の反例: 親の表に無い名前', ['only-this'], { 'node_modules/p/node_modules/evil': bundled }, ['evil:lockfile-bundle', 'evil:lockfile-unresolved', 'evil:lockfile-integrity']],
    ['C6-1 の反例: 版が範囲・タグ', ['b'], { 'node_modules/p/node_modules/b': { version: 'latest', inBundle: true } }, ['b:lockfile-bundle', 'b:lockfile-unresolved', 'b:lockfile-integrity']],
    ['同梱なのに integrity を持つ', ['b'], { 'node_modules/p/node_modules/b': { ...bundled, integrity: SRI } }, ['b:lockfile-bundle', 'b:lockfile-unresolved']],
    ['C5-3 の反例: トップレベルの inBundle + file:', ['b'], { 'node_modules/leftpadx': { version: '1.0.0', resolved: 'file:vendor/evil.tgz', integrity: SRI, inBundle: true } }, ['leftpadx:lockfile-bundle', 'leftpadx:lockfile-local-source']],
    ['C5-3 の反例: トップレベルの inBundle + 別ホスト', ['b'], { 'node_modules/leftpadx': { version: '1.0.0', resolved: 'https://evil.invalid/leftpadx-1.0.0.tgz', integrity: SRI, inBundle: true } }, ['leftpadx:lockfile-bundle', 'leftpadx:lockfile-source']],
    ['トップレベルの inBundle(resolved なし)', ['b'], { 'node_modules/x': bundled }, ['x:lockfile-bundle', 'x:lockfile-unresolved', 'x:lockfile-integrity']],
    ['親が同梱を宣言していない', undefined, { 'node_modules/p/node_modules/b': bundled }, ['b:lockfile-bundle', 'b:lockfile-unresolved', 'b:lockfile-integrity']],
    ['親の宣言が空の配列', [], { 'node_modules/p/node_modules/b': bundled }, ['b:lockfile-bundle', 'b:lockfile-unresolved', 'b:lockfile-integrity']],
    ['正しい置き場でも resolved を持てば赤(公式の URL でも)', ['b'], { 'node_modules/p/node_modules/b': { version: '1.0.0', resolved: registryUrl('b', '1.0.0'), integrity: SRI, inBundle: true } }, ['b:lockfile-bundle']],
    ['親が lockfile に無い(キーの形だけ親の下)', ['b'], { 'node_modules/q/node_modules/b': bundled }, ['b:lockfile-bundle', 'b:lockfile-unresolved', 'b:lockfile-integrity']],
  ])('%s', (_name, bundle, entries, expected) => {
    expect(ids(lockWithParent(bundle, entries))).toEqual(expected);
  });

  it('祖先は node_modules の下のエントリだけ(workspace の置き場の宣言では外さない)', () => {
    const text = JSON.stringify({
      lockfileVersion: 3,
      packages: { '': { name: 'r' }, w: { name: 'w', bundleDependencies: ['b'] }, 'w/node_modules/b': { version: '1.0.0', inBundle: true } },
    });
    expect(ids(text)).toEqual(['b:lockfile-bundle', 'b:lockfile-unresolved', 'b:lockfile-integrity']);
  });

  it('bundleProblem の境界: resolved が空文字でも持つものとして赤', () => {
    const packages = (entry: Record<string, unknown>) => ({ 'node_modules/p': { bundleDependencies: ['b'] }, 'node_modules/p/node_modules/b': entry });
    expect(bundleProblem(packages({ version: '1.0.0', inBundle: true, resolved: '' }), 'node_modules/p/node_modules/b')).toContain('resolved');
    expect(bundleProblem(packages({ version: '1.0.0', inBundle: true }), 'node_modules/p/node_modules/b')).toBeNull();
  });
});

describe('C5-6: link の宣言照合はキーの名前で引く', () => {
  const LOCAL: LocalDeclarations = { targets: new Map([['framework/adapters/log-axiom', new Set(['@kaninabe/adapter-log-axiom'])], ['vendor/ok.tgz', new Set(['ok'])]]) };
  const at = (key: string, entry: Record<string, unknown>): string[] =>
    ids(JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'r' }, [key]: { version: '1.0.0', ...entry } } }), LOCAL);

  it.each([
    ['正しいリンク(name 欄なし)', 'node_modules/@kaninabe/adapter-log-axiom', { resolved: 'framework/adapters/log-axiom', link: true }, []],
    ['正しいリンク(name 欄がキーと同じ)', 'node_modules/@kaninabe/adapter-log-axiom', { resolved: 'framework/adapters/log-axiom', link: true, name: '@kaninabe/adapter-log-axiom' }, []],
    ['C5-6 の反例: zod を name 欄で workspace に見せる', 'node_modules/zod', { resolved: 'framework/adapters/log-axiom', link: true, name: '@kaninabe/adapter-log-axiom' }, ['zod:lockfile-link']],
    ['name 欄だけがキーと違う(置き場の宣言とキーは一致)', 'node_modules/@kaninabe/adapter-log-axiom', { resolved: 'framework/adapters/log-axiom', link: true, name: 'zod' }, ['@kaninabe/adapter-log-axiom:lockfile-link']],
    ['file: の取得元もキーの名前で引く(name 欄で別の宣言に見せない)', 'node_modules/zod', { resolved: 'file:vendor/ok.tgz', integrity: SRI, name: 'ok' }, ['zod:lockfile-local-source']],
    ['file: の取得元(キーの名前が宣言どおり・name 欄は別名)', 'node_modules/ok', { resolved: 'file:vendor/ok.tgz', integrity: SRI, name: 'real-ok' }, []],
  ])('%s', (_name, key, entry, expected) => {
    expect(at(key, entry)).toEqual(expected);
  });
});

describe('C5-2: package-lock.json 以外の lockfile は置かれていること自体を赤', () => {
  const discover = (files: Readonly<Record<string, string>>): { foreign: string[]; allowed: string[] } => {
    const io = fakeIo({ files });
    const fs = { list: io.list, isDirectory: io.isDirectory, isFile: (rel: string) => io.readText(rel) !== null };
    return { foreign: discoverForeignLockfiles(fs), allowed: discoverLockfiles(fs) };
  };

  it.each([...FOREIGN_LOCKFILES].map((name) => [name]))('%s を根でも入れ子でも見つける(package.json の有無は問わない)', (name) => {
    const found = discover({ [name]: '{}', [`nest/x/${name}`]: '{}', 'package.json': '{}', 'package-lock.json': '{}' });
    expect([...found.foreign].sort()).toEqual([name, `nest/x/${name}`].sort());
    expect(found.allowed).toEqual(['package-lock.json']);
  });

  it('依存の置き場(node_modules)の下は歩かない・深さの上限を守る', () => {
    expect(discover({ 'node_modules/a/npm-shrinkwrap.json': '{}', 'a/b/c/d/e/pnpm-lock.yaml': '', 'a/b/c/d/bun.lock': '' }).foreign).toEqual(['a/b/c/d/bun.lock']);
  });

  it.each(['NPM-SHRINKWRAP.json', 'Npm-Shrinkwrap.JSON', 'Yarn.lock', 'DENO.LOCK'])('C6-7: 大文字を混ぜた綴り %s も見つける(大文字小文字を区別しない FS では npm がそれを開く)', (name) => {
    expect(discover({ [`a/${name}`]: '{}' }).foreign).toEqual([`a/${name}`]);
  });

  it('似た名前(npm-shrinkwrap.json.bak・package-lock.json)は数えない', () => {
    expect(discover({ 'npm-shrinkwrap.json.bak': '', 'yarn.lock.txt': '', 'package-lock.json': '{}' }).foreign).toEqual([]);
  });

  it('runDepsCheck: C5-2 の反例(shrinkwrap が file: を指す)は、package-lock.json が正しくても赤', async () => {
    const io = fakeIo({
      files: {
        'package.json': '{"name":"r"}',
        'package-lock.json': lockfile([{ key: 'node_modules/leftpadx', version: '1.0.0' }]),
        'npm-shrinkwrap.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/leftpadx': { version: '1.0.0', resolved: 'file:vendor/evil.tgz', integrity: SRI } } }),
      },
    });
    const report = await runDepsCheck(io, '/r');
    const foreign = report.findings.filter((f) => f.id === 'lockfile-foreign');
    expect(foreign.map((f) => [f.lockfile, f.level])).toEqual([['npm-shrinkwrap.json', 'red']]);
    expect(report.ok).toBe(false);
  });
});
