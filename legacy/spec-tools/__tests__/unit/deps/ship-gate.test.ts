/** 出荷の関門(`deps:check -- --ship-gate`。8 回目 C8-2)の判定。 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyCompleteRun, applyShipGate, SHIP_GATE_UNPERFORMED_ALLOWED } from '../../../lib/deps/ship-gate.js';
import type { DepsFinding, DepsReport, LockfileReport, PartResult } from '../../../lib/deps/types.js';
import { finding } from './helpers.js';

const DONE: PartResult = { status: 'done' };
const DOWN: PartResult = { status: 'unavailable', reason: 'network down' };

/** lockfile 1 本の結果(既定は全部の部分が済)。 */
function lock(parts: Partial<LockfileReport['parts']> = {}, path = 'package-lock.json'): LockfileReport {
  return { path, sha256: 'a'.repeat(64), packages: 3, parts: { audit: DONE, osv: DONE, signatures: DONE, cooldown: DONE, ...parts } };
}

/** 検査の結果(要約は run.ts と同じ数え方。`tableProblems` は受け入れ表の行の問題の数)。 */
function report(findings: readonly DepsFinding[], lockfiles: readonly LockfileReport[] = [lock()], tableProblems = 0): DepsReport {
  const count = (level: string): number => findings.filter((entry) => entry.level === level).length;
  const red = count('red') + tableProblems;
  return {
    version: 1, generatedAt: '2026-10-29T00:00:00.000Z', lockfiles, findings, notes: [],
    summary: { red, warning: count('warning'), accepted: count('accepted'), unperformed: 0 }, ok: red === 0,
  };
}

const COOLDOWN = finding({ kind: 'cooldown', id: 'cooldown', severity: 'low', level: 'warning', title: '公開から 0.1 日' });

describe('applyShipGate', () => {
  it('署名だけが未実施を許される部分', () => {
    expect(SHIP_GATE_UNPERFORMED_ALLOWED).toEqual(['signatures']);
  });

  it.each([
    ['何も無い', report([]), true, 0],
    ['署名だけ未実施(依存を入れないジョブ)', report([], [lock({ signatures: DOWN })]), true, 0],
    ['advisory の警告(moderate)は警告のまま', report([finding({ severity: 'moderate', level: 'warning' })]), true, 0],
    ['受け入れ済みの待ちは通す', report([{ ...COOLDOWN, level: 'accepted' }]), true, 0],
    ['署名の missing の警告は警告のまま', report([finding({ kind: 'signature', id: 'missing-signature', level: 'warning' })]), true, 0],
    // 負例
    ['公開から 7 日未満の版は赤', report([COOLDOWN]), false, 1],
    ['audit が未実施は赤', report([], [lock({ audit: DOWN })]), false, 1],
    ['OSV が未実施は赤', report([], [lock({ osv: DOWN })]), false, 1],
    ['待ちが未実施は赤', report([], [lock({ cooldown: DOWN })]), false, 1],
    ['lockfile ごとに数える', report([], [lock({ osv: DOWN }), lock({ osv: DOWN, audit: DOWN }, 'docs/package-lock.json')]), false, 3],
    ['lockfile が 0 本は赤', report([], []), false, 1],
    ['元の赤はそのまま', report([finding()]), false, 1],
    ['受け入れ表の行の問題(要約の赤)を落とさない', report([], [lock()], 2), false, 2],
  ] as const)('%s', (_name, input, ok, red) => {
    const gated = applyShipGate(input);
    expect(gated.ok).toBe(ok);
    expect(gated.summary.red).toBe(red);
  });

  it('待ちの警告を赤にし、要約の警告から外す・元の結果は変えない', () => {
    const input = report([COOLDOWN, finding({ severity: 'moderate', level: 'warning' })]);
    const gated = applyShipGate(input);
    expect(gated.findings[0]?.level).toBe('red');
    expect(gated.findings[0]?.title).toContain('出荷の関門');
    expect(gated.summary).toMatchObject({ red: 1, warning: 1 });
    expect(input.findings[0]?.level).toBe('warning');
  });

  it('未実施の赤は注に名指す(lockfile と部分と理由)', () => {
    const gated = applyShipGate(report([], [lock({ osv: DOWN })]));
    expect(gated.notes).toEqual([expect.stringContaining('package-lock.json の osv が未実施です(network down)')]);
  });
});

/** 道具の木の根(このファイルは __tests__/unit/deps/ にある)。 */
const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** `from` の綴りの閉包のうち、相対でも `node:` でもない指定子(依存を入れずに `node` で直に読めるか)。 */
function bareSpecifiers(entry: string): string[] {
  const seen = new Set<string>();
  const bare: string[] = [];
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
      const spec = match[1] ?? '';
      if (spec.startsWith('node:')) continue;
      if (!spec.startsWith('.')) {
        bare.push(`${spec} <- ${path.relative(TOOL_ROOT, file)}`);
        continue;
      }
      const target = path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'));
      walk(existsSync(target) ? target : target.replace(/\.ts$/, '.mts'));
    }
  };
  walk(path.join(TOOL_ROOT, entry));
  return bare;
}

describe('出荷の関門は依存を入れずに走る', () => {
  it('cli/deps-check.ts の import の閉包は相対と node: だけ(関門のジョブは npm ci をしない)', () => {
    expect(bareSpecifiers('cli/deps-check.ts')).toEqual([]);
  });

  it('負例: 素の指定子を拾う(検出器が空振りしない)', () => {
    expect(bareSpecifiers('lib/io/front-matter.ts').some((entry) => entry.startsWith('js-yaml'))).toBe(true);
  });
});

describe('applyCompleteRun(取り込みの台本が日数で回す deps:check -- --complete。fix27)', () => {
  it.each([
    ['全部済で指摘なし', report([]), true, 0],
    ['待ちの警告は警告のまま(版を上げた直後の取り込みを止めない)', report([COOLDOWN]), true, 0],
    ['署名だけ未実施でも赤(依存を入れた木で回すので許す部分を持たない)', report([], [lock({ signatures: DOWN })]), false, 1],
    ['OSV と audit が未実施なら 2 件の赤', report([], [lock({ osv: DOWN, audit: DOWN })]), false, 2],
    ['lockfile が 0 本なら赤', report([], []), false, 1],
    ['もとの赤は数え直しても残る', report([finding({ severity: 'high', level: 'red' })]), false, 1],
  ])('%s', (_name, input, ok, red) => {
    const judged = applyCompleteRun(input);
    expect(judged.ok).toBe(ok);
    expect(judged.summary.red).toBe(red);
  });

  it('未実施の部分は lockfile と部分の名前と理由を名指す(元の結果は変えない)', () => {
    const input = report([], [lock({ osv: DOWN })]);
    const judged = applyCompleteRun(input);
    expect(judged.notes).toEqual(['全部を確かめる実行: package-lock.json の osv が未実施です(network down)。確かめられないまま鮮度の印を新しくしない']);
    expect(input.ok).toBe(true);
  });
});
