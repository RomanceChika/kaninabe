/**
 * V2 のうち、access_spec の列を名指す口(`fields_hidden[].field` / `writes[].fields` / `accept[].filter`・`by`)の接地。
 *
 * 規約網羅(domain-spec-writing.md の V2 行):
 *   - `fields_hidden[].field` は entity_spec の列に実在する(綴り違いのマスクはどの列にも掛からず、素の列が surface に出る)
 *   - 同じ列を 2 回隠さない(列名で 1 つのマスクに畳まれ、後の宣言が前を黙って上書きする)
 *   - `writes[].fields` は実在し、状態の列・自動の列でない
 *   - `accept[].filter` は実在し、`accept[].by` は reads に現れる
 *   - access_spec の `entity` は同じ集約の entity_spec の名前と一致する
 *   - 正しい宣言は何も言わない(対照)・entity_spec が無い集約は列の実在を言わない(境界)
 */

import { describe, expect, it } from 'vitest';
import type { AccessSpec, ReadFilterAccept } from '../../../../lib/model/types.js';
import { checkAccessFields } from '../../../../lib/verify/verifiers/v2-access-fields.js';
import { referenceIntegrityVerifier } from '../../../../lib/verify/verifiers/v2-reference-integrity.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  fieldHiddenRule,
  loc,
  readRule,
  specModel,
  stubContext,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';

const member = entitySpec('member', [
  field('id', { kind: 'uuid' }, { auto: true }),
  field('email', { kind: 'string' }),
  field('company_id', { kind: 'uuid' }),
  field('state', { kind: 'state', machine: 'member' }),
]);

function accept(by: string, filter: string): ReadFilterAccept {
  return { by, field: filter, reason: '理由', location: loc() };
}

function access(init: Parameters<typeof accessSpec>[1]): AccessSpec {
  return accessSpec('member', { reads: [readRule('member', { kind: 'all' })], ...init });
}

describe('V2: fields_hidden[].field', () => {
  it('実在しない列を隠す宣言はエラー(綴り違いのマスクはどの列にも掛からない)', () => {
    const findings = checkAccessFields(access({ fieldsHidden: [fieldHiddenRule('emial', ['member'])] }), member);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V2');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('emial');
    expect(findings[0]?.message).toContain('列にありません');
  });

  it('同じ列を 2 回隠す宣言はエラー(後の宣言が前の宣言を黙って上書きする)', () => {
    const findings = checkAccessFields(
      access({ fieldsHidden: [fieldHiddenRule('email', ['member']), fieldHiddenRule('email', ['anonymous'])] }),
      member,
    );
    expect(findings.map((finding) => finding.message)).toEqual(['member の fields_hidden が email を 2 回宣言しています']);
  });

  it('実在する列を 1 回だけ隠す宣言は何も言わない(対照)', () => {
    expect(checkAccessFields(access({ fieldsHidden: [fieldHiddenRule('email', ['member'])] }), member)).toEqual([]);
  });

  it('entity_spec が無い集約では列の実在を言わない(V1 が先に止める)が、二重の宣言は言う(境界)', () => {
    const findings = checkAccessFields(
      access({ fieldsHidden: [fieldHiddenRule('emial', ['member']), fieldHiddenRule('emial', ['member'])] }),
      undefined,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('2 回宣言');
  });

  it('V2 の検証器から呼ばれる(配線を外すと鳴らない)', () => {
    const model = specModel({
      aggregates: [aggregate({ name: 'member', entity: member, access: access({ fieldsHidden: [fieldHiddenRule('emial', ['member'])] }) })],
    });
    const { ctx } = stubContext({});
    const messages = referenceIntegrityVerifier.verify(model, ctx).map((finding) => finding.message);
    expect(messages.some((message) => message.includes('fields_hidden が隠す emial'))).toBe(true);
  });
});

describe('V2: writes[].fields', () => {
  it('実在しない列はエラー(書き換えてよい列から黙って落ちる)', () => {
    const findings = checkAccessFields(access({ writes: [writeRule('member', ['emial'])] }), member);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('writes(by: member)の fields にある emial');
  });

  it('状態の列はエラー(遷移を通らずに状態を書ける口が開く)', () => {
    const findings = checkAccessFields(access({ writes: [writeRule('member', ['state'])] }), member);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('状態の列(state(member))');
  });

  it('自動の列はエラー', () => {
    const findings = checkAccessFields(access({ writes: [writeRule('member', ['id'])] }), member);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('自動の列(auto: true)');
  });

  it('実在する通常の列は何も言わない(対照)・entity_spec が無ければ言わない(境界)', () => {
    expect(checkAccessFields(access({ writes: [writeRule('member', ['email'])] }), member)).toEqual([]);
    expect(checkAccessFields(access({ writes: [writeRule('member', ['emial'])] }), undefined)).toEqual([]);
  });
});

describe('V2: access_spec の entity', () => {
  it('同じ集約の entity_spec の名前と違えばエラー(名前で引く口から黙って外れる)', () => {
    const findings = checkAccessFields(accessSpec('membr', { reads: [readRule('member', { kind: 'all' })] }), member);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('access_spec の entity membr');
  });
});

describe('V2: accept[]', () => {
  it('実在しない列の受け入れはエラー', () => {
    const findings = checkAccessFields(access({ accepts: [accept('member', 'compnay_id')] }), member);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('filter compnay_id');
  });

  it('reads に現れないロールの受け入れはエラー', () => {
    const findings = checkAccessFields(access({ accepts: [accept('staff', 'company_id')] }), member);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('accept の by staff');
  });

  it('祖先の列({集約}.{列})の受け入れ: 実在して context で届くなら通り、届かない・実在しない列は error', () => {
    const parent = aggregate({ name: 'dept', entity: entitySpec('dept', [field('company_id', { kind: 'string' })]) });
    const child = entitySpec('member', [field('dept_id', { kind: 'ref', entity: 'dept' })], { dept: 'member.dept_id' });
    const model = specModel({ aggregates: [parent, aggregate({ name: 'member', entity: child })] });

    expect(checkAccessFields(access({ accepts: [accept('member', 'dept.company_id')] }), child, model)).toEqual([]);
    expect(checkAccessFields(access({ accepts: [accept('member', 'dept.nothing')] }), child, model)).toHaveLength(1);
    expect(checkAccessFields(access({ accepts: [accept('member', 'ghost.company_id')] }), child, model)).toHaveLength(1);
    const unreachable = entitySpec('member', [field('dept_id', { kind: 'ref', entity: 'dept' })]);
    const apart = specModel({ aggregates: [parent, aggregate({ name: 'member', entity: unreachable })] });
    expect(checkAccessFields(access({ accepts: [accept('member', 'dept.company_id')] }), unreachable, apart)).toHaveLength(1);
  });

  it('実在する列と reads のロールの受け入れは何も言わない(対照)', () => {
    expect(checkAccessFields(access({ accepts: [accept('member', 'company_id')] }), member)).toEqual([]);
  });
});
