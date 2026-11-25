/**
 * 本物の `generate`(`cli/generate-docs.ts`)が、**仕様の error があれば何も書かず**、**書き先が木の外 / リンクなら何も書かない**ことを別プロセスで見る。
 *
 * 監査の実測: ①(F-06)T12 など V 群の外の error があっても `generate` は生成した。②(F-02a)`ddl_migration: ../../../../escape_marker.sql` で
 * 木の外へ書いた。③(F-02b)コミットされたシンボリックリンク(ハンドブックの置き場 -> 外)を辿って外のディレクトリに 59 ファイル書いた。
 * 使い捨ての製品の写しに対して実行する(題材の fixture は触らない)。
 */

import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTemps, cliPath, copiedSample, declareToolWatchTest, editFile, fingerprintOf, SLOW, temp } from '../../helpers/book-entry-fixture.js';
import { runToolCli, TOOL_TREE } from '../../helpers/run-tool-cli.js';

afterAll(cleanupTemps);

/** 全部入りの generate を実行する。 */
function generate(root: string): ReturnType<typeof runToolCli> {
  return runToolCli(cliPath('generate-docs.ts'), TOOL_TREE, ['--root', root]);
}

/** 題材の表 1 枚の `ddl_migration` を書き換える。 */
function setDdlMigration(root: string, name: string): void {
  editFile(root, 'docs/specs/backend/data/tables/holds.md', (text) => text.replace(/^ddl_migration: .*$/m, `ddl_migration: ${name}`));
}

describe('generate の出口', () => {
  it(
    '本の根の下の宣言の無いファイルは generate --check が名指して赤にする(点検 13 回目 C13-7)',
    () => {
      const root = declareToolWatchTest(copiedSample('refuse-stray'));
      expect(generate(root).status).toBe(0);
      writeFileSync(path.join(root, 'docs/book/stray.html'), '<script>1</script>');

      const run = runToolCli(cliPath('generate-docs.ts'), TOOL_TREE, ['--root', root, '--check']);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('docs/book/stray.html は本の根の下にありますがどの生成器からも出ません');
    },
    SLOW,
  );

  it(
    '仕様の error(V 群の外の T12: migration の名前の食い違い)があれば、何も書かずに止まる',
    () => {
      const root = declareToolWatchTest(copiedSample('refuse-error'));
      setDdlMigration(root, '20260912120203_ddl_wrong_name.sql');
      const before = fingerprintOf(root);

      const run = generate(root);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('何も書かずに生成を中止します');
      expect(run.stderr).toContain('T12');
      expect(fingerprintOf(root)).toEqual(before);
    },
    SLOW,
  );

  it(
    '`ddl_migration: ../../../../escape_marker.sql` は読み込みで落ち、木の外にファイルを作らない',
    () => {
      const root = declareToolWatchTest(copiedSample('refuse-traversal'));
      setDdlMigration(root, '../../../../escape_marker.sql');
      const before = fingerprintOf(root);

      const run = generate(root);

      expect(run.status).toBe(1);
      expect(fingerprintOf(root)).toEqual(before);
      expect(existsSync(path.join(root, '../escape_marker.sql'))).toBe(false);
      expect(existsSync(path.resolve(root, '../../../../escape_marker.sql'))).toBe(false);
    },
    SLOW,
  );

  it(
    'コミットされたシンボリックリンク(ハンドブックの置き場 -> 外)を辿って外へ書かない',
    () => {
      const root = declareToolWatchTest(copiedSample('refuse-symlink'));
      const outside = temp('refuse-symlink-outside');
      mkdirSync(path.join(root, 'docs'), { recursive: true });
      symlinkSync(outside, path.join(root, 'docs', 'book'));

      const run = generate(root);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('書き込みの関所');
      expect(run.stderr).toContain('シンボリックリンク');
      expect(readdirSync(outside)).toEqual([]);
    },
    SLOW,
  );
});
