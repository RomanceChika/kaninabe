/**
 * K5(ログの目録 `logging` の宣言と、ログの転送先)のユニットテスト。
 *
 * 規約網羅(config-spec-writing.md §ログの目録):
 *   - `logging` が無ければ落ちる(ASVS V16.1.1 / V16.4.3)。書かれていて読めなかった(K0 が言った)ときは二重に言わない
 *   - `sink.off_host: false`(ホストの中)は落ちる。`true` なら通る
 *   - `app_direct` の鍵の環境変数(`key_env`)は variables に行があり、本番の置き場(`required_in`)に置かれる宣言であること
 *   - **導入はマストではない**: 警告は本番を宣言したとき(`required_in` が空でない)だけ。
 *       本番を宣言・転送先なし → 警告(未分類)/ 本番を宣言・`exempt` → 警告(受け入れた危険。毎回名指す)/ 本番を宣言しない → 何も言わない
 *   - カタログが読めていない・available でないときは何も言わない
 *   - 検査から見えない本番の転送先は、実行ログが毎回「未検証」と名指す(本番を宣言して転送先を持つときだけ)
 *   - 受け入れた危険の宣言は、外す宣言があるときだけ取り出される(W5 の突合相手)
 */

import { describe, expect, it } from 'vitest';
import { logSinkAcceptances, verifyLogSink } from '../../../../lib/config/verifiers/k5-log-sink.js';
import { describeLogSinkRun } from '../../../../lib/config/log-sink-note.js';
import type { ConfigLogDestination, ConfigLogSinkDecl, ConfigSpecModel } from '../../../../lib/model/config/types.js';
import { configCatalog, configModel, configVariable, loggingDecl } from '../../../helpers/config-builder.js';

const EXEMPT_LOCATION = { file: 'specs/config.md', pointer: 'logging.sink.exempt' };

/** アプリから直接送る宣言。 */
function appDirect(keyEnv: string | null = 'LOG_KEY', overrides: Partial<Extract<ConfigLogDestination, { kind: 'forward' }>> = {}): ConfigLogDestination {
  return { kind: 'forward', mode: 'app_direct', label: '収集サービス', offHost: true, keyEnv, configuredIn: 'ホストの環境変数', ...overrides };
}

/** 鍵の行(置き場は引数)。 */
function keyRow(targets: readonly string[]) {
  return configVariable('LOG_KEY', { requirement: 'optional_degrades', targets });
}

describe('K5: ログの目録の宣言', () => {
  it('logging があり、転送先がホストの外なら違反なし', () => {
    expect(verifyLogSink({ config: configModel([], true, loggingDecl()) })).toEqual([]);
  });

  it('logging が無ければ落ちる(宣言の場所と書き方を示す)', () => {
    const findings = verifyLogSink({ config: configModel([]) });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'K5', severity: 'error', counterexample: { declared: 'false' } });
    expect(findings[0]?.message).toContain('ログの目録(logging)がありません');
    expect(findings[0]?.suggestion).toContain('off_host');
    expect(findings[0]?.suggestion).toContain('exempt');
  });

  it('書かれていて読めなかった logging は K0 が言うので、K5 は「無い」と二重に言わない', () => {
    const catalog = { ...configCatalog([]), loggingDeclared: true };
    expect(verifyLogSink({ config: { available: true, catalog } })).toEqual([]);
  });

  it('転送先がホストの中(off_host: false)なら落ちる', () => {
    const destination: ConfigLogDestination = { kind: 'forward', mode: 'host_drain', label: '同じホストのファイル', offHost: false, keyEnv: null, configuredIn: 'サーバー上' };
    const findings = verifyLogSink({ config: configModel([], true, loggingDecl({ sink: { requiredIn: ['ci'], destination } })) });
    expect(findings).toEqual([
      expect.objectContaining({ verifier: 'K5', severity: 'error', counterexample: { sink: '同じホストのファイル', offHost: 'false' } }),
    ]);
    expect(findings[0]?.message).toContain('ホストの外にありません');
  });

  it('カタログが読めていない・設定仕様が無いときは何も言わない', () => {
    const unreadable: ConfigSpecModel = { available: true, catalog: null };
    const absent: ConfigSpecModel = { available: false, catalog: null };
    expect(verifyLogSink({ config: unreadable })).toEqual([]);
    expect(verifyLogSink({ config: absent })).toEqual([]);
  });
});

describe('K5: アプリから直接送る鍵(app_direct の key_env)', () => {
  it('鍵の行があり、必須の置き場に置かれる宣言なら違反なし', () => {
    const decl = loggingDecl({ sink: { requiredIn: ['ci'], destination: appDirect() } });
    expect(verifyLogSink({ config: configModel([keyRow(['local', 'ci'])], true, decl) })).toEqual([]);
  });

  it('鍵の行が variables に無ければ落ちる(実装が読む設定とカタログの 1 対 1 を壊す)', () => {
    const decl = loggingDecl({ sink: { requiredIn: ['ci'], destination: appDirect() } });
    const findings = verifyLogSink({ config: configModel([], true, decl) });
    expect(findings).toEqual([expect.objectContaining({ verifier: 'K5', severity: 'error', counterexample: { key_env: 'LOG_KEY' } })]);
    expect(findings[0]?.message).toContain('variables にありません');
  });

  it('鍵の置き場に、必須にした置き場が入っていなければ落ちる(本番に鍵を置けない宣言)', () => {
    const decl = loggingDecl({ sink: { requiredIn: ['ci', 'local'], destination: appDirect() } });
    const findings = verifyLogSink({ config: configModel([keyRow(['local'])], true, decl) });
    expect(findings).toEqual([expect.objectContaining({ severity: 'error', counterexample: { key_env: 'LOG_KEY', missing: 'ci' } })]);
    expect(findings[0]?.message).toContain('置き場に、転送先を必須にした置き場(ci)が入っていません');
  });

  it('本番を宣言していなければ、鍵の置き場は問わない(行があればよい)', () => {
    const decl = loggingDecl({ sink: { requiredIn: [], destination: appDirect() } });
    expect(verifyLogSink({ config: configModel([keyRow([])], true, decl) })).toEqual([]);
  });

  it('host_drain は鍵を持たないので、variables を見ない', () => {
    expect(verifyLogSink({ config: configModel([], true, loggingDecl()) })).toEqual([]);
  });

  it('app_direct でも key_env が null(K0 が先に落とす形)なら K5 は鍵を見ない', () => {
    const decl = loggingDecl({ sink: { requiredIn: ['ci'], destination: appDirect(null) } });
    expect(verifyLogSink({ config: configModel([], true, decl) })).toEqual([]);
  });
});

describe('K5: 導入はマストではない(警告は本番を宣言したときだけ)', () => {
  const NONE: ConfigLogDestination = { kind: 'none' };

  it('本番を宣言していて転送先も exempt も無ければ、警告(未分類。受け入れた危険ではない)', () => {
    const findings = verifyLogSink({ config: configModel([], true, loggingDecl({ sink: { requiredIn: ['ci'], destination: NONE } })) });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'K5', severity: 'warning', counterexample: { required_in: 'ci', sink: 'none' } });
    expect(findings[0]?.acceptance).toBeUndefined();
    expect(findings[0]?.message).toContain('本番の置き場(ci)を宣言していますが、ログの転送先がありません');
    expect(findings[0]?.suggestion).toContain('exempt');
  });

  it('本番を宣言していて exempt で外していれば、毎回「受け入れた危険」として名指す(理由つき)', () => {
    const destination: ConfigLogDestination = { kind: 'exempt', reason: '個人情報を持たない社内ツール', location: EXEMPT_LOCATION };
    const findings = verifyLogSink({ config: configModel([], true, loggingDecl({ sink: { requiredIn: ['ci'], destination } })) });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'K5',
      severity: 'warning',
      location: EXEMPT_LOCATION,
      counterexample: { exempt: '個人情報を持たない社内ツール' },
      acceptance: { reason: '個人情報を持たない社内ツール', location: EXEMPT_LOCATION },
    });
    expect(findings[0]?.message).toContain('理由: 個人情報を持たない社内ツール');
  });

  it('本番を宣言していなければ(試験環境・趣味の用途)、転送先が無くても何も言わない', () => {
    expect(verifyLogSink({ config: configModel([], true, loggingDecl({ sink: { requiredIn: [], destination: NONE } })) })).toEqual([]);
  });

  it('転送先を宣言していれば、本番を宣言していても警告は出ない', () => {
    expect(verifyLogSink({ config: configModel([keyRow(['ci'])], true, loggingDecl({ sink: { requiredIn: ['ci'], destination: appDirect() } })) })).toEqual([]);
  });
});

describe('K5: 受け入れた危険の宣言(W5 の突合相手)', () => {
  const EXEMPT: ConfigLogDestination = { kind: 'exempt', reason: '社内ツール', location: EXEMPT_LOCATION };

  it('外す宣言(本番を宣言している)があれば、警告の acceptance と同じものを取り出す', () => {
    const config = configModel([], true, loggingDecl({ sink: { requiredIn: ['ci'], destination: EXEMPT } }));
    expect(logSinkAcceptances(config)).toEqual([{ reason: '社内ツール', location: EXEMPT_LOCATION }]);
    expect(verifyLogSink({ config })[0]?.acceptance).toEqual(logSinkAcceptances(config)[0]);
  });

  it('外す宣言が無い・本番を宣言していない・カタログが無いときは空', () => {
    expect(logSinkAcceptances(configModel([], true, loggingDecl()))).toEqual([]);
    expect(logSinkAcceptances(configModel([], true, loggingDecl({ sink: { requiredIn: [], destination: EXEMPT } })))).toEqual([]);
    expect(logSinkAcceptances(configModel([]))).toEqual([]);
    expect(logSinkAcceptances({ available: false, catalog: null })).toEqual([]);
  });
});

describe('K5: 検査から見えないこと(本番の転送先)', () => {
  it('本番を宣言して転送先を持てば毎回、未実施の行で転送先・必須の置き場・保管日数・設定する場所を名指す', () => {
    const lines = describeLogSinkRun(loggingDecl());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^K5: 未実施 — 本番のログの転送先は未検証です/);
    for (const word of ['ログドレイン', 'ci', '90 日', 'ダッシュボードの設定画面']) expect(lines[0]).toContain(word);
  });

  it('app_direct は鍵の環境変数名と、未設定なら黙って標準出力だけになることを名指す', () => {
    const lines = describeLogSinkRun(loggingDecl({ sink: { requiredIn: ['ci'], destination: appDirect('LOG_KEY') } }));
    expect(lines[0]).toContain('鍵 LOG_KEY が本番に設定されたときだけ送る');
    expect(lines[0]).toContain('未設定なら黙って標準出力だけになる');
  });

  it('app_direct でも鍵の名前が無い形(K0 が落とす)は、ログドレインの言い方になる', () => {
    expect(describeLogSinkRun(loggingDecl({ sink: { requiredIn: ['ci'], destination: appDirect(null) } }))[0]).toContain('配置先のログドレインに任せる');
  });

  it('宣言が無ければ何も言わない(K5 の違反が言う)', () => {
    expect(describeLogSinkRun(undefined)).toEqual([]);
  });

  it('本番を宣言していなければ何も言わない(試験環境・趣味の用途)', () => {
    expect(describeLogSinkRun(loggingDecl({ sink: { requiredIn: [], destination: appDirect() } }))).toEqual([]);
  });

  it('転送先が無い・外している製品は、警告が言うのでここでは何も言わない', () => {
    expect(describeLogSinkRun(loggingDecl({ sink: { requiredIn: ['ci'], destination: { kind: 'none' } } }))).toEqual([]);
    expect(describeLogSinkRun(loggingDecl({ sink: { requiredIn: ['ci'], destination: { kind: 'exempt', reason: 'x', location: EXEMPT_LOCATION } } }))).toEqual([]);
  });
});

describe('K5: 死んだジョブの知らせ先(logging.dead_letter_alert。14 回目の決定)', () => {
  const sink = { requiredIn: ['ci'], destination: appDirect() };
  const alertDestination = appDirect('ALERT_URL', { label: '知らせの口' });
  const variables = [keyRow(['ci']), configVariable('ALERT_URL', { requirement: 'optional_degrades', targets: ['ci'] })];
  const verify = (deadLetterAlert?: ConfigLogSinkDecl) => {
    const { deadLetterAlert: _default, ...rest } = loggingDecl({ sink });
    return verifyLogSink({ config: configModel(variables, true, deadLetterAlert === undefined ? rest : { ...rest, deadLetterAlert }) });
  };

  it('本番を宣言して宛先があれば何も言わない', () => {
    expect(verify({ requiredIn: ['ci'], destination: alertDestination })).toEqual([]);
  });

  it('本番を宣言して宣言が無ければ警告(sink の置き場を継ぐ)', () => {
    const findings = verify();
    expect(findings).toEqual([expect.objectContaining({ verifier: 'K5', severity: 'warning', counterexample: { required_in: 'ci', dead_letter_alert: 'none' } })]);
    expect(findings[0]?.message).toContain('死んだジョブの知らせ先');
  });

  it('本番を宣言していなければ何も言わない', () => {
    const { deadLetterAlert: _default, ...rest } = loggingDecl({ sink: { requiredIn: [], destination: { kind: 'none' } } });
    expect(verifyLogSink({ config: configModel([], true, rest) })).toEqual([]);
  });

  it('理由つきで外すと、受け入れた危険として毎回名指す', () => {
    const exempt = { kind: 'exempt' as const, reason: '運用の人が毎朝ログを読む', location: EXEMPT_LOCATION };
    const decl = { requiredIn: ['ci'], destination: exempt };
    const findings = verify(decl);
    expect(findings).toEqual([expect.objectContaining({ severity: 'warning', acceptance: { reason: exempt.reason, location: EXEMPT_LOCATION } })]);
    expect(logSinkAcceptances(configModel(variables, true, loggingDecl({ sink, deadLetterAlert: decl })))).toEqual([{ reason: exempt.reason, location: EXEMPT_LOCATION }]);
  });

  it('鍵の環境変数が variables に無ければ落ちる', () => {
    expect(verify({ requiredIn: ['ci'], destination: appDirect('NOT_DECLARED') })).toEqual([expect.objectContaining({ severity: 'error', counterexample: { key_env: 'NOT_DECLARED' } })]);
  });

  it('宛先を持つ本番は実行ログが未検証と名指す', () => {
    const lines = describeLogSinkRun(loggingDecl({ sink, deadLetterAlert: { requiredIn: ['ci'], destination: alertDestination } }));
    expect(lines.join('\n')).toContain('死んだジョブの知らせ先は未検証');
  });
});
