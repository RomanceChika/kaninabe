/**
 * アプリの枠の後段 Next.js の層と土台の表(`STRUCTURE`)が、**表の外の事実**と食い違わないことのテスト(部品化 ③-c6)。
 *
 * 表の整合そのもの(層の重なり・`placedBy` ほか)は配置の定義の検査(`layout-structure.test.ts`)が見る。ここが見るのは、検査が中を見られない 2 点 ——
 * ①受信口の置き場の行が名指すキーの見本が、**コアの正**(`lib/inbound/inbound-url.ts` の受信口の URL)から外れていないこと(後段の値はコアの関数を値で import できない)
 * ②実行時パッケージの土台の行(`root: 'framework'`)の 2 本が、実行時パッケージのソースの中に**実在する**こと(表に書いた住所が腐っていない)。
 */

import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inboundUrlOf } from '../../../../lib/inbound/inbound-url.js';
import { FRAMEWORK_RUNTIME_DIR } from '../../../../lib/io/paths.js';
import { layoutPath } from '../../../../lib/model/product/layout.js';
import { NEXTJS_LAYOUT } from '../../../../lib/targets/nextjs/layout.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const STRUCTURE = NEXTJS_LAYOUT['source-root']?.structure;

describe('受信口の置き場の行のキーの見本は、コアの受信口の URL', () => {
  it('http-entry を書き込む役割に名指す行のキーは inboundUrlOf の形で、その URL の置き場が行の土台の中にある', () => {
    const rows = (STRUCTURE?.baseDirs ?? []).filter((entry) => entry.placedBy?.role === 'http-entry');

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.placedBy?.key).toBe(inboundUrlOf('sample_id'));
    const placed = layoutPath(NEXTJS_LAYOUT, '', 'http-entry', inboundUrlOf('any_integration'));
    const source = layoutPath(NEXTJS_LAYOUT, '', 'source-root');
    expect(placed?.startsWith(`${source}/${row?.layer}/${row?.dir}/`)).toBe(true);
  });
});

describe('実行時パッケージの土台(root: framework)の行は、実行時パッケージのソースに実在する', () => {
  it('2 行すべて(層 / 土台)がディレクトリとして実在する', () => {
    const rows = (STRUCTURE?.baseDirs ?? []).filter((entry) => entry.root === 'framework');

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const directory = `${REPO_ROOT}${FRAMEWORK_RUNTIME_DIR}/${STRUCTURE?.runtimeSource}/${row.layer}/${row.dir}`;
      expect(existsSync(directory) && statSync(directory).isDirectory(), directory).toBe(true);
    }
  });
});
