/**
 * 指定子の解き方を変える設定の許可表(`lib/job/module-resolution-config.ts`。点検 7 回目 B7-2)の表のテスト。
 * 正例(製品の実物の形)・負例(別名を足す欄)・境界(`./` の有無・コメントつきの tsconfig・別名を持たない配置)を並べる。
 */

import { describe, expect, it } from 'vitest';
import { packageJsonResolutionProblem, tsconfigPathsProblem } from '../../../lib/job/module-resolution-config.js';

describe('packageJsonResolutionProblem', () => {
  it.each([
    ['製品の実物の欄', { name: 'app', version: '0.1.0', private: true, engines: {}, scripts: {}, dependencies: {}, devDependencies: {}, overrides: {} }],
    ['空', {}],
    ['type / packageManager / peerDependencies', { type: 'module', packageManager: 'npm@10', peerDependencies: {} }],
  ])('%s → 通る', (_name, value) => {
    expect(packageJsonResolutionProblem(JSON.stringify(value))).toBeNull();
  });

  it.each([
    ['B7-2 の反例: imports(#comp/*)', { name: 'app', imports: { '#comp/*': './src/composition/*.ts' } }, 'imports'],
    ['exports(自己参照の行き先)', { name: 'app', exports: { './x': './src/x.ts' } }, 'exports'],
    ['main', { main: './src/index.ts' }, 'main'],
    ['browser', { browser: { './a': './b' } }, 'browser'],
    ['workspaces(表に無い欄)', { workspaces: ['x'] }, 'workspaces'],
    ['複数', { imports: {}, exports: {} }, 'imports・exports'],
  ])('%s → error', (_name, value, reason) => {
    expect(packageJsonResolutionProblem(JSON.stringify(value))).toContain(reason);
  });

  it.each([
    ['JSON でない', '{', 'JSON'],
    ['配列', '[]', '最上位'],
  ])('境界: %s → error(読めないものは通さない)', (_name, text, reason) => {
    expect(packageJsonResolutionProblem(text)).toContain(reason);
  });
});

describe('tsconfigPathsProblem', () => {
  const alias = { prefix: '@/', dir: 'src' };
  const config = (options: Record<string, unknown>, extra: Record<string, unknown> = {}): string => JSON.stringify({ compilerOptions: options, ...extra });

  it.each([
    ['製品の実物(./src/*)', config({ strict: true, paths: { '@/*': ['./src/*'] } })],
    ['./ なし', config({ paths: { '@/*': ['src/*'] } })],
    ['paths なし', config({ strict: true })],
    ['compilerOptions なし', '{}'],
    ['コメントつき(JSON with comments)', '{\n  // 別名\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },\n}\n'],
  ])('%s → 通る', (_name, text) => {
    expect(tsconfigPathsProblem('tsconfig.json', text, alias)).toBeNull();
  });

  it.each([
    ['B7-2 の反例: 別名を足す(~/*)', config({ paths: { '@/*': ['./src/*'], '~/*': ['./src/*'] } }), '`paths` が配置の別名'],
    ['別名の行き先を変える', config({ paths: { '@/*': ['./src/composition/*'] } }), '`paths` が配置の別名'],
    ['行き先を 2 つにする', config({ paths: { '@/*': ['./src/*', './lib/*'] } }), '`paths` が配置の別名'],
    ['baseUrl(素の綴りを自分のソースに解く)', config({ baseUrl: '.', paths: { '@/*': ['./src/*'] } }), 'baseUrl'],
    ['rootDirs', config({ rootDirs: ['src', 'gen'] }), 'rootDirs'],
    ['extends', config({}, { extends: './tsconfig.base.json' }), 'extends'],
    ['paths が配列', config({ paths: [] }), 'オブジェクトでない'],
    ['compilerOptions が配列', JSON.stringify({ compilerOptions: [] }), 'オブジェクトでない'],
    ['構文として読めない', '{ "compilerOptions": ', '構文'],
  ])('%s → error', (_name, text, reason) => {
    expect(tsconfigPathsProblem('tsconfig.json', text, alias)).toContain(reason);
  });

  it('境界: 配置が別名を持たない(null)なら paths は空でなければ error', () => {
    expect(tsconfigPathsProblem('tsconfig.json', config({ paths: { '@/*': ['./src/*'] } }), null)).toContain('`paths` が配置の別名');
    expect(tsconfigPathsProblem('tsconfig.json', config({ paths: {} }), null)).toBeNull();
  });
});
