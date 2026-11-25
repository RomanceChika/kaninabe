/**
 * 既定のアイコンの残骸の置き場(`defaultIconPath` と `loadBrandFiles` の `faviconIcoPath` / `faviconIcoExists`)のテスト。
 *
 * 置き場は置き場の配置(アプリの枠の後段が与える)の役割 `app-icon` が決める。**配置を差し替えると、残骸を探す先も差し替わる**
 * (Next.js と綴りの重ならない架空の配置で、Next.js の綴りが 1 つも出ない)。実在の確認だけは一時ディレクトリを読む(ローダー自身のテスト)。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultIconPath, loadBrandFiles } from '../../../../lib/model/design/loader.js';
import type { DesignBrand } from '../../../../lib/model/design/types.js';
import { EMPTY_LAYOUT } from '../../../../lib/model/product/layout.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** ロゴを宣言していない brand(既定の残骸の実在だけを見る)。 */
const BRAND: DesignBrand = { icon: null, appleIcon: null, ogImage: null, placeholder: null };

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 一時のリポジトリルートに、指定した相対パスの空ファイルを作る。 */
function repoWith(...files: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'brand-icon-'));
  created.push(root);
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), '');
  }
  return root;
}

describe('defaultIconPath', () => {
  it('配置の既定のアイコンの役割から引く(リポジトリルート相対)', () => {
    expect(defaultIconPath(TEST_ROOTS, TEST_LAYOUT)).toBe('app/src/app/favicon.ico');
    expect(defaultIconPath({ ...TEST_ROOTS, app: 'app' }, FOREIGN_LAYOUT)).toBe('app/server_code/ui/brand_default.png');
  });

  it('実装の木を持たない製品・配置に役割が無い構成では null(残骸もありえない)', () => {
    expect(defaultIconPath({ ...TEST_ROOTS, app: null }, TEST_LAYOUT)).toBeNull();
    expect(defaultIconPath(TEST_ROOTS, EMPTY_LAYOUT)).toBeNull();
  });
});

describe('loadBrandFiles: 既定のアイコンの残骸', () => {
  it('配置の置き場に実在すれば残っているとする(Next.js の置き場に在っても、この配置では残骸ではない)', () => {
    const roots = { ...TEST_ROOTS, app: 'app' };
    const root = repoWith('app/server_code/ui/brand_default.png', 'app/src/app/favicon.ico');

    const status = loadBrandFiles(root, roots, FOREIGN_LAYOUT, null);

    expect(status.faviconIcoPath).toBe('app/server_code/ui/brand_default.png');
    expect(status.faviconIcoExists).toBe(true);
    expect(loadBrandFiles(repoWith('app/src/app/favicon.ico'), roots, FOREIGN_LAYOUT, null).faviconIcoExists).toBe(false);
  });

  it('Next.js の配置では既定の置き場を見る・宣言した brand があるときも同じ', () => {
    const root = repoWith('app/src/app/favicon.ico');

    expect(loadBrandFiles(root, TEST_ROOTS, TEST_LAYOUT, null)).toMatchObject({ faviconIcoPath: 'app/src/app/favicon.ico', faviconIcoExists: true });
    expect(loadBrandFiles(root, TEST_ROOTS, TEST_LAYOUT, BRAND).faviconIcoExists).toBe(true);
  });
});
