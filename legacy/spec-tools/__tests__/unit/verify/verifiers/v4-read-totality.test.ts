import { describe, expect, it } from 'vitest';

import { readTotalityVerifier } from '../../../../lib/verify/verifiers/v4-read-totality.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  read,
  role,
  roleSpec,
  specModel,
  stubGuards,
} from '../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

const ctx: VerifyContext = { guards: stubGuards(), roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };

function run(model: SpecModel) {
  return readTotalityVerifier.verify(model, ctx);
}

const ROLES = roleSpec([
  'anonymous',
  'member',
  role('performer', 'entry.performer_id == actor.id'),
  'system',
]);

function modelWithReads(reads: readonly ReturnType<typeof read>[]): SpecModel {
  return specModel(
    [aggregate('entry', { access: accessSpec('entry', { reads: [...reads] }) })],
    ROLES,
  );
}

describe('V4 全域性(読み取り)', () => {
  it('reads に現れないロールを 1 件ずつ検出する', () => {
    const findings = run(modelWithReads([read('performer', 'own'), read('system', 'all')]));

    expect(findings.map((f) => f.counterexample?.role)).toEqual(['anonymous', 'member']);
    expect(findings[0]?.verifier).toBe('V4');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toBe('entry: ロール anonymous の読み取りスコープが未定義です');
    expect(findings[0]?.suggestion).toContain('scope: none');
    expect(findings[0]?.counterexample).toEqual({ entity: 'entry', role: 'anonymous' });
    expect(findings[0]?.location.file).toBe('docs/specs/domain/entry/access.md');
  });

  it('全ロールが明示されていれば違反ゼロ(scope: none も明示として数える)', () => {
    const findings = run(
      modelWithReads([
        read('anonymous', 'none'),
        read('member', 'none'),
        read('performer', 'own'),
        read('system', 'all'),
      ]),
    );

    expect(findings).toEqual([]);
  });

  it('access_spec を持たない集約は対象外(access.md 自体の欠落は V1 の担当)', () => {
    const model = specModel([aggregate('entry', { entity: entitySpec('entry') })], ROLES);

    expect(run(model)).toEqual([]);
  });

  it('ロールが 1 つも定義されていなければ違反ゼロ', () => {
    const model = specModel(
      [aggregate('entry', { access: accessSpec('entry', { reads: [] }) })],
      roleSpec([]),
    );

    expect(run(model)).toEqual([]);
  });

  it('複数の access_spec をそれぞれ独立に検査する', () => {
    const model = specModel(
      [
        aggregate('entry', {
          access: accessSpec('entry', {
            reads: [
              read('anonymous', 'none'),
              read('member', 'none'),
              read('performer', 'own'),
              read('system', 'all'),
            ],
          }),
        }),
        aggregate('workshop', { access: accessSpec('workshop', { reads: [read('member', 'all')] }) }),
      ],
      ROLES,
    );

    const findings = run(model);

    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.counterexample?.entity === 'workshop')).toBe(true);
  });
});
