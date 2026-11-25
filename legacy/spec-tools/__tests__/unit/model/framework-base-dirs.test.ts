/**
 * 層と土台ディレクトリの**配置からの引き口**(framework-base-dirs.ts)の規約網羅テスト。
 *
 * 表は置き場の配置の `source-root` が宣言する。ここが見るのは、①本番の配置(Next.js)から引いた表の整合(土台のパスの形・生成物の欄・並び)と
 * ②**別の配置(架空の値)の表が、その値で読まれる**こと(層・土台・走査の入力・補助ファイルのどれもが、配置の値に従う。コアに Next.js の綴りは残っていない)。
 */

import { describe, expect, it } from 'vitest';
import {
  frameworkAuxFiles,
  frameworkBaseDirs,
  frameworkLayerNames,
  frameworkLayers,
  layoutBaseDirPath,
  productBaseDirPaths,
  structureOf,
  vocabularyScanDirs,
  vocabularyScanLayers,
} from '../../../lib/model/framework-base-dirs.js';
import { EMPTY_LAYOUT } from '../../../lib/model/product/layout.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../helpers/platform.js';

describe('層の宣言(コアの 4 名 + 配置が足す層)', () => {
  it('Next.js の配置: コアの 4 名のあとに components・app が並ぶ(生成物の並びのまま)', () => {
    expect(frameworkLayers(TEST_LAYOUT).map((layer) => layer.name)).toEqual(['domain', 'operation', 'infrastructure', 'composition', 'components', 'app']);
  });

  it('足した層の説明と閉世界の見張り役が、層の宣言に載る(走査の拡張子は載らない — 生成物の形を変えない)', () => {
    const added = frameworkLayers(TEST_LAYOUT).slice(4);
    expect(added.map((layer) => Object.keys(layer))).toEqual([
      ['name', 'role', 'closedWorld'],
      ['name', 'role', 'closedWorld'],
    ]);
    expect(frameworkLayerNames(TEST_LAYOUT)).toEqual(new Set(['domain', 'operation', 'infrastructure', 'composition', 'components', 'app']));
  });

  it('配置が宣言を持たない(空の配置)と、層はコアの 4 名だけ・土台は 0 件', () => {
    expect(frameworkLayers(EMPTY_LAYOUT).map((layer) => layer.name)).toEqual(['domain', 'operation', 'infrastructure', 'composition']);
    expect(structureOf(EMPTY_LAYOUT)).toBeNull();
    expect(frameworkBaseDirs(EMPTY_LAYOUT)).toEqual([]);
    expect(frameworkAuxFiles(EMPTY_LAYOUT)).toEqual([]);
  });
});

describe('土台ディレクトリの宣言(解いた表)', () => {
  const dirs = frameworkBaseDirs(TEST_LAYOUT);

  it('20 行が宣言順に並び、パスが重複せず、すべて src/{層}/ の下にある', () => {
    expect(dirs).toHaveLength(20);
    const paths = dirs.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    const layers = frameworkLayerNames(TEST_LAYOUT);
    for (const path of paths) {
      const segments = path.split('/');
      expect(segments[0]).toBe('src');
      expect(layers.has(segments[1] ?? '')).toBe(true);
      expect(segments.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('生成物の JSON と同じキーの並びで返す(root / path / role / generated / vocabularyScan / layout / perSpec / sdkPackages)', () => {
    for (const entry of dirs) {
      expect(Object.keys(entry)).toEqual(['root', 'path', 'role', 'generated', 'vocabularyScan', 'layout', 'perSpec', 'sdkPackages']);
    }
  });

  it('SDK を宣言した土台は接続層だけ(B9-4。宣言の無い土台は空)', () => {
    expect(dirs.filter((entry) => entry.sdkPackages.length > 0).map((entry) => [entry.path, entry.sdkPackages])).toEqual([['src/infrastructure/supabase', ['@supabase/*']]]);
  });

  it('説明(role)が空でなく、生成物の置き場は語彙漏れの走査に載せない(生成器が正なので二重に見ない)', () => {
    for (const entry of dirs) {
      expect(entry.role.trim()).not.toBe('');
      if (entry.generated) expect(entry.vocabularyScan).toBe(false);
    }
  });

  it('実行時パッケージの根に住んでいる土台の全数(移した分だけが載る。製品のソースの根ではなくパッケージのソースの根から解く)', () => {
    expect(dirs.filter((entry) => entry.root === 'framework').map((entry) => entry.path)).toEqual([
      'src/domain/engine',
      'src/operation/_template',
    ]);
  });

  it('スタックの層の下の土台は、配置の値が持つ綴りで解かれる(ルーティング層・UI 部品の層)', () => {
    const paths = dirs.map((entry) => entry.path);
    expect(paths.slice(-4)).toEqual(['src/app/_actions/platform', 'src/app/api/inbound', 'src/app/_screens/generated', 'src/components/usecase/generated']);
  });
});

describe('製品の木の土台のパスの集合(逆引き・閉世界が使う口)', () => {
  it('製品の根を接いだ形で、製品の木の土台と、土台の表に載せていない手書きの置き場を返す(実行時パッケージの行は含めない)', () => {
    const paths = productBaseDirPaths(TEST_LAYOUT, 'app');
    expect(paths.has('app/src/operation/shared')).toBe(true);
    expect(paths.has('app/src/infrastructure/supabase')).toBe(true);
    expect(paths.has('app/src/composition/shared')).toBe(true);
    expect(paths.has('app/src/domain/engine')).toBe(false);
    expect(paths.has('app/src/operation/_template')).toBe(false);
  });

  it('製品の根からの相対(空文字)でも引ける・実装の木が無い(null)と空', () => {
    expect(productBaseDirPaths(TEST_LAYOUT, '').has('src/operation/jobs')).toBe(true);
    expect(productBaseDirPaths(TEST_LAYOUT, null).size).toBe(0);
    expect(productBaseDirPaths(EMPTY_LAYOUT, 'app').size).toBe(0);
  });

  it('層ごとの土台の名前: operation は共有物・ジョブ基盤・保存点・テスト支援の 4 つ', () => {
    const operation = [...productBaseDirPaths(TEST_LAYOUT, 'app')].filter((path) => path.startsWith('app/src/operation/')).map((path) => path.slice('app/src/operation/'.length));
    expect(new Set(operation)).toEqual(new Set(['shared', 'jobs', 'usecase', '__tests__']));
  });

  it('配線の層の土台に、載せていない手書きの置き場 shared が入る(土台の表には載らない)', () => {
    const composition = [...productBaseDirPaths(TEST_LAYOUT, 'app')].filter((path) => path.startsWith('app/src/composition/')).map((path) => path.slice('app/src/composition/'.length));
    expect(new Set(composition)).toEqual(new Set(['jobs', 'usecase', 'platform', 'inbound', '__tests__', 'shared']));
    expect(frameworkBaseDirs(TEST_LAYOUT).map((entry) => entry.path)).not.toContain('src/composition/shared');
  });
});

describe('土台 1 つの置き場(層と相対パスで指す)', () => {
  it('製品の根を接いだ形で返し、宣言されていない土台・実装の木が無いときは null', () => {
    expect(layoutBaseDirPath(TEST_LAYOUT, 'app', 'operation', 'usecase')).toBe('app/src/operation/usecase');
    expect(layoutBaseDirPath(TEST_LAYOUT, '', 'infrastructure', '__tests__')).toBe('src/infrastructure/__tests__');
    expect(layoutBaseDirPath(TEST_LAYOUT, 'app', 'operation', 'nowhere')).toBeNull();
    expect(layoutBaseDirPath(TEST_LAYOUT, 'app', 'nowhere', 'usecase')).toBeNull();
    expect(layoutBaseDirPath(TEST_LAYOUT, null, 'operation', 'usecase')).toBeNull();
    expect(layoutBaseDirPath(EMPTY_LAYOUT, 'app', 'operation', 'usecase')).toBeNull();
  });

  it('実行時パッケージの土台は製品の木の置き場ではない(null)', () => {
    expect(layoutBaseDirPath(TEST_LAYOUT, 'app', 'domain', 'engine')).toBeNull();
  });
});

describe('語彙漏れの走査に載せる置き場(W1 が使う口)', () => {
  it('vocabularyScan: true の行だけを宣言順に、根を添えて返す(2 つの根にまたがる)', () => {
    expect(vocabularyScanDirs(TEST_LAYOUT)).toEqual([
      { path: 'src/domain/engine', root: 'framework' },
      { path: 'src/operation/_template', root: 'framework' },
      { path: 'src/operation/jobs', root: 'product' },
      { path: 'src/infrastructure/supabase', root: 'product' },
    ]);
  });

  it('層ぜんたいを走査に載せる根: 共有の部品の層 components が .ts / .tsx で載る(製品の根を接いだ形)', () => {
    expect(vocabularyScanLayers(TEST_LAYOUT, 'app')).toEqual([{ dir: 'app/src/components', extensions: ['.ts', '.tsx'] }]);
    expect(vocabularyScanLayers(TEST_LAYOUT, null)).toEqual([]);
    expect(vocabularyScanLayers(EMPTY_LAYOUT, 'app')).toEqual([]);
  });
});

describe('補助ファイルの宣言(集約ディレクトリの中の閉世界)', () => {
  it('operation の補助ファイルは IF 宣言だけである', () => {
    expect(frameworkAuxFiles(TEST_LAYOUT)).toEqual([{ layer: 'operation', file: 'ports.ts', role: '操作が宣言する IF(infrastructure が型として実装する唯一の入口)' }]);
  });
});

describe('別の配置(架空の値)の表は、その値で読まれる', () => {
  it('層: コアの 4 名のあとに、架空の配置が足した層が宣言順に並ぶ(Next.js の層は出ない)', () => {
    expect(frameworkLayers(FOREIGN_LAYOUT).map((layer) => layer.name)).toEqual(['domain', 'operation', 'infrastructure', 'composition', 'handlers', 'wiring', 'endpoints', 'ui']);
  });

  it('土台のパス: 架空のソースの根と、架空の実行時パッケージのソースの根から解かれる', () => {
    const dirs = frameworkBaseDirs(FOREIGN_LAYOUT);
    expect(dirs.map((entry) => `${entry.root}:${entry.path}`)).toEqual([
      'framework:rt_code/domain/kernel',
      'product:server_code/domain/built',
      'product:server_code/operation/common',
      'product:server_code/operation/usecase',
      'product:server_code/operation/__tests__',
      'product:server_code/infrastructure/connectors',
      'product:server_code/infrastructure/__tests__',
      'product:server_code/handlers/saves',
      'product:server_code/wiring/saves',
      'product:server_code/wiring/webhooks',
      'product:server_code/endpoints/hooks/in',
      'product:server_code/ui/parts',
      'product:server_code/ui/forms',
    ]);
  });

  it('製品の木の土台の集合・土台 1 つの置き場・走査の入力・補助ファイルが、架空の値に従う', () => {
    expect([...productBaseDirPaths(FOREIGN_LAYOUT, 'app')].sort()).toEqual(
      [
        'app/server_code/domain/built',
        'app/server_code/operation/common',
        'app/server_code/operation/usecase',
        'app/server_code/operation/__tests__',
        'app/server_code/infrastructure/connectors',
        'app/server_code/infrastructure/__tests__',
        'app/server_code/handlers/saves',
        'app/server_code/wiring/saves',
        'app/server_code/wiring/webhooks',
        'app/server_code/wiring/misc',
        'app/server_code/endpoints/hooks/in',
        'app/server_code/ui/parts',
        'app/server_code/ui/forms',
      ].sort(),
    );
    expect(layoutBaseDirPath(FOREIGN_LAYOUT, 'app', 'operation', 'common')).toBe('app/server_code/operation/common');
    // コアが前提にする土台(保存点の hooks)は、別の配置も宣言する(宣言が無い配置は定義の検査が止める)。宣言の無い土台は null。
    expect(layoutBaseDirPath(FOREIGN_LAYOUT, 'app', 'operation', 'usecase')).toBe('app/server_code/operation/usecase');
    expect(layoutBaseDirPath(FOREIGN_LAYOUT, 'app', 'composition', 'jobs')).toBeNull();
    expect(vocabularyScanDirs(FOREIGN_LAYOUT)).toEqual([
      { path: 'rt_code/domain/kernel', root: 'framework' },
      { path: 'server_code/operation/common', root: 'product' },
      { path: 'server_code/infrastructure/connectors', root: 'product' },
    ]);
    expect(vocabularyScanLayers(FOREIGN_LAYOUT, 'app')).toEqual([{ dir: 'app/server_code/ui', extensions: ['.ts'] }]);
    expect(frameworkAuxFiles(FOREIGN_LAYOUT)).toEqual([{ layer: 'operation', file: 'iface.ts', role: '操作が宣言する IF' }]);
  });

  it('架空の配置の表のどこにも、Next.js の綴りが残っていない', () => {
    const text = JSON.stringify([frameworkLayers(FOREIGN_LAYOUT), frameworkBaseDirs(FOREIGN_LAYOUT), frameworkAuxFiles(FOREIGN_LAYOUT)]);
    // コアが前提にする土台の名前 `operation/usecase`(保存点の hooks)は別の配置にも出る。Next.js の綴りは、足す層の下の綴りで見る。
    expect(text).not.toMatch(/_actions|_screens|components|usecase\/generated|composition\/usecase|inbound|supabase|"src\/|app\//);
  });
});
