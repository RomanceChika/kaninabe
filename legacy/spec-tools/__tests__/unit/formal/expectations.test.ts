/**
 * 宣言(expectations.json)と TLC の答えの突合(C24 の第 4 段)のテスト。
 *
 * 見るべきは「**宣言を反転すると赤になる**」の両向きである —— holds と書いた性質が
 * 破れても、violated と書いた性質が破れなくなっても、どちらも赤でなければ
 * この台帳は免除リストになる。
 */

import { describe, expect, it } from 'vitest';
import { parseExpectations, verdictFindings } from '../../../lib/formal/expectations.js';
import type { PropertyExpectation, TlcResult } from '../../../lib/formal/types.js';

const HOLDS_DECLARED: PropertyExpectation = {
  id: 'S3',
  check: 'INVARIANT',
  intent: '試行回数は上限を超えない',
  verdict: 'holds',
};

const VIOLATED_DECLARED: PropertyExpectation = {
  id: 'S1',
  check: 'INVARIANT',
  intent: '終端は単調',
  verdict: 'violated',
  reason: '書き戻しが locked_by を見ない',
  where: 'app/src/infrastructure/jobs/job.queue.ts:53',
  remedy: 'locked_by = 自分 を条件に足す',
};

const HOLDS_ANSWER: TlcResult = { kind: 'holds', states: 100, distinct: 50, depth: 7 };
const VIOLATED_ANSWER: TlcResult = {
  kind: 'violated',
  trace: [{ index: 1, action: '初期状態', values: new Map([['x', '0']]) }],
};

describe('parseExpectations', () => {
  it('正しい宣言を読み、問題を出さない', () => {
    const parsed = parseExpectations({
      models: [{ model: 'Outbox', premise: '実装の比', properties: [HOLDS_DECLARED, VIOLATED_DECLARED] }],
    });
    expect(parsed.problems).toEqual([]);
    expect(parsed.models[0]?.properties).toHaveLength(2);
  });

  it('cfg を書かなければ {model}.cfg になる', () => {
    const parsed = parseExpectations({
      models: [{ model: 'Outbox', premise: '実装の比', properties: [HOLDS_DECLARED] }],
    });
    expect(parsed.models[0]?.cfg).toBe('Outbox.cfg');
  });

  it('同じモデルを違う定数の組で並べられる(前提を外した側を持つため)', () => {
    const parsed = parseExpectations({
      models: [
        { model: 'Outbox', cfg: 'Outbox.cfg', premise: '実装の比', properties: [HOLDS_DECLARED] },
        { model: 'Outbox', cfg: 'Outbox-lease-breach.cfg', premise: '前提を外した比', properties: [VIOLATED_DECLARED] },
      ],
    });
    expect(parsed.problems).toEqual([]);
    expect(parsed.models).toHaveLength(2);
  });

  it('premise(その定数の組が置いている前提)が無ければ問題として出す', () => {
    const parsed = parseExpectations({ models: [{ model: 'Outbox', properties: [HOLDS_DECLARED] }] });
    expect(parsed.problems[0]).toContain('premise');
  });

  it('violated なのに理由・場所・対処が無ければ問題として出す(免除リストにさせない)', () => {
    const parsed = parseExpectations({
      models: [{ model: 'Outbox', premise: 'x', properties: [{ ...VIOLATED_DECLARED, where: undefined }] }],
    });
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toContain('reason');
  });

  it('verdict が holds でも violated でもなければ問題として出す', () => {
    const parsed = parseExpectations({
      models: [{ model: 'Outbox', premise: 'x', properties: [{ ...HOLDS_DECLARED, verdict: 'skip' }] }],
    });
    expect(parsed.problems[0]).toContain('verdict');
  });

  it('日本語の意図が無ければ問題として出す(反例の先頭に出すものが無くなる)', () => {
    const parsed = parseExpectations({
      models: [{ model: 'Outbox', premise: 'x', properties: [{ ...HOLDS_DECLARED, intent: '' }] }],
    });
    expect(parsed.problems[0]).toContain('意図');
  });

  it('models が無ければ問題として出す', () => {
    expect(parseExpectations({}).problems).toHaveLength(1);
    expect(parseExpectations('x').problems).toHaveLength(1);
  });

  it('性質が 1 つも無いモデルは問題として出す', () => {
    const parsed = parseExpectations({ models: [{ model: 'Outbox', premise: 'x', properties: [] }] });
    expect(parsed.problems[0]).toContain('properties');
  });
});

describe('verdictFindings', () => {
  it('宣言と答えが一致していれば何も言わない(holds)', () => {
    expect(verdictFindings('Outbox', HOLDS_DECLARED, HOLDS_ANSWER, [])).toEqual([]);
  });

  it('宣言と答えが一致していれば何も言わない(violated)', () => {
    expect(verdictFindings('Outbox', VIOLATED_DECLARED, VIOLATED_ANSWER, ['反例'])).toEqual([]);
  });

  it('holds と宣言した性質が破れたら赤になり、反例を添える', () => {
    const findings = verdictFindings('Outbox', HOLDS_DECLARED, VIOLATED_ANSWER, ['1. 初期状態']);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('holds と宣言した性質が破れました');
    expect(findings[0]?.detail).toEqual(['1. 初期状態']);
  });

  it('violated と宣言した性質が破れなかったら赤になり、宣言していた場所を出す', () => {
    const findings = verdictFindings('Outbox', VIOLATED_DECLARED, HOLDS_ANSWER, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('破れませんでした');
    expect(findings[0]?.suggestion).toContain('job.queue.ts:53');
  });

  it('TLC が打ち切られたら赤になる(答えが出ていないので緑にしない)', () => {
    const findings = verdictFindings('Outbox', HOLDS_DECLARED, { kind: 'timeout', seconds: 120 }, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('120 秒で終わりませんでした');
  });

  it('TLC が答えを返さなければ赤になる(黙って通さない)', () => {
    const findings = verdictFindings(
      'Outbox',
      HOLDS_DECLARED,
      { kind: 'error', reason: 'Error: Parsing failed', output: ['a', 'b'] },
      [],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('TLC が答えを返しませんでした');
  });
});
