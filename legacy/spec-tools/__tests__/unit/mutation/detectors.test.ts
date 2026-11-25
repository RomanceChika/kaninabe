/**
 * 変異を捕る側の目録(`lib/mutation/detectors.ts`)の単体テスト。
 *
 * ここで固定するのは **`verify` の指紋の母集合**である。指紋は Finding の字面を見るので、
 * 「壊した宣言をそのまま引用する検査」や「配線の有無を報告する検査」を母集合に入れると、
 * **執行の挙動が 1 ビットも変わっていない変異が『捕った』に化ける**(空振りの緑)。
 * A 群を外した理由と同じで、到達性(V21)もここでは外れている —— 外れていることを
 * 目録の JSDoc ではなく**この目**が保証する。
 */

import { describe, expect, it } from 'vitest';
import { createGuardServices } from '../../../lib/guard/services.js';
import { ALL_MUTATION_DETECTORS } from '../../../lib/mutation/detectors.js';
import { mutationSubjectOf } from '../../../lib/mutation/matrix.js';
import { REACHABILITY_VERIFIER_IDS } from '../../../lib/verify/z3-reachability.js';
import { boundedReachabilityVerifier } from '../../../lib/verify/verifiers/v21-bounded-reachability.js';
import type { GenerateContext } from '../../../lib/gen-kit/generator.js';
import type { MutationSubject } from '../../../lib/mutation/types.js';
import type { SpecModel } from '../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  readRule,
  role,
  specModel,
} from '../../helpers/model-builder-v8plus.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../helpers/verify-inputs.js';

/** 状態機械を 1 つ持つ題材(到達性の問いが 3 件立つ)。 */
function model(): SpecModel {
  return specModel({
    roles: [role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'doc',
        entity: entitySpec('doc', [field('state', { kind: 'state', machine: 'doc' })]),
        stateMachines: [
          machine({
            machine: 'doc',
            states: ['draft', 'published'],
            events: [event({ id: 'publish', from: ['draft'], to: 'published', by: ['member'] })],
          }),
        ],
        access: accessSpec('doc', { reads: [readRule('member', { kind: 'own' })] }),
      }),
    ],
  });
}

/** その題材の材料。 */
function subject(): MutationSubject {
  const guards = createGuardServices();
  return mutationSubjectOf({
    name: 'doc',
    model: model(),
    guards,
    actions: undefined,
    dataTables: undefined,
    jobs: undefined,
    context: { repoRoot: '/repo', guards } as GenerateContext,
  });
}

/** `verify` の指紋。 */
function verifyFingerprint(): string {
  const detector = ALL_MUTATION_DETECTORS.find((entry) => entry.id === 'verify');
  expect(detector).toBeDefined();
  const target = subject();
  return detector?.fingerprint(target.model, target) ?? '';
}

describe('verify の指紋の母集合', () => {
  it('到達性(V21)の行は 1 つも入らない', () => {
    const fingerprint = verifyFingerprint();

    for (const id of REACHABILITY_VERIFIER_IDS) expect(fingerprint, id).not.toContain(`${id}|`);
  });

  it('外さなければ入ってしまう(この目が空振りでないことの確認)', () => {
    const target = subject();

    const findings = boundedReachabilityVerifier.verify(target.model, { roots: TEST_ROOTS, guards: target.guards, ...NO_DOMAIN_INPUTS });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V21');
  });
});
