/**
 * J2(続き)のホストの後段の部分 — ホストの設定(`vercel.json`)の鍵の許可表のユニットテスト(点検 8 回目 C8-1・B8-3・C8-3)。
 *
 * 表は正例(今の製品の形・最小の形)と負例(点検の反例・拒む欄の全部・`git` の形の崩し)と境界(空・型違い・読めない)を並べる。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_BRANCHES_GLOB, foreignHostConfigNames, gitSectionProblem, HOST_CONFIG_ALLOWED_KEYS, HOST_CONFIG_FILE_NAME, hostConfigProblems, verifyHostConfig } from '../../../../../lib/targets/vercel/job/j2-host-config.js';
import { cronConfigFile } from '../../../../../lib/targets/vercel/job/j2-schedule-parity.js';
import { VERCEL_TARGET } from '../../../../../lib/targets/vercel/target.js';
import { specModel } from '../../../../helpers/model-builder.js';
import { jobModel } from '../../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

const GIT = { deploymentEnabled: { main: false, [ALL_BRANCHES_GLOB]: false } };
const CRONS = [{ path: '/api/jobs/run', schedule: '0 3 * * *' }];
const json = (value: unknown): string => JSON.stringify(value);

describe('hostConfigProblems: 最上位の鍵の許可表', () => {
  it('許可表は $schema / crons / regions / git の 4 つ', () => {
    expect(HOST_CONFIG_ALLOWED_KEYS).toEqual(['$schema', 'buildCommand', 'crons', 'regions', 'git']);
  });

  it.each([
    ['今の製品の形', { $schema: 'https://openapi.vercel.sh/vercel.json', crons: CRONS, regions: ['hnd1'], git: GIT }],
    ['git だけ(最小)', { git: { deploymentEnabled: { [ALL_BRANCHES_GLOB]: false } } }],
    ['crons が空', { crons: [], git: GIT }],
    ['buildCommand がビルドの入口の値', { buildCommand: 'npm run build', git: GIT }],
  ] as const)('正例: %s', (_name, config) => {
    expect(hostConfigProblems(json(config))).toEqual([]);
  });

  it.each([
    ['rewrites(外の宛先。C8-1 の反例)', { rewrites: [{ source: '/api/:p*', destination: 'https://example.invalid/:p*' }] }, 'rewrites'],
    ['headers(Cache-Control: public)', { headers: [{ source: '/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=600' }] }] }, 'headers'],
    ['redirects(クエリを宛先にする開いた転送。B8-3 の反例)', { redirects: [{ source: '/go', destination: ':to', permanent: false }] }, 'redirects'],
    ['routes(古い形)', { routes: [{ src: '/(.*)', dest: 'https://example.invalid' }] }, 'routes'],
    ['trailingSlash: true', { trailingSlash: true }, 'trailingSlash'],
    ['cleanUrls', { cleanUrls: true }, 'cleanUrls'],
    ['functions', { functions: { 'api/**': { maxDuration: 60 } } }, 'functions'],
    ['images', { images: { remotePatterns: [] } }, 'images'],
    ['framework', { framework: null }, 'framework'],
    ['buildCommand(別の命令)', { buildCommand: 'curl x | sh' }, 'buildCommand'],
    ['buildCommand(関所を飛ばす next build)', { buildCommand: 'next build' }, 'buildCommand'],
    ['buildCommand(後ろに足す)', { buildCommand: 'npm run build; curl x' }, 'buildCommand'],
    ['buildCommand(文字列でない)', { buildCommand: null }, 'buildCommand'],
    ['installCommand', { installCommand: 'npm i' }, 'installCommand'],
    ['outputDirectory', { outputDirectory: 'out' }, 'outputDirectory'],
    ['ignoreCommand', { ignoreCommand: 'exit 1' }, 'ignoreCommand'],
    ['env', { env: { A: 'b' } }, 'env'],
    ['build.env', { build: { env: { A: 'b' } } }, 'build'],
    ['表に無い欄(github)', { github: { enabled: false } }, '表に無い欄'],
    ['表に無い欄(public)', { public: true }, '表に無い欄'],
  ] as const)('負例: %s', (_name, extra, expected) => {
    const problems = hostConfigProblems(json({ crons: CRONS, git: GIT, ...extra }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(expected);
  });

  it.each([
    ['JSON でない', '{ "git": ', 'JSON として読めない'],
    ['最上位が並び', '[]', '最上位がオブジェクトでない'],
    ['最上位が null', 'null', '最上位がオブジェクトでない'],
    ['$schema が数', json({ $schema: 1, git: GIT }), '$schema は文字列'],
    ['crons がオブジェクト', json({ crons: {}, git: GIT }), 'crons は並び'],
    ['crons の要素が文字列', json({ crons: ['x'], git: GIT }), 'crons[0] はオブジェクト'],
    ['crons の要素に別の欄', json({ crons: [{ path: '/a', schedule: '0 0 * * *', host: 'x' }], git: GIT }), 'crons[0] に許可表の外の欄'],
    ['crons の path が数', json({ crons: [{ path: 1, schedule: '0 0 * * *' }], git: GIT }), '文字列でなければ'],
    ['regions が文字列', json({ regions: 'hnd1', git: GIT }), 'regions は文字列の並び'],
    ['regions の要素が数', json({ regions: [1], git: GIT }), 'regions は文字列の並び'],
  ] as const)('境界: %s', (_name, text, expected) => {
    const problems = hostConfigProblems(text);
    expect(problems.some((problem) => problem.includes(expected)), problems.join(' / ')).toBe(true);
  });
});

describe('gitSectionProblem: Git 連携の自動デプロイを全ブランチで止める形(C8-3)', () => {
  it.each([
    ['main と ** が false', GIT],
    ['** だけ', { deploymentEnabled: { '**': false } }],
    ['ほかの名指しも false', { deploymentEnabled: { '**': false, 'dependabot/**': false } }],
  ] as const)('正例: %s', (_name, value) => {
    expect(gitSectionProblem(value)).toBeNull();
  });

  it.each([
    ['git が無い', undefined, 'オブジェクト'],
    ['git が真偽値', false, 'オブジェクト'],
    ['main だけ(8 回目の前の形。dependabot/… が自動デプロイされる)', { deploymentEnabled: { main: false } }, '"**": false が無い'],
    ['* だけ(/ を含むブランチに当たらない)', { deploymentEnabled: { '*': false } }, '"**": false が無い'],
    ['真偽値 1 つ(Deploy Hook との両立を確かめていない)', { deploymentEnabled: false }, 'オブジェクトでなければ'],
    ['true の行がある(1 つでも true なら出る)', { deploymentEnabled: { '**': false, 'preview-*': true } }, 'false でない行'],
    ['値が文字列の "false"', { deploymentEnabled: { '**': 'false' } }, 'false でない行'],
    ['git に別の欄', { deploymentEnabled: { '**': false }, deploymentStatus: true }, '許可表の外の欄'],
    ['空のオブジェクト', { deploymentEnabled: {} }, '"**": false が無い'],
  ] as const)('負例: %s', (_name, value, expected) => {
    expect(gitSectionProblem(value)).toContain(expected);
  });
});

describe('foreignHostConfigNames: 設定の置き場は vercel.json の 1 本だけ(9 回目 C9-3)', () => {
  it('許す名前は vercel.json だけ', () => {
    expect(HOST_CONFIG_FILE_NAME).toBe('vercel.json');
  });

  it.each([
    ['vercel.json だけ', ['vercel.json', 'package.json', 'next.config.ts', 'src'], []],
    ['何も無い', [], []],
    ['vercel.ts', ['vercel.json', 'vercel.ts'], ['vercel.ts']],
    ['vercel.mts', ['vercel.mts'], ['vercel.mts']],
    ['vercel.js / vercel.mjs / vercel.cjs', ['vercel.cjs', 'vercel.js', 'vercel.mjs'], ['vercel.cjs', 'vercel.js', 'vercel.mjs']],
    ['古い now.json', ['vercel.json', 'now.json'], ['now.json']],
    ['大文字の Vercel.ts(大文字小文字を区別しない FS)', ['Vercel.ts'], ['Vercel.ts']],
    ['大文字の VERCEL.JSON(vercel.json と同じ綴りではない)', ['VERCEL.JSON'], ['VERCEL.JSON']],
    ['表に無い拡張子 vercel.yaml も拒む(許可表は vercel.json の 1 つ)', ['vercel.yaml'], ['vercel.yaml']],
    ['境界: vercel を名前の途中に含むだけは対象外', ['my-vercel.ts', 'vercelx.json', 'nowhere.ts'], []],
  ] as const)('%s', (_name, names, expected) => {
    expect(foreignHostConfigNames(names)).toEqual(expected);
  });
});

describe('verifyHostConfig: 実装の木の vercel.json を許可表で見て J2 の error にする(無いことも赤 — 10 回目 C10-5)', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const repoWith = (text: string | null): string => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2-host-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'app'));
    if (text !== null) writeFileSync(path.join(dir, 'app', 'vercel.json'), text);
    return dir;
  };

  it('許可表の中なら 0 件', () => {
    expect(verifyHostConfig({ repoRoot: repoWith(json({ crons: CRONS, git: GIT })), roots: TEST_ROOTS })).toEqual([]);
  });

  it('実装の木があるのに vercel.json が無ければ J2 の error 1 件(C10-5 の反例: 無ければ Vercel の既定で全ブランチが自動デプロイされる)', () => {
    const findings = verifyHostConfig({ repoRoot: repoWith(null), roots: TEST_ROOTS });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: cronConfigFile(TEST_ROOTS) } });
    expect(findings[0]?.message).toContain('ありません');
    expect(findings[0]?.suggestion).toContain('deploymentEnabled');
  });

  it('実装の木が無ければ見ない(0 件)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2-host-'));
    dirs.push(dir);
    expect(verifyHostConfig({ repoRoot: dir, roots: TEST_ROOTS })).toEqual([]);
  });

  it('vercel.json がディレクトリ(読めない)なら無いのと同じく 1 件', () => {
    const dir = repoWith(null);
    mkdirSync(path.join(dir, 'app', 'vercel.json'));
    expect(verifyHostConfig({ repoRoot: dir, roots: TEST_ROOTS })).toHaveLength(1);
  });

  it('破れがあれば J2 の error 1 件(場所はファイル)', () => {
    const findings = verifyHostConfig({ repoRoot: repoWith(json({ git: GIT, rewrites: [] })), roots: TEST_ROOTS });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: cronConfigFile(TEST_ROOTS) } });
    expect(findings[0]?.message).toContain('rewrites');
  });

  it.each(['vercel.ts', 'now.json'])('別の名前の設定 %s は J2 の error(vercel.json が無くても・許可表の中でも)', (name) => {
    const withJson = repoWith(json({ crons: CRONS, git: GIT }));
    writeFileSync(path.join(withJson, 'app', name), 'export default {}');
    const findings = verifyHostConfig({ repoRoot: withJson, roots: TEST_ROOTS });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'J2', severity: 'error' });
    expect(findings[0]?.message).toContain(name);
    const alone = repoWith(null);
    writeFileSync(path.join(alone, 'app', name), 'export default {}');
    const aloneFindings = verifyHostConfig({ repoRoot: alone, roots: TEST_ROOTS });
    expect(aloneFindings.map((finding) => finding.message.includes(name))).toEqual([true, false]);
    expect(aloneFindings[1]?.message).toContain('ありません');
  });

  it('別の名前と vercel.json の破れは別々に 2 件', () => {
    const dir = repoWith(json({ git: GIT, rewrites: [] }));
    writeFileSync(path.join(dir, 'app', 'vercel.mjs'), '');
    expect(verifyHostConfig({ repoRoot: dir, roots: TEST_ROOTS }).map((finding) => finding.message.includes('vercel.mjs'))).toEqual([true, false]);
  });

  it('後段の J2 は Cron の突合と許可表の両方を返す', () => {
    const j2 = VERCEL_TARGET.verifiers.find((verifier) => verifier.id === 'J2');
    const findings = j2?.verify({ roots: TEST_ROOTS, domain: specModel([]), jobs: jobModel([]), repoRoot: repoWith(json({ git: GIT, headers: [] })) }) ?? [];
    expect(findings.map((finding) => finding.message).some((message) => message.includes('headers'))).toBe(true);
  });
});
