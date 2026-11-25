/**
 * lockfile の手元の置き場の宣言(`lib/deps/lockfile-local.ts`。4 回目 C4-4)と、`runDepsCheck` への配線(点検の反例をそのまま当てる)。
 * 通信は偽の口(ネットワークに出ない)。
 */

import { describe, expect, it } from 'vitest';
import { declaredLocalTargets } from '../../../lib/deps/lockfile-local.js';
import { runDepsCheck } from '../../../lib/deps/run.js';
import { auditJson, fakeIo, lockfile, registryUrl, SRI } from './helpers.js';
import type { FakeSpec } from './helpers.js';

/** 偽の口の上で宣言を集め、置き場 → 名前の並びにする。 */
function targetsOf(files: Readonly<Record<string, string>>, lock = 'package-lock.json'): Record<string, string[]> {
  const local = declaredLocalTargets(fakeIo({ files }), lock);
  return Object.fromEntries([...local.targets].map(([target, names]) => [target, [...names].sort()]));
}

describe('declaredLocalTargets', () => {
  it('根の workspaces(そこの package.json の name)と、根・各 workspace の file: 依存を集める', () => {
    const files = {
      'package.json': JSON.stringify({ workspaces: ['framework/runtime', 'app'], devDependencies: { tool: 'file:./vendor/tool.tgz' } }),
      'framework/runtime/package.json': JSON.stringify({ name: '@kaninabe/runtime' }),
      'app/package.json': JSON.stringify({ name: 'app', dependencies: { '@kaninabe/runtime': 'file:../framework/runtime', zod: '^4' } }),
    };
    expect(targetsOf(files)).toEqual({ 'vendor/tool.tgz': ['tool'], 'framework/runtime': ['@kaninabe/runtime'], app: ['app'] });
  });

  it('入れ子の lockfile(独立の道具の木)は、その場所からの相対(../ を含む)で集める', () => {
    const files = { 'legacy/spec-tools/package.json': JSON.stringify({ dependencies: { '@kaninabe/runtime': 'file:../../framework/runtime' } }) };
    expect(targetsOf(files, 'legacy/spec-tools/package-lock.json')).toEqual({ '../../framework/runtime': ['@kaninabe/runtime'] });
  });

  it('workspaces の末尾が /* の 1 段は展開し、{ packages } の形も読む', () => {
    const files = {
      'package.json': JSON.stringify({ workspaces: { packages: ['packages/*'] } }),
      'packages/a/package.json': JSON.stringify({ name: 'a' }),
      'packages/b/package.json': JSON.stringify({ name: 'b' }),
    };
    expect(targetsOf(files)).toEqual({ 'packages/a': ['a'], 'packages/b': ['b'] });
  });

  it.each([
    ['package.json が無い', {}],
    ['package.json が JSON でない', { 'package.json': 'x' }],
    ['package.json が配列', { 'package.json': '[]' }],
    ['** の形は展開しない', { 'package.json': JSON.stringify({ workspaces: ['packages/**'] }), 'packages/a/package.json': '{"name":"a"}' }],
    ['途中に * の形は展開しない', { 'package.json': JSON.stringify({ workspaces: ['*/x/*'] }), 'p/x/a/package.json': '{"name":"a"}' }],
    ['workspace の package.json が無い', { 'package.json': JSON.stringify({ workspaces: ['ghost'] }) }],
    ['file: でない依存(link: / 範囲)は数えない', { 'package.json': JSON.stringify({ dependencies: { a: 'link:../a', b: '^1', c: 5 } }) }],
  ])('空になる: %s', (_name, files) => {
    expect(targetsOf(files)).toEqual({});
  });

  it('name の無い workspace は置き場として数えない(その file: 依存は数える)', () => {
    const files = {
      'package.json': JSON.stringify({ workspaces: ['w'] }),
      'w/package.json': JSON.stringify({ dependencies: { x: 'file:../x' } }),
    };
    expect(targetsOf(files)).toEqual({ x: ['x'] });
  });
});

/** 通信が通る偽の世界(OSV は何も見つけず、登録簿は名前ごとの目録を返す。`absent` の名前は 404)。 */
function world(lock: string, extra: Readonly<Record<string, string>> = {}, absent: readonly string[] = []): FakeSpec {
  return {
    files: { 'package.json': JSON.stringify({ workspaces: ['framework/runtime'] }), 'framework/runtime/package.json': '{"name":"@kaninabe/runtime"}', 'package-lock.json': lock, ...extra },
    dirs: ['node_modules'],
    exec: (_cmd, args) => (args.includes('signatures') ? { code: 0, stdout: '{"invalid":[],"missing":[]}' } : { code: 0, stdout: auditJson([]) }),
    fetch: (url, init) => {
      if (url.includes('osv.dev')) return { results: (init?.body as { queries: unknown[] }).queries.map(() => ({})) };
      const name = decodeURIComponent(url.slice('https://registry.npmjs.org/'.length));
      if (absent.includes(name)) throw Object.assign(new Error(`HTTP 404 ${url}`), { status: 404 });
      return { time: { '4.6.7': '2026-09-01T00:00:00Z' }, versions: { '4.6.7': { dist: { integrity: SRI } } } };
    },
  };
}

const ZOD = { key: 'node_modules/zod', version: '4.6.7' };

describe('runDepsCheck: 4 回目の点検の反例は赤になる(以前は ok: true)', () => {
  it('対照: 正直な lockfile と workspace へのリンクは緑', async () => {
    const lock = lockfile([ZOD, { key: 'node_modules/@kaninabe/runtime', version: '0.1.0', resolved: 'framework/runtime', link: true }]);
    const report = await runDepsCheck(fakeIo(world(lock)), '/r');
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it.each([
    ['v1 の lockfile(別のホスト・sha1)', JSON.stringify({ lockfileVersion: 1, dependencies: { zod: { version: '4.6.7', resolved: 'https://evil.example/zod-4.6.7.tgz', integrity: 'sha1-AAAA' } } }), 'lockfile-shape'],
    ['JSON の壊れた lockfile', '{"lockfileVersion":3,', 'lockfile-shape'],
    ['宣言の無い置き場へのリンク', lockfile([{ key: 'node_modules/zod', version: '4.6.7', resolved: 'docs/specs/evil', link: true }]), 'lockfile-link'],
    ['宣言の無い file: の tarball', lockfile([{ key: 'node_modules/zod', version: '4.6.7', resolved: 'file:docs/specs/evil/zod-4.6.7.tgz' }]), 'lockfile-local-source'],
  ])('%s', async (_name, lock, id) => {
    const report = await runDepsCheck(fakeIo(world(lock)), '/r');
    expect(report.findings.map((f) => f.id)).toContain(id);
    expect(report.ok).toBe(false);
  });

  it('name を偽ると照合の赤・待ちと目録は resolved から導いた本当の名前で引く(偽の名前の 404 で全体を未実施にさせない)', async () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/zod': { name: 'zz-not-a-real-package-xyz', version: '0.0.1', resolved: registryUrl('zod', '4.6.7'), integrity: SRI }, 'node_modules/b': { version: '4.6.7', resolved: registryUrl('b', '4.6.7'), integrity: SRI } } });
    const asked: string[] = [];
    const spec = world(lock, {}, ['zz-not-a-real-package-xyz']);
    const report = await runDepsCheck(fakeIo({ ...spec, fetch: (url, init) => { if (url.startsWith('https://registry.npmjs.org/')) asked.push(url); return spec.fetch?.(url, init); } }), '/r');
    expect(asked.sort()).toEqual(['https://registry.npmjs.org/b', 'https://registry.npmjs.org/zod']);
    expect(report.findings.map((f) => f.id)).toEqual(['lockfile-identity']);
    expect(report.lockfiles[0]?.parts.cooldown.status).toBe('done');
    expect(report.ok).toBe(false);
  });

  it('登録簿に無い名前(404)は赤・他の名前の待ちは実施のまま', async () => {
    const lock = lockfile([ZOD, { key: 'node_modules/ghost', version: '4.6.7' }]);
    const report = await runDepsCheck(fakeIo(world(lock, {}, ['ghost'])), '/r');
    expect(report.findings.map((f) => `${f.pkg}:${f.id}`)).toEqual(['ghost:registry-missing']);
    expect(report.lockfiles[0]?.parts.cooldown.status).toBe('done');
  });

  it('目録に無い版は赤', async () => {
    const lock = lockfile([{ key: 'node_modules/zod', version: '4.6.99' }]);
    const report = await runDepsCheck(fakeIo(world(lock)), '/r');
    expect(report.findings.map((f) => f.id)).toEqual(['registry-version-missing']);
  });
});
