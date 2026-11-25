/**
 * 写し元の宣言を実ファイルへ解決する段取りのテスト。
 *
 * `SOURCE:` は閉包の hash(`semantics/import-closure.ts`)・`SOURCE-FN:` は最新の migration 1 本の本文の sha256。
 * 旧い閉包を履歴から復元する口(`recall`)は**食い違ったときだけ**呼ぶ(git を毎回回さない)。
 */

import { describe, expect, it, vi } from 'vitest';
import { closureHash, sha256Of } from '../../../lib/semantics/import-closure.js';
import { resolveSources } from '../../../lib/formal/resolve-sources.js';
import type { SourceIo } from '../../../lib/formal/resolve-sources.js';
import type { SourceDeclaration } from '../../../lib/formal/types.js';
import { sourceRootPath } from '../../../lib/model/product/layout.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

const ENTRY = "import { leaf } from './leaf.js';\nexport const entry = leaf;\n";
const LEAF = 'export const leaf = 1;\n';
const FILES: Readonly<Record<string, string>> = { 'lib/entry.ts': ENTRY, 'lib/leaf.ts': LEAF };
const CLOSURE = closureHash([
  { path: 'lib/entry.ts', sha256: sha256Of(ENTRY) },
  { path: 'lib/leaf.ts', sha256: sha256Of(LEAF) },
]);

/** 世界(パス → 本文)を読む口と、呼ばれたら記録する復元の口。 */
function io(files: Readonly<Record<string, string>> = FILES): SourceIo & { recall: ReturnType<typeof vi.fn> } {
  return { read: (relative) => files[relative] ?? null, recall: vi.fn(() => null) };
}

const decl = (sha256: string, target = 'lib/entry.ts'): SourceDeclaration => ({ kind: 'path', target, sha256, line: 2 });

describe('resolveSources', () => {
  it('SOURCE: は閉包の hash に解き、閉包のファイルを持つ', () => {
    const resolved = resolveSources([decl(CLOSURE)], [], io(), TEST_ROOTS, TEST_LAYOUT).get('lib/entry.ts');

    expect(resolved).toMatchObject({ kind: 'ok', sha256: CLOSURE });
    expect(resolved?.kind === 'ok' && resolved.closure?.map((file) => file.path)).toEqual(['lib/entry.ts', 'lib/leaf.ts']);
  });

  it('宣言が一致していれば旧い閉包の復元を呼ばない', () => {
    const reader = io();
    resolveSources([decl(CLOSURE)], [], reader, TEST_ROOTS, TEST_LAYOUT);

    expect(reader.recall).not.toHaveBeenCalled();
  });

  it('食い違ったときだけ旧い閉包の復元を呼び、その結果を previous に載せる', () => {
    const reader = io();
    reader.recall.mockReturnValue([{ path: 'lib/entry.ts', sha256: 'x' }]);

    const resolved = resolveSources([decl(sha256Of('stale'))], [], reader, TEST_ROOTS, TEST_LAYOUT).get('lib/entry.ts');

    expect(reader.recall).toHaveBeenCalledTimes(1);
    expect(resolved?.kind === 'ok' && resolved.previous).toEqual([{ path: 'lib/entry.ts', sha256: 'x' }]);
  });

  it('本文の sha256 を宣言しても一致しない(閉包の hash と本文の hash は別の値)', () => {
    const resolved = resolveSources([decl(sha256Of(ENTRY))], [], io(), TEST_ROOTS, TEST_LAYOUT).get('lib/entry.ts');

    expect(resolved?.kind === 'ok' && resolved.sha256).toBe(CLOSURE);
    expect(CLOSURE).not.toBe(sha256Of(ENTRY));
  });

  it('写し元が無ければ missing', () => {
    expect(resolveSources([decl(CLOSURE, 'lib/none.ts')], [], io(), TEST_ROOTS, TEST_LAYOUT).get('lib/none.ts')?.kind).toBe('missing');
  });

  it('閉包を辿れない(実体の無い相対 import)なら missing(欠けた閉包の hash で緑にしない)', () => {
    const resolved = resolveSources([decl(CLOSURE)], [], io({ 'lib/entry.ts': ENTRY }), TEST_ROOTS, TEST_LAYOUT).get('lib/entry.ts');

    expect(resolved).toMatchObject({ kind: 'missing' });
    expect(resolved?.kind === 'missing' && resolved.reason).toContain('./leaf.js');
  });

  it('閉包の `@/…` は根の宣言の実装の木(source-root の役割)に解く(綴りは書き写さない)', () => {
    const appSrc = sourceRootPath(TEST_LAYOUT, TEST_ROOTS) ?? '';
    const entry = `${appSrc}/entry.ts`;
    const files = {
      [entry]: "import { leaf } from '@/leaf';\nexport const entry = leaf;\n",
      [`${appSrc}/leaf.ts`]: LEAF,
    };

    const resolved = resolveSources([decl('0'.repeat(64), entry)], [], io(files), TEST_ROOTS, TEST_LAYOUT).get(entry);

    expect(resolved?.kind === 'ok' && resolved.closure?.map((file) => file.path)).toEqual([entry, `${appSrc}/leaf.ts`]);
  });
});
