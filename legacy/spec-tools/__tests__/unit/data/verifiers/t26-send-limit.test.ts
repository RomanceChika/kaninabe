/**
 * T26(送信の上限の接地。ARCH-SP-BE-0001 §送信の上限)のテスト。
 *
 * 表: 正しい宣言を 1 か所ずつ崩した形(赤)と、正しい形(緑)。
 */

import { describe, expect, it } from 'vitest';
import { UNIT_EXPERIMENTAL_REASON, verifySendLimits } from '../../../../lib/data/verifiers/t26-send-limit.js';
import type { DataFunctionDecl, SendLimitDecl } from '../../../../lib/model/data/types.js';
import type { JobSpecModel } from '../../../../lib/model/job/types.js';
import { aggregate, entitySpec, field, machine, specModel } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

/** 正しい宣言。 */
const DECL: SendLimitDecl = {
  event: 'thing.update',
  types: ['notify_a'],
  keys: [{ name: 'parent_id', blocked: { table: 'parents', column: 'state', values: ['draft'], word: 'from_draft' } }, { name: 'actor_id' }],
  payload: ['text'],
  limits: [{ word: 'actor_daily', key: 'actor_id', max: 10, per: '24 hours' }],
};

/** 送信の上限の関数。 */
function limitFn(decl: SendLimitDecl = DECL, extra: Partial<DataFunctionDecl> = {}): DataFunctionDecl {
  return {
    name: 'send_limit_thing',
    args: ['text', 'uuid', 'uuid', 'text'],
    params: ['p_type', 'p_parent_id', 'p_actor_id', 'p_text'],
    kind: 'send_limit',
    migration: '20261105100038_send_limit_thing.sql',
    alsoWrites: [],
    sendLimit: decl,
    ...extra,
  };
}

/** 書き出し先を外した関数。 */
function withoutMigration(fn: DataFunctionDecl): DataFunctionDecl {
  const { migration: _migration, ...rest } = fn;
  return rest;
}

/** 呼ぶ RPC。 */
const CALLER: DataFunctionDecl = { name: 'update_thing', args: [], params: [], kind: 'rpc', shape: 'update', handwritten: '理由', alsoWrites: [], calls: ['send_limit_thing'] };

/** ドメイン(親の集約は状態の欄 state を持つ)。 */
const DOMAIN = specModel({
  aggregates: [
    aggregate({ name: 'parent', entity: entitySpec('parent', [field('state', { kind: 'state', machine: 'parent' }), field('title', { kind: 'string' })]), stateMachines: [machine({ machine: 'parent', states: ['draft', 'open'] })] }),
    aggregate({ name: 'thing', entity: entitySpec('thing', [field('title', { kind: 'string' })]) }),
  ],
});

/** ジョブカタログ。 */
const JOBS = { available: true, catalog: { id: 'job-catalog', vocabulary: {}, jobs: [{ id: 'notify_a' }], testCases: [] } } as unknown as JobSpecModel;

/** 題材を組んで回す。 */
function run(fn: DataFunctionDecl, opts: { readonly home?: string; readonly caller?: DataFunctionDecl | null; readonly callerEntity?: string } = {}) {
  const caller = opts.caller === undefined ? CALLER : opts.caller;
  const tables = [
    dataTable(opts.home ?? 'jobs', { internal: true, functions: [fn] }),
    dataTable('parents', { entity: 'parent' }),
    dataTable('things', { entity: opts.callerEntity ?? 'thing', functions: caller === null ? [] : [caller] }),
  ];
  return verifySendLimits(DOMAIN, dataTableModel(tables), JOBS);
}

/** 招いたメンバーを単位にする辿り方の題材(メンバー → 招待 → 発行したメンバー)。 */
const CHAIN_DOMAIN = specModel({
  aggregates: [
    aggregate({ name: 'member', entity: entitySpec('member', [field('invited_via', { kind: 'ref', entity: 'invitation' }), field('name', { kind: 'string' })]) }),
    aggregate({ name: 'invitation', entity: entitySpec('invitation', [field('issued_by', { kind: 'ref', entity: 'member' })]) }),
    aggregate({ name: 'thing', entity: entitySpec('thing', [field('title', { kind: 'string' })]) }),
  ],
});

/** 単位の辿り方だけを差し替えた題材を回す。 */
function runChain(via: readonly { table: string; column: string; to: string }[]) {
  const decl: SendLimitDecl = { ...DECL, keys: [{ name: 'actor_id', unit: { via } }], payload: [], limits: [{ word: 'actor_daily', key: 'actor_id', max: 10, per: '24 hours' }] };
  const fn = limitFn(decl, { args: ['text', 'uuid'], params: ['p_type', 'p_actor_id'] });
  const tables = [
    dataTable('jobs', { internal: true, functions: [fn] }),
    dataTable('members', { entity: 'member' }),
    dataTable('invitations', { entity: 'invitation' }),
    dataTable('things', { entity: 'thing', functions: [CALLER] }),
  ];
  return verifySendLimits(CHAIN_DOMAIN, dataTableModel(tables), JOBS);
}

/** 正しい辿り方。 */
const CHAIN = [
  { table: 'members', column: 'invited_via', to: 'invitations' },
  { table: 'invitations', column: 'issued_by', to: 'members' },
];

describe('T26 数える単位の辿り方(unit.via)', () => {
  it('正しい辿り方でも、unit は試験段階なので警告を 1 件だけ出す(誤りは無い)', () => {
    const findings = runChain(CHAIN);
    expect(findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'T26', severity: 'warning', reason: UNIT_EXPERIMENTAL_REASON, counterexample: { key: 'actor_id' } });
    expect(findings[0]?.message).toContain('試験段階');
  });

  it.each<[string, readonly { table: string; column: string; to: string }[], string]>([
    ['参照の欄でない', [{ table: 'members', column: 'name', to: 'invitations' }, CHAIN[1] ?? CHAIN[0] ?? { table: '', column: '', to: '' }], '参照の欄(ref)ではありません'],
    ['参照先が違う', [{ table: 'members', column: 'invited_via', to: 'members' }], '参照先は invitation'],
    ['表が無い', [{ table: 'nothing', column: 'x', to: 'members' }], 'data_table の表ではありません'],
    ['歩が途切れる', [{ table: 'members', column: 'invited_via', to: 'invitations' }, { table: 'members', column: 'invited_via', to: 'invitations' }], '歩が途切れています'],
    ['最初の表へ戻らない', [{ table: 'members', column: 'invited_via', to: 'invitations' }], '最初の表 members ではありません'],
  ])('赤: %s', (_name, via, word) => {
    const findings = runChain(via).filter((finding) => finding.severity === 'error');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.verifier === 'T26')).toBe(true);
    expect(findings.map((finding) => finding.message).join('\n')).toContain(word);
  });
});

describe('T26 送信の上限の接地', () => {
  it('緑: 正しい宣言', () => {
    expect(run(limitFn())).toEqual([]);
  });

  it.each<[string, DataFunctionDecl, Parameters<typeof run>[1], string]>([
    ['書き出し先が無い', withoutMigration(limitFn()), {}, 'migration'],
    ['名前の接頭辞', limitFn(DECL, { name: 'limit_thing' }), { caller: { ...CALLER, calls: ['limit_thing'] } }, 'send_limit_ で始まっていません'],
    ['置き場が jobs でない', limitFn(), { home: 'outbox' }, 'outbox の data_table'],
    ['args の食い違い', limitFn(DECL, { args: ['text', 'uuid', 'text', 'uuid'] }), {}, 'args / params'],
    ['params の並びの食い違い', limitFn(DECL, { params: ['p_type', 'p_actor_id', 'p_parent_id', 'p_text'] }), {}, 'args / params'],
    ['種別がカタログに無い', limitFn({ ...DECL, types: ['notify_a', 'notify_missing'] }), {}, 'notify_missing はジョブカタログにありません'],
    ['blocked の表が無い', limitFn({ ...DECL, keys: [{ name: 'parent_id', blocked: { table: 'nothing', column: 'state', values: ['draft'], word: 'w' } }, { name: 'actor_id' }] }), {}, '状態の欄ではありません'],
    ['blocked の列が状態の欄でない', limitFn({ ...DECL, keys: [{ name: 'parent_id', blocked: { table: 'parents', column: 'title', values: ['x'], word: 'w' } }, { name: 'actor_id' }] }), {}, '状態の欄ではありません'],
    ['blocked の値が状態に無い', limitFn({ ...DECL, keys: [{ name: 'parent_id', blocked: { table: 'parents', column: 'state', values: ['closed'], word: 'w' } }, { name: 'actor_id' }] }), {}, 'closed は状態機械 parent の状態にありません'],
    ['呼ぶ RPC が無い', limitFn(), { caller: null }, 'calls で名指す RPC がありません'],
    ['呼ぶ RPC の集約が event と違う', limitFn(), { callerEntity: 'parent' }, 'の操作ではありません'],
  ])('赤: %s', (_name, fn, opts, word) => {
    const findings = run(fn, opts);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('T26');
    expect(findings[0]?.message).toContain(word);
  });

  it('data_table が読めていなければ見ない・カタログが無ければ種別を見ない', () => {
    expect(verifySendLimits(DOMAIN, dataTableModel([], false))).toEqual([]);
    const tables = [dataTable('jobs', { internal: true, functions: [limitFn({ ...DECL, types: ['notify_missing'] })] }), dataTable('parents', { entity: 'parent' }), dataTable('things', { entity: 'thing', functions: [CALLER] })];
    expect(verifySendLimits(DOMAIN, dataTableModel(tables))).toEqual([]);
  });
});

describe('T26 数える単位(unit)は試験段階で未決(2026-11-05 コーディネーターの決定)', () => {
  it('unit を宣言しない鍵は警告を出さない', () => {
    const decl: SendLimitDecl = { ...DECL, keys: [{ name: 'actor_id' }], payload: [], limits: [{ word: 'actor_daily', key: 'actor_id', max: 10, per: '24 hours' }] };
    const fn = limitFn(decl, { args: ['text', 'uuid'], params: ['p_type', 'p_actor_id'] });
    const tables = [dataTable('jobs', { internal: true, functions: [fn] }), dataTable('members', { entity: 'member' }), dataTable('invitations', { entity: 'invitation' }), dataTable('things', { entity: 'thing', functions: [CALLER] })];
    expect(verifySendLimits(CHAIN_DOMAIN, dataTableModel(tables), JOBS).filter((finding) => finding.reason === UNIT_EXPERIMENTAL_REASON)).toEqual([]);
  });

  it('誤った辿り方でも試験段階の警告は 1 件だけ添わる(誤りの赤とは別)', () => {
    const findings = runChain([{ table: 'members', column: 'invited_via', to: 'invitations' }]);
    expect(findings.filter((finding) => finding.reason === UNIT_EXPERIMENTAL_REASON)).toHaveLength(1);
    expect(findings.some((finding) => finding.severity === 'error')).toBe(true);
  });
});
