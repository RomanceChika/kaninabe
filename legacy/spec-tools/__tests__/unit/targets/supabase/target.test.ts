import { describe, expect, it } from 'vitest';
import { verifyPgCronParity } from '../../../../lib/targets/supabase/job/j3-pgcron-parity.js';
import { SUPABASE_PLATFORM_PROFILE } from '../../../../lib/targets/supabase/platform-profile.js';
import { SUPABASE_TARGET } from '../../../../lib/targets/supabase/target.js';
import { specModel } from '../../../helpers/model-builder.js';
import { jobModel, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/**
 * プラットフォームの後段 Supabase の登録(役割・プラットフォームの設定・登録する検査)。pg_cron は Supabase の拡張なので、
 * J3(migration の `cron.schedule` との突合)はこの後段が登録する。
 */

describe('SUPABASE_TARGET', () => {
  it('役割は platform。プラットフォームの設定(ロール名・認証の式・外に出すスキーマ)を持つ', () => {
    expect(SUPABASE_TARGET.id).toBe('supabase');
    expect(SUPABASE_TARGET.role).toBe('platform');
    expect(SUPABASE_TARGET.platform).toBe(SUPABASE_PLATFORM_PROFILE);
  });

  it('登録する検査は J3 だけ。登録する生成器は無い(SQL の生成器はプラットフォームの設定を引数で受ける側)', () => {
    expect(SUPABASE_TARGET.verifiers.map((verifier) => [verifier.group, verifier.id])).toEqual([['job', 'J3']]);
    expect(SUPABASE_TARGET.generators).toEqual([]);
  });

  it('登録した J3 は migration の登録との突合をそのまま行う(pg_cron の行の登録が無ければ落とす)', () => {
    const jobs = jobModel([scheduledJob('missing_in_migration', { scheduler: 'database', cron: '5 5 * * *' })]);
    const input = { domain: specModel([]), jobs, repoRoot: '/no/such/root', roots: TEST_ROOTS };
    const registered = SUPABASE_TARGET.verifiers[0]?.verify(input) ?? [];
    expect(registered).toEqual(verifyPgCronParity(input));
    expect(registered.map((finding) => finding.verifier)).toEqual(['J3']);
  });
});
