/**
 * T20（`also_writes` の書き込みの種類の接地）のテスト。
 * `scrub`（個人列を置き換えて消す）は personal 列を持つ表にだけ・書き込み先は実在する表に向く。
 */

import { describe, expect, it } from 'vitest';
import { verifyWriteKinds } from '../../../../lib/data/verifiers/t20-write-kinds.js';
import type { DataFunctionDecl, DataWriteKind } from '../../../../lib/model/data/types.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

const DOMAIN = specModel([
  aggregate('member', { entity: entitySpec('member', { fields: [] }) }),
  aggregate('entry', { entity: entitySpec('entry', { fields: [field('note', { kind: 'text' }, { personal: true })] }) }),
  aggregate('venue', { entity: entitySpec('venue', { fields: [field('name', { kind: 'string' })] }) }),
]);

/** 書き込みの種類つきの RPC。 */
function rpc(kinds: Record<string, readonly DataWriteKind[]>): DataFunctionDecl {
  return { name: 'erase', args: [], params: [], kind: 'rpc', shape: 'composite', alsoWrites: Object.keys(kinds), alsoWriteKinds: kinds };
}

function messages(kinds: Record<string, readonly DataWriteKind[]>): readonly string[] {
  return verifyWriteKinds(DOMAIN, dataTableModel([
      dataTable('members', { entity: 'member', functions: [rpc(kinds)] }),
      dataTable('domain_events', { internal: true }),
      dataTable('jobs', { internal: true }),
    ])).map((finding) => finding.message);
}

describe('T20 書き込みの種類の接地', () => {
  it('scrub は personal 列を持つ表にだけ。持たない表は名指しで error', () => {
    expect(messages({ entries: ['scrub'], domain_events: ['insert'] })).toEqual([]);
    const result = messages({ venues: ['scrub'] });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('venues に scrub');
    expect(result[0]).toContain('personal: true の欄がありません');
  });

  it('書き込み先が data_table にも entity_spec にも無い表は error（綴り間違いを黙って通さない）', () => {
    const result = messages({ entires: ['update'] });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('entires');
  });

  it('update / delete / insert は personal 列の有無に依らない', () => {
    expect(messages({ venues: ['update', 'delete', 'insert'] })).toEqual([]);
  });

  it('also_writes は帰属表を名指さない(自表は self_writes)', () => {
    const result = messages({ members: ['update'] });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('帰属表 members を名指しています');
  });

  it('self_writes の scrub も personal 列を持つ帰属表にだけ', () => {
    const fn: DataFunctionDecl = { ...rpc({}), selfWriteKinds: ['update', 'scrub'] };
    const findings = verifyWriteKinds(DOMAIN, dataTableModel([dataTable('members', { entity: 'member', functions: [fn] })]));
    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('erase の self_writes に scrub')]);
    const onEntries = verifyWriteKinds(DOMAIN, dataTableModel([dataTable('entries', { entity: 'entry', functions: [fn] })]));
    expect(onEntries).toEqual([]);
  });

  it('calls の呼び先は実在する関数(rpc / helper)で、自分自身ではない', () => {
    const callee: DataFunctionDecl = { name: 'end_sessions', args: [], params: [], kind: 'rpc', shape: 'composite', alsoWrites: [] };
    const tables = (calls: readonly string[]) =>
      dataTableModel([dataTable('members', { entity: 'member', functions: [{ ...rpc({}), calls }, callee] })]);
    expect(verifyWriteKinds(DOMAIN, tables(['end_sessions']))).toEqual([]);
    expect(verifyWriteKinds(DOMAIN, tables(['end_session'])).map((finding) => finding.message)).toEqual([
      expect.stringContaining('calls の end_session は、data_table に実在する関数'),
    ]);
    expect(verifyWriteKinds(DOMAIN, tables(['erase'])).map((finding) => finding.message)).toEqual([expect.stringContaining('自分自身')]);
  });

  it('data_table を採らない構成は何も言わない', () => {
    expect(verifyWriteKinds(DOMAIN, { available: false, tables: [] })).toEqual([]);
  });
});
