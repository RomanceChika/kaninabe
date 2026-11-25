/**
 * V11 のうち、隠し列の相手(`fields_hidden[].from`)の接地。
 *
 * 規約網羅(domain-spec-writing.md の V11 行):
 *   - `from` のロールは roles.md に実在する(綴り違いのロールはどの読み取り規則も外さず、隠したつもりの相手に素の列が出る)
 *   - その access_spec の reads に現れる(外す相手は `reads[].by` との一致で決まる)
 *   - 内部実行のロール(`kind: system`)でない(RLS を迂回するので隠せない)
 *   - `scope: none` のロールは受け入れる(先回りの宣言。境界)・正しい宣言は何も言わない(対照)
 */

import { describe, expect, it } from 'vitest';
import { roleGroundingVerifier } from '../../../../lib/verify/verifiers/v11-role-grounding.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  fieldHiddenRule,
  readRule,
  role,
  specModel,
  stubContext,
} from '../../../helpers/model-builder-v8plus.js';

function model(from: readonly string[], reads = [readRule('anonymous', { kind: 'none' }), readRule('member', { kind: 'all' }), readRule('system', { kind: 'all' })]) {
  return specModel({
    roles: [role('anonymous'), role('member'), role('system'), role('staff')],
    aggregates: [
      aggregate({
        name: 'member',
        entity: entitySpec('member', [field('email', { kind: 'string' })]),
        access: accessSpec('member', { reads, fieldsHidden: [fieldHiddenRule('email', from)] }),
      }),
    ],
  });
}

function messages(from: readonly string[], reads?: Parameters<typeof model>[1]): readonly string[] {
  const { ctx } = stubContext({});
  return roleGroundingVerifier.verify(model(from, reads), ctx).map((finding) => `${finding.verifier}:${finding.severity}:${finding.message}`);
}

describe('V11: fields_hidden[].from', () => {
  it('未定義のロールから隠す宣言はエラー(綴り違いは誰からも隠さない)', () => {
    const found = messages(['membr']);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('V11:error:');
    expect(found[0]).toContain('fields_hidden(email)の from のロール membr は roles.md に定義されていません');
  });

  it('reads に現れないロールから隠す宣言はエラー(外す読み取り規則が無い)', () => {
    const found = messages(['staff']);
    expect(found).toEqual(['V11:error:member の fields_hidden(email)の from にある staff は、この access_spec の reads に現れません']);
  });

  it('内部実行のロールから隠す宣言はエラー(RLS を迂回するので隠せない)', () => {
    const found = messages(['system']);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('内部実行のロール(kind: system)で、列を隠せません');
  });

  it('scope: none のロールから隠す宣言は受け入れる(境界)・reads のロールから隠す宣言は何も言わない(対照)', () => {
    expect(messages(['anonymous'])).toEqual([]);
    expect(messages(['member'])).toEqual([]);
  });
});
