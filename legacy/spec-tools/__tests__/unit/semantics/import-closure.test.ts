/**
 * 写し元の閉包(C24 の鮮度の hash の対象)のテスト。
 *
 * この検査の値打ちは「**写し元が import している先の本文だけが変わっても hash が動く**」の一点である。
 * 写し元 1 本の本文だけを固定すると、import 先の定数(`RPC_BODY_WORDS` 等)の変更でモデルが黙って古くなる。
 * 小さい import 木を**一時ディレクトリに実際に作って**、実ファイルを読む口(`worktreeReader`)まで通す。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closureHash, computeClosure, diffClosure, sha256Of } from '../../../lib/semantics/import-closure.js';
import { worktreeReader } from '../../../cli/formal-sources-io.js';
import { sourceAliasOf } from '../../../lib/model/product/layout.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../helpers/platform.js';

/** 本番の配置が与える別名(`@/` → `app/src`)。 */
const APP_ALIAS = sourceAliasOf(TEST_LAYOUT, { app: 'app' });

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 一時ディレクトリに木を作る(パス → 本文)。 */
function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'closure-'));
  created.push(root);
  for (const [relative, text] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }
  return root;
}

/** 3 ファイルの小さな木: entry → mid → leaf。 */
const THREE = {
  'lib/entry.ts': "import { mid } from './mid.js';\nexport const entry = mid + 1;\n",
  'lib/mid.ts': "import { leaf } from './sub/leaf.js';\nexport const mid = leaf + 1;\n",
  'lib/sub/leaf.ts': 'export const leaf = 1;\n',
};

describe('computeClosure', () => {
  it('相対 import を推移的に辿り、`.js` を `.ts` に解く(パスの昇順)', () => {
    const closure = computeClosure('lib/entry.ts', worktreeReader(tree(THREE)));

    expect(closure?.files.map((file) => file.path)).toEqual(['lib/entry.ts', 'lib/mid.ts', 'lib/sub/leaf.ts']);
    expect(closure?.unresolved).toEqual([]);
  });

  it('起点の束縛を絞る口(entrySpecifiers): 写し元の import のうち渡した指定子だけを辿り、その先は全部の辺を辿る', () => {
    const root = tree({
      'lib/entry.ts': "import { a } from './a.js';\nimport { b } from './b.js';\nexport const x = [a, b];\n",
      'lib/a.ts': "import { deep } from './deep.js';\nexport const a = deep;\n",
      'lib/b.ts': 'export const b = 1;\n',
      'lib/deep.ts': 'export const deep = 1;\n',
    });

    const all = computeClosure('lib/entry.ts', worktreeReader(root));
    const onlyA = computeClosure('lib/entry.ts', worktreeReader(root), null, new Set(['./a.js']));
    const none = computeClosure('lib/entry.ts', worktreeReader(root), null, new Set());

    expect(all?.files.map((file) => file.path)).toEqual(['lib/a.ts', 'lib/b.ts', 'lib/deep.ts', 'lib/entry.ts']);
    expect(onlyA?.files.map((file) => file.path)).toEqual(['lib/a.ts', 'lib/deep.ts', 'lib/entry.ts']);
    expect(none?.files.map((file) => file.path)).toEqual(['lib/entry.ts']);
  });

  it('絞っても、写し元より先の辺は絞らない(写し元の外で同じ指定子が出ても辿る)', () => {
    const root = tree({
      'lib/entry.ts': "import { a } from './a.js';\nexport const x = a;\n",
      'lib/a.ts': "import { b } from './b.js';\nexport const a = b;\n",
      'lib/b.ts': 'export const b = 1;\n',
    });

    const closure = computeClosure('lib/entry.ts', worktreeReader(root), null, new Set(['./a.js']));

    expect(closure?.files.map((file) => file.path)).toEqual(['lib/a.ts', 'lib/b.ts', 'lib/entry.ts']);
  });

  it('葉のファイルを変えると hash が動く(写し元自身は 1 バイトも変えていない)', () => {
    const before = computeClosure('lib/entry.ts', worktreeReader(tree(THREE)));
    const after = computeClosure(
      'lib/entry.ts',
      worktreeReader(tree({ ...THREE, 'lib/sub/leaf.ts': `${THREE['lib/sub/leaf.ts']}// 1 行足した\n` })),
    );

    expect(after?.hash).not.toBe(before?.hash);
    expect(after?.files.find((file) => file.path === 'lib/entry.ts')?.sha256).toBe(
      before?.files.find((file) => file.path === 'lib/entry.ts')?.sha256,
    );
  });

  it('同じ内容なら置き場所が違っても同じ hash(読む順・列挙順に依らない)', () => {
    const a = computeClosure('lib/entry.ts', worktreeReader(tree(THREE)));
    const reversed = Object.fromEntries(Object.entries(THREE).reverse());
    const b = computeClosure('lib/entry.ts', worktreeReader(tree(reversed)));

    expect(a?.hash).toBe(b?.hash);
  });

  it('パッケージ import(@kaninabe/ ・ node: ・ 素のパッケージ名)の先は閉包に入れない。`@/` も実装の木の根が無ければ境界', () => {
    const root = tree({
      'lib/entry.ts': [
        "import fs from 'node:fs';",
        "import { x } from '@kaninabe/runtime/ports';",
        "import { y } from '@/domain/jobs/retry';",
        "import ts from 'typescript';",
        "export const z = [fs, x, y, ts];",
      ].join('\n'),
      // 閉包に入れないことを見るための「罠」: パッケージ名と同じ綴りの相対ファイルがあっても拾わない。
      'typescript': 'export {};\n',
      'domain/jobs/retry.ts': 'export const y = 1;\n',
    });

    const closure = computeClosure('lib/entry.ts', worktreeReader(root));

    expect(closure?.files.map((file) => file.path)).toEqual(['lib/entry.ts']);
    expect(closure?.unresolved).toEqual([]);
  });

  it('`@/…` は実装の木のソースの根に解いて辿る(推移的に・拡張子補完と index も)', () => {
    const root = tree({
      'app/src/jobs/run.ts': "import { port } from '@/ports/queue';\nimport { pure } from '@/domain';\nexport const run = [port, pure];\n",
      'app/src/ports/queue.ts': "import type { Row } from '@/ports/row';\nexport const port = 1;\n",
      'app/src/ports/row.ts': 'export type Row = string;\n',
      'app/src/domain/index.ts': 'export const pure = 1;\n',
    });

    const closure = computeClosure('app/src/jobs/run.ts', worktreeReader(root), APP_ALIAS);

    expect(closure?.files.map((file) => file.path)).toEqual([
      'app/src/domain/index.ts',
      'app/src/jobs/run.ts',
      'app/src/ports/queue.ts',
      'app/src/ports/row.ts',
    ]);
    expect(closure?.unresolved).toEqual([]);
  });

  it('別名の綴りと行き先は配置が与える(別の配置の別名 `~srv/` を辿り、`@/` は境界になる)', () => {
    const files = {
      'app/server_code/entry.ts': "import { x } from '~srv/shared/x';\nimport { y } from '@/other';\nexport const e = [x, y];\n",
      'app/server_code/shared/x.ts': 'export const x = 1;\n',
      'app/src/other.ts': 'export const y = 1;\n',
    };
    const alias = sourceAliasOf(FOREIGN_LAYOUT, { app: 'app' });

    expect(alias).toEqual({ prefix: '~srv/', dir: 'app/server_code' });
    const closure = computeClosure('app/server_code/entry.ts', worktreeReader(tree(files)), alias);
    expect(closure?.files.map((file) => file.path)).toEqual(['app/server_code/entry.ts', 'app/server_code/shared/x.ts']);
    expect(closure?.unresolved).toEqual([]);
  });

  it('`@/…` の先の葉を変えると hash が動く(別名の先だけが変わった束を見逃さない)', () => {
    const files = {
      'app/src/entry.ts': "import { x } from '@/shared/x';\nexport const e = x;\n",
      'app/src/shared/x.ts': 'export const x = 1;\n',
    };
    const before = computeClosure('app/src/entry.ts', worktreeReader(tree(files)), APP_ALIAS);
    const after = computeClosure(
      'app/src/entry.ts',
      worktreeReader(tree({ ...files, 'app/src/shared/x.ts': 'export const x = 2;\n' })),
      APP_ALIAS,
    );

    expect(after?.hash).not.toBe(before?.hash);
  });

  it('`@/…` の実体が実装の木に無ければ unresolved(黙って閉包から落とさない)', () => {
    const root = tree({ 'app/src/entry.ts': "import { g } from '@/gone';\nexport const e = g;\n" });

    expect(computeClosure('app/src/entry.ts', worktreeReader(root), APP_ALIAS)?.unresolved).toEqual([
      { from: 'app/src/entry.ts', specifier: '@/gone' },
    ]);
  });

  it('`@kaninabe/…` は実装の木の根を渡しても境界のまま(`@/` だけが別名)', () => {
    const root = tree({
      'app/src/entry.ts': "import { r } from '@kaninabe/runtime';\nexport const e = r;\n",
      'app/src/st/runtime.ts': 'export const r = 1;\n',
    });

    expect(computeClosure('app/src/entry.ts', worktreeReader(root), APP_ALIAS)?.files.map((file) => file.path)).toEqual([
      'app/src/entry.ts',
    ]);
  });

  it('型だけの import も辿る(型と値を区別しない)', () => {
    const root = tree({
      'lib/entry.ts': "import type { T } from './types.js';\nexport type U = T;\n",
      'lib/types.ts': 'export type T = string;\n',
    });

    expect(computeClosure('lib/entry.ts', worktreeReader(root))?.files.map((file) => file.path)).toEqual([
      'lib/entry.ts',
      'lib/types.ts',
    ]);
  });

  it('循環 import で止まる(自己 import も)', () => {
    const root = tree({
      'lib/a.ts': "import './b.js';\nexport const a = 1;\n",
      'lib/b.ts': "import './a.js';\nimport './b.js';\nexport const b = 1;\n",
    });

    expect(computeClosure('lib/a.ts', worktreeReader(root))?.files.map((file) => file.path)).toEqual(['lib/a.ts', 'lib/b.ts']);
  });

  it('`./dir` は dir/index.ts に解く', () => {
    const root = tree({
      'lib/entry.ts': "export * from './dir';\n",
      'lib/dir/index.ts': 'export const d = 1;\n',
    });

    expect(computeClosure('lib/entry.ts', worktreeReader(root))?.files.map((file) => file.path)).toEqual([
      'lib/dir/index.ts',
      'lib/entry.ts',
    ]);
  });

  it('TS でないファイル(.sql)は葉で、import を探さない', () => {
    const root = tree({ 'm/001.sql': "-- import './other.js'\nselect 1;\n" });
    const closure = computeClosure('m/001.sql', worktreeReader(root));

    expect(closure?.files).toEqual([{ path: 'm/001.sql', sha256: sha256Of("-- import './other.js'\nselect 1;\n") }]);
  });

  it('実体の無い相対 import は unresolved に出す(黙って閉包から落とさない)', () => {
    const root = tree({ 'lib/entry.ts': "import { gone } from './gone.js';\nexport const e = gone;\n" });

    expect(computeClosure('lib/entry.ts', worktreeReader(root))?.unresolved).toEqual([
      { from: 'lib/entry.ts', specifier: './gone.js' },
    ]);
  });

  it('写し元そのものが無ければ null', () => {
    expect(computeClosure('lib/none.ts', worktreeReader(tree(THREE)))).toBeNull();
  });
});

describe('closureHash', () => {
  it('import の無い写し元 1 本でも「パス sha256」の式で出す(本文の sha256 とは別の値)', () => {
    const body = 'export const x = 1;\n';
    const closure = computeClosure('lib/x.ts', worktreeReader(tree({ 'lib/x.ts': body })));

    expect(closure?.hash).toBe(sha256Of(`lib/x.ts ${sha256Of(body)}\n`));
    expect(closure?.hash).not.toBe(sha256Of(body));
  });

  it('並びに依らない(パスの昇順に直してから連結する)', () => {
    const files = [
      { path: 'b.ts', sha256: 'b'.repeat(64) },
      { path: 'a.ts', sha256: 'a'.repeat(64) },
    ];

    expect(closureHash(files)).toBe(closureHash([...files].reverse()));
  });
});

describe('diffClosure', () => {
  const file = (p: string, h: string): { path: string; sha256: string } => ({ path: p, sha256: h });

  it('変わった・増えた・減ったファイルを名指す', () => {
    const delta = diffClosure(
      [file('a.ts', '1'), file('b.ts', '2'), file('gone.ts', '3')],
      [file('a.ts', '1'), file('b.ts', '22'), file('new.ts', '4')],
    );

    expect(delta.changed).toEqual([{ path: 'b.ts', before: '2', after: '22' }]);
    expect(delta.added).toEqual([file('new.ts', '4')]);
    expect(delta.removed).toEqual([file('gone.ts', '3')]);
  });
});

describe('computeClosure: 字句でない指定子は閉包が欠けた印(点検 6 回目 B6-1)', () => {
  it.each([
    ['置換のあるテンプレート', 'export const l = (x: string) => import(`@/composition/${x}/ai`);\n', '`@/composition/${x}/ai`'],
    ['変数', 'export const l = (x: string) => import(x);\n', 'x'],
    ['require の変数', 'export const l = (x: string) => require(x) as unknown;\n', 'x'],
  ])('%s: 入口の外のモジュールにあっても unresolved に opaque で載る(辺は作らない)', (_title, body, specifier) => {
    const root = tree({
      'app/src/entry.ts': "import { l } from '@/mid';\nexport const e = l;\n",
      'app/src/mid.ts': body,
      'app/src/composition/a/ai.ts': 'export const ai = 1;\n',
    });

    const closure = computeClosure('app/src/entry.ts', worktreeReader(root), APP_ALIAS);

    expect(closure?.files.map((file) => file.path)).toEqual(['app/src/entry.ts', 'app/src/mid.ts']);
    expect(closure?.unresolved).toEqual([{ from: 'app/src/mid.ts', specifier, opaque: true }]);
  });

  it('起点の束縛を絞っても(entrySpecifiers)、入口そのものの字句でない指定子は必ず載る(動的 import は呼べば読む)', () => {
    const root = tree({ 'app/src/entry.ts': "import { a } from '@/a';\nexport const e = async (x: string) => [a, await import(`@/${x}`)];\n", 'app/src/a.ts': '' });

    expect(computeClosure('app/src/entry.ts', worktreeReader(root), APP_ALIAS, new Set(['@/a']))?.unresolved).toEqual([
      { from: 'app/src/entry.ts', specifier: '`@/${x}`', opaque: true },
    ]);
  });

  it('字句の動的 import(置換の無いテンプレート)は辺になり、欠けたとは言わない', () => {
    const root = tree({ 'app/src/entry.ts': 'export const e = () => import(`@/a`);\n', 'app/src/a.ts': '' });

    const closure = computeClosure('app/src/entry.ts', worktreeReader(root), APP_ALIAS);

    expect(closure?.files.map((file) => file.path)).toEqual(['app/src/a.ts', 'app/src/entry.ts']);
    expect(closure?.unresolved).toEqual([]);
  });
});

describe('computeClosure: 素の指定子の許可表(点検 7 回目 B7-2)', () => {
  const files = new Map([
    ['app/src/entry.ts', "import { a } from '#comp/a';\nimport { b } from 'next/server';\nimport { c } from '@/mid';\nexport const x = [a, b, c];\n"],
    ['app/src/mid.ts', "import { d } from '~/d';\nimport { e } from 'node:path';\nexport const c = [d, e];\n"],
  ]);
  const read = (relative: string): string | null => files.get(relative) ?? null;
  const alias = { prefix: '@/', dir: 'app/src' };

  it('許可表を渡すと、表に無い素の指定子は unresolved に unlisted で載る(閉包の先のモジュールでも)', () => {
    const closure = computeClosure('app/src/entry.ts', read, alias, undefined, (specifier) => specifier.startsWith('next/') || specifier.startsWith('node:'));
    expect(closure?.unresolved).toEqual([
      { from: 'app/src/entry.ts', specifier: '#comp/a', unlisted: true },
      { from: 'app/src/mid.ts', specifier: '~/d', unlisted: true },
    ]);
    expect(closure?.files.map((file) => file.path)).toEqual(['app/src/entry.ts', 'app/src/mid.ts']);
  });

  it('許可表を渡さなければ(C24 の形)素の指定子は全部境界で、unresolved に出ない', () => {
    expect(computeClosure('app/src/entry.ts', read, alias)?.unresolved).toEqual([]);
  });

  it('許可表は hash に効かない(閉包のファイルは同じ)', () => {
    expect(computeClosure('app/src/entry.ts', read, alias, undefined, () => false)?.hash).toBe(computeClosure('app/src/entry.ts', read, alias)?.hash);
  });
});
