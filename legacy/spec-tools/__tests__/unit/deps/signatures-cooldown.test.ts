/** 署名の検査と、公開日時の待ち(cooldown)。 */

import { describe, expect, it } from 'vitest';
import { cooldownFindings, fetchPublishTimes, isNotFound, registryMissingFindings, runSignatures } from '../../../lib/deps/signatures.js';
import { fakeIo } from './helpers.js';

describe('runSignatures', () => {
  it('node_modules が無ければ未実施(理由に npm ci を言う)', async () => {
    const out = await runSignatures(fakeIo({}), 'package-lock.json', '/r');
    expect(out.part.status).toBe('unavailable');
    expect(out.part.reason).toContain('npm ci');
  });

  it.each([
    ['問題なし', '{"invalid":[],"missing":[]}', 0, 0],
    ['署名の不一致は赤', '{"invalid":[{"name":"a","version":"1.0.0"}],"missing":[]}', 1, 0],
    ['署名なしは警告', '{"invalid":[],"missing":[{"name":"b","version":"1.0.0"}]}', 0, 1],
  ])('%s', async (_name, stdout, reds, warns) => {
    const io = fakeIo({ dirs: ['sub/node_modules'], exec: () => ({ code: 0, stdout }) });
    const out = await runSignatures(io, 'sub/package-lock.json', '/r');
    expect(out.part.status).toBe('done');
    expect(out.findings.filter((f) => f.level === 'red')).toHaveLength(reds);
    expect(out.findings.filter((f) => f.level === 'warning')).toHaveLength(warns);
  });

  it.each([
    ['JSON でない', 'ERR'],
    ['error を返す', '{"error":{"code":"ENOTFOUND"}}'],
  ])('%s → 未実施', async (_name, stdout) => {
    const io = fakeIo({ dirs: ['node_modules'], exec: () => ({ code: 1, stdout }) });
    expect((await runSignatures(io, 'package-lock.json', '/r')).part.status).toBe('unavailable');
  });
});

describe('cooldownFindings', () => {
  const NOW = new Date('2026-10-22T12:00:00Z');
  const times = new Map([['a', { '1.0.0': '2026-10-20T12:00:00Z', '0.9.0': '2026-10-01T00:00:00Z', '1.1.0': '2026-10-15T12:00:00Z' }]]);
  const pkg = (version: string, fromRegistry = true) => ({ name: 'a', version, fromRegistry });

  it.each([
    ['2 日前は待ちの警告', '1.0.0', true, 1],
    ['ちょうど 7 日前は対象外(7 日未満だけ)', '1.1.0', true, 0],
    ['3 週間前は対象外', '0.9.0', true, 0],
    ['登録簿由来でないものは見ない', '1.0.0', false, 0],
  ])('%s', (_name, version, fromRegistry, count) => {
    expect(cooldownFindings('l', [pkg(version, fromRegistry)], times, NOW)).toHaveLength(count);
  });

  // 7 回目 C7-7: 待ちを満たしたと言えない版は黙って飛ばさず赤(未実施にもしない)。境界: 経過 0 はちょうど公開の瞬間 = 待ちの中。
  describe('待ちを確かめられない版は赤(C7-7)', () => {
    const odd = new Map([['b', { '1.0.0': '2026-10-22T12:00:01Z', '2.0.0': '2026-10-22T12:00:00Z', '3.0.0': 'not-a-date', '4.0.0': '2026-11-30T00:00:00Z' }]]);
    const b = (version: string) => ({ name: 'b', version, fromRegistry: true });
    it.each([
      ['経過が負(1 秒後に公開)', '1.0.0', 'red', 'cooldown-future'],
      ['経過が負(約 1 か月後)', '4.0.0', 'red', 'cooldown-future'],
      ['経過ちょうど 0 は待ちの中(警告)', '2.0.0', 'warning', 'cooldown'],
      ['日時として読めない', '3.0.0', 'red', 'cooldown-time-missing'],
      ['目録の time にその版が無い', '9.9.9', 'red', 'cooldown-time-missing'],
      ['time の鍵が Object の持ち物の名前(constructor)', 'constructor', 'red', 'cooldown-time-missing'],
    ])('%s → %s', (_name, version, level, id) => {
      const found = cooldownFindings('l', [b(version)], odd, NOW);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ kind: 'cooldown', level, id, pkg: 'b', version });
    });
    it('目録そのものを引けなかった名前(通信の失敗)は何も言わない(未実施は part が言う)', () => {
      expect(cooldownFindings('l', [{ name: 'zzz', version: '1.0.0', fromRegistry: true }], odd, NOW)).toEqual([]);
    });
    it('目録の versions に無い版は registryMissingFindings に任せる(重ねて名指ししない)・versions にあって time に無い版は赤', () => {
      const versions = new Map([['b', new Set(['1.0.0', '8.0.0'])]]);
      expect(cooldownFindings('l', [b('9.9.9')], odd, NOW, versions)).toEqual([]);
      expect(cooldownFindings('l', [b('8.0.0')], odd, NOW, versions)).toMatchObject([{ id: 'cooldown-time-missing', level: 'red' }]);
    });
    it('登録簿由来でないものは time が無くても見ない', () => {
      expect(cooldownFindings('l', [{ name: 'b', version: '9.9.9', fromRegistry: false }], odd, NOW)).toEqual([]);
    });
  });

  it('指摘は警告で、公開日と経過日数を題に持つ', () => {
    const [found] = cooldownFindings('l', [pkg('1.0.0')], times, NOW);
    expect(found).toMatchObject({ kind: 'cooldown', level: 'warning', pkg: 'a', version: '1.0.0' });
    expect(found?.title).toContain('2026-10-20');
  });
});

describe('fetchPublishTimes', () => {
  it('名前ごとに 1 度だけ引き、scope 付きは %2f にする', async () => {
    const urls: string[] = [];
    const io = fakeIo({ fetch: (url) => { urls.push(url); return { time: { '1.0.0': '2026-01-01T00:00:00Z' }, versions: { '1.0.0': {} } }; } });
    const out = await fetchPublishTimes(io, ['a', 'a', '@s/b']);
    expect(out.part.status).toBe('done');
    expect(urls.sort()).toEqual(['https://registry.npmjs.org/%40s%2fb'.replace('%40', '@'), 'https://registry.npmjs.org/a']);
    expect(out.times.get('a')?.['1.0.0']).toBeDefined();
  });

  it('通信失敗は未実施(表は空)', async () => {
    const out = await fetchPublishTimes(fakeIo({}), ['a']);
    expect(out.part.status).toBe('unavailable');
    expect(out.times.size).toBe(0);
    expect(out.missing.size).toBe(0);
  });

  it('失敗は名前ごと: 404 は missing・通信の失敗はその名前だけ未実施・他の名前は引ける(4 回目 C4-5)', async () => {
    const io = fakeIo({
      fetch: (url) => {
        if (url.endsWith('/ghost')) throw Object.assign(new Error('HTTP 404'), { status: 404 });
        if (url.endsWith('/flaky')) throw Object.assign(new Error('HTTP 503'), { status: 503 });
        return { time: { '1.0.0': '2026-01-01T00:00:00Z' }, versions: { '1.0.0': {} } };
      },
    });
    const out = await fetchPublishTimes(io, ['a', 'ghost', 'flaky']);
    expect([...out.missing]).toEqual(['ghost']);
    expect(out.part).toMatchObject({ status: 'unavailable' });
    expect(out.part.reason).toContain('flaky');
    expect(out.part.reason).not.toContain('ghost');
    expect([...out.versions.keys()]).toEqual(['a']);
  });

  it('404 だけなら実施(赤は呼び手が数える)', async () => {
    const io = fakeIo({ fetch: () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); } });
    const out = await fetchPublishTimes(io, ['ghost']);
    expect(out.part.status).toBe('done');
    expect([...out.missing]).toEqual(['ghost']);
  });

  it('目録の形でない応答(versions が無い)は、その名前を未実施にする(黙って緑にしない)', async () => {
    const out = await fetchPublishTimes(fakeIo({ fetch: () => ({ time: {} }) }), ['a']);
    expect(out.part.status).toBe('unavailable');
    expect(out.versions.size).toBe(0);
  });
});

describe('isNotFound / registryMissingFindings', () => {
  it.each([
    [Object.assign(new Error('x'), { status: 404 }), true],
    [Object.assign(new Error('x'), { status: 500 }), false],
    [new Error('HTTP 404'), false],
    ['404', false],
    [null, false],
  ])('isNotFound(%s)', (error, expected) => {
    expect(isNotFound(error)).toBe(expected);
  });

  const lookup = { versions: new Map([['a', new Set(['1.0.0'])]]), missing: new Set(['ghost']) };
  it.each([
    ['目録にある版', { name: 'a', version: '1.0.0', fromRegistry: true }, []],
    ['目録に無い版', { name: 'a', version: '9.9.9', fromRegistry: true }, ['registry-version-missing']],
    ['登録簿に無い名前', { name: 'ghost', version: '1.0.0', fromRegistry: true }, ['registry-missing']],
    ['目録を引けなかった名前(通信)は言わない', { name: 'flaky', version: '1.0.0', fromRegistry: true }, []],
    ['登録簿から来ない部品は見ない', { name: 'ghost', version: '1.0.0', fromRegistry: false }, []],
  ])('%s', (_name, pkg, expected) => {
    const found = registryMissingFindings('l', [pkg], lookup);
    expect(found.map((f) => f.id)).toEqual(expected);
    expect(found.every((f) => f.level === 'red' && f.kind === 'lockfile')).toBe(true);
  });
});
