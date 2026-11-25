/**
 * 子のコマンドに渡す PATH の濾し(`lib/io/safe-path.ts`。7 回目 C7-3・C7-6)。
 * (1) 落とす要素の表(偽の実体)、(2) 本物の FS で、PATH の先頭の根の中の偽の `npm` が動かず根の外の `npm` が動くこと。
 */

import { execFileSync } from 'node:child_process';
import { withoutGitEnv } from '../../helpers/git-env.js';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { childEnvOutsideRoot, foldPathSpelling, searchPathOutsideRoot } from '../../../lib/io/safe-path.js';
import { fakeRealpath, SEARCH_PATH_CASES, SEARCH_PATH_ROOT_CASES } from '../../helpers/search-path-cases.js';

describe('searchPathOutsideRoot(落とす要素の表)', () => {
  it.each(SEARCH_PATH_CASES)('%s', (_name, entries, expected) => {
    const kept = searchPathOutsideRoot(entries.join(delimiter), '/r', fakeRealpath);
    expect(kept === '' ? [] : kept.split(delimiter)).toEqual(expected);
  });

  it.each(SEARCH_PATH_ROOT_CASES)('%s', (_name, root, entries, expected) => {
    const kept = searchPathOutsideRoot(entries.join(delimiter), root, fakeRealpath);
    expect(kept === '' ? [] : kept.split(delimiter)).toEqual(expected);
  });

  it('根の実体を引けなければ綴りで比べる', () => {
    expect(searchPathOutsideRoot(['/gone/bin', '/usr/bin'].join(delimiter), '/gone', fakeRealpath)).toBe('/usr/bin');
  });
});

describe('foldPathSpelling', () => {
  it.each([
    ['/Home/A/Repo', '/home/a/repo'],
    ['/x/ſ', '/x/s'],
    ['/x/K', '/x/k'],
    ['/x/Ｒ', '/x/r'],
    ['/x/é', '/x/é'],
    ['/x/Stra\u00dfe', '/x/strasse'],
    ['/x/STRA\u1e9eE', '/x/strasse'],
  ] as const)('%s → %s', (input, folded) => {
    expect(foldPathSpelling(input)).toBe(folded);
  });
});

describe('本物の FS: PATH の先頭の偽の npm は動かない(C7-6)', () => {
  let root = '';
  let outside = '';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'safe-path-root-'));
    outside = mkdtempSync(join(tmpdir(), 'safe-path-outside-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  /** 呼ばれたら印のファイルを書く偽の `npm`。 */
  const fakeNpm = (dir: string, marker: string): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'npm'), `#!/bin/sh\necho called > ${JSON.stringify(marker)}\necho '{"auditReportVersion":2,"vulnerabilities":{}}'\n`, { mode: 0o755 });
  };

  it('node_modules/.bin と根の中の bin の偽物は実行されず、根の外のものが実行される(ほかの変数は変えない)', () => {
    fakeNpm(join(root, 'framework', 'spec-tools', 'node_modules', '.bin'), join(root, 'modules-called'));
    fakeNpm(join(root, 'bin'), join(root, 'root-called'));
    fakeNpm(join(outside, 'bin'), join(outside, 'outside-called'));
    const env = childEnvOutsideRoot({ PATH: [join(root, 'framework', 'spec-tools', 'node_modules', '.bin'), join(root, 'bin'), join(outside, 'bin'), '/usr/bin', '/bin'].join(delimiter), KEEP: 'x' }, root);
    expect(env['KEEP']).toBe('x');
    execFileSync('npm', ['audit', '--json'], { cwd: outside, env: withoutGitEnv(env), encoding: 'utf-8' });
    expect(existsSync(join(root, 'modules-called'))).toBe(false);
    expect(existsSync(join(root, 'root-called'))).toBe(false);
    expect(existsSync(join(outside, 'outside-called'))).toBe(true);
  });

  it('根を複数渡すと、どの根の中の要素も落とす(8 回目 C8-6: 一時ツリーとリポジトリの根)', () => {
    const value = [join(root, 'bin'), join(outside, 'bin'), '/usr/bin'].join(delimiter);
    expect(childEnvOutsideRoot({ PATH: value }, [root, outside])['PATH']).toBe('/usr/bin');
    expect(childEnvOutsideRoot({ PATH: value }, [outside])['PATH']).toBe([join(root, 'bin'), '/usr/bin'].join(delimiter));
  });

  it('PATH が無ければ空(何も拾わない)', () => {
    expect(childEnvOutsideRoot({}, root)['PATH']).toBe('');
  });
});
