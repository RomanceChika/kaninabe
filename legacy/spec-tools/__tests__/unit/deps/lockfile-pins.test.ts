/**
 * lockfile の配信元と固定の検査(3 回目の点検 C-3)。lockfile は JSON として読み、字面の揺れで素通りしない。
 * 4 回目 C4-4: v1・読めない lockfile は赤・link / file: は宣言した置き場だけ。C4-5: 名前と版は resolved から導いて照合・登録簿の 404 は赤。
 */

import { describe, expect, it } from 'vitest';
import {
  isOfficialRegistryUrl,
  lockfilePinFindings,
  lockfileShapeProblem,
  normalizeLocalPath,
  registryTarballIdentity,
} from '../../../lib/deps/lockfile-pins.js';
import type { LocalDeclarations } from '../../../lib/deps/lockfile-pins.js';
import { applyAccepted } from '../../../lib/deps/accepted.js';
import { integrityMismatchFindings } from '../../../lib/deps/signatures.js';
import { runDepsCheck } from '../../../lib/deps/run.js';
import { auditJson, fakeIo, lockfile, registryUrl, SRI } from './helpers.js';

const OFFICIAL = 'https://registry.npmjs.org/a/-/a-1.0.0.tgz';

/** 1 エントリの lockfile の本文(JSON を組み立てる)。 */
function lockWith(entry: Record<string, unknown>, key = 'node_modules/a'): string {
  return JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'r' }, [key]: { version: '1.0.0', ...entry } } });
}

const ids = (text: string): string[] => lockfilePinFindings('l', text).map((f) => f.id);

describe('lockfilePinFindings', () => {
  it('公式の登録簿 + sha512 は指摘なし', () => {
    expect(ids(lockWith({ resolved: OFFICIAL, integrity: SRI }))).toEqual([]);
  });

  it.each([
    ['公式でない https', { resolved: 'https://evil.example/a-1.0.0.tgz', integrity: SRI }, ['lockfile-source']],
    ['http', { resolved: 'http://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: SRI }, ['lockfile-source']],
    ['@ で別ホストを装う', { resolved: 'https://registry.npmjs.org@evil.example/a.tgz', integrity: SRI }, ['lockfile-source']],
    ['ホスト名の前方一致', { resolved: 'https://registry.npmjs.org.evil.example/a.tgz', integrity: SRI }, ['lockfile-source']],
    ['git', { resolved: 'git+ssh://git@github.com/x/y.git#abc', integrity: SRI }, ['lockfile-source']],
    ['github の tarball', { resolved: 'https://codeload.github.com/x/y/tar.gz/abc', integrity: SRI }, ['lockfile-source']],
    ['URL でない文字列', { resolved: '../x', integrity: SRI }, ['lockfile-source']],
    ['resolved が無い', { integrity: SRI }, ['lockfile-unresolved']],
    ['resolved が文字列でない', { resolved: 5, integrity: SRI }, ['lockfile-unresolved']],
    ['integrity が無い', { resolved: OFFICIAL }, ['lockfile-integrity']],
    ['integrity が sha1', { resolved: OFFICIAL, integrity: 'sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA=' }, ['lockfile-integrity']],
    ['integrity が sha512 を含む複数', { resolved: OFFICIAL, integrity: `sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA= ${SRI}` }, ['lockfile-integrity']],
    ['integrity が短い sha512', { resolved: OFFICIAL, integrity: 'sha512-AAAA' }, ['lockfile-integrity']],
    ['両方が悪い', { resolved: 'https://evil.example/a.tgz' }, ['lockfile-source', 'lockfile-integrity']],
  ])('赤: %s', (_name, entry, expected) => {
    const found = lockfilePinFindings('l', lockWith(entry));
    expect(found.map((f) => f.id)).toEqual(expected);
    expect(found.every((f) => f.level === 'red' && f.kind === 'lockfile' && f.pkg === 'a')).toBe(true);
  });

  it('字面の揺れ(エスケープした URL・キーの綴り)でも JSON として読むので見逃さない', () => {
    const raw = `{"lockfileVersion":3,"packages":{"node_modules/a":{"version":"1.0.0","resolved":"https:\\/\\/evil.example\\/a.tgz","integrity":"${SRI}"},"node_modules/b":{"version":"1.0.0","\\u0072esolved":"https://evil.example/b.tgz","integrity":"${SRI}"}}}`;
    expect(raw).toContain('https:\\/\\/evil');
    expect(lockfilePinFindings('l', raw).map((f) => `${f.pkg}:${f.id}`)).toEqual(['a:lockfile-source', 'b:lockfile-source']);
  });

  it('除外の規則: node_modules の外のキー(inBundle は親が同梱を宣言したときだけ。lockfile-bundle.test.ts)', () => {
    expect(ids(lockWith({ resolved: 'https://evil.example/a.tgz' }, 'workspace/dir'))).toEqual([]);
  });

  it('入れ子の node_modules は最後の名前を pkg にする', () => {
    const found = lockfilePinFindings('l', lockWith({ resolved: 'https://evil.example/s.tgz', integrity: SRI }, 'node_modules/a/node_modules/@s/b'));
    expect(found[0]?.pkg).toBe('@s/b');
  });

  it.each([
    ['JSON でない', 'not json'],
    ['lockfileVersion が無い', '{"packages":{}}'],
    ['packages が無い', '{"lockfileVersion":3}'],
    ['packages が配列でない値', '{"lockfileVersion":3,"packages":5}'],
    ['packages が配列', '{"lockfileVersion":3,"packages":[]}'],
    ['v1(C4-4 の反例: dependencies だけ・別のホスト)', JSON.stringify({ lockfileVersion: 1, dependencies: { zod: { version: '4.6.7', resolved: 'https://evil.example/zod-4.6.7.tgz', integrity: 'sha1-AAAA' } } })],
    ['版が文字列', '{"lockfileVersion":"3","packages":{}}'],
    ['JSON の null', 'null'],
  ])('読めない形は lockfile-shape の赤 1 件: %s', (_name, text) => {
    const found = lockfilePinFindings('l', text);
    expect(found.map((f) => [f.id, f.level, f.kind])).toEqual([['lockfile-shape', 'red', 'lockfile']]);
  });

  it.each([
    ['v2', '{"lockfileVersion":2,"packages":{}}', null],
    ['v3', '{"lockfileVersion":3,"packages":{}}', null],
    ['v1', '{"lockfileVersion":1,"packages":{}}', 'lockfileVersion'],
    ['v0', '{"lockfileVersion":0,"packages":{}}', 'lockfileVersion'],
  ])('lockfileShapeProblem の境界: %s', (_name, text, expected) => {
    const problem = lockfileShapeProblem(text);
    if (expected === null) expect(problem).toBeNull();
    else expect(problem).toContain(expected);
  });

  it('受け入れ表では受け入れられない(取得元の差し替えを期限つきで許さない)', () => {
    const found = lockfilePinFindings('l', lockWith({ resolved: 'https://evil.example/a.tgz', integrity: SRI }));
    const entry = { kind: 'advisory' as const, target: 'lockfile-source', pkg: 'a', versions: ['1.0.0'], premises: [], reason: 'x', reviewBy: '2099-01-01' };
    applyAccepted(found, [entry], '2026-10-24');
    expect(found[0]?.level).toBe('red');
  });
});

describe('isOfficialRegistryUrl', () => {
  it.each([[OFFICIAL, true], ['https://registry.npmjs.org/@s%2fb/-/b-1.tgz', true], ['https://registry.npmjs.com/a.tgz', false], ['https://user:pw@registry.npmjs.org/a.tgz', false], ['', false]])('%s', (url, expected) => {
    expect(isOfficialRegistryUrl(url)).toBe(expected);
  });
});

describe('integrityMismatchFindings(登録簿の目録との突き合わせ)', () => {
  const other = `sha512-${'B'.repeat(86)}==`;
  const pkg = { name: 'a', version: '1.0.0', fromRegistry: true, integrity: SRI };

  it.each([
    ['一致', new Map([['a', { '1.0.0': SRI }]]), 0],
    ['不一致は赤', new Map([['a', { '1.0.0': other }]]), 1],
    ['目録がその版の integrity を言っていない', new Map([['a', {}]]), 0],
    ['目録に名前が無い', new Map(), 0],
  ])('%s', (_name, registry, count) => {
    const found = integrityMismatchFindings('l', [pkg], registry);
    expect(found).toHaveLength(count);
    expect(found.every((f) => f.level === 'red' && f.id === 'lockfile-integrity-mismatch')).toBe(true);
  });

  it('登録簿由来でない・lockfile に integrity が無い部品は見ない', () => {
    const registry = new Map([['a', { '1.0.0': other }]]);
    expect(integrityMismatchFindings('l', [{ ...pkg, fromRegistry: false }], registry)).toEqual([]);
    expect(integrityMismatchFindings('l', [{ name: 'a', version: '1.0.0', fromRegistry: true }], registry)).toEqual([]);
  });
});

describe('runDepsCheck への配線', () => {
  const exec = { exec: () => ({ code: 0, stdout: auditJson([]) }) };

  it('公式でない配信元は、通信が全部落ちていても赤にする(通信不要の検査)', async () => {
    const evil = lockfile([{ key: 'node_modules/a', version: '1.0.0', resolved: 'https://evil.example/a.tgz' }]);
    const report = await runDepsCheck(fakeIo({ files: { 'package.json': '{}', 'package-lock.json': evil }, ...exec }), '/r');
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.id)).toContain('lockfile-source');
  });

  it('通信できるとき、目録の integrity と食い違えば赤(通信できなければ未実施で赤にしない)', async () => {
    const files = { 'package.json': '{}', 'package-lock.json': lockfile([{ key: 'node_modules/a', version: '1.0.0' }]) };
    const registry = { time: { '1.0.0': '2020-01-01T00:00:00Z' }, versions: { '1.0.0': { dist: { integrity: `sha512-${'B'.repeat(86)}==` } } } };
    const online = fakeIo({ files, ...exec, fetch: (url) => (url.includes('osv.dev') ? { results: [{}] } : registry) });
    const red = await runDepsCheck(online, '/r');
    expect(red.findings.map((f) => f.id)).toContain('lockfile-integrity-mismatch');
    const offline = await runDepsCheck(fakeIo({ files, ...exec }), '/r');
    expect(offline.findings.map((f) => f.id)).not.toContain('lockfile-integrity-mismatch');
    expect(offline.ok).toBe(true);
  });
});

/** 宣言した手元の置き場(置き場 → 名前)。 */
function declared(entries: Readonly<Record<string, readonly string[]>>): LocalDeclarations {
  return { targets: new Map(Object.entries(entries).map(([target, names]) => [target, new Set(names)])) };
}

describe('lockfilePinFindings: link / file: は宣言した置き場だけ(4 回目 C4-4)', () => {
  const LOCAL = declared({ 'framework/runtime': ['@kaninabe/runtime'], '../../framework/lint-config': ['@kaninabe/lint-config'], 'vendor/ok.tgz': ['ok'] });
  const at = (entry: Record<string, unknown>, key: string): string[] => lockfilePinFindings('l', lockWith(entry, key), LOCAL).map((f) => f.id);

  it.each([
    ['workspace へのリンク', { resolved: 'framework/runtime', link: true }, 'node_modules/@kaninabe/runtime', []],
    ['./ や末尾の / の表記ゆれ', { resolved: './framework/runtime/', link: true }, 'node_modules/@kaninabe/runtime', []],
    ['file: 依存の置き場へのリンク(親を辿る)', { resolved: '../../framework/lint-config', link: true }, 'node_modules/@kaninabe/lint-config', []],
    ['宣言した file: の tarball', { resolved: 'file:vendor/ok.tgz', integrity: SRI }, 'node_modules/ok', []],
    ['C4-4 の反例: 宣言の無い置き場へのリンク', { resolved: 'docs/specs/evil', link: true }, 'node_modules/zod', ['lockfile-link']],
    ['宣言した置き場を別の名前で指すリンク', { resolved: 'framework/runtime', link: true }, 'node_modules/zod', ['lockfile-link']],
    ['.. で宣言した置き場に見せる', { resolved: 'framework/runtime/../../vendor/evil', link: true }, 'node_modules/@kaninabe/runtime', ['lockfile-link']],
    ['resolved の無いリンク', { link: true }, 'node_modules/@kaninabe/runtime', ['lockfile-link']],
    ['C4-4 の反例: 宣言の無い file: の tarball', { resolved: 'file:docs/specs/evil/zod-4.6.7.tgz', integrity: SRI }, 'node_modules/zod', ['lockfile-local-source']],
    ['宣言した tarball を別の名前で', { resolved: 'file:vendor/ok.tgz', integrity: SRI }, 'node_modules/zod', ['lockfile-local-source']],
    ['入れ子の node_modules のリンク', { resolved: 'vendor/evil', link: true }, 'node_modules/a/node_modules/zod', ['lockfile-link']],
  ])('%s', (_name, entry, key, expected) => {
    expect(at(entry, key)).toEqual(expected);
  });

  it('宣言を渡さなければ(既定)どのリンクも赤', () => {
    expect(ids(lockWith({ resolved: 'framework/runtime', link: true }, 'node_modules/@kaninabe/runtime'))).toEqual(['lockfile-link']);
  });
});

describe('lockfilePinFindings: 名前と版は resolved から導いて照合する(4 回目 C4-5)', () => {
  it.each([
    ['一致', { resolved: registryUrl('zod', '4.6.7'), version: '4.6.7' }, 'node_modules/zod', []],
    ['scope つきの一致', { resolved: registryUrl('@s/b', '1.0.0-beta.1'), version: '1.0.0-beta.1' }, 'node_modules/@s/b', []],
    ['npm の別名(name の欄が本当の名前)', { resolved: registryUrl('string-width', '4.2.3'), version: '4.2.3', name: 'string-width' }, 'node_modules/string-width-cjs', []],
    ['C4-5 の反例: name を偽る', { resolved: registryUrl('zod', '4.6.7'), version: '0.0.1', name: 'zz-not-a-real-package-xyz' }, 'node_modules/zod', ['lockfile-identity']],
    ['C4-5 の反例: version を偽る', { resolved: registryUrl('zod', '4.6.7'), version: '4.6.99' }, 'node_modules/zod', ['lockfile-identity']],
    ['キーの名前と tarball が別', { resolved: registryUrl('evil', '4.6.7'), version: '4.6.7' }, 'node_modules/zod', ['lockfile-identity']],
    ['version の欄が無い', { resolved: registryUrl('zod', '4.6.7'), version: undefined }, 'node_modules/zod', ['lockfile-identity']],
    ['tarball の形でない公式の URL', { resolved: 'https://registry.npmjs.org/zod', version: '4.6.7' }, 'node_modules/zod', ['lockfile-identity']],
  ])('%s', (_name, entry, key, expected) => {
    expect(lockfilePinFindings('l', lockWith({ integrity: SRI, ...entry }, key)).map((f) => f.id)).toEqual(expected);
  });
});

describe('registryTarballIdentity / normalizeLocalPath', () => {
  it.each([
    ['https://registry.npmjs.org/zod/-/zod-4.6.7.tgz', { name: 'zod', version: '4.6.7' }],
    ['https://registry.npmjs.org/@s/b/-/b-1.0.0-rc.1.tgz', { name: '@s/b', version: '1.0.0-rc.1' }],
    ['https://registry.npmjs.org/@s%2fb/-/b-1.0.0.tgz', { name: '@s/b', version: '1.0.0' }],
    ['https://registry.npmjs.org/a-b/-/a-b-2.0.0.tgz', { name: 'a-b', version: '2.0.0' }],
    ['https://registry.npmjs.org/zod/-/other-4.6.7.tgz', null],
    ['https://registry.npmjs.org/zod/-/zod-.tgz', null],
    ['https://registry.npmjs.org/zod/-/zod-1.0.0.tar', null],
    ['https://evil.example/zod/-/zod-1.0.0.tgz', null],
    ['https://registry.npmjs.org/a/b/c/-/c-1.0.0.tgz', null],
  ])('%s', (url, expected) => {
    expect(registryTarballIdentity(url)).toEqual(expected);
  });

  it.each([
    ['./a/', 'a'],
    ['a/../b', 'b'],
    ['../x', '../x'],
    ['a/../../b', '../b'],
    ['a//b/.', 'a/b'],
    ['/abs/x', '/abs/x'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeLocalPath(input)).toBe(expected);
  });
});
