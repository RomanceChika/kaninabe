import { describe, expect, it } from 'vitest';
import { jobTargetsOf } from '../../../../lib/target-api/contract.js';
import { cronRouteTestsGenerator } from '../../../../lib/targets/vercel/generate/code-cron-route-tests.js';
import { IP_RATE_LIMIT_UNVERIFIED } from '../../../../lib/targets/vercel/ip-rate-limit.js';
import { VERCEL_TARGET } from '../../../../lib/targets/vercel/target.js';
import { jobModel, scheduledJob } from '../../../helpers/job-builder.js';
import { specModel } from '../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/**
 * ホストの後段 Vercel の登録(役割・登録する検査・登録する生成器)。ルール ID と生成器の ID は、コアにあったときと同じ。
 */

describe('VERCEL_TARGET', () => {
  it('役割は host。登録する検査は J2(Cron の登録の突合)と J4(頻度制約)で、プラットフォームの設定は持たない', () => {
    expect(VERCEL_TARGET.id).toBe('vercel');
    expect(VERCEL_TARGET.role).toBe('host');
    expect(VERCEL_TARGET.verifiers.map((verifier) => [verifier.group, verifier.id])).toEqual([
      ['job', 'J2'],
      ['job', 'J4'],
    ]);
    expect(VERCEL_TARGET.platform).toBeUndefined();
  });

  it('登録する生成器は Cron 起動口の見張りテスト 1 本(ID はコアにあったときのまま)', () => {
    expect(VERCEL_TARGET.generators).toEqual([cronRouteTestsGenerator]);
    expect(cronRouteTestsGenerator.id).toBe('code-cron-route-tests');
  });

  it('登録した検査は口の ID のまま動く(J4: 1 日に複数回の scheduler: host を落とす / J2: app/ が無ければ登録の突合を飛ばす)', () => {
    const [j2, j4] = [VERCEL_TARGET.verifiers[0], VERCEL_TARGET.verifiers[1]];
    const input = { domain: specModel([]), jobs: jobModel([scheduledJob('too_often', { cron: '*/5 * * * *' })]), repoRoot: '/no/such/root', roots: TEST_ROOTS };
    expect(j4?.verify(input).map((finding) => finding.verifier)).toEqual(['J4']);
    expect(j2?.verify(input)).toEqual([]);
  });

  it('jobTargetsOf は後段の役割をつけて検査を集め、選んだ後段の名前・役割・対象外の宣言も運ぶ', () => {
    const registry = jobTargetsOf([VERCEL_TARGET]);
    expect(registry.checks.map((entry) => [entry.role, entry.check.id])).toEqual([
      ['host', 'J2'],
      ['host', 'J4'],
    ]);
    expect(registry.targets).toEqual([{ id: 'vercel', role: 'host', notApplicable: {}, unverified: [IP_RATE_LIMIT_UNVERIFIED] }]);
  });
});
