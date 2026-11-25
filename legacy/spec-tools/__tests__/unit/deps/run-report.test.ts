/** 検査全体(偽の口で通す)・lockfile の発見と読み取り・鮮度の言い方。 */

import { describe, expect, it } from 'vitest';
import { describeFreshness, formatDepsReport } from '../../../lib/deps/report.js';
import { discoverLockfiles, lockfileDigest, parseLockedPackages } from '../../../lib/deps/lockfile.js';
import { runDepsCheck } from '../../../lib/deps/run.js';
import { applyShipGate } from '../../../lib/deps/ship-gate.js';
import { ACCEPTED_FILE } from '../../../lib/deps/types.js';
import { auditJson, fakeIo, lockfile, SRI } from './helpers.js';
import type { FakeSpec } from './helpers.js';

const LOCK = lockfile([{ key: 'node_modules/a', version: '1.0.0' }, { key: 'node_modules/b', version: '2.0.0' }]);
const PKG = '{"name":"x"}';
const BASE: Record<string, string> = { 'package.json': PKG, 'package-lock.json': LOCK };
const HEAD = '| 種別 | 対象 | パッケージ | 版 | 前提 | 理由 | 見直しの期限 |\n|---|---|---|---|---|---|---|\n';

/** 通信が通る偽の世界(OSV は何も見つけず、登録簿は 30 日前の公開を返す)。 */
const healthyFetch: NonNullable<FakeSpec['fetch']> = (url, init) => (url.includes('osv.dev') && url.endsWith('/querybatch')
  ? { results: (init?.body as { queries: unknown[] }).queries.map(() => ({})) }
  : { time: { '1.0.0': '2026-09-01T00:00:00Z', '2.0.0': '2026-09-01T00:00:00Z' }, versions: { '1.0.0': {}, '2.0.0': {} } });

const exec = (auditOut: string): NonNullable<FakeSpec['exec']> => (_cmd, args) => (args.includes('signatures') ? { code: 0, stdout: '{"invalid":[],"missing":[]}' } : { code: 0, stdout: auditOut });

describe('runDepsCheck', () => {
  it('何も無ければ通過(緑)', async () => {
    const report = await runDepsCheck(fakeIo({ files: BASE, dirs: ['node_modules'], fetch: healthyFetch, exec: exec(auditJson([])) }), '/r');
    expect(report.ok).toBe(true);
    expect(report.summary).toEqual({ red: 0, warning: 0, accepted: 0, unperformed: 0 });
  });

  it('high は赤、moderate は警告で一覧', async () => {
    const out = auditJson([{ name: 'a', severity: 'high', ghsa: 'GHSA-1' }, { name: 'b', severity: 'moderate', ghsa: 'GHSA-2' }]);
    const report = await runDepsCheck(fakeIo({ files: BASE, dirs: ['node_modules'], fetch: healthyFetch, exec: exec(out) }), '/r');
    expect(report.ok).toBe(false);
    expect(report.summary).toMatchObject({ red: 1, warning: 1 });
  });

  it('通信が全部落ちても落とさない: 未実施を部分ごとに記録する', async () => {
    const down = fakeIo({ files: BASE, dirs: ['node_modules'], exec: () => ({ code: 1, stdout: '{"error":{"code":"ENOTFOUND"}}' }) });
    const report = await runDepsCheck(down, '/r');
    expect(report.ok).toBe(true);
    const parts = report.lockfiles[0]?.parts;
    expect([parts?.audit.status, parts?.osv.status, parts?.signatures.status, parts?.cooldown.status]).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable']);
    expect(report.summary.unperformed).toBe(4);
    expect(formatDepsReport(report, 'out/x.json').join('\n')).toContain('未実施 — OSV');
  });

  it('受け入れ表: 期限内は赤にしない・期限切れは赤', async () => {
    const out = auditJson([{ name: 'a', severity: 'high', ghsa: 'GHSA-1' }]);
    const run = (reviewBy: string) => runDepsCheck(fakeIo({ files: { ...BASE, [ACCEPTED_FILE]: `${HEAD}| advisory | GHSA-1 | a | 1.0.0 | - | 到達不能 | ${reviewBy} |` }, dirs: ['node_modules'], fetch: healthyFetch, exec: exec(out) }), '/r');
    const fresh = await run('2026-10-28');
    expect(fresh.ok).toBe(true);
    expect(fresh.summary).toMatchObject({ red: 0, accepted: 1 });
    const expired = await run('2026-10-01');
    expect(expired.ok).toBe(false);
    expect(expired.findings[0]?.accepted?.expired).toBe(true);
  });

  it('受け入れ表: 版を言わない audit の指摘は lockfile の版で当て、名指していない版は赤のまま', async () => {
    const out = auditJson([{ name: 'a', severity: 'high', ghsa: 'GHSA-1' }]);
    const run = (version: string) => runDepsCheck(fakeIo({ files: { ...BASE, [ACCEPTED_FILE]: `${HEAD}| advisory | GHSA-1 | a | ${version} | - | 到達不能 | 2026-10-28 |` }, dirs: ['node_modules'], fetch: healthyFetch, exec: exec(out) }), '/r');
    const covered = await run('1.0.0');
    expect(covered.summary).toMatchObject({ red: 0, accepted: 1 });
    expect(covered.findings[0]?.version).toBe('1.0.0');
    const uncovered = await run('9.9.9');
    expect(uncovered.ok).toBe(false);
    expect(uncovered.summary).toMatchObject({ red: 1, accepted: 0 });
  });

  it('受け入れ表: high の期限が今日から 7 日を超える行は赤(重大度の上限。報告が上限を言う)', async () => {
    const out = auditJson([{ name: 'a', severity: 'high', ghsa: 'GHSA-1' }]);
    const report = await runDepsCheck(fakeIo({ files: { ...BASE, [ACCEPTED_FILE]: `${HEAD}| advisory | GHSA-1 | a | 1.0.0 | - | 到達不能 | 2026-12-01 |` }, dirs: ['node_modules'], fetch: healthyFetch, exec: exec(out) }), '/r');
    expect(report.ok).toBe(false);
    expect(report.findings[0]?.accepted?.overDeadline).toBe(7);
    expect(formatDepsReport(report, 'out/x.json').join('\n')).toContain('重大度の上限(今日から 7 日以内)を超えています');
  });

  it('受け入れ表の不正な行は赤(fail-closed)・当たらない行は注記', async () => {
    const report = await runDepsCheck(fakeIo({ files: { ...BASE, [ACCEPTED_FILE]: `${HEAD}| advisory | GHSA-x | a | 1.0.0 | - |  | 2026-10-25 |\n| advisory | GHSA-unused | a | 1.0.0 | - | 理由 | 2026-10-25 |` }, dirs: ['node_modules'], fetch: healthyFetch, exec: exec(auditJson([])) }), '/r');
    expect(report.ok).toBe(false);
    expect(report.notes.join('\n')).toContain('理由が空');
    expect(report.notes.join('\n')).toContain('GHSA-unused');
  });

  it('公開から 7 日未満の版は警告、cooldown の受け入れで accepted', async () => {
    const fresh: NonNullable<FakeSpec['fetch']> = (url, init) => (url.includes('osv.dev') ? healthyFetch(url, init) : { time: { '1.0.0': '2026-10-20T00:00:00Z', '2.0.0': '2026-09-01T00:00:00Z' }, versions: { '1.0.0': {}, '2.0.0': {} } });
    const io = (files: Record<string, string>) => fakeIo({ files, dirs: ['node_modules'], fetch: fresh, exec: exec(auditJson([])) });
    const warned = await runDepsCheck(io(BASE), '/r');
    expect(warned.findings.filter((f) => f.kind === 'cooldown')).toHaveLength(2 - 1);
    expect(warned.summary).toMatchObject({ warning: 1, red: 0 });
    const accepted = await runDepsCheck(io({ ...BASE, [ACCEPTED_FILE]: `${HEAD}| cooldown | 1.0.0 | a | 1.0.0 | - | 緊急の修正版 | 2026-10-29 |` }), '/r');
    expect(accepted.summary).toMatchObject({ warning: 0, accepted: 1 });
    // 9 回目 C9-2: 今日(10-22)から 8 日後の期限は待ちの受け入れの上限(7 日)を超えて赤。
    const over = await runDepsCheck(io({ ...BASE, [ACCEPTED_FILE]: `${HEAD}| cooldown | 1.0.0 | a | 1.0.0 | - | 緊急の修正版 | 2026-10-30 |` }), '/r');
    expect(over.summary).toMatchObject({ red: 1, accepted: 0 });
    expect(formatDepsReport(over, 'out/x.json').join('\n')).toContain('待ちの受け入れの上限(今日から 7 日以内)を超えています');
  });

  it.each([
    ['* / * の 2099 年の行(C9-2 の反例)', '| cooldown | * | * | * | - | 理由 | 2099-12-31 |', false],
    ['版と名前を名指した 2099 年の行', '| cooldown | 1.0.0 | a | 1.0.0 | - | 理由 | 2099-12-31 |', false],
    ['版と名前を名指した 7 日後の行', '| cooldown | 1.0.0 | a | 1.0.0 | - | 理由 | 2026-10-29 |', true],
  ] as const)('出荷の関門まで通す: %s → ok %s(9 回目 C9-2)', async (_name, row, ok) => {
    const fresh: NonNullable<FakeSpec['fetch']> = (url, init) => (url.includes('osv.dev') ? healthyFetch(url, init) : { time: { '1.0.0': '2026-10-20T00:00:00Z', '2.0.0': '2026-09-01T00:00:00Z' }, versions: { '1.0.0': {}, '2.0.0': {} } });
    const report = await runDepsCheck(fakeIo({ files: { ...BASE, [ACCEPTED_FILE]: `${HEAD}${row}` }, dirs: ['node_modules'], fetch: fresh, exec: exec(auditJson([])) }), '/r');
    const gated = applyShipGate({ ...report, lockfiles: report.lockfiles.map((entry) => ({ ...entry, parts: { ...entry.parts, signatures: { status: 'done' } } })) });
    expect(gated.ok).toBe(ok);
  });

  it('lockfile ごとに回す(ルートと docs)・読めない lockfile は全部未実施', async () => {
    const files = { ...BASE, 'docs/package.json': PKG, 'docs/package-lock.json': 'not json' };
    const report = await runDepsCheck(fakeIo({ files, dirs: ['node_modules'], fetch: healthyFetch, exec: exec(auditJson([])) }), '/r');
    expect(report.lockfiles.map((l) => l.path)).toEqual(['package-lock.json', 'docs/package-lock.json']);
    expect(report.lockfiles[1]?.parts.audit.status).toBe('unavailable');
    // 確かめた中身の指紋を lockfile ごとに持つ(読めない lockfile も。取り込みの台本の日数の口が今の中身と比べる。差分点検 A27-2)。
    expect(report.lockfiles.map((l) => l.sha256)).toEqual([lockfileDigest(LOCK), lockfileDigest('not json')]);
  });
});

describe('discoverLockfiles / parseLockedPackages', () => {
  it('package.json と並ぶ lockfile だけ・依存と作業置き場とテストの題材は歩かない', () => {
    const files = { 'package.json': PKG, 'package-lock.json': LOCK, 'docs/package.json': PKG, 'docs/package-lock.json': LOCK, 'node_modules/x/package.json': PKG, 'node_modules/x/package-lock.json': LOCK, 'dist/a/package.json': PKG, 'dist/a/package-lock.json': LOCK, 'orphan/package-lock.json': LOCK };
    const io = fakeIo({ files });
    expect(discoverLockfiles({ list: io.list, isDirectory: io.isDirectory, isFile: (rel) => io.readText(rel) !== null })).toEqual(['package-lock.json', 'docs/package-lock.json']);
  });

  it('入れ子の node_modules は最後の名前を採り、link・版なし・重複を除き、登録簿由来かを持つ', () => {
    const text = lockfile([
      { key: 'node_modules/a', version: '1.0.0' },
      { key: 'node_modules/a/node_modules/@s/b', version: '2.0.0', resolved: 'https://example.invalid/b.tgz' },
      { key: 'node_modules/self', version: '1.0.0', link: true },
      { key: 'node_modules/a', version: '1.0.0' },
    ]);
    expect(parseLockedPackages(text)).toEqual([
      { name: '@s/b', version: '2.0.0', fromRegistry: false, integrity: SRI },
      { name: 'a', version: '1.0.0', fromRegistry: true, integrity: SRI },
    ]);
  });

  it.each([['JSON でない', 'x'], ['packages が無い', '{}']])('%s → null', (_name, text) => {
    expect(parseLockedPackages(text)).toBeNull();
  });
});

describe('describeFreshness(verify の範囲サマリ)', () => {
  const NOW = new Date('2026-10-22T00:00:00Z');
  const DONE = { status: 'done' };
  const DOWN = { status: 'unavailable' };
  const parts = (status: object) => ({ audit: status, osv: status, signatures: status, cooldown: status });
  const record = (iso: string, over: Record<string, unknown> = {}) =>
    JSON.stringify({ generatedAt: iso, ok: true, lockfiles: [{ path: 'package-lock.json', parts: parts(DONE) }], ...over });

  it.each([
    ['記録なし', null, true],
    ['JSON が壊れている', 'x', true],
    ['日時が無い', '{}', true],
    ['当日', record('2026-10-22T00:00:00Z'), false],
    ['ちょうど 7 日前はまだ警告にしない', record('2026-10-15T00:00:00Z'), false],
    ['7 日を超えたら警告', record('2026-10-14T23:00:00Z'), true],
    ['1 か月前', record('2026-09-22T00:00:00Z'), true],
    ['時計のずれの範囲(1 分先)は未来にしない', record('2026-10-22T00:01:00Z'), false],
    ['未来の時刻(1 年先)は「0 日前」にせず警告', record('2027-10-22T00:00:00Z'), true],
    ['全部未実施の実行は警告', record('2026-10-22T00:00:00Z', { lockfiles: [{ path: 'a', parts: parts(DOWN) }, { path: 'b', parts: parts(DOWN) }] }), true],
    ['一部だけ未実施なら警告にしない', record('2026-10-22T00:00:00Z', { lockfiles: [{ path: 'a', parts: { ...parts(DONE), osv: DOWN } }] }), false],
    ['赤で終わった実行は警告', record('2026-10-22T00:00:00Z', { ok: false }), true],
    ['ok の欄が無い記録は警告(結果を読めない)', JSON.stringify({ generatedAt: '2026-10-22T00:00:00Z' }), true],
    ['ok が真偽値でない記録は警告', record('2026-10-22T00:00:00Z', { ok: 'true' }), true],
  ])('%s', (_name, json, stale) => {
    expect(describeFreshness(json, NOW).stale).toBe(stale);
  });

  it.each([
    ['全部済で当日なら新しい', record('2026-10-22T00:00:00Z'), false],
    ['一部だけ未実施でも古い(全部を確かめた実行ではない)', record('2026-10-22T00:00:00Z', { lockfiles: [{ path: 'a', parts: { ...parts(DONE), osv: DOWN } }] }), true],
    ['lockfile が 0 本なら古い(何も確かめていない)', record('2026-10-22T00:00:00Z', { lockfiles: [] }), true],
    ['部分の欄が空の lockfile は古い', record('2026-10-22T00:00:00Z', { lockfiles: [{ path: 'a', parts: {} }] }), true],
    ['7 日を超えたら古い(日数の上限は既定と同じ STALE_DAYS)', record('2026-10-14T23:00:00Z'), true],
    ['ちょうど 7 日前は新しい', record('2026-10-15T00:00:00Z'), false],
    ['赤で終わった実行は古い', record('2026-10-22T00:00:00Z', { ok: false }), true],
  ])('complete(取り込みの台本の日数の口): %s', (_name, json, stale) => {
    expect(describeFreshness(json, NOW, { complete: true }).stale).toBe(stale);
  });

  // 差分点検 A27-2: 印が確かめた lockfile の中身と今の中身を比べる(日付だけの印では、lockfile が変わっても印が新しい間は回らなかった)。
  describe('今の lockfile と比べる(取り込みの台本の日数の口)', () => {
    const A = 'a'.repeat(64);
    const B = 'b'.repeat(64);
    const stamped = (locks: readonly { readonly path: string; readonly sha256?: string }[]) =>
      record('2026-10-22T00:00:00Z', { lockfiles: locks.map((lock) => ({ ...lock, parts: parts(DONE) })) });
    it.each([
      ['同じ本数・同じ中身なら新しい', stamped([{ path: 'package-lock.json', sha256: A }]), { 'package-lock.json': A }, false, ''],
      ['中身が変わったら古い', stamped([{ path: 'package-lock.json', sha256: A }]), { 'package-lock.json': B }, true, 'package-lock.json'],
      ['lockfile が増えたら古い', stamped([{ path: 'package-lock.json', sha256: A }]), { 'package-lock.json': A, 'docs/package-lock.json': A }, true, 'docs/package-lock.json'],
      ['lockfile が減ったら古い', stamped([{ path: 'package-lock.json', sha256: A }, { path: 'docs/package-lock.json', sha256: A }]), { 'package-lock.json': A }, true, 'docs/package-lock.json'],
      ['指紋を持たない古い形の記録は古い', stamped([{ path: 'package-lock.json' }]), { 'package-lock.json': A }, true, '指紋を持たない'],
    ])('%s', (_name, json, current, stale, mention) => {
      const freshness = describeFreshness(json, NOW, { complete: true, lockfiles: current });
      expect(freshness.stale).toBe(stale);
      expect(freshness.line).toContain(mention);
    });
  });

  it('complete の未実施の行は理由を言い分ける', () => {
    expect(describeFreshness(record('2026-10-22T00:00:00Z', { lockfiles: [{ path: 'a', parts: { ...parts(DONE), osv: DOWN } }] }), NOW, { complete: true }).line).toContain('未実施の部分が残った');
  });

  it('警告の行は deps:check を回すよう案内し、理由を言い分ける', () => {
    expect(describeFreshness(null, NOW).line).toContain('npm run deps:check');
    expect(describeFreshness(record('2027-10-22T00:00:00Z'), NOW).line).toContain('未来の時刻');
    expect(describeFreshness(record('2026-10-22T00:00:00Z', { ok: false }), NOW).line).toContain('赤で終わった');
    expect(describeFreshness(record('2026-10-22T00:00:00Z', { lockfiles: [{ path: 'a', parts: parts(DOWN) }] }), NOW).line).toContain('未実施で終わった');
  });
});
