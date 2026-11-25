/**
 * lockfile の npm と同じ規則の部品(`lib/deps/npm-lock-rules.ts`)の表のテスト(6 回目 C6-1・C6-7)。
 *
 * 同梱の判定は npm(`@npmcli/arborist`)の `Node.getBundler` と `load-virtual.js` の `#assignBundles` の写しである。
 * 写した規則の 1 つずつに、正例(npm が同梱とみなす)・負例(npm が普通の依存として取る)・境界を当てる。
 */

import { describe, expect, it } from 'vitest';
import { bundleProblem, foldFileName, FOREIGN_LOCKFILE_NAMES, isForeignLockfileName, lockKeyName, lockParentKey, npmDepBundler } from '../../../lib/deps/npm-lock-rules.js';
import { registryUrl, SRI } from './helpers.js';

/** 登録簿から取る普通のエントリ。 */
const reg = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ version: '1.0.0', resolved: registryUrl(name, '1.0.0'), integrity: SRI, ...extra });

/** 同梱の自己申告をしたエントリ(取得元なし)。 */
const bundled = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ version: '1.0.0', inBundle: true, ...extra });

describe('lockParentKey / lockKeyName(npm の置き場の親と名前)', () => {
  it.each([
    ['node_modules/a', ''],
    ['node_modules/@s/a', ''],
    ['node_modules/a/node_modules/b', 'node_modules/a'],
    ['node_modules/a/node_modules/@s/b', 'node_modules/a'],
    ['w/node_modules/x', 'w'],
    ['w', null],
    ['', null],
  ])('%s の親は %j', (key, parent) => {
    expect(lockParentKey(key)).toBe(parent);
  });

  it.each([
    ['node_modules/a/node_modules/@s/b', '@s/b'],
    ['node_modules/a', 'a'],
    ['w', 'w'],
  ])('%s の名前は %s', (key, name) => {
    expect(lockKeyName(key)).toBe(name);
  });
});

describe('npmDepBundler(npm の getBundler の写し)', () => {
  it.each([
    // 正例
    ['親の配列にある名前', { 'node_modules/a': reg('a', { bundleDependencies: ['b'] }), 'node_modules/a/node_modules/b': bundled() }, 'node_modules/a/node_modules/b', 'node_modules/a'],
    ['同梱された部品の下(親の同梱を受け継ぐ)', { 'node_modules/a': reg('a', { bundleDependencies: ['b'] }), 'node_modules/a/node_modules/b': bundled(), 'node_modules/a/node_modules/b/node_modules/c': bundled() }, 'node_modules/a/node_modules/b/node_modules/c', 'node_modules/a'],
    ['同梱された兄弟から依存される(edgesIn)', { 'node_modules/a': reg('a', { bundleDependencies: ['b'] }), 'node_modules/a/node_modules/b': bundled({ dependencies: { c: '1.0.0' } }), 'node_modules/a/node_modules/c': bundled() }, 'node_modules/a/node_modules/c', 'node_modules/a'],
    ['同梱の自己申告 + 親が依存(#assignBundles が親の表に足す)', { 'node_modules/a': reg('a', { dependencies: { b: '1.0.0' } }), 'node_modules/a/node_modules/b': bundled() }, 'node_modules/a/node_modules/b', 'node_modules/a'],
    // 負例
    ['C6-1 の反例: 親の表に無い名前', { 'node_modules/a': reg('a', { bundleDependencies: ['only-this'] }), 'node_modules/a/node_modules/evil': bundled() }, 'node_modules/a/node_modules/evil', null],
    ['C6-1 の反例: 親の表が true', { 'node_modules/b': reg('b', { bundleDependencies: true }), 'node_modules/b/node_modules/evil2': bundled() }, 'node_modules/b/node_modules/evil2', null],
    ['C6-1 の反例: true の表 + 親が依存(npm は true の表に足せない)', { 'node_modules/b': reg('b', { bundleDependencies: true, dependencies: { x: '1.0.0' } }), 'node_modules/b/node_modules/x': bundled() }, 'node_modules/b/node_modules/x', null],
    ['C6-1 の反例: 依存元が同梱されていない兄弟', { 'node_modules/a': reg('a', { bundleDependencies: ['only-this'] }), 'node_modules/a/node_modules/c': reg('c', { dependencies: { evil: '1.0.0' } }), 'node_modules/a/node_modules/evil': bundled() }, 'node_modules/a/node_modules/evil', null],
    ['親が依存していても、自己申告が無ければ足されない', { 'node_modules/a': reg('a', { dependencies: { b: '1.0.0' } }), 'node_modules/a/node_modules/b': { version: '1.0.0' } }, 'node_modules/a/node_modules/b', null],
    ['親が自分も inBundle と申告していれば足されない', { 'node_modules/a': reg('a', { inBundle: true, dependencies: { b: '1.0.0' } }), 'node_modules/a/node_modules/b': bundled() }, 'node_modules/a/node_modules/b', null],
    ['根の表の同梱は依存の同梱ではない(npm は取る)', { '': { name: 'r', bundleDependencies: ['x'] }, 'node_modules/x': bundled() }, 'node_modules/x', null],
    ['workspace の表は数えない(厳しい側)', { w: { name: 'w', bundleDependencies: ['x'] }, 'w/node_modules/x': bundled() }, 'w/node_modules/x', null],
    ['親が lockfile に無い', { 'node_modules/q/node_modules/b': bundled() }, 'node_modules/q/node_modules/b', null],
    ['依存元の解決が別の置き場に当たる(edgesIn にならない)', { 'node_modules/a': reg('a', { bundleDependencies: ['b'] }), 'node_modules/a/node_modules/b': bundled({ dependencies: { c: '1.0.0' } }), 'node_modules/a/node_modules/b/node_modules/c': bundled(), 'node_modules/a/node_modules/c': bundled() }, 'node_modules/a/node_modules/c', null],
  ] as const)('%s', (_name, packages, key, expected) => {
    expect(npmDepBundler(packages, key)).toBe(expected);
  });

  it('循環する依存で止まる(npm と同じく辿った道で打ち切る)', () => {
    const packages = {
      'node_modules/a': reg('a', { bundleDependencies: ['only'] }),
      'node_modules/a/node_modules/x': bundled({ dependencies: { y: '1.0.0' } }),
      'node_modules/a/node_modules/y': bundled({ dependencies: { x: '1.0.0' } }),
    };
    expect(npmDepBundler(packages, 'node_modules/a/node_modules/x')).toBeNull();
  });
});

describe('bundleProblem(取得元を持たなくてよい正しい同梱か)', () => {
  const base = { 'node_modules/a': reg('a', { bundleDependencies: ['b'] }) };
  it.each([
    ['正しい同梱', bundled(), null],
    ['resolved を持つ', bundled({ resolved: registryUrl('b', '1.0.0') }), 'resolved'],
    ['resolved が空文字', bundled({ resolved: '' }), 'resolved'],
    ['integrity を持つ', bundled({ integrity: SRI }), 'integrity'],
    ['版が範囲', bundled({ version: '^1.0.0' }), '1 点の版'],
    ['版がタグ', bundled({ version: 'latest' }), '1 点の版'],
    ['版が無い', { inBundle: true }, '1 点の版'],
    ['版が先行版・ビルド付き(1 点の版)', bundled({ version: '1.0.0-rc.1+b.2' }), null],
    ['版の先頭が 0 埋め', bundled({ version: '01.0.0' }), '1 点の版'],
  ] as const)('%s', (_name, entry, expected) => {
    const problem = bundleProblem({ ...base, 'node_modules/a/node_modules/b': entry }, 'node_modules/a/node_modules/b');
    if (expected === null) expect(problem).toBeNull();
    else expect(problem).toContain(expected);
  });

  it('npm が同梱とみなさない形は、取得元が無くても赤', () => {
    expect(bundleProblem({ 'node_modules/a': reg('a', { bundleDependencies: ['other'] }), 'node_modules/a/node_modules/b': bundled() }, 'node_modules/a/node_modules/b')).toContain('npm が同梱とみなさない');
  });

  it('エントリが読めない(オブジェクトでない)', () => {
    expect(bundleProblem({ 'node_modules/a': 'x' }, 'node_modules/a')).toContain('読めない');
  });
});

describe('isForeignLockfileName(許すのは綴りがちょうど package-lock.json だけ。大文字小文字と互換文字を畳む — C6-7・C7-2)', () => {
  it.each([
    ...FOREIGN_LOCKFILE_NAMES.map((name) => [name, true] as const),
    // 大文字小文字(ASCII)
    ['NPM-SHRINKWRAP.json', true],
    ['Npm-Shrinkwrap.Json', true],
    ['YARN.LOCK', true],
    // APFS が同一視する互換文字(C7-2 の反例: ſ U+017F・K U+212A)と、全角・合字
    ['npm-\u017fhrinkwrap.json', true],
    ['npm-\u017fhrin\u212awrap.json', true],
    ['yarn.loc\u212a', true],
    ['\uff59arn.lock', true],
    ['pnpm-lock.yam\u217c', true],
    // 綴りの違う package-lock.json(FS は package-lock.json として開くが検査は読まない)
    ['PACKAGE-LOCK.JSON', true],
    ['Package-lock.json', true],
    ['package-lock.j\u017fon', true],
    // 表に無い道具の lockfile も形で拒む
    ['Cargo.lock', true],
    ['poetry.lock', true],
    ['x-lock.yml', true],
    ['my-shrinkwrap.json', true],
    ['npm-shrinkwrap.json.bak', false],
    // npm の設定(12 回目 C12-8)。
    ['.NPMRC', true],
    ['.YarnRC.yml', true],
    ['.npmrc.example', false],
    // 許す・lockfile でない
    ['package-lock.json', false],
    ['package.json', false],
    ['db-lock.mts', false],
    ['lockfile.ts', false],
    ['lock.md', false],
    ['x-yarn.lock.md', false],
  ] as const)('%s → %s', (name, expected) => {
    expect(isForeignLockfileName(name)).toBe(expected);
  });

  it.each([
    ['npm-\u017fhrinkwrap.json', 'npm-shrinkwrap.json'],
    ['YARN.LOC\u212a', 'yarn.lock'],
    ['\uff30ackage-lock.json', 'package-lock.json'],
    ['caf\u0065\u0301.lock', 'caf\u00e9.lock'],
  ] as const)('foldFileName(%s) = %s', (name, folded) => {
    expect(foldFileName(name)).toBe(folded);
  });
});
