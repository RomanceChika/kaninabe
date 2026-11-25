/**
 * J5(匿名化する効果の宣言 `anonymizes`)のユニットテスト。
 *
 * 規約網羅(job-spec-writing.md §検証):
 *   - 対象の集約が実在し personal 列を持ち、その状態機械の effects から積まれていれば違反なし
 *   - 対象の集約が無い / personal 列が無い / 自分の集約の effects から積まれていない / 別の集約から積まれている → 赤
 *   - writes[].effects にしか載っていない(状態遷移を持たない編集)→ 赤
 *   - 自分の機械から積まれていても writes[].effects に載せていれば赤(匿名化は writes[].effects に載せない)
 *   - 匿名化する効果の kind の語が in_transaction を宣言していなければ赤(キューに積まれる種類の扱いという自己矛盾)
 *   - 1 つの集約に匿名化の効果が 2 つあると赤
 *   - kind の語の declares: [anonymizes] と行の anonymizes が対であること(語と宣言のずれ):
 *     宣言した語を選んで anonymizes を書き忘れると赤(anonymizes を持つ行が他に 1 つも無くても)・
 *     anonymizes を持つのに宣言の無い語を選ぶと赤
 *   - 逆向き(personal 列を持つ集約に匿名化の効果が無い)は鳴らさない(消去を持たない製品は正当)
 */

import { describe, expect, it } from 'vitest';
import { verifyAnonymize } from '../../../../lib/job/verifiers/j5-anonymize.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  effect,
  entitySpec,
  field,
  machine,
  specModel,
  write,
} from '../../../helpers/model-builder.js';
import { jobModel as jobModelWith, outboxJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { authModel } from '../../../helpers/auth-builder.js';

/** personal 列を持つ集約 `person`(`forget` の遷移が匿名化の効果を積む)。 */
function personAggregate(opts: { readonly personal?: boolean; readonly effects?: readonly string[] } = {}) {
  return aggregate('person', {
    entity: entitySpec('person', {
      fields: [
        field('nickname', { kind: 'string' }, { personal: opts.personal ?? true, personalPlaceholder: '(removed)' }),
        field('rank', { kind: 'string' }),
      ],
    }),
    stateMachines: [
      machine('person', {
        states: ['active', 'forgotten'],
        initial: 'active',
        effects: [effect('forget', opts.effects ?? ['scrub_person'])],
      }),
    ],
  });
}

/** ドメインモデルを作る(`person` に加えて任意の集約)。 */
function domain(...others: Parameters<typeof specModel>[0]): SpecModel {
  return specModel([personAggregate(), ...others]);
}

/** `scrub` は匿名化の語(in_transaction + declares: [anonymizes])。`plain` は宣言の無い語。 */
const KIND_TERMS = [
  { id: 'scrub', inTransaction: true, declares: ['anonymizes' as const] },
  { id: 'plain' },
];

/** `kind` の語彙を KIND_TERMS にしたカタログを作る。 */
function jobModel(jobs: Parameters<typeof jobModelWith>[0], kindTerms: Parameters<typeof jobModelWith>[2] = KIND_TERMS) {
  return jobModelWith(jobs, true, kindTerms);
}

const SCRUB = outboxJob('scrub_person', { kind: 'scrub', anonymizes: 'person', inTransaction: true });

describe('J5: 認証フローの主語を匿名化する行の platform_call(A14-5)', () => {
  const member = aggregate('member', {
    entity: entitySpec('member', { fields: [field('nickname', { kind: 'string' }, { personal: true, personalPlaceholder: '(removed)' })] }),
    stateMachines: [machine('membership', { states: ['active', 'forgotten'], initial: 'active', effects: [effect('forget', ['scrub_member'])] })],
  });
  const model = specModel([member]);
  const job = (extra: { readonly platformCall?: string; readonly platformJob?: string } = {}) => outboxJob('scrub_member', { kind: 'scrub', anonymizes: 'member', inTransaction: true, ...extra });

  it('赤: 主語の集約を匿名化するのに platform_call が無い', () => {
    const findings = verifyAnonymize(model, jobModel([job()]), TEST_ROOTS, authModel());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('platform_call');
  });

  it('緑: platform_call を名指す', () => {
    expect(verifyAnonymize(model, jobModel([job({ platformCall: 'erase_auth_identity' })]), TEST_ROOTS, authModel())).toEqual([]);
  });

  describe('platform_job(コミットの後のジョブで消す形)', () => {
    const memberWith = (does: readonly string[]) =>
      specModel([
        aggregate('member', {
          entity: entitySpec('member', { fields: [field('nickname', { kind: 'string' }, { personal: true, personalPlaceholder: '(removed)' })] }),
          stateMachines: [machine('membership', { states: ['active', 'forgotten'], initial: 'active', effects: [effect('forget', does)] })],
        }),
      ]);
    const queued = outboxJob('erase_account', { kind: 'plain' });
    const scrub = job({ platformJob: 'erase_account' });

    it('緑: 同じ遷移で積むキューの行を名指す', () => {
      expect(verifyAnonymize(memberWith(['scrub_member', 'erase_account']), jobModel([scrub, queued]), TEST_ROOTS, authModel())).toEqual([]);
    });

    it('赤: 名指す行が無い', () => {
      const findings = verifyAnonymize(memberWith(['scrub_member', 'erase_account']), jobModel([scrub]), TEST_ROOTS, authModel());
      expect(findings.map((f) => f.message)).toEqual([expect.stringContaining('キューに積まれる outbox の行ではありません')]);
    });

    it('赤: 名指す行が同一トランザクションの行(キューに積まれない)', () => {
      const inline = outboxJob('erase_account', { kind: 'scrub', inTransaction: true });
      const findings = verifyAnonymize(memberWith(['scrub_member', 'erase_account']), jobModel([scrub, inline]), TEST_ROOTS, authModel());
      expect(findings.some((f) => f.message.includes('キューに積まれる outbox の行ではありません'))).toBe(true);
    });

    it('赤: 匿名化の遷移にジョブが載っていない(消去が認証基盤へ届かない遷移)', () => {
      const findings = verifyAnonymize(memberWith(['scrub_member']), jobModel([scrub, queued]), TEST_ROOTS, authModel());
      expect(findings.map((f) => f.message)).toEqual([expect.stringContaining('platform_job erase_account が載っていません')]);
    });
  });

  it('緑: 主語でない集約の匿名化は要らない', () => {
    expect(verifyAnonymize(domain(), jobModel([SCRUB]), TEST_ROOTS, authModel())).toEqual([]);
  });

  it('認証仕様が無い構成では見ない', () => {
    expect(verifyAnonymize(model, jobModel([job()]), TEST_ROOTS)).toEqual([]);
  });
});

describe('J5: 匿名化する効果の宣言', () => {
  it('実在し personal 列を持つ集約の遷移から積まれていれば違反なし', () => {
    expect(verifyAnonymize(domain(), jobModel([SCRUB]), TEST_ROOTS)).toEqual([]);
  });

  it('anonymizes を持つ効果が無ければ何も見ない(逆向きは鳴らさない — 消去を持たない製品は正当)', () => {
    const catalog = jobModel([outboxJob('scrub_person', { kind: 'plain' })]);

    expect(verifyAnonymize(domain(), catalog, TEST_ROOTS)).toEqual([]);
  });

  it('カタログが無ければ何も見ない', () => {
    expect(verifyAnonymize(domain(), { available: false, catalog: null }, TEST_ROOTS)).toEqual([]);
  });

  it('anonymizes が仕様に無い集約を指していればエラー', () => {
    const catalog = jobModel([outboxJob('scrub_person', { kind: 'scrub', anonymizes: 'ghost', inTransaction: true })]);

    const findings = verifyAnonymize(domain(), catalog, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('J5');
    expect(findings[0]?.message).toContain('仕様に無い集約');
  });

  it('対象の集約に personal 列が無ければエラー(書き換える列が無い匿名化は空の宣言)', () => {
    const noPersonal = specModel([personAggregate({ personal: false })]);

    const findings = verifyAnonymize(noPersonal, jobModel([SCRUB]), TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('personal: true の欄がありません');
  });

  it('対象の集約の状態機械の effects から積まれていなければエラー', () => {
    // effects に載るのは別のジョブ。匿名化の効果は writes[].effects(状態遷移を持たない編集)にだけ載る。
    const model = specModel([
      aggregate('person', {
        entity: entitySpec('person', {
          fields: [field('nickname', { kind: 'string' }, { personal: true, personalPlaceholder: '(removed)' })],
        }),
        stateMachines: [machine('person', { states: ['active'], initial: 'active' })],
        access: accessSpec('person', { writes: [write('member', ['nickname'], undefined, ['scrub_person'])] }),
      }),
    ]);

    const findings = verifyAnonymize(model, jobModel([SCRUB]), TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('person の状態機械の effects から積まれていません');
  });

  it('どこからも積まれていない場合は J1 の担当なので J5 は重ねて言わない', () => {
    const model = specModel([
      aggregate('person', {
        entity: entitySpec('person', {
          fields: [field('nickname', { kind: 'string' }, { personal: true, personalPlaceholder: '(removed)' })],
        }),
        stateMachines: [machine('person', { states: ['active'], initial: 'active' })],
      }),
    ]);

    expect(verifyAnonymize(model, jobModel([SCRUB]), TEST_ROOTS)).toEqual([]);
  });

  it('別の集約の遷移から積まれていればエラー(「自分の集約」が嘘になる)', () => {
    const other = aggregate('shelf', {
      stateMachines: [machine('shelf', { states: ['open'], initial: 'open', effects: [effect('close', ['scrub_person'])] })],
    });

    const findings = verifyAnonymize(domain(other), jobModel([SCRUB]), TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('別の集約 shelf の状態機械の effects から積まれています');
  });

  it('自分の機械から積まれていても writes[].effects にも載せていればエラー(匿名化は載せない)', () => {
    const model = specModel([
      aggregate('person', {
        entity: entitySpec('person', {
          fields: [field('nickname', { kind: 'string' }, { personal: true, personalPlaceholder: '(removed)' })],
        }),
        stateMachines: [
          machine('person', {
            states: ['active', 'forgotten'],
            initial: 'active',
            effects: [effect('forget', ['scrub_person'])],
          }),
        ],
        access: accessSpec('person', { writes: [write('member', ['nickname'], undefined, ['scrub_person'])] }),
      }),
    ]);

    const findings = verifyAnonymize(model, jobModel([SCRUB]), TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('writes[].effects にも載っています');
  });

  it('匿名化する効果の kind の語が in_transaction を宣言していなければエラー(自己矛盾)', () => {
    const catalog = jobModel([outboxJob('scrub_person', { kind: 'scrub', anonymizes: 'person' })], [
      { id: 'scrub', declares: ['anonymizes'] },
    ]);

    const findings = verifyAnonymize(domain(), catalog, TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('kind scrub が in_transaction を宣言していません');
  });

  it('1 つの集約を匿名化する効果が 2 つあればエラー(2 つ目を指す)', () => {
    const model = specModel([personAggregate({ effects: ['scrub_person', 'scrub_person_again'] })]);
    const again = outboxJob('scrub_person_again', { kind: 'scrub', anonymizes: 'person', inTransaction: true });

    const findings = verifyAnonymize(model, jobModel([SCRUB, again]), TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('person を匿名化する効果が複数あります');
    expect(findings[0]?.location.pointer).toBe('jobs.scrub_person_again');
  });

  it('declares した語を選んで anonymizes を書き忘れればエラー(anonymizes を持つ行が他に無くても通さない)', () => {
    const forgot = outboxJob('scrub_person', { kind: 'scrub', inTransaction: true });

    const findings = verifyAnonymize(domain(), jobModel([forgot]), TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('J5');
    expect(findings[0]?.message).toContain('scrub_person の kind scrub は anonymizes を必ず持つ語(declares)なのに、anonymizes がありません');
    expect(findings[0]?.location.pointer).toBe('jobs.scrub_person');
  });

  it('declares した語を、anonymizes を持つ行と持たない行で分け合っていれば持たない行を指す', () => {
    const plainRow = outboxJob('notify_someone', { kind: 'scrub', inTransaction: true });

    const findings = verifyAnonymize(domain(), jobModel([SCRUB, plainRow]), TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('notify_someone の kind scrub は anonymizes を必ず持つ語');
  });

  it('anonymizes を持つのに declares の無い語を選んでいればエラー(語に宣言を足す)', () => {
    const row = outboxJob('scrub_person', { kind: 'plain', anonymizes: 'person', inTransaction: true });

    const findings = verifyAnonymize(domain(), jobModel([row]), TEST_ROOTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('scrub_person は anonymizes を持つのに、kind plain が anonymizes を declares していません');
    expect(findings[0]?.suggestion).toContain('declares: [anonymizes]');
  });
});
