/**
 * R16(持っていれば効く値 `bearer` の取り扱い)の単体テスト。
 * 止める形(名指した欄が無い・datetime でない・同じ欄・CSPRNG でない式・値を渡す口・route に載る)と、
 * 受け入れる形(正しい宣言・読めないとき)、使い回しの受け入れが warning(受け入れた危険)になることを 1 つずつ固定する。
 */

import { describe, expect, it } from 'vitest';
import { BEARER_DEFAULT_SQL } from '../../../lib/kernel/bearer.js';
import { bearerAcceptances, verifyBearer, type BearerInput, type BearerScreenRoute } from '../../../lib/risk/verifiers/r16-bearer.js';
import type { BearerDecl, FieldDef } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, loc, specModel } from '../../helpers/model-builder.js';
import { dataTable } from '../../helpers/data-builder.js';

const at = loc('invite/entity.md', 'fields[0].bearer');
const reusable: BearerDecl = { kind: 'reusable', reason: '何人でも入れる窓口の設計のため', location: at };
const expiring = (expiresAt = 'expires_at', usedAt = 'used_at'): BearerDecl => ({ kind: 'expiring', expiresAt, usedAt, location: at });

/** 欄 `code` に bearer を付けた集約 `invite` を持つ入力。 */
function input(bearer: BearerDecl, extra: Partial<BearerInput> = {}, extraFields: readonly FieldDef[] = []): BearerInput {
  const code: FieldDef = { ...field('code', { kind: 'string' }), maxLength: 43, suppliedBy: 'db', bearer };
  return {
    model: specModel([aggregate('invite', { entity: entitySpec('invite', { fields: [code, ...extraFields] }) })]),
    tables: null,
    screens: null,
    ...extra,
  };
}

const timeFields = [field('expires_at', { kind: 'datetime' }), field('used_at', { kind: 'datetime' })];
const table = (defaults: Record<string, string>, params: readonly string[] = []) =>
  dataTable('invites', {
    entity: 'invite',
    defaults,
    functions: [{ name: 'insert_invite', args: [], params, kind: 'rpc', shape: 'create', migration: 'x.sql', alsoWrites: {}, selfWrites: [], location: loc('t') } as never],
  });
const screen = (route: string): BearerScreenRoute => ({ id: 'screen-x', route, location: loc('screens/x.md') });

describe('R16 受け入れる形', () => {
  it('寿命の対が実在する datetime の欄を名指していれば通る', () => {
    expect(verifyBearer(input(expiring(), {}, timeFields))).toEqual([]);
  });

  it('CSPRNG の式(空白の違いは無視)・route に載っていない・引数で受けていなければ通る', () => {
    const squeezed = BEARER_DEFAULT_SQL.replaceAll(' ', '');
    for (const expression of [BEARER_DEFAULT_SQL, squeezed, `  ${BEARER_DEFAULT_SQL}\n`]) {
      const findings = verifyBearer(input(expiring(), { tables: [table({ code: expression }, ['p_id'])], screens: [screen('/invite'), screen('/items/:id')] }, timeFields));
      expect(findings).toEqual([]);
    }
  });

  it('材料が読めなければ(テーブル仕様・画面)その検査は何も言わない', () => {
    expect(verifyBearer(input(expiring(), { tables: null, screens: null }, timeFields))).toEqual([]);
  });

  it('対応するテーブル仕様が無い集約は defaults を見ない', () => {
    expect(verifyBearer(input(expiring(), { tables: [dataTable('others', { entity: 'other' })] }, timeFields))).toEqual([]);
  });

  it('bearer の無い集約は何も言わない', () => {
    const model = specModel([aggregate('plain', { entity: entitySpec('plain', { fields: [field('code', { kind: 'string' })] }) })]);
    expect(verifyBearer({ model, tables: [], screens: [screen('/p/:code')] })).toEqual([]);
  });
});

describe('R16 止める形(寿命の宣言)', () => {
  it('名指した欄が無い', () => {
    const findings = verifyBearer(input(expiring('gone_at', 'used_at'), {}, [field('used_at', { kind: 'datetime' })]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'R16', severity: 'error', counterexample: { key: 'expires_at', named: 'gone_at' } });
    expect(findings[0]?.message).toContain('実在しません');
  });

  it('datetime でない欄を名指す', () => {
    const findings = verifyBearer(input(expiring(), {}, [field('expires_at', { kind: 'integer' }), field('used_at', { kind: 'datetime' })]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('datetime ではありません');
    expect(findings[0]?.counterexample).toMatchObject({ type: 'integer' });
  });

  it('失効と使用が同じ欄', () => {
    const findings = verifyBearer(input(expiring('stamp', 'stamp'), {}, [field('stamp', { kind: 'datetime' })]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('同じ欄 stamp');
  });
});

describe('R16 受け入れた危険(使い回し)', () => {
  it('reusable は warning で、受け入れた危険の宣言を載せる', () => {
    const findings = verifyBearer(input(reusable));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'R16',
      severity: 'warning',
      acceptance: { reason: reusable.kind === 'reusable' ? reusable.reason : '', location: at },
    });
    expect(findings[0]?.message).toContain('何人でも入れる窓口の設計のため');
  });

  it('bearerAcceptances は reusable の宣言だけを集める', () => {
    expect(bearerAcceptances(input(reusable).model)).toEqual([{ reason: '何人でも入れる窓口の設計のため', location: at }]);
    expect(bearerAcceptances(input(expiring(), {}, timeFields).model)).toEqual([]);
  });
});

describe('R16 止める形(生成の仕方)', () => {
  it.each([
    ['UUID を使う式', "replace((gen_random_uuid())::text, '-'::text, ''::text)"],
    ['バイト数が違う', BEARER_DEFAULT_SQL.replace('(32)', '(16)')],
    ['固定値', "'founder'::text"],
  ])('defaults の式が CSPRNG の 32 バイトでない: %s', (_name, expression) => {
    const findings = verifyBearer(input(reusable, { tables: [table({ code: expression })] }));
    const errors = findings.filter((finding) => finding.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('CSPRNG の 32 バイトではありません');
    expect(errors[0]?.suggestion).toContain(BEARER_DEFAULT_SQL);
  });

  it('defaults に値の作り方が無い', () => {
    const errors = verifyBearer(input(reusable, { tables: [table({})] })).filter((finding) => finding.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('defaults に値の作り方がありません');
  });

  it.each(['p_code', 'p_new_code'])('表の関数が値を引数 %s で受けている', (param) => {
    const errors = verifyBearer(input(reusable, { tables: [table({ code: BEARER_DEFAULT_SQL }, ['p_id', param])] })).filter((finding) => finding.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.counterexample).toMatchObject({ function: 'insert_invite', param });
  });
});

describe('R16 止める形(URL のパス)', () => {
  it.each([
    ['欄の名前', '/invite/:code'],
    ['集約名_欄の名前', '/join/:invite_code/confirm'],
  ])('route の動的セグメントが bearer の欄を名指す: %s', (_name, route) => {
    const errors = verifyBearer(input(reusable, { screens: [screen(route)] })).filter((finding) => finding.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.counterexample).toMatchObject({ screen: 'screen-x', route, field: 'invite.code' });
    expect(errors[0]?.suggestion).toContain('フラグメント');
  });

  it('別の名前の動的セグメント・静的な route は止めない', () => {
    expect(verifyBearer(input(expiring(), { screens: [screen('/invite/:token'), screen('/code')] }, timeFields))).toEqual([]);
  });
});
