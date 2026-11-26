import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pgCronSkipped, verifyPgCronParity } from '../../../../lib/targets/supabase/job/j3-pgcron-parity.js';
import { SUPABASE_PLATFORM_PROFILE } from '../../../../lib/targets/supabase/platform-profile.js';
import { SUPABASE_TARGET } from '../../../../lib/targets/supabase/target.js';
import { specModel } from '../../../helpers/model-builder.js';
import { jobModel, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/**
 * プラットフォームの後段 Supabase の登録(役割・プラットフォームの設定・登録する検査)。pg_cron は Supabase の拡張なので、
 * J3(migration の `cron.schedule` との突合)はこの後段が登録する。
 */

/** migration の置き場を持つ fixture(置き場が無いと J3 は突合を飛ばすので、突合が走る木を使う)。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/jobs-repo');

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
    const input = { domain: specModel([]), jobs, repoRoot: REPO_ROOT, roots: TEST_ROOTS };
    const registered = SUPABASE_TARGET.verifiers[0]?.verify(input) ?? [];
    expect(registered).toEqual(verifyPgCronParity(input));
    // 片方向(カタログにあって migration に無い)と逆方向(fixture の run_due_jobs がカタログに無い)の 2 件。
    expect(registered.map((finding) => finding.verifier)).toEqual(['J3', 'J3']);
  });

  it('登録した J3 は、突合しなかった分の一言(skipped)も後段が言う(コアは中身を知らない)', () => {
    const jobs = jobModel([scheduledJob('spec_only', { scheduler: 'database', cron: '5 5 * * *' })]);
    const input = { domain: specModel([]), jobs, repoRoot: REPO_ROOT, roots: { ...TEST_ROOTS, migrations: 'none', app: null } };
    const note = SUPABASE_TARGET.verifiers[0]?.skipped?.(input);
    expect(note).toBe(pgCronSkipped(input));
    expect(note).toContain('J3');
  });
});
