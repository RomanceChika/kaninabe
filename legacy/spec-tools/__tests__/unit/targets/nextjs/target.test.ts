/**
 * アプリの枠の後段 Next.js(`role: app_frame`)。置き場の役割 → パスの値(`ProductLayout`)だけを持ち、検査も生成器も登録しない。
 *
 * 値が契約を満たすこと・語彙の全役割を宣言していること・ハンドブックの入口が読めるよう型だけの import しか持たないこと、を固定する。
 * パスの解決そのものは `model/product/layout.test.ts`、置き場の綴りがこの置き場の外に無いことは `gates/platform-spellings.test.ts` が見る。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layoutDefinitionProblems } from '../../../../lib/model/product/layout-definition.js';
import { LAYOUT_ROLES } from '../../../../lib/model/product/layout.js';
import { selectTargetSet } from '../../../../lib/target-api/contract.js';
import { NEXTJS_LAYOUT } from '../../../../lib/targets/nextjs/layout.js';
import { NEXTJS_TARGET } from '../../../../lib/targets/nextjs/target.js';
import { NEXTJS_BROWSER_DEFENSE } from '../../../../lib/targets/nextjs/browser-defense.js';
import { browserDefenseProblems } from '../../../../lib/model/product/browser-defense.js';
import { SUPABASE_TARGET } from '../../../../lib/targets/supabase/target.js';
import { TEST_GENERATOR_IDS } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

describe('NEXTJS_TARGET', () => {
  it('アプリの枠の後段(role: app_frame)で、置き場の配置とブラウザ側の守りの宣言を持ち、守りを配る生成器 3 本を登録する(検査は登録しない)', () => {
    expect(NEXTJS_TARGET).toMatchObject({ id: 'nextjs', role: 'app_frame', verifiers: [] });
    expect(NEXTJS_TARGET.generators.map((generator) => generator.id)).toEqual(['code-browser-defense', 'code-browser-defense-tests', 'code-paid-entry-tests']);
    expect(NEXTJS_TARGET.layout).toBe(NEXTJS_LAYOUT);
    expect(NEXTJS_TARGET.browserDefense).toBe(NEXTJS_BROWSER_DEFENSE);
    expect(browserDefenseProblems(NEXTJS_BROWSER_DEFENSE)).toEqual([]);
  });

  it('プラットフォームの後段と一緒に契約を満たして選べる(app_frame は高々 1 つ)', () => {
    expect(selectTargetSet([SUPABASE_TARGET, NEXTJS_TARGET], TEST_ROOTS, TEST_GENERATOR_IDS).ok).toBe(true);
    expect(selectTargetSet([SUPABASE_TARGET, NEXTJS_TARGET, { ...NEXTJS_TARGET, id: 'nextjs-again' }], TEST_ROOTS, TEST_GENERATOR_IDS).ok).toBe(false);
  });
});

describe('NEXTJS_LAYOUT', () => {
  it('語彙(39 役割)を全部宣言し、配置そのものの契約を満たす', () => {
    expect(Object.keys(NEXTJS_LAYOUT).sort()).toEqual([...LAYOUT_ROLES].sort());
    expect(layoutDefinitionProblems(NEXTJS_LAYOUT)).toEqual([]);
  });

  it('多重度: 製品の根とソースの根は 1 つ(アプリの枠の後段を選ぶ製品は実装の木を宣言する。下限 1 はコアの `LAYOUT_ROLE_MIN`)・HTTP の入口と受信の配線はキーごとに複数(下限 1 = 置き場の宣言が要る。実体は 0 でもよい)', () => {
    expect(NEXTJS_LAYOUT['product-root']?.multiplicity).toEqual({ min: 1, max: 1, key: 'none' });
    expect(NEXTJS_LAYOUT['source-root']?.multiplicity).toEqual({ min: 1, max: 1, key: 'none' });
    expect(NEXTJS_LAYOUT['http-entry']?.multiplicity).toEqual({ min: 1, max: 'many', key: 'url_path' });
    expect(NEXTJS_LAYOUT['composition-root']?.multiplicity).toEqual({ min: 1, max: 'many', key: 'integration_id' });
  });

  it('基準: 製品の根はリポジトリルート・ソースの根は製品の根・入口と配線はソースの根', () => {
    expect(['product-root', 'source-root', 'http-entry', 'composition-root'].map((role) => NEXTJS_LAYOUT[role as 'http-entry']?.base)).toEqual([
      null,
      'product-root',
      'source-root',
      'source-root',
    ]);
  });

  it('値の置き場のファイルが読むのは型だけ(ハンドブックの入口の閉包に、後段の契約・生成器・検査も、コアの土台の表も持ち込まない — 依存の向きは配置 → 土台の役割)', () => {
    const text = readFileSync(fileURLToPath(new URL('../../../../lib/targets/nextjs/layout.ts', import.meta.url)), 'utf-8');
    const imports = text.split('\n').filter((line) => /^import /.test(line));
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((line) => !line.startsWith('import type '))).toEqual([]);
  });

  it('層と土台の表を source-root が宣言する: 層はコアの 4 名に足す 2 つ(components・app)・土台は 20 行(実行時パッケージの 2 行を含む)・載せていない手書きの置き場は composition/shared', () => {
    const structure = NEXTJS_LAYOUT['source-root']?.structure;

    expect(structure?.layers.map((layer) => layer.name)).toEqual(['components', 'app']);
    expect(structure?.baseDirs).toHaveLength(20);
    expect(structure?.baseDirs.filter((entry) => entry.root === 'framework')).toHaveLength(2);
    expect(structure?.unlistedDirs.map((entry) => `${entry.layer}/${entry.dir}`)).toEqual(['composition/shared']);
    expect(structure?.runtimeSource).toBe('src');
  });
});
