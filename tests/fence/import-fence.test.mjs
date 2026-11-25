/**
 * Tests of scripts/check-import-fence.mjs: each rule fires on a minimal bad import, a good import passes,
 * names in comments and strings never count, and the real tree is clean.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkTree, specifiersOf, violationsOf, walk } from '../../scripts/check-import-fence.mjs';

/** Rules broken by `text` when it is the content of `file`. */
function rulesFor(file, text) {
  return violationsOf(file, specifiersOf(file, text)).map((v) => v.rule);
}

describe('specifiersOf', () => {
  it('reads import, export-from, dynamic import, require and import types, with line numbers', () => {
    const text = [
      "import a from 'a';",
      "export * from 'b';",
      "const c = await import('c');",
      "const d = require('d');",
      "type T = import('e').X;",
    ].join('\n');

    assert.deepEqual(specifiersOf('x.ts', text).map((s) => [s.specifier, s.line]), [['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]]);
  });

  it('ignores specifier-looking text in comments and strings', () => {
    assert.deepEqual(specifiersOf('x.ts', "// import x from 'legacy/y'\nconst s = \"import('z')\";"), []);
  });
});

describe('violationsOf', () => {
  it('bin imports node: built-ins only', () => {
    assert.deepEqual(rulesFor('bin/kaninabe.mjs', "import fs from 'node:fs';"), []);
    assert.equal(rulesFor('bin/kaninabe.mjs', "import x from 'left-pad';").length, 1);
  });

  it('legacy never imports bin/ or framework/v2', () => {
    assert.equal(rulesFor('legacy/spec-tools/lib/a.ts', "import x from '../../../bin/kaninabe.mjs';").length, 1);
    assert.equal(rulesFor('legacy/spec-tools/lib/a.ts', "import x from '../../../framework/v2/a.js';").length, 1);
    assert.deepEqual(rulesFor('legacy/spec-tools/lib/a.ts', "import x from './b.js';"), []);
  });

  it('framework code never names legacy/, scripts/, tests/ or the verifier; its tests may', () => {
    assert.equal(rulesFor('framework/runtime/src/a.ts', "import x from '../../../legacy/spec-tools/lib/a.js';").length, 1);
    assert.ok(rulesFor('framework/runtime/src/a.ts', "import x from '@kaninabe/spec-tools';").includes('framework code never imports the verifier/generator'));
    assert.deepEqual(rulesFor('framework/runtime/src/__tests__/a.test.ts', "import x from '../../../../legacy/spec-tools/lib/a.js';"), []);
  });

  it('package graph: runtime imports no kaninabe package; adapters only runtime (and session -> postgrest)', () => {
    assert.equal(rulesFor('framework/runtime/src/a.ts', "import x from '@kaninabe/adapter-postgrest';").length, 1);
    assert.deepEqual(rulesFor('framework/adapters/postgrest/src/a.ts', "import x from '@kaninabe/runtime/sql';"), []);
    assert.equal(rulesFor('framework/adapters/postgrest/src/a.ts', "import x from '@kaninabe/adapter-log-axiom';").length, 1);
    assert.deepEqual(rulesFor('framework/adapters/supabase-session/src/a.ts', "import x from '@kaninabe/adapter-postgrest';"), []);
    assert.equal(rulesFor('framework/lint-config/src/a.ts', "import x from '@kaninabe/runtime';").length, 1);
    assert.deepEqual(rulesFor('framework/runtime/eslint.config.mjs', "import x from '@kaninabe/lint-config/framework-source';"), []);
  });

  it('scripts and tests keep to their small import sets', () => {
    assert.deepEqual(rulesFor('scripts/a.mjs', "import ts from 'typescript';"), []);
    assert.equal(rulesFor('scripts/a.mjs', "import x from 'left-pad';").length, 1);
    assert.deepEqual(rulesFor('tests/bin/a.test.mjs', "import x from '../../bin/kaninabe.mjs';"), []);
    assert.equal(rulesFor('tests/bin/a.test.mjs', "import x from '../../legacy/a.js';").length, 1);
  });
});

describe('computed specifiers and escapes', () => {
  it('flags a specifier it cannot read in bin, scripts, tests and framework code', () => {
    assert.equal(rulesFor('bin/a.mjs', 'await import(name);').length, 1);
    assert.equal(rulesFor('framework/runtime/src/a.ts', 'await import(`../x/${n}`);').length, 1);
    assert.equal(rulesFor('framework/runtime/src/a.ts', "require.resolve('./a');").length, 0);
    assert.equal(rulesFor('framework/runtime/src/a.ts', "require.resolve('../../../legacy/x');").length, 1);
    assert.equal(rulesFor('framework/runtime/src/a.ts', "createRequire(import.meta.url)('x');").length, 1);
    assert.deepEqual(rulesFor('legacy/spec-tools/lib/a.ts', 'await import(name);'), []);
  });

  it('flags a path that leaves the repository, and @kaninabe/v2 from legacy; fixtures folders are not exempt', () => {
    assert.equal(rulesFor('framework/runtime/src/a.ts', "import x from '../../../../app/src/x.js';").length, 1);
    assert.equal(rulesFor('legacy/spec-tools/lib/a.ts', "import x from '../../../../../app/x.js';").length, 1);
    assert.equal(rulesFor('legacy/spec-tools/lib/a.ts', "import x from '@kaninabe/v2/x';").length, 1);
    assert.equal(rulesFor('framework/runtime/fixtures/a.ts', "import x from '../../../legacy/x.js';").length, 1);
  });
});

describe('the real tree', () => {
  it('scans many files and has no violation', () => {
    assert.ok(walk(path.resolve('framework')).length > 100);
    assert.deepEqual(checkTree(), []);
  });

  it('a planted violation is reported, and the command exits 1', () => {
    const tree = realpathSync(mkdtempSync(path.join(tmpdir(), 'fence-')));
    try {
      mkdirSync(path.join(tree, 'framework/runtime/src'), { recursive: true });
      mkdirSync(path.join(tree, 'legacy/spec-tools'), { recursive: true });
      writeFileSync(path.join(tree, 'framework/runtime/src/a.ts'), "import x from '../../../legacy/y.js';\n");
      writeFileSync(path.join(tree, 'legacy/spec-tools/b.ts'), 'export {};\n');
      assert.equal(checkTree(tree).length, 1);
      assert.deepEqual(checkTree(tree).map((l) => l.split('  ')[0]), ['framework/runtime/src/a.ts:1']);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
    const empty = realpathSync(mkdtempSync(path.join(tmpdir(), 'fence-empty-')));
    try {
      assert.equal(checkTree(empty).length, 1);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    assert.equal(spawnSync(process.execPath, ['scripts/check-import-fence.mjs'], { encoding: 'utf8' }).status, 0);
  });
});
