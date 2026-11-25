/**
 * J7(セッションを終える効果の宣言 `ends_sessions` と、アカウントを止める遷移の宣言漏れ = R11)のユニットテスト。
 *
 * 規約網羅(job-spec-writing.md §検証):
 *   宣言そのもの(J5 と同形)
 *   - 対象が認証フローの主語の集約で、その状態機械の effects から積まれていれば違反なし
 *   - 対象の集約が無い / 認証フローの主語でない / 自分の機械から積まれていない / 別の集約から積まれている → 赤
 *   - writes[].effects にも載せていれば赤・kind の語が in_transaction でなければ赤・1 つの集約に 2 つあれば赤
 *   - kind の語の declares: [ends_sessions] と行の ends_sessions が対であること(書き忘れ・宣言の無い語)
 *   R11(アカウントを止める遷移は宣言しなければならない)
 *   - 終端の状態へ行く遷移 / tone: negative の状態へ行く遷移 / 匿名化する効果を持つ遷移は、宣言が無ければ赤(効果が 1 本も無い製品でも)
 *   - 一時停止(終端でも negative でもない状態へ行く遷移)は求めない
 *   - 主語が enum の欄(遷移を持たない)・認証仕様が無い構成では R11 は見ない
 */

import { describe, expect, it } from 'vitest';
import { subjectAggregateOf, verifyEndsSessions } from '../../../../lib/job/verifiers/j7-ends-sessions.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { aggregate, effect, event, machine, specModel, accessSpec, write } from '../../../helpers/model-builder.js';
import { jobModel as jobModelWith, outboxJob } from '../../../helpers/job-builder.js';
import { authModel } from '../../../helpers/auth-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** 認証フローの主語は状態機械 `membership`(集約 `member`)。 */
const AUTH = authModel();

/** `end` は終える効果の語(in_transaction + declares: [ends_sessions])。`plain` は宣言の無い語。 */
const KIND_TERMS = [
  { id: 'end', inTransaction: true, declares: ['ends_sessions' as const] },
  { id: 'scrub', inTransaction: true, declares: ['anonymizes' as const] },
  { id: 'plain' },
];

const jobModel = (jobs: Parameters<typeof jobModelWith>[0], kindTerms: Parameters<typeof jobModelWith>[2] = KIND_TERMS) =>
  jobModelWith(jobs, true, kindTerms);

const END = outboxJob('end_member_sessions', { kind: 'end', endsSessions: 'member', platformCall: 'revoke_auth_sessions', inTransaction: true });

/**
 * メンバーの集約。`disable`(tone: negative の disabled へ)・`leave`(終端 left へ)・`pause`(休会 = 求めない)を持つ。
 * `effects` は遷移 ID → 積む効果(既定は disable と leave が END を積む)。
 */
function memberAggregate(effects: Record<string, readonly string[]> = { disable: ['end_member_sessions'], leave: ['end_member_sessions'] }) {
  return aggregate('member', {
    stateMachines: [
      machine('membership', {
        states: ['active', 'paused', 'disabled', 'left'],
        initial: 'active',
        final: ['left'],
        stateTone: { disabled: 'negative' },
        events: [
          event('pause', { from: ['active'], to: 'paused' }),
          event('disable', { from: ['active', 'paused'], to: 'disabled' }),
          event('leave', { from: ['active', 'paused', 'disabled'], to: 'left' }),
        ],
        effects: Object.entries(effects).map(([on, ids]) => effect(on, ids)),
      }),
    ],
  });
}

const domain = (...others: Parameters<typeof specModel>[0]): SpecModel => specModel([memberAggregate(), ...others]);

describe('J7: セッションを終える効果の宣言', () => {
  it('認証フローの主語の集約の遷移から積まれ、止める遷移がすべて宣言していれば違反なし', () => {
    expect(verifyEndsSessions(domain(), jobModel([END]), AUTH, TEST_ROOTS)).toEqual([]);
  });

  it('カタログが無ければ何も見ない', () => {
    expect(verifyEndsSessions(domain(), { available: false, catalog: null }, AUTH, TEST_ROOTS)).toEqual([]);
  });

  it('ends_sessions が仕様に無い集約を指していればエラー', () => {
    const catalog = jobModel([outboxJob('end_member_sessions', { kind: 'end', endsSessions: 'ghost', platformCall: 'x', inTransaction: true })]);

    const findings = verifyEndsSessions(domain(), catalog, AUTH, TEST_ROOTS).filter((f) => f.counterexample?.['ends_sessions'] === 'ghost');

    expect(findings.map((f) => f.verifier)).toEqual(['J7']);
    expect(findings[0]?.message).toContain('仕様に無い集約');
  });

  it('認証フローの主語でない集約を指していればエラー(ログイン状態を持つのは主語だけ)', () => {
    const shelf = aggregate('shelf', {
      stateMachines: [machine('shelf', { states: ['open', 'closed'], initial: 'open', effects: [effect('close', ['end_shelf_sessions'])] })],
    });
    const row = outboxJob('end_shelf_sessions', { kind: 'end', endsSessions: 'shelf', platformCall: 'x', inTransaction: true });

    const findings = verifyEndsSessions(domain(shelf), jobModel([END, row]), AUTH, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('認証フローの主語の集約(member)ではありません');
  });

  it('対象の集約の状態機械の effects から積まれていなければエラー(止める遷移の宣言漏れも別に出る)', () => {
    const model = specModel([memberAggregate({})]);

    const findings = verifyEndsSessions(model, jobModel([END]), AUTH, TEST_ROOTS);

    // どこからも積まれていない場合は J1 の担当(重ねて言わない)。止める遷移の宣言漏れ(R11)だけが出る。
    expect(findings.every((f) => f.message.includes('アカウントを止める'))).toBe(true);
  });

  it('writes[].effects(状態遷移を持たない編集)にだけ載っていればエラー', () => {
    const model = specModel([
      aggregate('member', {
        stateMachines: memberAggregate({ disable: ['x'], leave: ['x'] }).stateMachines,
        access: accessSpec('member', { writes: [write('member', ['name'], undefined, ['end_member_sessions'])] }),
      }),
    ]);

    const findings = verifyEndsSessions(model, jobModel([END]), AUTH, TEST_ROOTS).filter((f) => !f.message.includes('アカウントを止める'));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('member の状態機械の effects から積まれていません');
  });

  it('自分の機械から積まれていても writes[].effects にも載せていればエラー', () => {
    const model = specModel([
      aggregate('member', {
        stateMachines: memberAggregate().stateMachines,
        access: accessSpec('member', { writes: [write('member', ['name'], undefined, ['end_member_sessions'])] }),
      }),
    ]);

    const findings = verifyEndsSessions(model, jobModel([END]), AUTH, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('writes[].effects にも載っています');
  });

  it('別の集約の遷移から積まれていればエラー', () => {
    const other = aggregate('shelf', {
      stateMachines: [machine('shelf', { states: ['open'], initial: 'open', effects: [effect('close', ['end_member_sessions'])] })],
    });

    const findings = verifyEndsSessions(domain(other), jobModel([END]), AUTH, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('別の集約 shelf の状態機械の effects から積まれています');
  });

  it('kind の語が in_transaction を宣言していなければエラー(キューに積むと再試行の間にログイン状態が残る)', () => {
    const row = outboxJob('end_member_sessions', { kind: 'end', endsSessions: 'member', platformCall: 'x' });
    const terms = [{ id: 'end', declares: ['ends_sessions' as const] }, { id: 'plain' }];

    const findings = verifyEndsSessions(domain(), jobModel([row], terms), AUTH, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('kind end が in_transaction を宣言していません');
  });

  it('1 つの集約にセッションを終える効果が 2 つあればエラー(2 つ目を指す)', () => {
    const model = specModel([memberAggregate({ disable: ['end_member_sessions', 'end_again'], leave: ['end_member_sessions'] })]);
    const again = outboxJob('end_again', { kind: 'end', endsSessions: 'member', platformCall: 'x', inTransaction: true });

    const findings = verifyEndsSessions(model, jobModel([END, again]), AUTH, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('member のセッションを終える効果が複数あります');
    expect(findings[0]?.location.pointer).toBe('jobs.end_again');
  });

  it('declares した語を選んで ends_sessions を書き忘れればエラー(他に ends_sessions を持つ行が無くても)', () => {
    const forgot = outboxJob('end_member_sessions', { kind: 'end', inTransaction: true });

    const findings = verifyEndsSessions(domain(), jobModel([forgot]), AUTH, TEST_ROOTS).filter((f) => f.message.includes('必ず持つ語'));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('end_member_sessions の kind end は ends_sessions を必ず持つ語(declares)なのに、ends_sessions がありません');
  });

  it('ends_sessions を持つのに declares の無い語を選んでいればエラー(語に宣言を足す)', () => {
    const row = outboxJob('end_member_sessions', { kind: 'plain', endsSessions: 'member', platformCall: 'x', inTransaction: true });

    const findings = verifyEndsSessions(domain(), jobModel([row]), AUTH, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('kind plain が ends_sessions を declares していません');
    expect(findings[0]?.suggestion).toContain('declares: [ends_sessions]');
  });

  it('認証仕様が無い構成では、主語の照合と R11 を飛ばす(宣言そのものの接地だけ見る)', () => {
    expect(verifyEndsSessions(specModel([memberAggregate({})]), jobModel([END]), undefined, TEST_ROOTS).map((f) => f.verifier)).toEqual([]);
    expect(verifyEndsSessions(specModel([memberAggregate({})]), jobModel([END]), { available: false, flow: null }, TEST_ROOTS)).toEqual([]);
  });
});

describe('J7: R11 — アカウントを止める遷移は宣言しなければならない', () => {
  const noEffects = jobModel([outboxJob('notify_x', { kind: 'plain' })]);

  it('効果が 1 本も宣言されていない製品でも、終端・negative・匿名化の遷移は赤(宣言を忘れたことに気づける)', () => {
    const findings = verifyEndsSessions(domain(), noEffects, AUTH, TEST_ROOTS);

    expect(findings.map((f) => f.counterexample?.['event']).sort()).toEqual(['membership.disable', 'membership.leave']);
    expect(findings.every((f) => f.verifier === 'J7' && f.severity === 'error')).toBe(true);
    expect(findings.find((f) => f.counterexample?.['event'] === 'membership.leave')?.message).toContain('終端の状態 left へ行く');
    expect(findings.find((f) => f.counterexample?.['event'] === 'membership.disable')?.message).toContain('tone: negative の状態 disabled へ行く');
    expect(findings[0]?.suggestion).toContain('V7.4.2');
  });

  it('宣言を落とした遷移だけを指す(落とした 1 本)', () => {
    const model = specModel([memberAggregate({ leave: ['end_member_sessions'] })]);

    const findings = verifyEndsSessions(model, jobModel([END]), AUTH, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ event: 'membership.disable', to: 'disabled', subject: 'member' });
  });

  it('一時停止(終端でも negative でもない状態へ行く遷移)は求めない', () => {
    // pause は active → paused。上の正例が pause に宣言なしで通っていることが対照。
    expect(verifyEndsSessions(domain(), jobModel([END]), AUTH, TEST_ROOTS)).toEqual([]);
  });

  it('終端でも negative でもなくても、主語の個人データを匿名化する遷移は赤', () => {
    const model = specModel([
      aggregate('member', {
        stateMachines: [
          machine('membership', {
            states: ['active', 'erased'],
            initial: 'active',
            events: [event('erase', { from: ['active'], to: 'erased' })],
            effects: [effect('erase', ['scrub_member'])],
          }),
        ],
      }),
    ]);
    const scrub = outboxJob('scrub_member', { kind: 'scrub', anonymizes: 'member', inTransaction: true });

    const findings = verifyEndsSessions(model, jobModel([scrub]), AUTH, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('個人データを匿名化する');
    expect(findings[0]?.counterexample).toMatchObject({ event: 'membership.erase' });
  });

  it('別の集約の匿名化は、主語の遷移を赤にしない', () => {
    const model = specModel([
      aggregate('member', {
        stateMachines: [machine('membership', { states: ['active', 'paused'], initial: 'active', events: [event('pause', { from: ['active'], to: 'paused' })], effects: [effect('pause', ['scrub_other'])] })],
      }),
    ]);
    const scrub = outboxJob('scrub_other', { kind: 'scrub', anonymizes: 'other', inTransaction: true });

    expect(verifyEndsSessions(model, jobModel([scrub]), AUTH, TEST_ROOTS).filter((f) => f.message.includes('アカウントを止める'))).toEqual([]);
  });

  it('主語が enum の欄(kind: field)なら遷移を持たないので R11 は見ない', () => {
    const fieldAxes = [
      { id: 'card', kind: 'field' as const, summary: '主語', of: 'member.status', absent: 'none', location: { file: 'a', pointer: 'axes.card' } },
    ];
    const fieldAuth = authModel({ subject: 'member.status', axes: fieldAxes });

    expect(verifyEndsSessions(domain(), noEffects, fieldAuth, TEST_ROOTS)).toEqual([]);
  });

  it('認証フローの主語が見つからない(状態機械が仕様に無い)ときは R11 を見ない', () => {
    const lost = authModel({ subject: 'ghost_machine' });

    expect(verifyEndsSessions(domain(), noEffects, lost, TEST_ROOTS)).toEqual([]);
  });
});

describe('subjectAggregateOf: 認証フローの主語の集約', () => {
  it('状態機械が主語ならその機械を持つ集約・enum の欄が主語ならその欄の集約・見つからなければ null', () => {
    expect(subjectAggregateOf(domain(), AUTH.flow)).toBe('member');
    const fieldAuth = authModel({
      subject: 'member.status',
      axes: [{ id: 'card', kind: 'field', summary: '主語', of: 'member.status', absent: 'none', location: { file: 'a', pointer: 'axes.card' } }],
    });
    expect(subjectAggregateOf(domain(), fieldAuth.flow)).toBe('member');
    expect(subjectAggregateOf(domain(), authModel({ subject: 'nope' }).flow)).toBeNull();
    expect(subjectAggregateOf(domain(), null)).toBeNull();
    const noOf = authModel({ axes: [{ id: 'x', kind: 'enum', summary: 's', values: ['a'], location: { file: 'a', pointer: 'axes.x' } }] });
    expect(subjectAggregateOf(domain(), noOf.flow)).toBeNull();
  });
});
