/** OSV の照会(偽の応答)と、audit の指摘との突き合わせ。 */

import { describe, expect, it } from 'vitest';
import { mergeAdvisories, runOsv } from '../../../lib/deps/osv.js';
import { fakeIo, finding } from './helpers.js';

const PKGS = [
  { name: 'a', version: '1.0.0', fromRegistry: true },
  { name: 'b', version: '2.0.0', fromRegistry: true },
];

/** a だけが GHSA-1(HIGH)に当たる偽の OSV。 */
function osvFetch(url: string, init?: { body?: unknown }): unknown {
  if (url.endsWith('/querybatch')) {
    const queries = (init?.body as { queries: unknown[] }).queries;
    return { results: queries.map((_q, i) => (i === 0 ? { vulns: [{ id: 'GHSA-1' }] } : {})) };
  }
  return { id: 'GHSA-1', aliases: ['CVE-9'], summary: '壊れている', database_specific: { severity: 'HIGH' } };
}

describe('runOsv', () => {
  it('当たった ID の詳細を引いて、重大度・別名つきの指摘にする', async () => {
    const out = await runOsv(fakeIo({ fetch: osvFetch }), 'package-lock.json', PKGS);
    expect(out.part.status).toBe('done');
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({ id: 'GHSA-1', pkg: 'a', version: '1.0.0', severity: 'high', level: 'red', aliases: ['CVE-9'], sources: ['osv'] });
  });

  it('1000 件ずつに分けて送る', async () => {
    const many = Array.from({ length: 2300 }, (_v, i) => ({ name: `p${String(i)}`, version: '1.0.0', fromRegistry: true }));
    const sizes: number[] = [];
    const io = fakeIo({ fetch: (url, init) => { const q = (init?.body as { queries: unknown[] }).queries; sizes.push(q.length); return { results: q.map(() => ({})) }; } });
    const out = await runOsv(io, 'l', many);
    expect(sizes).toEqual([1000, 1000, 300]);
    expect(out.part.status).toBe('done');
  });

  it.each([
    ['MAL- は critical', { id: 'MAL-2026-1', database_specific: {} }, 'critical', 'red'],
    ['重大度が無ければ unknown → 警告', { id: 'GHSA-2' }, 'unknown', 'warning'],
    ['MODERATE は警告', { id: 'GHSA-3', database_specific: { severity: 'MODERATE' } }, 'moderate', 'warning'],
  ])('%s', async (_name, detail, severity, level) => {
    const io = fakeIo({ fetch: (url, init) => (url.endsWith('/querybatch') ? { results: (init?.body as { queries: unknown[] }).queries.map((_q, i) => (i === 0 ? { vulns: [{ id: (detail as { id: string }).id }] } : {})) } : detail) });
    const out = await runOsv(io, 'l', PKGS);
    expect(out.findings[0]).toMatchObject({ severity, level });
  });

  it('通信失敗は未実施(半端な結果を無しに見せない)', async () => {
    const out = await runOsv(fakeIo({}), 'l', PKGS);
    expect(out.part.status).toBe('unavailable');
    expect(out.part.reason).toContain('OSV');
    expect(out.findings).toEqual([]);
  });

  it('応答の件数が問い合わせと合わなければ未実施', async () => {
    const out = await runOsv(fakeIo({ fetch: () => ({ results: [] }) }), 'l', PKGS);
    expect(out.part.status).toBe('unavailable');
  });

  it('詳細の取得で失敗しても未実施', async () => {
    const io = fakeIo({ fetch: (url) => { if (url.endsWith('/querybatch')) return { results: [{ vulns: [{ id: 'GHSA-1' }] }, {}] }; throw new Error('500'); } });
    expect((await runOsv(io, 'l', PKGS)).part.status).toBe('unavailable');
  });
});

describe('mergeAdvisories(二重化の突き合わせ)', () => {
  it('同じ部品で ID か別名が重なれば 1 本にまとめ、出どころを両方持つ', () => {
    const audit = [finding({ id: 'GHSA-1', pkg: 'a', severity: 'high' })];
    const osv = [finding({ id: 'GHSA-1', pkg: 'a', version: '1.0.0', sources: ['osv'] })];
    const merged = mergeAdvisories(audit, osv);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ sources: ['audit', 'osv'], version: '1.0.0' });
  });

  it('別名で重なっても同じ(OSV が CVE を主にしても audit の GHSA と一致)', () => {
    const merged = mergeAdvisories([finding({ id: 'GHSA-1', pkg: 'a' })], [finding({ id: 'CVE-9', aliases: ['GHSA-1'], pkg: 'a', sources: ['osv'] })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.aliases).toContain('CVE-9');
  });

  it('audit が重大度を言わなければ OSV の重大度を採って判定し直す', () => {
    const merged = mergeAdvisories([finding({ id: 'GHSA-1', severity: 'unknown', level: 'warning' })], [finding({ id: 'GHSA-1', severity: 'critical', sources: ['osv'] })]);
    expect(merged[0]).toMatchObject({ severity: 'critical', level: 'red' });
  });

  it('OSV だけが見つけたものは足す(別の出どころの価値)', () => {
    const merged = mergeAdvisories([], [finding({ id: 'GHSA-9', pkg: 'z', sources: ['osv'] })]);
    expect(merged).toHaveLength(1);
  });

  it('同じ部品・同じ advisory でも版が違えば別の指摘(2 つ目の版を 1 つ目に吸わせない)', () => {
    const audit = [finding({ id: 'GHSA-1', pkg: 'a', severity: 'high' })];
    const osv = [finding({ id: 'GHSA-1', pkg: 'a', version: '2.3.2', sources: ['osv'] }), finding({ id: 'GHSA-1', pkg: 'a', version: '4.0.7', sources: ['osv'] })];
    const merged = mergeAdvisories(audit, osv);
    expect(merged.map((f) => f.version)).toEqual(['2.3.2', '4.0.7']);
    expect(merged.every((f) => f.sources.includes('audit') && f.sources.includes('osv'))).toBe(true);
  });

  it('OSV が当てなかった audit の指摘は lockfile にあるその名前の版ごとに分ける(無ければ版の無いまま)', () => {
    const packages = [{ name: 'a', version: '4.0.7', fromRegistry: true }, { name: 'a', version: '2.3.2', fromRegistry: true }, { name: 'b', version: '1.0.0', fromRegistry: true }];
    const merged = mergeAdvisories([finding({ id: 'GHSA-1', pkg: 'a' }), finding({ id: 'GHSA-2', pkg: 'z' })], [], packages);
    expect(merged.map((f) => `${f.pkg}@${f.version ?? '-'}`)).toEqual(['a@2.3.2', 'a@4.0.7', 'z@-']);
  });

  it('部品が違えば別の指摘', () => {
    expect(mergeAdvisories([finding({ id: 'GHSA-1', pkg: 'a' })], [finding({ id: 'GHSA-1', pkg: 'b', sources: ['osv'] })])).toHaveLength(2);
  });
});
