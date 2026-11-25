/**
 * 名指しされた RPC の引き当て（`lib/model/data/realized-rpcs.ts`）のテスト。
 *
 * 操作の属性（`operation-facts.ts`）と遷移書き込みの期待表（`code-transition-writes.ts`）が同じ引き当てを使う。
 * RPC は効果の `realized_by` が名指しし、集約に複合 RPC が何本あるかには依らないこと、
 * 遷移の定型（shape: transition）も名指しできること、実在しない名前は黙って捨てず `missing` に残ることを固定する。
 */

import { describe, expect, it } from 'vitest';
import { alsoWritesOf, findRealizedRpcs, realizingRpcName } from '../../../lib/model/data/realized-rpcs.js';
import type { JobDecl } from '../../../lib/model/job/types.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 関数 1 本の宣言。 */
function fn(name: string, kind: 'rpc' | 'helper' | 'trigger', shape: 'composite' | 'transition' | undefined, alsoWrites: readonly string[]) {
  return { name, args: [], params: [], kind, ...(shape === undefined ? {} : { shape }), alsoWrites };
}

/** 名指しを持つジョブの行。 */
function job(realizedBy?: Record<string, string>): JobDecl {
  return {
    id: 'revoke_sessions',
    source: 'outbox',
    kind: 'transaction_effect',
    onFailure: 'wiring_error',
    summary: 'x',
    inTransaction: true,
    ...(realizedBy === undefined ? {} : { realizedBy }),
    location: { file: 'jobs.md' },
  };
}

const MEMBERS = dataTable('members', {
  functions: [
    fn('apply_transition', 'rpc', 'transition', ['entries', 'jobs']),
    fn('erase_member', 'rpc', 'composite', ['entries', 'programs']),
    fn('end_sessions', 'rpc', 'composite', []),
    fn('is_member', 'helper', undefined, ['ignored']),
  ],
});

describe('効果が名指しした RPC', () => {
  it('イベントごとに名指しされた RPC 名を返す（名指しの無いイベント・行は undefined）', () => {
    const row = job({ 'membership.leave': 'apply_transition', 'membership.erase': 'erase_member' });
    expect(realizingRpcName(row, 'membership.leave')).toBe('apply_transition');
    expect(realizingRpcName(row, 'membership.erase')).toBe('erase_member');
    expect(realizingRpcName(row, 'membership.suspend')).toBeUndefined();
    expect(realizingRpcName(job(), 'membership.leave')).toBeUndefined();
    expect(realizingRpcName(undefined, 'membership.leave')).toBeUndefined();
  });

  it('遷移の定型（shape: transition）も複合も名指しでき、also_writes はイベントごとの名指しだけから決まる', () => {
    const leave = findRealizedRpcs([MEMBERS], ['apply_transition']);
    expect(alsoWritesOf(leave.found)).toEqual(['entries', 'jobs']);
    const erase = findRealizedRpcs([MEMBERS], ['erase_member']);
    expect(alsoWritesOf(erase.found)).toEqual(['entries', 'programs']);
  });

  it('同じ集約に複合 RPC が増えても、名指しされていなければ連鎖に入らない', () => {
    expect(alsoWritesOf(findRealizedRpcs([MEMBERS], ['apply_transition']).found)).not.toContain('programs');
    expect(findRealizedRpcs([MEMBERS], ['end_sessions']).found.map((found) => found.name)).toEqual(['end_sessions']);
    expect(alsoWritesOf(findRealizedRpcs([MEMBERS], ['end_sessions']).found)).toEqual([]);
  });

  it('実在しない名前・RPC でない関数は missing に残り、重複した名指しは 1 本にまとまる', () => {
    const result = findRealizedRpcs([MEMBERS], ['apply_transition', 'apply_transition', 'no_such', 'is_member']);
    expect(result.found.map((found) => found.name)).toEqual(['apply_transition']);
    expect(result.missing).toEqual(['no_such', 'is_member']);
  });

  it('also_writes の和は初出の順で重複を除く', () => {
    expect(alsoWritesOf(findRealizedRpcs([MEMBERS], ['apply_transition', 'erase_member']).found)).toEqual(['entries', 'jobs', 'programs']);
  });
});
