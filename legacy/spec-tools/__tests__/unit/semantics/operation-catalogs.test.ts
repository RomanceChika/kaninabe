/**
 * `isInTransactionJob`(書き込みと同じトランザクションで実現される種類のジョブか)のユニットテスト。
 *
 * 当たるのは、`kind` の語が `in_transaction` を宣言している行(`JobDecl.inTransaction`)と、
 * 匿名化する効果の宣言(`anonymizes`)・セッションを終える効果の宣言(`ends_sessions`)を持つ行である。いずれも `kind` の語を比べない
 * (機械が読むのは宣言で、語はカタログが持つ)。
 */

import { describe, expect, it } from 'vitest';
import { isInTransactionJob } from '../../../lib/semantics/operation-catalogs.js';
import { outboxJob } from '../../helpers/job-builder.js';

describe('isInTransactionJob', () => {
  it('kind の語が in_transaction を宣言している行(inTransaction)は、語が何であっても当たる', () => {
    expect(isInTransactionJob(outboxJob('a', { kind: 'realized_in_rpc', inTransaction: true }))).toBe(true);
  });

  it('語が transaction_effect でも、in_transaction の宣言が無ければ当たらない(語は比べない)', () => {
    expect(isInTransactionJob(outboxJob('a', { kind: 'transaction_effect' }))).toBe(false);
  });

  it('anonymizes を持つ行は kind の語が何であっても当たる', () => {
    expect(isInTransactionJob(outboxJob('a', { kind: 'scrub', anonymizes: 'person' }))).toBe(true);
  });

  it('ends_sessions を持つ行(セッションを終える効果)も kind の語が何であっても当たる', () => {
    expect(isInTransactionJob(outboxJob('a', { kind: 'plain', endsSessions: 'member', platformCall: 'revoke_auth_sessions' }))).toBe(true);
  });

  it('通知などの行は当たらない', () => {
    expect(isInTransactionJob(outboxJob('a', { kind: 'notification' }))).toBe(false);
  });

  it('カタログに無い ID(undefined)は当たらない', () => {
    expect(isInTransactionJob(undefined)).toBe(false);
  });
});
