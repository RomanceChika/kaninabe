/** npm audit の出力の読み取りと、重大度から赤 / 警告への写し。 */

import { describe, expect, it } from 'vitest';
import { baseLevel, normalizeSeverity, parseAudit, runAudit } from '../../../lib/deps/audit.js';
import { auditJson, fakeIo } from './helpers.js';

describe('normalizeSeverity', () => {
  it.each([
    ['critical', 'critical'], ['HIGH', 'high'], ['Moderate', 'moderate'], ['MEDIUM', 'moderate'], ['low', 'low'], ['info', 'unknown'], [undefined, 'unknown'], [3, 'unknown'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeSeverity(raw)).toBe(expected);
  });
});

describe('baseLevel(重大度の写し)', () => {
  it.each([
    ['advisory', 'critical', 'red'], ['advisory', 'high', 'red'], ['advisory', 'moderate', 'warning'], ['advisory', 'low', 'warning'], ['advisory', 'unknown', 'warning'],
    ['cooldown', 'low', 'warning'], ['signature', 'high', 'red'], ['signature', 'low', 'warning'],
  ] as const)('%s / %s → %s', (kind, severity, expected) => {
    expect(baseLevel({ kind, severity })).toBe(expected);
  });
});

describe('parseAudit', () => {
  it('advisory ごとに GHSA の ID・重大度・判定を持つ(文字列の via は数えない)', () => {
    const out = parseAudit('package-lock.json', auditJson([{ name: 'a', severity: 'high', ghsa: 'GHSA-1111' }, { name: 'b', severity: 'moderate', ghsa: 'GHSA-2222' }]));
    expect(out.part.status).toBe('done');
    expect(out.findings.map((f) => [f.pkg, f.id, f.severity, f.level])).toEqual([['a', 'GHSA-1111', 'high', 'red'], ['b', 'GHSA-2222', 'moderate', 'warning']]);
  });

  it('脆弱性なしは done で 0 件', () => {
    expect(parseAudit('l', auditJson([]))).toEqual({ part: { status: 'done' }, findings: [] });
  });

  it.each([
    ['空のオブジェクト', '{}'],
    ['配列', '[]'],
    ['null', 'null'],
    ['vulnerabilities が配列', JSON.stringify({ auditReportVersion: 2, vulnerabilities: [], metadata: { vulnerabilities: { total: 0 } } })],
    ['版が違う', JSON.stringify({ auditReportVersion: 1, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } })],
    ['metadata が無い', JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} })],
    ['件数はあるのに中身が読めない', JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 3 } } })],
  ])('報告の形を満たさない出力(%s)は検査済みにせず未実施(外部レビュー)', (_name, text) => {
    expect(parseAudit('l', text)).toMatchObject({ part: { status: 'unavailable' }, findings: [] });
  });

  it.each([
    ['JSON でない', 'not json'],
    ['取得の失敗(error を持つ)', '{"error":{"code":"ENOTFOUND","summary":"x"}}'],
  ])('%s → 未実施で落とさない', (_name, stdout) => {
    const out = parseAudit('l', stdout);
    expect(out.part.status).toBe('unavailable');
    expect(out.findings).toEqual([]);
  });

  it('URL に GHSA が無ければ npm の番号を ID にする', () => {
    const json = JSON.stringify({ auditReportVersion: 2, vulnerabilities: { a: { via: [{ source: 42, name: 'a', severity: 'low', url: 'https://example.invalid' }] } }, metadata: { vulnerabilities: { low: 1, total: 1 } } });
    expect(parseAudit('l', json).findings[0]?.id).toBe('npm-42');
  });
});

describe('runAudit', () => {
  it('lockfile のある場所で --json を回す(終了コード非 0 でも出力を読む)', async () => {
    const calls: string[] = [];
    const io = fakeIo({ exec: (cmd, args, cwd) => { calls.push(`${cmd} ${args.join(' ')} @ ${cwd}`); return { code: 1, stdout: auditJson([{ name: 'a', severity: 'critical', ghsa: 'GHSA-1' }]) }; } });
    const out = await runAudit(io, 'docs/package-lock.json', '/r');
    expect(calls).toEqual(['npm audit --json @ /r/docs']);
    expect(out.findings[0]?.level).toBe('red');
  });

  it('子プロセスを回せなければ未実施', async () => {
    const out = await runAudit(fakeIo({}), 'package-lock.json', '/r');
    expect(out.part.status).toBe('unavailable');
  });
});
