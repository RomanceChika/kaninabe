/**
 * 生成した試験を題材の木で実行する口(`wiring-tests.ts`。fix27 A2)の部品のユニットテスト。
 *
 * - 解けない import をホストの同じ置き場から写し、写した先・木にある生成物の先の import も辿る。ホストにも無いものは写さない・ソースの根の外へ出ない
 * - 関門を外した木はリクエスト前段を素通しにし、保護範囲の宣言はそのまま・戻すと元の本文になる(前段が無ければ何もしない)
 * - 実 DB の要らない試験は、実 DB に当てる 3 種の置き場の外の `*.test.ts` だけ
 * - 報告のパスは末尾で生成物に照らす(実体の綴りの前置きが付いても引ける)
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { carryHostSupport, kindOfPath, neuterRequestGate, wiringTestFiles } from '../../../../../lib/targets/supabase/samples/wiring-tests.js';
import { TEST_LAYOUT } from '../../../../helpers/platform.js';
import type { ProductRoots } from '../../../../../lib/model/product/types.js';

const ROOTS = { app: 'app', specs: 'docs/specs', generated: 'app/src/domain/generated' } as unknown as ProductRoots;

const lab = { base: '', tree: '', host: '' };

/** ファイルを置く。 */
function put(root: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

beforeEach(() => {
  lab.base = mkdtempSync(path.join(tmpdir(), 'wiring-tests-'));
  lab.tree = path.join(lab.base, 'tree');
  lab.host = path.join(lab.base, 'host');
});

afterEach(() => {
  rmSync(lab.base, { recursive: true, force: true });
});

describe('carryHostSupport', () => {
  it('解けない import をホストから写し、写した先と木の生成物の先も辿る。ホストに無いもの・ソースの根の外は写さない', () => {
    put(lab.tree, 'app/src/operation/__tests__/generated/a.test.ts', "import { h } from '../plan-harness';\nimport { g } from '@/proxy';\nimport { x } from '@/app/api/job/route';\nimport fc from 'fast-check';\n");
    put(lab.tree, 'app/src/proxy.ts', "import { s } from '@/infrastructure/supabase/proxy-session';\n");
    put(lab.host, 'app/src/operation/__tests__/plan-harness.ts', "import { p } from './plan-dep';\n");
    put(lab.host, 'app/src/operation/__tests__/plan-dep.ts', 'export const p = 1;\n');
    put(lab.host, 'app/src/infrastructure/supabase/proxy-session.ts', 'export const s = 1;\n');
    put(lab.host, 'app/outside.ts', 'export const o = 1;\n');

    const carried = carryHostSupport({ tree: lab.tree, repoRoot: lab.host, files: ['app/src/operation/__tests__/generated/a.test.ts'], roots: ROOTS, layout: TEST_LAYOUT });

    expect(carried).toEqual(['app/src/infrastructure/supabase/proxy-session.ts', 'app/src/operation/__tests__/plan-dep.ts', 'app/src/operation/__tests__/plan-harness.ts']);
    expect(existsSync(path.join(lab.tree, 'app/src/app/api/job/route.ts'))).toBe(false);
    expect(existsSync(path.join(lab.tree, 'app/outside.ts'))).toBe(false);
  });

  it('木で解ける import は写さない(生成物を製品の版で上書きしない)', () => {
    put(lab.tree, 'app/src/x.test.ts', "import { a } from './a';\n");
    put(lab.tree, 'app/src/a.ts', 'export const a = "tree";\n');
    put(lab.host, 'app/src/a.ts', 'export const a = "host";\n');
    expect(carryHostSupport({ tree: lab.tree, repoRoot: lab.host, files: ['app/src/x.test.ts'], roots: ROOTS, layout: TEST_LAYOUT })).toEqual([]);
    expect(readFileSync(path.join(lab.tree, 'app/src/a.ts'), 'utf-8')).toContain('tree');
  });
});

describe('neuterRequestGate', () => {
  it('前段を素通しにし、保護範囲の宣言は元の前段から渡す。戻すと元の本文', () => {
    put(lab.tree, 'app/src/proxy.ts', 'export const config = { matcher: [] };\nexport function proxy() { return 403; }\n');
    const restore = neuterRequestGate(lab.tree, ROOTS, TEST_LAYOUT);
    expect(restore).not.toBeNull();
    const neutered = readFileSync(path.join(lab.tree, 'app/src/proxy.ts'), 'utf-8');
    expect(neutered).toContain("export { config } from './proxy.original';");
    expect(neutered).toContain('return NextResponse.next();');
    restore?.();
    expect(readFileSync(path.join(lab.tree, 'app/src/proxy.ts'), 'utf-8')).toContain('return 403');
    expect(existsSync(path.join(lab.tree, 'app/src/proxy.original.ts'))).toBe(false);
  });

  it('前段が無ければ何もしない', () => {
    expect(neuterRequestGate(lab.tree, ROOTS, TEST_LAYOUT)).toBeNull();
  });
});

describe('wiringTestFiles と kindOfPath', () => {
  const generatedBy = new Map([
    ['app/src/app/api/__tests__/generated/browser-defense.test.ts', 'bd'],
    ['app/src/operation/__tests__/generated/a/b.test.ts', 'op'],
    ['app/src/infrastructure/__tests__/generated/rls/t.test.ts', 'rls'],
    ['app/src/domain/generated/x.ts', 'zod'],
  ]);

  it('実 DB に当てる置き場と試験でないものを外す', () => {
    expect(wiringTestFiles(generatedBy, ROOTS, TEST_LAYOUT)).toEqual(['app/src/app/api/__tests__/generated/browser-defense.test.ts', 'app/src/operation/__tests__/generated/a/b.test.ts']);
  });

  it('報告の絶対パスを末尾で生成物に照らす', () => {
    const kindOf = kindOfPath(generatedBy);
    expect(kindOf('/private/var/t/app/src/operation/__tests__/generated/a/b.test.ts')).toBe('op');
    expect(kindOf('/var/t/app/src/other.test.ts')).toBeNull();
  });
});
