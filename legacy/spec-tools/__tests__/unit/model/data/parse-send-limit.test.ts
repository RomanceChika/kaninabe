/**
 * data_table の `functions[].send_limit`(送信の上限)のパーサーの規約網羅テスト(T0 / V1)。
 *
 * 正: ARCH-SP-BE-0001 §送信の上限。読めない宣言は関数ごと載せない(半分の上限を生成すると宣言より緩い上限が黙って立つ)。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseDataTableSpec } from '../../../../lib/model/data/parse-data-table.js';

/** 正しい宣言(2 つの鍵・送れない状態・3 つの上限)。 */
const VALID = {
  event: 'thing.update',
  types: ['notify_a', 'notify_b'],
  keys: [{ name: 'parent_id', blocked: { table: 'parents', column: 'state', values: ['draft'], word: 'from_draft' } }, { name: 'actor_id' }],
  payload: ['text'],
  limits: [
    { word: 'actor_daily', key: 'actor_id', max: 10, per: '24 hours' },
    { word: 'parent_interval', key: 'parent_id', max: 1, per: '10 minutes' },
  ],
};

/** 関数 1 本だけの最小の data_table。 */
function parse(fn: Record<string, unknown>) {
  const reporter = new SpecReporter('docs/specs/backend/data/tables/jobs.md');
  return parseDataTableSpec(
    {
      doc_type: 'data_table',
      scope: 'backend',
      id: 'table-jobs',
      table: 'jobs',
      internal: true,
      functions: [fn],
      test_cases: [{ id: 'TC-TABLE-JOBS-001', type: 'integration', covers: ['success'], spec_ids: ['table-jobs'], implementation: 'a.test.ts::x' }],
    },
    'jobs.md',
    reporter,
  );
}

/** 送信の上限の関数(宣言を差し替える)。 */
function limitFn(sendLimit: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'send_limit_thing',
    args: ['text', 'uuid', 'uuid', 'text'],
    params: ['p_type', 'p_parent_id', 'p_actor_id', 'p_text'],
    kind: 'send_limit',
    migration: '20261105100038_send_limit_thing.sql',
    send_limit: sendLimit,
    ...extra,
  };
}

/** error の文言。 */
function errors(result: ReturnType<typeof parse>): readonly string[] {
  return result.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message);
}

describe('functions[].send_limit', () => {
  it('正しい宣言は全部の欄ごと読め、params も宣言できる', () => {
    const result = parse(limitFn(VALID));
    expect(errors(result)).toEqual([]);
    const fn = result.value?.functions[0];
    expect(fn).toMatchObject({ kind: 'send_limit', params: ['p_type', 'p_parent_id', 'p_actor_id', 'p_text'], migration: '20261105100038_send_limit_thing.sql' });
    expect(fn?.sendLimit).toEqual({
      event: 'thing.update',
      types: ['notify_a', 'notify_b'],
      keys: [{ name: 'parent_id', blocked: { table: 'parents', column: 'state', values: ['draft'], word: 'from_draft' } }, { name: 'actor_id' }],
      payload: ['text'],
      limits: VALID.limits,
    });
  });

  it.each<[string, unknown, string]>([
    ['宣言が無い', undefined, 'send_limit の宣言がありません'],
    ['マッピングでない', 'x', 'send_limit の宣言がありません'],
    ['知らないキー', { ...VALID, rate: 1 }, 'rate'],
    ['event の形', { ...VALID, event: 'update' }, '{集約}.{操作}'],
    ['types が空', { ...VALID, types: [] }, 'types は 1 つ以上'],
    ['types が無い', { ...VALID, types: undefined }, 'types がありません'],
    ['types の重複', { ...VALID, types: ['a', 'a'] }, '重複'],
    ['types の形', { ...VALID, types: ['A-b'] }, 'スネークケース'],
    ['keys が空', { ...VALID, keys: [] }, 'keys は 1 つ以上'],
    ['鍵の重複', { ...VALID, keys: [{ name: 'actor_id' }, { name: 'actor_id' }] }, '鍵 actor_id が重複'],
    ['鍵の形', { ...VALID, keys: [{ name: 'Actor' }] }, 'スネークケース'],
    ['payload が鍵と重なる', { ...VALID, payload: ['actor_id'] }, 'keys と重なっています'],
    ['blocked がマッピングでない', { ...VALID, keys: [{ name: 'actor_id', blocked: 'x' }] }, 'blocked は { table'],
    ['blocked の欠け', { ...VALID, keys: [{ name: 'actor_id', blocked: { table: 'p', values: ['a'], word: 'w' } }] }, 'どれも必須'],
    ['blocked の値が空', { ...VALID, keys: [{ name: 'actor_id', blocked: { table: 'p', column: 'state', values: [], word: 'w' } }] }, 'values は 1 つ以上'],
    ['blocked の知らないキー', { ...VALID, keys: [{ name: 'actor_id', blocked: { table: 'p', column: 'state', values: ['a'], word: 'w', when: 'x' } }] }, 'when'],
    ['鍵の知らないキー', { ...VALID, keys: [{ name: 'actor_id', scope: 'x' }] }, 'scope'],
    ['上限の知らないキー', { ...VALID, limits: [{ word: 'w', key: 'actor_id', max: 1, per: '1 hour', role: 'staff' }] }, 'role'],
    ['limits が空', { ...VALID, limits: [] }, 'limits は 1 つ以上'],
    ['上限の鍵が無い', { ...VALID, limits: [{ word: 'w', key: 'other_id', max: 1, per: '1 hour' }] }, 'keys にありません'],
    ['max が 0', { ...VALID, limits: [{ word: 'w', key: 'actor_id', max: 0, per: '1 hour' }] }, '1 以上の整数'],
    ['max が小数', { ...VALID, limits: [{ word: 'w', key: 'actor_id', max: 1.5, per: '1 hour' }] }, '1 以上の整数'],
    ['per の形', { ...VALID, limits: [{ word: 'w', key: 'actor_id', max: 1, per: '1 week' }] }, '{n} {minute|hour|day}'],
    ['per が長すぎる', { ...VALID, limits: [{ word: 'w', key: 'actor_id', max: 1, per: '400 days' }] }, '366 日'],
    ['上限の欄の欠け', { ...VALID, limits: [{ word: 'w', key: 'actor_id', per: '1 hour' }] }, 'どれも必須'],
    ['語の重複(送れない状態と上限)', { ...VALID, limits: [{ word: 'from_draft', key: 'actor_id', max: 1, per: '1 hour' }] }, '拒否の語 from_draft が重複'],
    ['語の形', { ...VALID, limits: [{ word: 'Daily', key: 'actor_id', max: 1, per: '1 hour' }] }, 'スネークケース'],
  ])('赤(関数ごと載せない): %s', (_name, sendLimit, word) => {
    const result = parse(limitFn(sendLimit));
    expect(errors(result).join('\n')).toContain(word);
    expect(result.value?.functions.find((fn) => fn.name === 'send_limit_thing')?.sendLimit).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ['省略', undefined],
    ['actor(既定を明示)', 'actor'],
  ])('数える単位の既定は鍵の値ごと(実行者ごと): %s', (_name, unit) => {
    const result = parse(limitFn({ ...VALID, keys: [{ name: 'actor_id', ...(unit === undefined ? {} : { unit }) }], limits: [VALID.limits[0]] }));
    expect(errors(result)).toEqual([]);
    expect(result.value?.functions[0]?.sendLimit?.keys[0]).toEqual({ name: 'actor_id' });
  });

  it('数える単位を参照の列の辿り方で宣言できる(招いたメンバーの単位)', () => {
    const via = [
      { table: 'members', column: 'invited_via', to: 'invitations' },
      { table: 'invitations', column: 'issued_by', to: 'members' },
    ];
    const result = parse(limitFn({ ...VALID, keys: [{ name: 'actor_id', unit: { via } }], limits: [VALID.limits[0]] }));
    expect(errors(result)).toEqual([]);
    expect(result.value?.functions[0]?.sendLimit?.keys[0]).toEqual({ name: 'actor_id', unit: { via } });
  });

  it.each<[string, unknown]>([
    ['知らない語', 'inviter'],
    ['via が空', { via: [] }],
    ['via 以外のキー', { via: [{ table: 'members', column: 'invited_via', to: 'invitations' }], depth: 2 }],
    ['歩の欠け', { via: [{ table: 'members', column: 'invited_via' }] }],
    ['歩の知らないキー', { via: [{ table: 'members', column: 'invited_via', to: 'invitations', where: 'x' }] }],
    ['歩の名前の形', { via: [{ table: 'Members', column: 'invited_via', to: 'invitations' }] }],
  ])('赤(関数ごと載せない): 数える単位の %s', (_name, unit) => {
    const result = parse(limitFn({ ...VALID, keys: [{ name: 'actor_id', unit }], limits: [VALID.limits[0]] }));
    expect(errors(result).join('\n')).toContain('unit');
    expect(result.value?.functions[0]?.sendLimit).toBeUndefined();
  });

  it('kind: send_limit 以外には書けない', () => {
    const result = parse({ name: 'is_member', args: [], kind: 'helper', send_limit: VALID });
    expect(errors(result).join('\n')).toContain('kind: helper なので send_limit を宣言できません');
  });

  it('手書きの口は無い(handwritten は書けない)', () => {
    const result = parse(limitFn(VALID, { handwritten: '理由' }));
    expect(errors(result).join('\n')).toContain('kind: send_limit なので handwritten を宣言できません');
  });

  it('値域の案内に send_limit が載る', () => {
    const result = parse({ name: 'x', args: [], kind: 'limit' });
    expect(result.findings.map((finding) => finding.suggestion).join('\n')).toContain('send_limit(送信の上限)');
  });
});
