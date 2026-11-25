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
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS, resolveRoot } from '../../bin/kaninabe.mjs';

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
