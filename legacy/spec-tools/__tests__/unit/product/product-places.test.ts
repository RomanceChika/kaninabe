/**
 * 製品の根の直下の手書きの置き場(`e2e-root` ・`env-template` ・`script-root` ・`app-resource`。部品化 ③-c6)と、それを読む側が置き場の配置から引くことのテスト。
 *
 * 固定するのは 4 点 —— ①実物の配置では、直書きしていた(`paths.ts` の旧い口が組んでいた)ときと同じパス ②キーの形(`relative_path`)が不正なものを解決しない
 * ③別の配置(架空の値)では読む側がその値に従い、Next.js の綴りの木は読まない ④実装の木を持たない製品は null。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { envScanRoots, envTemplateFile, readEnvTemplate, scanEnvReferences } from '../../../lib/config/env-scan.js';
import { walkerDir } from '../../../lib/generality/scan.js';
import { readBookInputs } from '../../../lib/generate/book-inputs-loader.js';
import { appResourcePath, e2eRootPath, EMPTY_LAYOUT, envTemplatePath, layoutKeyFits, scriptRootPath } from '../../../lib/model/product/layout.js';
import { parseSmoke } from '../../../lib/model/screen/parse-screen-smoke.js';
import { SpecReporter } from '../../../lib/model/parse-common.js';
import { YamlReader } from '../../../lib/model/yaml-reader.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

const NO_APP = { ...TEST_ROOTS, app: null };

describe('実物の配置: 旧い口が組んでいたときと同じパス', () => {
  it('E2E の置き場・製品の根の直下の名前つきの置き場・ハンドブックが写す資材', () => {
    expect(e2eRootPath(TEST_LAYOUT, TEST_ROOTS)).toBe('app/e2e');
    expect(envTemplatePath(TEST_LAYOUT, TEST_ROOTS)).toBe('app/.env.example');
    expect(scriptRootPath(TEST_LAYOUT, TEST_ROOTS)).toBe('app/scripts');
    expect(appResourcePath(TEST_LAYOUT, TEST_ROOTS, '_styles/ui.module.css')).toBe('app/src/app/_styles/ui.module.css');
    expect(appResourcePath(TEST_LAYOUT, TEST_ROOTS, 'globals.css')).toBe('app/src/app/globals.css');
    expect(appResourcePath(TEST_LAYOUT, TEST_ROOTS, '_components/state-badge.tsx')).toBe('app/src/app/_components/state-badge.tsx');
  });

  it('設定の参照の走査の根は、ソースの根・E2E・道具のスクリプトの順(仕組み側のパッケージの 2 本が続く)', () => {
    expect(envScanRoots(TEST_ROOTS, TEST_LAYOUT).slice(0, 3)).toEqual(['app/src', 'app/e2e', 'app/scripts']);
    expect(envTemplateFile(TEST_ROOTS, TEST_LAYOUT)).toBe('app/.env.example');
    expect(walkerDir(TEST_ROOTS, TEST_LAYOUT)).toBe('app/e2e');
  });

  it('実装の木を持たない製品は、どれも null(走査の根はパッケージの 2 本だけ)', () => {
    expect(e2eRootPath(TEST_LAYOUT, NO_APP)).toBeNull();
    expect(envTemplatePath(TEST_LAYOUT, NO_APP)).toBeNull();
    expect(scriptRootPath(TEST_LAYOUT, NO_APP)).toBeNull();
    expect(appResourcePath(TEST_LAYOUT, NO_APP, 'globals.css')).toBeNull();
    expect(envTemplateFile(NO_APP, TEST_LAYOUT)).toBeNull();
    expect(walkerDir(NO_APP, TEST_LAYOUT)).toBeNull();
    expect(envScanRoots(NO_APP, TEST_LAYOUT)).toHaveLength(2);
  });

  it('配置が役割を宣言していなければ null(黙って別の場所を見ない)', () => {
    expect(e2eRootPath(EMPTY_LAYOUT, TEST_ROOTS)).toBeNull();
    expect(envTemplatePath(EMPTY_LAYOUT, TEST_ROOTS)).toBeNull();
    expect(scriptRootPath(EMPTY_LAYOUT, TEST_ROOTS)).toBeNull();
    expect(appResourcePath(EMPTY_LAYOUT, TEST_ROOTS, 'globals.css')).toBeNull();
    expect(envTemplateFile(TEST_ROOTS, EMPTY_LAYOUT)).toBeNull();
  });
});

describe('キーの形: 基準の下の相対パス(relative_path)', () => {
  it('相対パスは区切りを含んでよいが、空・先頭の区切り・空のセグメント・`.` / `..`・空白は解決しない', () => {
    for (const bad of ['', '/x', 'a//b', 'a/', './x', 'a/../b', '..', 'a b']) {
      expect(appResourcePath(TEST_LAYOUT, TEST_ROOTS, bad), JSON.stringify(bad)).toBeNull();
      expect(layoutKeyFits(TEST_LAYOUT, 'app-resource', bad), JSON.stringify(bad)).toBe(false);
    }
    expect(layoutKeyFits(TEST_LAYOUT, 'app-resource', 'a/b.css')).toBe(true);
  });
});

describe('別の配置(架空の値): 読む側はその値に従い、Next.js の綴りの木は読まない', () => {
  it('置き場の解決', () => {
    expect(e2eRootPath(FOREIGN_LAYOUT, TEST_ROOTS)).toBe('app/journeys');
    expect(envTemplatePath(FOREIGN_LAYOUT, TEST_ROOTS)).toBe('app/etc/env.sample');
    expect(scriptRootPath(FOREIGN_LAYOUT, TEST_ROOTS)).toBe('app/etc/scripts');
    expect(appResourcePath(FOREIGN_LAYOUT, TEST_ROOTS, 'globals.css')).toBe('app/server_code/ui/assets/globals.css');
    expect(walkerDir(TEST_ROOTS, FOREIGN_LAYOUT)).toBe('app/journeys');
    expect(envScanRoots(TEST_ROOTS, FOREIGN_LAYOUT).slice(0, 3)).toEqual(['app/server_code', 'app/journeys', 'app/etc/scripts']);
    expect(envTemplateFile(TEST_ROOTS, FOREIGN_LAYOUT)).toBe('app/etc/env.sample');
  });

  it('設定の参照の走査と雛形の読み取りは、架空の置き場の木を読む', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'product-places-'));
    try {
      const put = (relative: string, body: string): void => {
        mkdirSync(path.dirname(path.join(repo, relative)), { recursive: true });
        writeFileSync(path.join(repo, relative), body);
      };
      put('app/journeys/walk.mts', 'const a = process.env.FOREIGN_E2E_KEY;\n');
      put('app/etc/scripts/tool.ts', 'const a = process.env.FOREIGN_SCRIPT_KEY;\n');
      put('app/e2e/ignored.mts', 'const a = process.env.NEXT_E2E_KEY;\n');
      put('app/etc/env.sample', 'FOREIGN_TEMPLATE_KEY=1\n');
      put('app/.env.example', 'NEXT_TEMPLATE_KEY=1\n');

      const names = scanEnvReferences(repo, TEST_ROOTS, FOREIGN_LAYOUT).references.map((reference) => reference.name).sort();
      expect(names).toEqual(['FOREIGN_E2E_KEY', 'FOREIGN_SCRIPT_KEY']);
      expect(readEnvTemplate(repo, TEST_ROOTS, FOREIGN_LAYOUT)).toEqual(['FOREIGN_TEMPLATE_KEY']);
      expect(readEnvTemplate(repo, TEST_ROOTS, TEST_LAYOUT)).toEqual(['NEXT_TEMPLATE_KEY']);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('ハンドブックが写す資材は、架空の置き場(app-resource)から読む', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'product-places-book-'));
    try {
      const put = (relative: string, body: string): void => {
        mkdirSync(path.dirname(path.join(repo, relative)), { recursive: true });
        writeFileSync(path.join(repo, relative), body);
      };
      put('app/server_code/ui/assets/globals.css', '.foreign {}\n');
      put('app/server_code/ui/assets/_styles/ui.module.css', '.foreign-ui {}\n');
      put('app/src/app/globals.css', '.next {}\n');

      const foreign = readBookInputs(repo, TEST_ROOTS, FOREIGN_LAYOUT, null);
      expect(foreign.globalsCss).toBe('.foreign {}\n');
      expect(foreign.uiCss).toBe('.foreign-ui {}\n');
      expect(foreign.stateBadgeSource).toBeUndefined();
      expect(readBookInputs(repo, TEST_ROOTS, TEST_LAYOUT, null).globalsCss).toBe('.next {}\n');
      expect(readBookInputs(repo, TEST_ROOTS, EMPTY_LAYOUT, null).globalsCss).toBeUndefined();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('smoke の implementation は、配置が決める E2E の置き場の下だけが許される', () => {
    const read = (layout: typeof TEST_LAYOUT, file: string) => {
      const reporter = new SpecReporter('screen.md');
      const root = new YamlReader({ smoke: [{ summary: '通る', implementation: `${file}::通る` }] }, '', reporter);
      return { smoke: parseSmoke(root, reporter, TEST_ROOTS, layout), findings: reporter.findings() };
    };

    expect(read(TEST_LAYOUT, 'app/e2e/smoke.spec.mts').smoke).toHaveLength(1);
    expect(read(FOREIGN_LAYOUT, 'app/journeys/smoke.spec.mts').smoke).toHaveLength(1);
    const wrong = read(FOREIGN_LAYOUT, 'app/e2e/smoke.spec.mts');
    expect(wrong.smoke).toEqual([]);
    expect(wrong.findings[0]?.message).toContain('"app/journeys/{ファイル}.spec.mts::{テスト名}" の形式ではありません');
    // 配置が E2E の置き場を宣言していなければ、置き場の無い製品と同じに書けない。
    expect(read(EMPTY_LAYOUT, 'app/e2e/smoke.spec.mts').smoke).toEqual([]);
  });
});
