/** SBOM の書き出し(`deps:check --sbom`。ASVS V15.1.2): 注入した exec で、コマンドの形・書き出し先・失敗の名指しを見る。 */

import { describe, expect, it } from 'vitest';
import { formatSboms, sbomFileOf, writeSboms } from '../../../lib/deps/sbom.js';
import { fakeIo } from './helpers.js';

const BOM = JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', components: [{ name: 'a' }, { name: 'b' }] });

describe('sbomFileOf(lockfile → 書き出し先)', () => {
  it.each([
    ['package-lock.json', 'tmp/deps-check/sbom-root.json'],
    ['docs/package-lock.json', 'tmp/deps-check/sbom-docs.json'],
    ['legacy/spec-tools/package-lock.json', 'tmp/deps-check/sbom-legacy-spec-tools.json'],
    ['tools/my_tool.x/package-lock.json', 'tmp/deps-check/sbom-tools-my-tool-x.json'],
  ])('%s', (lockfile, expected) => {
    expect(sbomFileOf(lockfile)).toBe(expected);
  });
});

describe('writeSboms', () => {
  it('lockfile ごとに npm sbom(CycloneDX・本番の部品のみ)をその場所で回し、JSON を書く', async () => {
    const calls: { cmd: string; args: readonly string[]; cwd: string }[] = [];
    const written: Record<string, string> = {};
    const io = fakeIo({ written, exec: (cmd, args, cwd) => (calls.push({ cmd, args, cwd }), { code: 0, stdout: BOM }) });
    const results = await writeSboms(io, ['package-lock.json', 'docs/package-lock.json'], '/r');
    expect(calls).toEqual([
      { cmd: 'npm', args: ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'], cwd: '/r' },
      { cmd: 'npm', args: ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'], cwd: '/r/docs' },
    ]);
    expect(Object.keys(written)).toEqual(['tmp/deps-check/sbom-root.json', 'tmp/deps-check/sbom-docs.json']);
    expect(written['tmp/deps-check/sbom-root.json']).toBe(`${BOM}\n`);
    expect(results.map((result) => [result.file, result.components])).toEqual([
      ['tmp/deps-check/sbom-root.json', 2],
      ['tmp/deps-check/sbom-docs.json', 2],
    ]);
  });

  it.each([
    ['終了コードが非 0', { code: 1, stdout: '', stderr: 'npm error missing' }, /終了コード 1/u],
    ['出力が JSON でない', { code: 0, stdout: 'not json' }, /CycloneDX の JSON ではありません/u],
    ['CycloneDX でない JSON', { code: 0, stdout: '{"bomFormat":"SPDX","components":[]}' }, /CycloneDX の JSON ではありません/u],
    ['components が配列でない', { code: 0, stdout: '{"bomFormat":"CycloneDX"}' }, /CycloneDX の JSON ではありません/u],
  ])('%s は書かずに未実施と名指す', async (_label, out, reason) => {
    const written: Record<string, string> = {};
    const [result] = await writeSboms(fakeIo({ written, exec: () => out }), ['package-lock.json'], '/r');
    expect(result?.file).toBeNull();
    expect(result?.reason).toMatch(reason);
    expect(written).toEqual({});
  });

  it('コマンドを回せなくても落とさず、ほかの lockfile は続ける', async () => {
    const written: Record<string, string> = {};
    const io = fakeIo({
      written,
      exec: (_cmd, _args, cwd) => {
        if (cwd === '/r') throw new Error('spawn failed');
        return { code: 0, stdout: BOM };
      },
    });
    const results = await writeSboms(io, ['package-lock.json', 'docs/package-lock.json'], '/r');
    expect(results[0]).toMatchObject({ file: null });
    expect(results[0]?.reason).toContain('spawn failed');
    expect(results[1]?.file).toBe('tmp/deps-check/sbom-docs.json');
    expect(Object.keys(written)).toEqual(['tmp/deps-check/sbom-docs.json']);
  });

  it('要約は書けた本数と、未実施の理由を出す', async () => {
    const io = fakeIo({ exec: (_cmd, _args, cwd) => (cwd === '/r' ? { code: 0, stdout: BOM } : { code: 1, stdout: '' }) });
    const lines = formatSboms(await writeSboms(io, ['package-lock.json', 'docs/package-lock.json'], '/r'));
    expect(lines[0]).toContain('1/2 本を書きました');
    expect(lines.join('\n')).toContain('tmp/deps-check/sbom-root.json(2 部品)');
    expect(lines.join('\n')).toContain('未実施 — docs/package-lock.json');
  });
});
