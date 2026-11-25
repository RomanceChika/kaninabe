/**
 * J2(続き)`scans` の発火元のユニットテスト。
 *
 * 規約(job-spec-writing.md §検証・action-spec-writing.md §scans):
 *   - `scans` の 1 行ごとに、発火元(ジョブの `fires` 1 本、または auth の `sign_in[].runs` への名指し)が
 *     ちょうど 1 つあること。0 本(`fires` を消した = m05b)も、2 本以上も落ちる
 *   - 認証仕様が読めない構成では、`runs` 由来かもしれない 0 本の行は未検査として返す
 */

import { describe, expect, it } from 'vitest';
import { verifyScanOrigin } from '../../../../lib/job/verifiers/j2-scan-origin.js';
import type { AuthSpecModel } from '../../../../lib/model/auth/types.js';
import type { JobDecl } from '../../../../lib/model/job/types.js';
import type { ActionSpecModel } from '../../../../lib/model/trace/types.js';
import { authBranch, authModel } from '../../../helpers/auth-builder.js';
import { jobModel, scheduledJob } from '../../../helpers/job-builder.js';
import { scanDecl } from '../../../helpers/trace-builder.js';

/** 時刻起点のジョブ 1 本(`fires` を渡せば走査を起こす)。 */
function job(id: string, fires?: string): JobDecl {
  return scheduledJob(id, fires === undefined ? {} : { fires });
}

/** 走査の宣言(actions/README.md の `scans`)。 */
function actionsWith(...events: readonly string[]): ActionSpecModel {
  return {
    actions: [],
    unhandled: [],
    scans: events.map((event) => scanDecl(event, `app/src/operation/${event}.ts`)),
    unscanned: [],
    testTagBaseline: [],
  };
}

/** 指定のイベントを `runs` に名指した認証仕様。 */
function authRunning(...events: readonly string[]): AuthSpecModel {
  return authModel({ branches: [authBranch('member_active', { runs: events })] });
}

/** 検証して、メッセージの並びを返す。 */
function messages(
  jobs: readonly JobDecl[],
  actions: ActionSpecModel,
  auth?: AuthSpecModel,
): readonly string[] {
  return verifyScanOrigin({ jobs: jobModel(jobs), actions, auth }).findings.map((finding) => finding.message);
}

describe('J2: scans の発火元', () => {
  it('ジョブの fires 1 本と sign_in の runs 1 つが、それぞれ別の走査を起こしていれば違反なし', () => {
    expect(
      messages([job('close', 'c.close')], actionsWith('c.close', 'm.activate'), authRunning('m.activate')),
    ).toEqual([]);
  });

  it('fires を消したジョブの走査は、起こすものが無いとしてエラー(m05b)', () => {
    const found = messages([job('close')], actionsWith('c.close'));

    expect(found).toEqual([
      'scans の c.close を起こす発火元がありません(fires で名指すジョブも、sign_in[].runs で名指す行も無い)',
    ]);
  });

  it('同じイベントを 2 本のジョブが起こしていれば、名指してエラー', () => {
    const found = messages([job('a', 'c.close'), job('b', 'c.close')], actionsWith('c.close'));

    expect(found).toEqual(['scans の c.close の発火元が 2 つあります(ジョブ a / ジョブ b)。ちょうど 1 つにします']);
  });

  it('ジョブが起こす走査を sign_in の runs も名指していれば、2 つの発火元としてエラー', () => {
    const found = messages([job('a', 'c.close')], actionsWith('c.close'), authRunning('c.close'));

    expect(found).toEqual([
      'scans の c.close の発火元が 2 つあります(ジョブ a / auth.md の sign_in[].runs)。ちょうど 1 つにします',
    ]);
  });

  it('sign_in の複数の行が同じイベントを名指しても、発火元は 1 つと数える', () => {
    const auth = authModel({
      branches: [authBranch('one', { runs: ['m.activate'] }), authBranch('two', { runs: ['m.activate'] })],
    });

    expect(messages([], actionsWith('m.activate'), auth)).toEqual([]);
  });

  it('認証仕様が無い環境では、runs を持たないものとして数える(ジョブの無い走査はエラー)', () => {
    const missing: AuthSpecModel = { available: false, flow: null };

    expect(messages([], actionsWith('m.activate'), missing)).toHaveLength(1);
    expect(messages([], actionsWith('m.activate'), undefined)).toHaveLength(1);
  });

  it('反例に走査・実装・名指したジョブ・sign_in の有無を載せる', () => {
    const [finding] = verifyScanOrigin({
      jobs: jobModel([job('a', 'c.close')]),
      actions: actionsWith('c.close'),
      auth: authRunning('c.close'),
    }).findings;

    expect(finding?.verifier).toBe('J2');
    expect(finding?.counterexample).toEqual({
      event: 'c.close',
      implementation: 'app/src/operation/c.close.ts',
      jobs: 'a',
      sign_in: 'yes',
    });
  });

  it('認証仕様が読めない(スキーマ違反)ときは、ジョブの無い走査を未検査として返し、エラーにしない', () => {
    const unreadable: AuthSpecModel = { available: true, flow: null };

    const result = verifyScanOrigin({
      jobs: jobModel([job('close', 'c.close')]),
      actions: actionsWith('c.close', 'm.activate'),
      auth: unreadable,
    });

    expect(result.findings).toEqual([]);
    expect(result.unchecked).toEqual(['m.activate']);
  });

  it('認証仕様が読めなくても、ジョブだけで決まる 2 本以上は落とす', () => {
    const unreadable: AuthSpecModel = { available: true, flow: null };

    const result = verifyScanOrigin({
      jobs: jobModel([job('a', 'c.close'), job('b', 'c.close')]),
      actions: actionsWith('c.close'),
      auth: unreadable,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.unchecked).toEqual([]);
  });
});
