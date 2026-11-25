/**
 * H5(サインインの方式と公開スキーマの突合)の**契約**のユニットテスト — 後段が登録した検査の実行と、実行の状態の言い方。
 *
 * 見るのは次のこと(検査の本体の中身は、後段のテストが見る):
 *   - 検査が登録されていなければ何も見ず `unregistered`(未実施として報告される。緑にしない)
 *   - 設定ファイルが無ければ `absent`(未実施)・読めれば `checked` で、違反をそのまま返す
 *   - 認証フロー仕様の宣言(方式)を検査へ渡す。宣言を読めていなければ検査を呼ばない(`no_declaration`)
 *   - 違反は H1〜H4 のあとに並ぶ
 */

import { describe, expect, it } from 'vitest';
import type { AuthConfigInput, AuthConfigVerifier } from '../../../lib/auth/platform-config.js';
import { H5_ID, runAuthConfig } from '../../../lib/auth/platform-config.js';
import { runAuthVerification } from '../../../lib/auth/run.js';
import { AUTH_CHECKS } from '../../../lib/auth/checks.js';
import { ALL_CHECKS } from '../../../lib/compose/all-checks.js';
import { describeAuthConfigRun, isCheckRunNote } from '../../../lib/verify/check-run-report.js';
import { isSkipNote } from '../../../lib/verify/skip-notes.js';
import type { Finding } from '../../../lib/kernel/finding.js';
import { authModel, authSessions } from '../../helpers/auth-builder.js';
import { loc, specModel } from '../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
import { scanResult } from '../../helpers/trace-builder.js';
import { UNSELECTED } from '../../helpers/verify-inputs.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';

const LOCAL_B = { method: 'password_b', reason: 'ローカルのテスト利用者がパスワードで入る' };
const INPUT: AuthConfigInput = { providers: ['oauth_a'], localOnly: [LOCAL_B], repoRoot: '/repo', roots: TEST_ROOTS };

const FINDING: Finding = {
  verifier: H5_ID,
  severity: 'error',
  message: '開いている口がある',
  location: loc('config.toml'),
  suggestion: '閉じる',
};

/** 呼ばれたときの入力を覚える検査。 */
function recording(outcome: ReturnType<AuthConfigVerifier['verify']>): { readonly verifier: AuthConfigVerifier; readonly calls: AuthConfigInput[] } {
  const calls: AuthConfigInput[] = [];
  return {
    calls,
    verifier: {
      id: H5_ID,
      verify: (input) => {
        calls.push(input);
        return outcome;
      },
    },
  };
}

describe('runAuthConfig', () => {
  it('検査が登録されていなければ何も見ず unregistered', () => {
    expect(runAuthConfig(null, INPUT)).toEqual({ findings: [], run: { state: 'unregistered', localOnly: [LOCAL_B] } });
    expect(runAuthConfig(undefined, INPUT)).toEqual({ findings: [], run: { state: 'unregistered', localOnly: [LOCAL_B] } });
  });

  it('設定ファイルが無ければ absent(違反は返さない)', () => {
    const { verifier } = recording({ status: 'absent', file: 'conf/platform.toml' });

    expect(runAuthConfig(verifier, INPUT)).toEqual({ findings: [], run: { state: 'absent', file: 'conf/platform.toml', localOnly: [LOCAL_B] } });
  });

  it('読めれば checked で、違反をそのまま返す', () => {
    const { verifier } = recording({ status: 'checked', file: 'conf/platform.toml', findings: [FINDING], skipped: [] });

    expect(runAuthConfig(verifier, INPUT)).toEqual({ findings: [FINDING], run: { state: 'checked', file: 'conf/platform.toml', skipped: [], localOnly: [LOCAL_B] } });
  });
});

describe('runAuthVerification と H5', () => {
  /** 画面仕様を採らない最小の入力(H5 の配線だけを見る)。 */
  function run(auth: ReturnType<typeof authModel>, authConfig?: AuthConfigVerifier | null) {
    return runAuthVerification({
      domain: specModel([]),
      auth,
      screens: UNSELECTED,
      repoRoot: '/repo',
      roots: TEST_ROOTS,
      layout: TEST_LAYOUT,
      actions: UNSELECTED,
      registry: buildTcRegistry([]),
      tests: scanResult({ available: false }),
      ...(authConfig === undefined ? {} : { authConfig }),
    });
  }

  it('宣言の方式(providers と local_only)を検査へ渡す', () => {
    const { verifier, calls } = recording({ status: 'checked', file: 'conf/platform.toml', findings: [], skipped: [] });

    const result = run(authModel({ providers: ['oauth_a'], localOnly: [LOCAL_B] }), verifier);

    expect(calls).toEqual([{ providers: ['oauth_a'], localOnly: [LOCAL_B], repoRoot: '/repo', roots: TEST_ROOTS }]);
    expect(result.authConfig).toEqual({ state: 'checked', file: 'conf/platform.toml', skipped: [], localOnly: [LOCAL_B] });
  });

  it('宣言したセッションの寿命も検査へ渡し、実行の状態に載せる(本番は未検証と名指すため)', () => {
    const { verifier, calls } = recording({ status: 'checked', file: 'conf/platform.toml', findings: [], skipped: [] });
    const sessions = authSessions();

    const result = run(authModel({ sessions }), verifier);

    expect(calls).toEqual([{ providers: ['oauth_a'], localOnly: [], sessions, repoRoot: '/repo', roots: TEST_ROOTS }]);
    expect(result.authConfig).toEqual({ state: 'checked', file: 'conf/platform.toml', skipped: [], localOnly: [], sessions });
    expect(run(authModel({ sessions })).authConfig).toEqual({ state: 'unregistered', localOnly: [], sessions });
  });

  it('H5 の違反は結果に載る(エラーの H5 が verify を赤にする)', () => {
    const { verifier } = recording({ status: 'checked', file: 'conf/platform.toml', findings: [FINDING], skipped: [] });

    const result = run(authModel(), verifier);

    expect(result.findings.filter((finding) => finding.verifier === H5_ID)).toEqual([FINDING]);
    expect(result.findings.at(-1)).toEqual(FINDING);
  });

  it('後段が登録していなければ unregistered(認証フロー仕様があっても緑にしない)', () => {
    expect(run(authModel()).authConfig).toEqual({ state: 'unregistered', localOnly: [] });
    expect(run(authModel(), null).authConfig).toEqual({ state: 'unregistered', localOnly: [] });
  });

  it('宣言を読めていなければ検査を呼ばない(no_declaration)', () => {
    const { verifier, calls } = recording({ status: 'checked', file: 'conf/platform.toml', findings: [], skipped: [] });

    const result = run({ available: true, flow: null }, verifier);

    expect(calls).toEqual([]);
    expect(result.authConfig).toEqual({ state: 'no_declaration', cause: 'unreadable' });
  });

  it('認証フロー仕様が無ければ検査を呼ばない', () => {
    const { verifier, calls } = recording({ status: 'checked', file: 'conf/platform.toml', findings: [], skipped: [] });

    const result = run({ available: false, flow: null }, verifier);

    expect(calls).toEqual([]);
    expect(result.authConfig).toEqual({ state: 'no_declaration', cause: 'absent' });
  });
});

describe('describeAuthConfigRun(実行ログの行)', () => {
  const UNSEEN = '開いているサインインの方式と外へ出すスキーマと戻り先の許可リストが宣言の範囲に収まっているか、セッションの寿命が宣言と同じかの突合は見ていません';

  it('後段が登録していなければ「H5: 未実施 — プラットフォームの後段がこの検査を登録していないため…」(範囲が縮んだ報告として数える)', () => {
    const lines = describeAuthConfigRun({ state: 'unregistered', localOnly: [] });

    expect(lines).toEqual([`H5: 未実施 — プラットフォームの後段がこの検査を登録していないため、${UNSEEN}。`]);
    for (const line of lines) {
      expect(isCheckRunNote(line)).toBe(true);
      expect(isSkipNote(line)).toBe(true);
    }
  });

  it('設定ファイルが無ければ、そのパスを名指して未実施と言う', () => {
    expect(describeAuthConfigRun({ state: 'absent', file: 'conf/platform.toml', localOnly: [] })).toEqual([`H5: 未実施 — conf/platform.toml が無い(または読めない)ため、${UNSEEN}。`]);
  });

  it('認証フロー仕様が無い / 読めないときも、理由を分けて未実施と言う(黙らない)', () => {
    expect(describeAuthConfigRun({ state: 'no_declaration', cause: 'absent' })).toEqual([`H5: 未実施 — 認証フロー仕様が無いため、${UNSEEN}。`]);
    expect(describeAuthConfigRun({ state: 'no_declaration', cause: 'unreadable' })).toEqual([`H5: 未実施 — 認証フロー仕様を読めないため、${UNSEEN}。`]);
  });

  it('実行した(飛ばした部分が無く、local_only も無い)なら何も言わない', () => {
    expect(describeAuthConfigRun({ state: 'checked', file: 'conf/platform.toml', skipped: [], localOnly: [] })).toEqual([]);
  });

  it('飛ばした部分は、理由ごとに未実施の行になる', () => {
    const lines = describeAuthConfigRun({ state: 'checked', file: 'conf/platform.toml', skipped: ['[auth] enabled = false のため、サインインの方式の突合は見ていません'], localOnly: [] });

    expect(lines).toEqual(['H5: 未実施 — [auth] enabled = false のため、サインインの方式の突合は見ていません。']);
    expect(isCheckRunNote(lines[0] ?? '')).toBe(true);
  });

  it('local_only があれば、緑(checked)でも毎回「本番の設定は未検証」を名指し、範囲サマリに数える', () => {
    const lines = describeAuthConfigRun({ state: 'checked', file: 'conf/platform.toml', skipped: [], localOnly: [LOCAL_B, { method: 'other', reason: '別の理由' }] });

    expect(lines).toEqual(['H5: 未実施 — 本番の設定は未検証です(local_only: password_b — ローカルのテスト利用者がパスワードで入る、other — 別の理由)。本番の管理画面で閉じていることを確かめてください。']);
    expect(isCheckRunNote(lines[0] ?? '')).toBe(true);
    expect(isSkipNote(lines[0] ?? '')).toBe(true);
  });

  it('sessions を読めていれば、緑(checked)でも毎回「本番のセッションの寿命は未検証」を名指し、範囲サマリに数える', () => {
    const lines = describeAuthConfigRun({ state: 'checked', file: 'conf/platform.toml', skipped: [], localOnly: [], sessions: authSessions() });

    expect(lines).toEqual(['H5: 未実施 — 本番のセッションの寿命は未検証です(sessions: 無操作の時間切れ 8h・絶対の寿命 24h・同時セッション 上限なし)。本番のプランでこの設定が使えるか(プラットフォームによっては上位のプランだけの機能)も確かめていません。本番の管理画面で同じ値になっていて、設定が効くプランであることを確かめてください。']);
    expect(isCheckRunNote(lines[0] ?? '')).toBe(true);
    expect(isSkipNote(lines[0] ?? '')).toBe(true);
    expect(describeAuthConfigRun({ state: 'unregistered', localOnly: [LOCAL_B], sessions: authSessions() })).toHaveLength(3);
  });

  it('多要素認証を要求するなら「本番の多要素認証の要素は未検証」を名指す(外す宣言なら名指さない — H6 が受け入れた危険として言う)', () => {
    const location = { file: 'auth.md', pointer: 'mfa' };
    const lines = describeAuthConfigRun({ state: 'checked', file: 'conf/platform.toml', skipped: [], localOnly: [], mfa: { kind: 'require', scope: { kind: 'roles', roles: ['role_a'] }, to: 'screen-mfa', implementation: 'a.ts::f', summary: 's', location } });

    expect(lines).toEqual(['H5: 未実施 — 本番の多要素認証の要素は未検証です(mfa: 要求する範囲はロール role_a)。本番の管理画面で要素(登録と確認)が有効になっていることを確かめてください。']);
    expect(isSkipNote(lines[0] ?? '')).toBe(true);
    expect(describeAuthConfigRun({ state: 'checked', file: 'conf/platform.toml', skipped: [], localOnly: [], mfa: { kind: 'exempt', reason: '理由', location } })).toEqual([]);
  });

  it('local_only の行は、設定ファイルが無い・後段が登録していないときにも付く', () => {
    expect(describeAuthConfigRun({ state: 'absent', file: 'conf/platform.toml', localOnly: [LOCAL_B] })).toHaveLength(2);
    expect(describeAuthConfigRun({ state: 'unregistered', localOnly: [LOCAL_B] })).toHaveLength(2);
  });
});

describe('H5 の登録', () => {
  it('H 群の検査の表と全検査の表に H5 が載る', () => {
    expect(AUTH_CHECKS.map((check) => check.id)).toContain(H5_ID);
    expect(ALL_CHECKS.map((check) => check.id)).toContain(H5_ID);
  });
});
