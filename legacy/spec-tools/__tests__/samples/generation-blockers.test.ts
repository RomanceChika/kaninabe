/**
 * **生成を止める error の方針**(`IMPLEMENTATION_COMPARISON_CHECK_IDS`)が、題材を通した実測と食い違わないことを見る。
 *
 * `generate` は全群の error が 1 件でもあれば何も書かずに止まる。例外は「実装の木との突合」の検査だけ(生成が作る / これから手で書く実装が
 * 突合先なので、仕様を足した直後は必ず赤い)。方針の表が足りないと、仕様を足した直後の `generate` が止まって実装を始められない。
 *
 * 実測: 題材を `generate` まで通し、**実装の木(生成物 + 空の手書き)が在る状態**で検証を回し直す —— 実際に `generate` を 2 回目に回すときの状態である。
 * そこで出る error は、検査 ID が方針の表にあるか、指摘に実装との突合の印(`grounding`)が付いていること。表は登録された検査 ID でもあること(`pre-generate.test.ts`)。
 */

import path from 'node:path';
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAllVerifications } from '../../lib/compose/verify-pipeline.js';
import { generationBlockers, IMPLEMENTATION_COMPARISON_CHECK_IDS } from '../../lib/verify/pre-generate.js';
import { SLOW } from '../helpers/book-entry-fixture.js';
import { TEST_VERIFY_INPUTS } from '../helpers/platform.js';
import { runSampleSystem } from './harness.js';

describe('生成の後に検証を回し直したときの error', () => {
  it.each(['rooms', 'library', 'expenses'])(
    '%s: 出る error は実装の木との突合だけで、生成を止めない',
    async (name) => {
      const run = await runSampleSystem(name, { keepRoot: true });
      try {
        const root = run.root ?? '';
        const after = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot: path.join(root, run.roots.specs, 'domain') });
        const errors = after.findings.filter((finding) => finding.severity === 'error');
        const unexplained = errors.filter((finding) => finding.grounding !== 'implementation' && !IMPLEMENTATION_COMPARISON_CHECK_IDS.includes(finding.verifier));

        expect(unexplained.map((finding) => `${finding.verifier}: ${finding.message}`)).toEqual([]);
        expect(generationBlockers(after.findings)).toEqual([]);
      } finally {
        if (run.root !== undefined) rmSync(run.root, { recursive: true, force: true });
      }
    },
    SLOW,
  );

  it('仕様側の error(dual_actors が意図して持つ V11 / V13)は生成を止める', async () => {
    const run = await runSampleSystem('dual_actors');

    expect(generationBlockers(run.findings).map((finding) => finding.verifier).sort()).toEqual(['V11', 'V11', 'V11', 'V13']);
  }, SLOW);
});
