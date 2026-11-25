/**
 * J6(失敗時の挙動の意味)のユニットテスト。
 *
 * `on_failure` の語は製品の語彙なので、体系は綴りを比べない。語の `means`(体系が固定する値域)と行の種類の対だけを見る:
 *   - 書き込みと同じトランザクションで実現される行(`inTransaction`)⇒ `never_queued`
 *   - 時刻起点(`source: schedule`)の行 ⇒ `next_run`
 *   - キューに積まれる行(outbox / manual)⇒ `retry_to_dead` か `pending_decision`
 * 監査の変異 M06d(実際に積まれる行と積まれない行の `on_failure` を入れ替える)がこの対で赤になる。
 */

import { describe, expect, it } from 'vitest';
import { verifyFailureMeaning } from '../../../../lib/job/verifiers/j6-failure-meaning.js';
import type { JobDecl, JobSpecModel, JobTermDecl } from '../../../../lib/model/job/types.js';
import { decideExit } from '../../../../lib/verify/exit-code.js';
import { bucketOf } from '../../../../lib/extension/bucket.js';
import type { ExtensionLedger } from '../../../../lib/model/extension/types.js';
import { jobModel, outboxJob, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** 同一トランザクションで実現される語を 1 つ持つ `kind` の語彙。 */
const KIND_TERMS: readonly JobTermDecl[] = [
  { id: 'notification' },
  { id: 'transaction_effect', inTransaction: true },
  { id: 'scan' },
];

/** 積まれない(同一トランザクションで実現される)効果の行。 */
const REALIZED = (opts: Partial<JobDecl> = {}): JobDecl =>
  outboxJob('confirm_entries_and_fees', { kind: 'transaction_effect', inTransaction: true, onFailure: 'wiring_error', ...opts });

/** 4 つの意味の語を全部持つ `on_failure` の語彙(語の綴りは製品の事情。体系が見るのは `means` だけ)。 */
const ON_FAILURE_TERMS: readonly JobTermDecl[] = [
  { id: 'retry_then_dead_letter', means: 'retry_to_dead' },
  { id: 'wiring_error', means: 'never_queued' },
  { id: 'skip_and_next_run', means: 'next_run' },
  { id: 'undecided', means: 'pending_decision' },
];

/** 検査に渡すカタログ(語彙の `on_failure` だけ 4 語に差し替える)。 */
function modelOf(jobs: readonly JobDecl[]): JobSpecModel {
  const base = jobModel(jobs, true, KIND_TERMS);
  if (base.catalog === null) throw new Error('builder は常にカタログを作る');
  return { available: true, catalog: { ...base.catalog, vocabulary: { ...base.catalog.vocabulary, on_failure: ON_FAILURE_TERMS } } };
}

/** 検査を回して、指摘の文面だけを返す。 */
function messages(jobs: readonly JobDecl[]): string[] {
  return verifyFailureMeaning(modelOf(jobs), TEST_ROOTS).map((finding) => finding.message);
}

describe('J6: 失敗時の挙動の意味と行の種類の対', () => {
  it('3 種の行がそれぞれの意味の語を選んでいれば違反なし', () => {
    const jobs = [
      outboxJob('notify_a'),
      outboxJob('notify_b', { source: 'manual' }),
      REALIZED(),
      scheduledJob('close_due_workshops'),
    ];

    expect(messages(jobs)).toEqual([]);
  });

  it('M06d: 積まれて実行される行が wiring_error・積まれない行が retry を選べば、2 行とも落ちる', () => {
    const jobs = [
      outboxJob('refresh_session_profile', { onFailure: 'wiring_error' }),
      REALIZED({ onFailure: 'retry_then_dead_letter' }),
    ];

    const found = verifyFailureMeaning(modelOf(jobs), TEST_ROOTS);

    expect(found.map((finding) => finding.verifier)).toEqual(['J6', 'J6']);
    expect(found.every((finding) => finding.severity === 'error')).toBe(true);
    expect(found.map((finding) => finding.counterexample?.['job'])).toEqual(['refresh_session_profile', 'confirm_entries_and_fees']);
    expect(found[0]?.message).toContain('キューに積まれる行(source: outbox / manual)が選べる意味は retry_to_dead / pending_decision です');
    expect(found[1]?.message).toContain('書き込みと同じトランザクションで実現される行(kind の語が in_transaction)が選べる意味は never_queued です');
  });

  it('時刻起点の行が next_run 以外の意味の語を選べば落ちる', () => {
    const found = messages([scheduledJob('close_due_workshops', {}, { onFailure: 'retry_then_dead_letter' })]);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('時刻で起きる行(source: schedule)が選べる意味は next_run です');
  });

  it('キューに積まれる行は pending_decision(未定)を選べるが、行ごとに warning が出る(決めるまで出荷の門が止める)', () => {
    const found = verifyFailureMeaning(modelOf([outboxJob('notify_a', { onFailure: 'undecided' }), outboxJob('notify_b', { onFailure: 'undecided' }), outboxJob('notify_c')]), TEST_ROOTS);

    expect(found.map((finding) => [finding.verifier, finding.severity, finding.counterexample?.['job']])).toEqual([
      ['J6', 'warning', 'notify_a'],
      ['J6', 'warning', 'notify_b'],
    ]);
    expect(found[0]?.message).toContain('pending_decision(失敗時の扱いが未定)');
    expect(found[0]?.suggestion).toContain('--fail-on-unclassified');
    expect(found[0]?.reason).toBeUndefined();
  });

  it('pending_decision の warning は台帳の候補に当たらず、未分類として出荷の門(--fail-on-unclassified)が止める', () => {
    const found = verifyFailureMeaning(modelOf([outboxJob('notify_a', { onFailure: 'undecided' })]), TEST_ROOTS);
    const ledger: ExtensionLedger = {
      candidates: [{ id: 'X-a', statement: 's', rules: ['T8'], status: 'open', since: '2026-10-03', ref: 'r', location: { file: 'ledger.md' } }],
      location: { file: 'ledger.md' },
    };

    expect(found.map((finding) => bucketOf(finding, ledger))).toEqual([{ kind: 'unclassified' }]);
    expect(decideExit(found, ledger, false).code).toBe(0);
    expect(decideExit(found, ledger, true).code).toBe(1);
  });

  it('時刻起点・同一トランザクションの行は pending_decision を選べない(error。warning は重ねない)', () => {
    const scheduled = verifyFailureMeaning(modelOf([scheduledJob('close_due_workshops', {}, { onFailure: 'undecided' })]), TEST_ROOTS);
    const realized = verifyFailureMeaning(modelOf([REALIZED({ onFailure: 'undecided' })]), TEST_ROOTS);

    expect([...scheduled, ...realized].map((finding) => finding.severity)).toEqual(['error', 'error']);
  });

  it('skip(next_run)の語を outbox の行が選べば落ちる', () => {
    expect(messages([outboxJob('notify_a', { onFailure: 'skip_and_next_run' })])).toHaveLength(1);
  });

  it('語彙に無い on_failure の語は J6 では鳴らさない(宣言の欠落は J0 が報告する)', () => {
    expect(messages([outboxJob('notify_a', { onFailure: 'ignore' })])).toEqual([]);
  });

  it('カタログを読めていなければ何も見ない', () => {
    expect(verifyFailureMeaning({ available: true, catalog: null }, TEST_ROOTS)).toEqual([]);
  });
});
