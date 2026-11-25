/**
 * 通し実行が実 DB に当てる生成テストの置き場(`lib/targets/supabase/samples/db-test-places.ts`)。
 *
 * Docker を起動できない環境でも、通し実行の 2 か所 —— 生成物から実行するテストを拾う口(`generatedTestFiles`)と、一時ツリーに置く vitest の設定の
 * `include`(`vitestConfig`)—— が**同じ置き場(置き場の配置の役割)から引かれ、配置の置き場と食い違わない**ことを固める:
 *   - 配置が各役割の置き場に置くテストのファイルを、拾う口が拾い、`include` の glob の下にも入る(2 か所と配置が一致する)
 *   - 別の配置(架空の値)に差し替えると、どちらも**その値**になる(Next.js の置き場の綴りは残らない)
 *   - 実装の木が無い製品・役割を決められない配置では 1 本も拾わない(空文字の接頭辞で全件が当たらない)
 */

import { describe, expect, it } from 'vitest';
import { layoutPath } from '../../../../../lib/model/product/layout.js';
import type { LayoutRole } from '../../../../../lib/model/product/layout.js';
import { EQUIVALENCE_TEST_ROLES, RLS_TEST_ROLES, generatedTestDirs, generatedTestIncludes, unplacedTestRoles } from '../../../../../lib/targets/supabase/samples/db-test-places.js';
import { generatedTestFiles } from '../../../../../lib/targets/supabase/samples/db-tests.js';
import { vitestConfig } from '../../../../../lib/targets/supabase/samples/db-tree.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

/** 生成物 1 本(中身は読まれない)。 */
function generated(layout: typeof TEST_LAYOUT, roles: readonly LayoutRole[]): ReadonlyMap<string, string> {
  return new Map(roles.map((role) => [layoutPath(layout, TEST_ROOTS.app, role, 'sample_name') ?? '', '// 生成']));
}

/** vitest の `include` の glob(`{dir}/**\/*.test.ts`)に、製品の根からの相対パスが入るか(この形だけを数える)。 */
function included(glob: string, relative: string): boolean {
  const dir = glob.slice(0, glob.length - '/**/*.test.ts'.length);
  return relative.startsWith(`${dir}/`) && relative.endsWith('.test.ts');
}

describe('samples:db の生成テストの置き場', () => {
  for (const [name, layout] of [['Next.js の値', TEST_LAYOUT], ['別の配置(架空の値)', FOREIGN_LAYOUT]] as const) {
    it(`${name}: 実 DB で実行する 3 種の置き場の根は、配置の逆引きの根と一致し、拾う口と vitest の include が同じ置き場を指す`, () => {
      const app = TEST_ROOTS.app ?? '';
      const eqFiles = generated(layout, EQUIVALENCE_TEST_ROLES);
      const rlsFiles = generated(layout, RLS_TEST_ROLES);
      const all = new Map([...eqFiles, ...rlsFiles]);
      const picked = generatedTestFiles(all, TEST_ROOTS, layout);

      // 拾う口: 種類ごとに、配置が置くファイルだけを拾う(取りこぼし・取り違いが無い)。
      expect(picked.equivalence).toEqual([...eqFiles.keys()].sort());
      expect(picked.rls).toEqual([...rlsFiles.keys()].sort());
      // vitest の include: 拾うファイルは、どれかの glob に入る(製品の根からの相対で)。
      const globs = generatedTestIncludes(layout, [...EQUIVALENCE_TEST_ROLES, ...RLS_TEST_ROLES]);
      expect(globs).toHaveLength(3);
      for (const file of [...picked.equivalence, ...picked.rls]) {
        const relative = file.slice(app.length + 1);
        expect(globs.some((glob) => included(glob, relative)), file).toBe(true);
      }
      // 設定の本文に、その glob がそのまま入る。
      const config = vitestConfig(layout).join('\n');
      for (const glob of globs) expect(config).toContain(`'${glob}'`);
      // 拾う口の置き場の印は、include の根と同じ置き場(製品の根を足したもの)。
      expect(generatedTestDirs(layout, TEST_ROOTS, [...EQUIVALENCE_TEST_ROLES, ...RLS_TEST_ROLES])).toEqual(
        globs.map((glob) => `${app}/${glob.slice(0, glob.length - '/**/*.test.ts'.length)}/`),
      );
    });
  }

  it('別の配置の値に差し替えると、置き場も include もその値になり、Next.js の置き場の綴りは残らない', () => {
    const globs = generatedTestIncludes(FOREIGN_LAYOUT, [...EQUIVALENCE_TEST_ROLES, ...RLS_TEST_ROLES]);
    expect(globs).toEqual([
      'server_code/checks/db/same/**/*.test.ts',
      'server_code/checks/db/same_save/**/*.test.ts',
      'server_code/checks/db/visibility/**/*.test.ts',
    ]);
    expect(vitestConfig(FOREIGN_LAYOUT).join('\n')).not.toContain('__tests__/generated');
  });

  it('実装の木が無い製品・役割を決められない配置では 1 本も拾わない(空文字の接頭辞にしない)', () => {
    const files = new Map([['app/src/infrastructure/__tests__/generated/rls/x.rls.test.ts', '//']]);
    expect(generatedTestFiles(files, { ...TEST_ROOTS, app: null }, TEST_LAYOUT)).toEqual({ equivalence: [], rls: [] });
    expect(generatedTestFiles(files, TEST_ROOTS, {})).toEqual({ equivalence: [], rls: [] });
    expect(generatedTestDirs({}, TEST_ROOTS, RLS_TEST_ROLES)).toEqual([]);
    expect(generatedTestIncludes({}, RLS_TEST_ROLES)).toEqual([]);
  });

  it('置き場を決められない役割は名指しで引ける(通し実行が「生成されていません」の原因として配置の欠落を言うため)。実装の木が無い製品は置き場が無いのが事実なので入らない', () => {
    const roles = [...EQUIVALENCE_TEST_ROLES, ...RLS_TEST_ROLES];
    expect(unplacedTestRoles({}, TEST_ROOTS, roles)).toEqual(roles);
    expect(unplacedTestRoles(TEST_LAYOUT, TEST_ROOTS, roles)).toEqual([]);
    expect(unplacedTestRoles({ ...TEST_LAYOUT, 'rls-test': undefined }, TEST_ROOTS, roles)).toEqual(['rls-test']);
    expect(unplacedTestRoles({}, { ...TEST_ROOTS, app: null }, roles)).toEqual([]);
  });
});
