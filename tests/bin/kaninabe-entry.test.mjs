/**
 * Tests of the entry `bin/kaninabe.mjs` (run with `node --test tests/bin`). They cover two things:
 *   - how the product root is chosen (explicit --root wins; an outer product wins over kaninabe's own
 *     product.md; failure when there is none)
 *   - exit status and wording for no command, --help and an unknown command
 * What verify and generate produce is tested next to the CLIs (legacy/spec-tools, outside-tool-tree.test.ts).
 * Imports: node: built-ins and the entry itself only.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, readFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS, SETUP_STEPS, npmCommand, resolveRoot } from '../../bin/kaninabe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(ROOT, 'bin', 'kaninabe.mjs');
const created = [];

/** A fresh temp directory (real path). */
function temp() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'kaninabe-bin-')));
  created.push(dir);
  return dir;
}

/** Puts an empty product.md in `dir`. */
function declare(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'product.md'), '');
}

after(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolveRoot', () => {
  it('--root (space and = forms) wins and the other arguments pass through', () => {
    const product = temp();
    declare(product);

    assert.deepEqual(resolveRoot(['--root', product, '--check'], '/'), { ok: true, root: product, rest: ['--check'] });
    assert.deepEqual(resolveRoot([`--root=${product}`], '/'), { ok: true, root: product, rest: [] });
  });

  it('--root without a value, or pointing at a place without product.md, fails', () => {
    const empty = temp();

    assert.equal(resolveRoot(['--root'], empty).ok, false);
    assert.equal(resolveRoot(['--root='], empty).ok, false);
    assert.equal(resolveRoot(['--root', '--check'], empty).ok, false);
    assert.equal(resolveRoot(['--root', empty], empty).ok, false);
  });

  it("called from inside a kaninabe copy, the outer product's root is chosen, not the copy's own", () => {
    const product = temp();
    const copy = path.join(product, 'kaninabe');
    declare(product);
    declare(copy);
    mkdirSync(path.join(copy, 'legacy'), { recursive: true });

    assert.deepEqual(resolveRoot([], path.join(copy, 'legacy'), copy), { ok: true, root: product, rest: [] });
    assert.deepEqual(resolveRoot([], product, copy), { ok: true, root: product, rest: [] });
  });

  it("with no outer product, kaninabe's own root is used (developing kaninabe alone)", () => {
    const own = temp();
    declare(own);

    assert.deepEqual(resolveRoot([], own, own), { ok: true, root: own, rest: [] });
  });

  it('fails when no product.md exists anywhere above', () => {
    assert.equal(resolveRoot([], temp(), '/nonexistent-kaninabe').ok, false);
  });
});

describe('commands', () => {
  it('every command in the table points at a CLI file that exists', () => {
    for (const [name, entry] of Object.entries(COMMANDS)) {
      assert.ok(existsSync(path.join(ROOT, 'legacy', 'spec-tools', 'cli', entry.cli)), name);
    }
  });

  it('no command prints usage and exits 1, --help exits 0, an unknown command exits 1 on stderr', () => {
    const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

    assert.equal(run().status, 1);
    assert.equal(run('--help').status, 0);
    const unknown = run('nope');
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /unknown command 'nope'/);
  });
});

describe('setup', () => {
  it('installs from the lockfile in kaninabe root and in the legacy tool folder, both of which exist with a lockfile', () => {
    for (const [dir, args] of SETUP_STEPS) {
      assert.deepEqual(args, ['ci']);
      assert.ok(existsSync(path.join(ROOT, dir, 'package-lock.json')), dir);
    }
  });

  /** A fake `npm` first on PATH: records "<cwd> <args>" per call, fails when a file named FAIL_ON_CALL holds the call number. */
  function fakeNpm(failOn) {
    const dir = temp();
    const log = path.join(dir, 'calls.log');
    writeFileSync(path.join(dir, 'npm'), `#!/bin/sh\necho "$PWD $*" >> "${log}"\ncount=$(wc -l < "${log}")\n[ "$count" = "${failOn}" ] && exit 7\nexit 0\n`);
    chmodSync(path.join(dir, 'npm'), 0o755);
    const env = { PATH: `${dir}${path.delimiter}${process.env.PATH}`, HOME: dir };
    return { env, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []) };
  }

  it('runs both installs in order, from a folder with no product.md', () => {
    const fake = fakeNpm('none');

    const result = spawnSync(process.execPath, [BIN, 'setup'], { cwd: temp(), encoding: 'utf8', env: fake.env });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fake.calls(), [`${ROOT} ci`, `${path.join(ROOT, 'legacy/spec-tools')} ci`]);
  });

  it('stops at the first failing install and returns its exit status', () => {
    const fake = fakeNpm('1');

    const result = spawnSync(process.execPath, [BIN, 'setup'], { cwd: temp(), encoding: 'utf8', env: fake.env });

    assert.equal(result.status, 7);
    assert.equal(fake.calls().length, 1);
  });

  it('refuses arguments without running npm; --help exits 0 and runs nothing', () => {
    const fake = fakeNpm('none');
    const run = (...args) => spawnSync(process.execPath, [BIN, 'setup', ...args], { cwd: temp(), encoding: 'utf8', env: fake.env });

    assert.equal(run('--root', 'x').status, 1);
    assert.equal(run('--help').status, 0);
    assert.deepEqual(fake.calls(), []);
  });

  it('does not hand an outer npm or production settings to the install', () => {
    const fake = fakeNpm('none');
    const env = { ...fake.env, NODE_ENV: 'production', npm_config_omit: 'dev', npm_lifecycle_event: 'x', npm_execpath: '/nonexistent/npm-cli.js' };

    const result = spawnSync(process.execPath, [BIN, 'setup'], { cwd: temp(), encoding: 'utf8', env });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fake.calls().length, 2);
  });

  it('npmCommand: node on npm-cli.js when it exists, npm.cmd through the shell on Windows, plain npm elsewhere', () => {
    const cli = path.join(temp(), 'npm-cli.js');
    writeFileSync(cli, '');

    assert.deepEqual(npmCommand({ npm_execpath: cli }, 'linux'), { command: process.execPath, prefix: [cli], shell: false });
    assert.deepEqual(npmCommand({}, 'win32'), { command: 'npm.cmd', prefix: [], shell: true });
    assert.deepEqual(npmCommand({}, 'linux'), { command: 'npm', prefix: [], shell: false });
  });

  it('is listed in the usage text', () => {
    assert.match(spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' }).stdout, /setup/);
  });
});

describe('end to end', () => {
  const SAMPLE = path.join(ROOT, 'legacy/spec-tools/__tests__/fixtures/samples/library');
  const run = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, INIT_CWD: '' } });

  /** A product tree (the library sample). The nested-copy choice of root is covered by the resolveRoot tests above. */
  function productTree() {
    const product = temp();
    cpSync(SAMPLE, product, { recursive: true });
    return { product, sub: path.join(product, 'docs') };
  }

  it('started through a symlink, it still runs', () => {
    const dir = temp();
    const link = path.join(dir, 'kaninabe-link.mjs');
    symlinkSync(BIN, link);

    const result = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /usage: kaninabe/);
  });

  it('verify from a folder inside the product reads that product, and a relative path argument is resolved from where it was typed', () => {
    const { product, sub } = productTree();

    const bare = run(sub, 'verify');
    assert.equal(bare.status, 0, bare.stdout + bare.stderr);
    assert.match(bare.stdout, /集約 4 件/);

    const withPath = run(product, 'verify', 'docs/specs/domain');
    assert.equal(withPath.status, 0, withPath.stdout + withPath.stderr);
    assert.match(withPath.stdout, /集約 4 件/);
  });

  it('a path argument outside the root is refused with exit 1', () => {
    const { product } = productTree();

    const result = run(product, 'verify', '/tmp');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not inside the product root/);
  });
});
