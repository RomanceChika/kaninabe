/**
 * V17(DB が決める値)の規約網羅テスト。
 * 対象の要求(domain-spec-writing.md §entity_spec):
 *   `supplied_by: db` の欄は (a) どの action_spec の `input` にも現れない
 *   (b) その表の data_table が機構(`defaults` / `triggers[].supplies`)を宣言している
 *   (c) 作成 RPC(`insert_{entity}`)の `params` に `p_{欄}` が無い。
 *   (a) の例外: access_spec の `writes` が書き換えを宣言した欄は、編集(`{集約}.update`)の `input` に現れてよい
 *   (作るときの値だけを DB が決める。点検 24 回目 B24-1 の末尾の番号)。
 */

import { describe, expect, it } from 'vitest';
import { suppliedByDbVerifier } from '../../../../lib/verify/verifiers/v17-supplied-by-db.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import type { DataTableSpec } from '../../../../lib/model/data/types.js';
import { accessSpec, aggregate, entitySpec, field, specModel, writeRule } from '../../../helpers/model-builder-v8plus.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** `code` を `supplied_by: db` で宣言した invitation 集約。 */
const MODEL = specModel({
  aggregates: [
    aggregate({
      name: 'invitation',
      entity: entitySpec('invitation', [
        field('code', { kind: 'string' }, { required: true, suppliedBy: 'db' }),
      ]),
    }),
  ],
});

/** 作成 RPC(引数名は呼び側が渡す口)。 */
function createRpc(params: readonly string[]): DataTableSpec['functions'][number] {
  return {
    name: 'insert_invitation',
    args: params.map(() => 'uuid'),
    params,
    kind: 'rpc',
    shape: 'create',
    alsoWrites: [],
  };
}

/** 検証器に渡す文脈を組み立てる。 */
function ctx(init: {
  input?: readonly string[];
  table?: Partial<DataTableSpec>;
}): VerifyContext {
  return {
    guards: undefined as never,
    roots: TEST_ROOTS,
    actions: loadedInput({
      actions: [actionSpec({ handles: 'invitation.create', input: init.input ?? [] })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    }),
    dataTables: loadedInput(
      dataTableModel([
        dataTable('invitations', { entity: 'invitation', ...init.table }),
      ]),
    ),
  };
}

describe('V17 DB が決める値', () => {
  it('列の既定値で機構が宣言されていれば通す', () => {
    const findings = suppliedByDbVerifier.verify(
      MODEL,
      ctx({ table: { defaults: { code: "gen_random_uuid()::text" } } }),
    );

    expect(findings).toEqual([]);
  });

  it('トリガの supplies で宣言されていても通す', () => {
    const findings = suppliedByDbVerifier.verify(
      MODEL,
      ctx({
        table: {
          triggers: [
            {
              name: 'fill_code',
              functionName: 'fill_code',
              deferred: false,
              supplies: ['code'],
              params: {},
            },
          ],
        },
      }),
    );

    expect(findings).toEqual([]);
  });

  it('機構の宣言が無ければ落とす', () => {
    const findings = suppliedByDbVerifier.verify(MODEL, ctx({}));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'V17',
      severity: 'error',
      counterexample: { entity: 'invitation', field: 'code', table: 'invitations' },
    });
  });

  it('action_spec の input に現れていたら落とす', () => {
    const findings = suppliedByDbVerifier.verify(
      MODEL,
      ctx({ input: ['invitation.code'], table: { defaults: { code: 'x()' } } }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({
      field: 'code',
      action: 'invitation.create',
    });
  });

  describe('作った後の書き換え(writes)の欄は編集の入力に現れてよい(点検 24 回目 B24-1)', () => {
    /** 集約の名前(program)と欄の持ち主(program_item)が違う形で、writes が code を書き換える。 */
    function model(writes: readonly string[]) {
      return specModel({
        aggregates: [
          aggregate({
            name: 'program',
            entity: entitySpec('invitation', [field('code', { kind: 'string' }, { required: true, suppliedBy: 'db' })]),
            access: accessSpec('invitation', { writes: [writeRule('staff', writes)] }),
          }),
        ],
      });
    }
    /** 指定の操作の action_spec だけを持つ文脈。 */
    function withAction(handles: string): VerifyContext {
      const base = ctx({ table: { defaults: { code: 'x()' } } });
      return {
        ...base,
        actions: loadedInput({ actions: [actionSpec({ handles, input: ['invitation.code'] })], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] }),
      };
    }

    it.each([
      ['writes に載る欄の編集の入力', ['code'], 'invitation.update', 0],
      ['writes に載らない欄の編集の入力', ['note'], 'invitation.update', 1],
      ['writes に載る欄でも作成の入力', ['code'], 'invitation.create', 1],
      ['writes に載る欄でも遷移の入力', ['code'], 'invitation.redeem', 1],
    ] as const)('%s', (_title, writes, handles, count) => {
      expect(suppliedByDbVerifier.verify(model(writes), withAction(handles))).toHaveLength(count);
    });
  });

  it('作成 RPC が p_{欄} を受け取っていたら落とす(渡す口が開いている)', () => {
    const findings = suppliedByDbVerifier.verify(
      MODEL,
      ctx({
        table: { defaults: { code: 'x()' }, functions: [createRpc(['p_id', 'p_code'])] },
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({
      function: 'insert_invitation',
      param: 'p_code',
    });
  });

  // fix25s: 末尾の番号の方式 insert_at は、入れてきた値を位置と読んで差し込み、空なら末尾に振る —— 作成の入力に任意で現れてよく、
  // 作成 RPC が p_{欄} を受けてよい。方式 initial の末尾の番号・ほかの機構の欄はこれまでどおり (a)(c) が落とす。
  describe('insert_at の末尾の番号は作成の入力と作成 RPC の口に現れてよい(fix25s)', () => {
    /** 末尾の番号のトリガ(方式を選ぶ)。 */
    function numbering(mode: string): DataTableSpec['triggers'][number] {
      return { name: 'number_code', functionName: 'number_code', fires: 'before insert', deferred: false, supplies: ['code'], params: {}, derives: [{ column: 'code', within: 'parent_id', mode }] };
    }
    it.each([
      ['insert_at の作成の入力と口', 'insert_at', 0],
      ['initial の作成の入力と口', 'initial', 2],
    ] as const)('%s', (_title, mode, count) => {
      const findings = suppliedByDbVerifier.verify(
        MODEL,
        ctx({ input: ['invitation.code'], table: { triggers: [numbering(mode)], functions: [createRpc(['p_id', 'p_code'])] } }),
      );
      expect(findings).toHaveLength(count);
    });
    it('insert_at でも作成でない操作(遷移)の入力なら落とす', () => {
      const base = ctx({ table: { triggers: [numbering('insert_at')] } });
      const findings = suppliedByDbVerifier.verify(MODEL, {
        ...base,
        actions: loadedInput({ actions: [actionSpec({ handles: 'invitation.redeem', input: ['invitation.code'] })], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] }),
      });
      expect(findings).toHaveLength(1);
    });
  });

  it('supplied_by を宣言していない欄は何も見ない', () => {
    const model = specModel({
      aggregates: [
        aggregate({
          name: 'invitation',
          entity: entitySpec('invitation', [field('code', { kind: 'string' }, { required: true })]),
        }),
      ],
    });

    expect(suppliedByDbVerifier.verify(model, ctx({ input: ['invitation.code'] }))).toEqual([]);
  });
});

describe('V17 入力の状態(action_spec / data_table が未選択 / 阻害)', () => {
  const withTable = { input: ['invitation.code'] as const };

  it('data_table が未選択でも阻害でも、機構の宣言(b)と渡す口(c)は見ない(action_spec の (a) は見る)', () => {
    for (const dataTables of [UNSELECTED, blockedInput<never>('missing')]) {
      const state = { ...ctx(withTable), dataTables };
      const findings = suppliedByDbVerifier.verify(MODEL, state);

      expect(findings.map((finding) => finding.message)).toEqual([
        expect.stringContaining('action_spec invitation.create の input に現れます'),
      ]);
    }
  });

  it('action_spec が未選択でも阻害でも、(a)(入力に現れないこと)は出さない(機構の宣言(b)は見る)', () => {
    for (const actions of [UNSELECTED, blockedInput<never>('invalid')]) {
      const state = { ...ctx(withTable), actions };
      const findings = suppliedByDbVerifier.verify(MODEL, state);

      expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('機構を宣言していません')]);
    }
  });
});

