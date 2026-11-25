/**
 * V24(状態の claim の対応範囲)の規約網羅テスト。
 *
 * 値の集合を持つ `claim`(と `kind` との併記)は、実行時のロール解決とオラクルが追随するまで error で止める。
 * 止める/止めないは `STATE_CLAIM_SUPPORTED` の 1 か所で決まる。
 */

import { describe, expect, it } from 'vitest';
import {
  createStateClaimSupportVerifier,
  STATE_CLAIM_SUPPORTED,
  stateClaimSupportVerifier,
} from '../../../../lib/verify/verifiers/v24-state-claim-support.js';
import { ALL_VERIFIERS } from '../../../../lib/verify/verifiers/index.js';
import type { RoleDef } from '../../../../lib/model/types.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import { role, specModel } from '../../../helpers/model-builder-v8plus.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

const CTX: VerifyContext = { guards: undefined as never, roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };

const stateful: RoleDef = { ...role('active_only'), claim: 'account.state', claimValues: ['active'] };
const loginWithClaim: RoleDef = { ...role('member', undefined, undefined, 'authenticated_default'), claim: 'account.is_ok' };
const booleanClaim: RoleDef = { ...role('staff'), claim: 'account.is_staff' };
const plainLogin: RoleDef = role('member', undefined, undefined, 'authenticated_default');

const modelOf = (...roles: readonly RoleDef[]) => specModel({ roles });

describe('V24 状態の claim の対応範囲', () => {
  const pending = createStateClaimSupportVerifier(false);

  it('値の集合を持つ claim は未対応として error で止める(理由と書き方を示す)', () => {
    const findings = pending.verify(modelOf(stateful), CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'V24', severity: 'error' });
    expect(findings[0]?.message).toContain('ロール active_only の claim(account.state == active)は未対応です');
    expect(findings[0]?.message).toContain('束 3・4');
    expect(findings[0]?.counterexample).toEqual({ role: 'active_only', claim: 'account.state == active' });
  });

  it('kind との併記は値の集合が無い boolean の形でも止める(オラクルが claim を boolean の欄として置くため)', () => {
    expect(pending.verify(modelOf(loginWithClaim), CTX)).toHaveLength(1);
  });

  it('従来の形(kind なしの boolean の claim・claim の無い役)は何も言わない', () => {
    expect(pending.verify(modelOf(booleanClaim, plainLogin), CTX)).toEqual([]);
  });

  it('対応済みと渡せば何も言わない(切り替えは 1 か所)', () => {
    expect(createStateClaimSupportVerifier(true).verify(modelOf(stateful, loginWithClaim), CTX)).toEqual([]);
  });

  it('登録される検証器は STATE_CLAIM_SUPPORTED のとおりに振る舞う', () => {
    expect(ALL_VERIFIERS).toContain(stateClaimSupportVerifier);
    expect(stateClaimSupportVerifier.verify(modelOf(stateful), CTX)).toHaveLength(STATE_CLAIM_SUPPORTED ? 0 : 1);
  });
});
