/**
 * 生成の前に回す検証の母集合(`lib/verify/pre-generate.ts`)の単体テスト。
 *
 * `generate` は「エラーなしで検証を通った仕様」だけを入力にする。したがって母集合は
 * **V 群から到達性を外したもの**である —— V21 は warning しか出さないので生成を 1 つも
 * 止めないのに、`generate` のたびに数百 KB のスクリプトを Z3 に流すことになる。
 * さらにこの経路は答えの表を配線していないので、外さないと「配線されていません」が
 * 毎回 1 件鳴る。**外れていることをこの目が保証する**(JSDoc は保証しない)。
 */

import { describe, expect, it } from 'vitest';
import { GENERATION_VERIFIERS, generationBlockers, IMPLEMENTATION_COMPARISON_CHECK_IDS } from '../../../lib/verify/pre-generate.js';
import { ALL_CHECKS } from '../../../lib/compose/all-checks.js';
import type { Finding } from '../../../lib/kernel/finding.js';
import { ALL_VERIFIERS } from '../../../lib/verify/verifiers/index.js';
import { REACHABILITY_VERIFIER_IDS } from '../../../lib/verify/z3-reachability.js';

describe('GENERATION_VERIFIERS', () => {
  it('到達性(V21)を母集合から外している', () => {
    const ids = GENERATION_VERIFIERS.map((verifier) => verifier.id);

    for (const id of REACHABILITY_VERIFIER_IDS) expect(ids, id).not.toContain(id);
  });

  it('外しているのは到達性だけ(他の検査を黙って落としていない)', () => {
    const dropped = ALL_VERIFIERS.map((verifier) => verifier.id).filter(
      (id) => !GENERATION_VERIFIERS.some((verifier) => verifier.id === id),
    );

    expect(dropped).toEqual([...REACHABILITY_VERIFIER_IDS]);
  });
});

describe('生成を止める error の方針(IMPLEMENTATION_COMPARISON_CHECK_IDS)', () => {
  const registered = new Set(ALL_CHECKS.map((check) => check.id));

  it('実装の木との突合の検査 ID は、登録された検査である(綴りの間違いで黙って効かなくならない)', () => {
    expect(IMPLEMENTATION_COMPARISON_CHECK_IDS.filter((id) => !registered.has(id))).toEqual([]);
    expect(new Set(IMPLEMENTATION_COMPARISON_CHECK_IDS).size).toBe(IMPLEMENTATION_COMPARISON_CHECK_IDS.length);
  });

  it('仕様だけで決まる検査(読み込み・綴り・置き場・参照)は載せていない', () => {
    for (const id of ['P0', 'V1', 'V2', 'A0', 'A1', 'A3', 'A9', 'Q0', 'Q1', 'S0', 'S2', 'T0', 'T1', 'T6', 'T7', 'T12', 'Y0', 'Y7', 'X0', 'Z0', 'G0']) {
      expect(IMPLEMENTATION_COMPARISON_CHECK_IDS, id).not.toContain(id);
    }
  });

  const finding = (verifier: string, severity: 'error' | 'warning'): Finding => ({
    verifier,
    severity,
    message: 'm',
    location: { file: 'f' },
    suggestion: 's',
  });

  it('同じ検査 ID が仕様の誤りと実装との突合の両方を出すもの(A2 / G8 / H2 / J2 / V10)は、印の付いた突合の指摘だけが止めない', () => {
    const grounded = (verifier: string): Finding => ({ ...finding(verifier, 'error'), grounding: 'implementation' });

    for (const id of ['A2', 'G8', 'H2', 'J2', 'V10']) {
      expect(IMPLEMENTATION_COMPARISON_CHECK_IDS, id).not.toContain(id);
      expect(generationBlockers([finding(id, 'error')]).map((entry) => entry.verifier), id).toEqual([id]);
      expect(generationBlockers([grounded(id)]), id).toEqual([]);
    }
  });

  it('error は全群が止める。実装との突合と warning だけが止めない', () => {
    const blockers = generationBlockers([
      finding('T12', 'error'),
      finding('Y0', 'error'),
      finding('S0', 'error'),
      finding('Q0', 'error'),
      finding('A6', 'error'),
      finding('K1', 'error'),
      finding('T11', 'warning'),
    ]);

    expect(blockers.map((entry) => entry.verifier)).toEqual(['T12', 'Y0', 'S0', 'Q0']);
  });
});
