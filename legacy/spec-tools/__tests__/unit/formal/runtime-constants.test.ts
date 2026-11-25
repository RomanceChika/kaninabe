/**
 * 模型の前提の執行点(予算 + タイムアウト < リース)のテスト。
 *
 * `Outbox.tla` が「リース超過は起きない」と言えるのはこの比が成り立つ間だけである。
 * **前提は書いておくだけでは守られない**(予算を伸ばす人・タイムアウトを伸ばす人・
 * リースを縮める人は別々である)ので、3 つの実装値から機械が確かめる。
 */

import { describe, expect, it } from 'vitest';
import {
  describePremise,
  premiseFindings,
  readRuntimeConstants,
} from '../../../lib/formal/runtime-constants.js';
import type { RuntimeConstantSources } from '../../../lib/formal/runtime-constants.js';

function sources(budget: string, timeout: string, lease: string): RuntimeConstantSources {
  return {
    budget: { path: 'route.ts', text: budget },
    timeout: { path: 'external-expectations.ts', text: timeout },
    lease: { path: 'claim_due_jobs.sql', text: lease },
  };
}

const REAL = sources(
  'const BUDGET_MS = 50_000;',
  'discord: { timeoutMs: 5000 }, chat: { timeoutMs: 60000 },',
  'p_lease_seconds integer default 300',
);

describe('readRuntimeConstants', () => {
  it('3 つの値を読む(アンダースコア区切りの数も読む)', () => {
    const constants = readRuntimeConstants(REAL);
    expect('severity' in constants).toBe(false);
    if ('severity' in constants) return;
    expect(constants.budgetMs).toBe(50_000);
    expect(constants.leaseMs).toBe(300_000);
  });

  it('タイムアウトは**最大**を取る(ジョブのハンドラはどの連携も呼びうる)', () => {
    const constants = readRuntimeConstants(REAL);
    if ('severity' in constants) throw new Error('読めるはず');
    expect(constants.timeoutMs).toBe(60000);
  });

  it('どれか 1 つでも読めなければ赤になる(読めなかったを「成り立った」にしない)', () => {
    for (const broken of [
      sources('const OTHER = 1;', 'timeoutMs: 5000', 'p_lease_seconds integer default 300'),
      sources('const BUDGET_MS = 1;', 'nothing here', 'p_lease_seconds integer default 300'),
      sources('const BUDGET_MS = 1;', 'timeoutMs: 5000', 'no lease here'),
    ]) {
      const result = readRuntimeConstants(broken);
      expect('severity' in result).toBe(true);
    }
  });
});

describe('premiseFindings', () => {
  it('実装の比では成り立つので何も言わない', () => {
    const constants = readRuntimeConstants(REAL);
    if ('severity' in constants) throw new Error('読めるはず');
    expect(premiseFindings(constants, REAL)).toEqual([]);
  });

  it('リースを縮めると赤になり、3 ファイルを場所に出す', () => {
    const narrowed = sources(
      'const BUDGET_MS = 50_000;',
      'timeoutMs: 5000',
      'p_lease_seconds integer default 30',
    );
    const constants = readRuntimeConstants(narrowed);
    if ('severity' in constants) throw new Error('読めるはず');
    const findings = premiseFindings(constants, narrowed);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.location).toContain('route.ts');
    expect(findings[0]?.location).toContain('claim_due_jobs.sql');
    expect(findings[0]?.suggestion).toContain('Outbox-lease-breach.cfg');
  });

  it('等号は成り立たない側に倒す(予算 + タイムアウト = リースは赤)', () => {
    const edge = sources('const BUDGET_MS = 295_000;', 'timeoutMs: 5000', 'p_lease_seconds integer default 300');
    const constants = readRuntimeConstants(edge);
    if ('severity' in constants) throw new Error('読めるはず');
    expect(premiseFindings(constants, edge)).toHaveLength(1);
  });
});

describe('describePremise', () => {
  it('何を確かめたかを 1 行で言う(確かめた実行と飛ばした実行を見分けのつかない形にしない)', () => {
    const constants = readRuntimeConstants(REAL);
    if ('severity' in constants) throw new Error('読めるはず');
    expect(describePremise(constants)).toContain('50000ms');
    expect(describePremise(constants)).toContain('300000ms');
  });
});
