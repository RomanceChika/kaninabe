/**
 * V19(遷移が自分の列に何をするか)の規約網羅テスト。
 * 対象の要求(domain-spec-writing.md §state_spec):
 *   `records_actor` に並ぶ列は (a) entity_spec に実在する (b) `ref(実行者の集約)` 型である
 *   (c) `access_spec` の `transition_writes` に載っている(`writes` の `by: system` の行では満たさない)。
 *   `clears` に並ぶ列は (a) 実在する (b) **空にできる**(必須でない) (c) `transition_writes` に載っている
 *   (d) `records_actor` と両方には並べられない。
 *   `records_actor` に並ぶ列は (e) **値の口(`p_{列}` の引数)が遷移 RPC にある**(束 ㉔)。
 *   `clears` は口を要らない(引数が無ければ生成器が直に `null` を書く)ので (e) を見ない。
 */

import { describe, expect, it } from 'vitest';
import { recordsActorVerifier } from '../../../../lib/verify/verifiers/v19-records-actor.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { blockedInput, loadedInput, NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

/** 検査は仕様モデルだけを見る(action_spec も data_table も要らない)。 */
const CTX = { guards: undefined, ...NO_DOMAIN_INPUTS } as unknown as VerifyContext;

/**
 * 問い合わせ(inquiry)1 集約と、実行者の集約(member)。
 *
 * `handled_by` は `ref(member)` かつ `transition_writes` に載っている列(遷移が書くときだけ載せる。載せたのに書かないと腐った宣言)、
 * `subject` は実行者への参照ではない列、`assignee` は transition_writes に載っていない参照列である。
 */
function model(recordsActor: readonly string[], access: Parameters<typeof accessSpec>[1] = { transitionWrites: used(recordsActor) }) {
  return specModel({
    aggregates: [
      aggregate({
        name: 'member',
        entity: entitySpec('member', [field('is_staff', { kind: 'boolean' }, { session: true })]),
      }),
      aggregate({
        name: 'inquiry',
        entity: entitySpec('inquiry', [
          field('state', { kind: 'state', machine: 'inquiry' }, { required: true }),
          field('handled_by', { kind: 'ref', entity: 'member' }),
          field('assignee', { kind: 'ref', entity: 'member' }),
          field('subject', { kind: 'string' }),
        ]),
        stateMachines: [
          machine({
            machine: 'inquiry',
            states: ['received', 'in_progress'],
            initial: 'received',
            events: [event({ id: 'start_handling', from: ['received'], to: 'in_progress', recordsActor })],
          }),
        ],
        access: accessSpec('inquiry', access),
      }),
    ],
  });
}

/** `transition_writes` に載せる列(`handled_by` を遷移が書くときだけ)。 */
function used(columns: readonly string[]): readonly string[] {
  return columns.includes('handled_by') ? ['handled_by'] : [];
}

describe('V19 遷移が実行者を書き留める列の接地', () => {
  it('実行者への参照で transition_writes に載っている列なら通す', () => {
    expect(recordsActorVerifier.verify(model(['handled_by']), CTX)).toEqual([]);
  });

  it('records_actor を書いていない遷移は見ない', () => {
    expect(recordsActorVerifier.verify(model([]), CTX)).toEqual([]);
  });

  it('entity_spec に無い列は落とす', () => {
    const findings = recordsActorVerifier.verify(model(['nowhere']), CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('実在しません');
  });

  it('実行者への参照でない列は落とす(実行者以外の値は computes の受け皿)', () => {
    const findings = recordsActorVerifier.verify(model(['subject']), CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('実行者への参照ではありません');
  });

  it('transition_writes に載っていない列は落とす(集約として書いてよいことが前提)', () => {
    const findings = recordsActorVerifier.verify(model(['assignee']), CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('transition_writes に宣言されていません');
  });
});

describe('V19 transition_writes の宣言(writes の by: system とは別の口)', () => {
  it('writes の by: system の行では満たさない(その行は内部実行が編集で書ける許可であり、経路を作る)', () => {
    const findings = recordsActorVerifier.verify(model(['handled_by'], { writes: [writeRule('system', ['handled_by'])] }), CTX);

    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('transition_writes に宣言されていません')]);
    expect(findings[0]?.suggestion).toContain('by: system の行では満たさない');
  });

  it('載せたのにどの遷移も書かない列は、腐った宣言として落とす', () => {
    const findings = recordsActorVerifier.verify(model([], { transitionWrites: ['handled_by'] }), CTX);

    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('腐った宣言です')]);
    expect(findings[0]?.location.pointer).toBe('transition_writes.handled_by');
  });

  it('実在しない列を載せると落とす', () => {
    const findings = recordsActorVerifier.verify(model([], { transitionWrites: ['nowhere'] }), CTX);

    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('transition_writes が指す inquiry.nowhere は実在しません')]);
  });
});

/**
 * `clears` の側のモデル。
 *
 * `handled_by` は任意かつ `transition_writes` に載っている列(空にしてよい)、
 * `state` は必須の列、`assignee` は transition_writes に載っていない列である。
 */
function clearsModel(clears: readonly string[], recordsActor: readonly string[] = []) {
  return specModel({
    aggregates: [
      aggregate({
        name: 'member',
        entity: entitySpec('member', [field('is_staff', { kind: 'boolean' }, { session: true })]),
      }),
      aggregate({
        name: 'inquiry',
        entity: entitySpec('inquiry', [
          field('state', { kind: 'state', machine: 'inquiry' }, { required: true }),
          field('handled_by', { kind: 'ref', entity: 'member' }),
          field('assignee', { kind: 'ref', entity: 'member' }),
        ]),
        stateMachines: [
          machine({
            machine: 'inquiry',
            states: ['received', 'in_progress'],
            initial: 'received',
            events: [
              event({ id: 'start_handling', from: ['received'], to: 'in_progress', clears, recordsActor }),
            ],
          }),
        ],
        access: accessSpec('inquiry', { transitionWrites: used([...clears, ...recordsActor]) }),
      }),
    ],
  });
}

/** その宣言で出る指摘の文面。 */
function clearsFindings(clears: readonly string[], recordsActor: readonly string[] = []): string[] {
  return recordsActorVerifier.verify(clearsModel(clears, recordsActor), CTX).map((finding) => finding.message);
}

describe('V19 遷移が空にする列(clears)の接地', () => {
  it('実在し・空にでき・transition_writes に載っている列なら通る', () => {
    expect(clearsFindings(['handled_by'])).toEqual([]);
  });

  it('実在しない列はエラーにする', () => {
    expect(clearsFindings(['nowhere']).join('\n')).toContain('実在しません');
  });

  it('必須の列は空にできないのでエラーにする', () => {
    expect(clearsFindings(['state']).join('\n')).toContain('空にできません');
  });

  it('transition_writes に載っていない列はエラーにする', () => {
    expect(clearsFindings(['assignee']).join('\n')).toContain('transition_writes に宣言されていません');
  });

  it('records_actor と clears の両方に並べることはできない', () => {
    expect(clearsFindings(['handled_by'], ['handled_by']).join('\n')).toContain('両方に並べています');
  });

  it('宣言が無ければ何も見ない', () => {
    expect(clearsFindings([])).toEqual([]);
  });
});

/**
 * 遷移 RPC の引数の宣言つきの文脈(束 ㉔ の (e) を見るのに要る)。
 *
 * @param params `apply_inquiry_transition` の引数名
 * @returns data_table を持つ検査の文脈
 */
function ctxWithParams(params: readonly string[]): VerifyContext {
  return {
    guards: undefined,
    dataTables: loadedInput(dataTableModel([
      dataTable('inquiries', {
        entity: 'inquiry',
        functions: [
          {
            name: 'apply_inquiry_transition',
            args: params.map(() => 'uuid'),
            params: [...params],
            kind: 'rpc',
            shape: 'transition',
            alsoWrites: [],
          },
        ],
      }),
    ])),
  } as unknown as VerifyContext;
}

describe('V19 宣言した列を書く値の口(遷移 RPC の引数)', () => {
  it('records_actor の列を受ける引数があれば通る', () => {
    const ctx = ctxWithParams(['p_inquiry_id', 'p_expected_state', 'p_handled_by']);

    expect(recordsActorVerifier.verify(model(['handled_by']), ctx)).toEqual([]);
  });

  it('records_actor の列を受ける引数が無ければ落とす(宣言だけで本文が何もしない)', () => {
    const ctx = ctxWithParams(['p_inquiry_id', 'p_expected_state']);
    const findings = recordsActorVerifier.verify(model(['handled_by']), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('apply_inquiry_transition にありません');
    expect(findings[0]?.suggestion).toContain('p_handled_by');
  });

  it('clears の列は引数が無くても落とさない(空にするのに渡すものは無い)', () => {
    const ctx = ctxWithParams(['p_inquiry_id', 'p_expected_state']);

    expect(recordsActorVerifier.verify(clearsModel(['handled_by']), ctx)).toEqual([]);
  });

  it('data_table を読めない構成では口を見ない', () => {
    expect(recordsActorVerifier.verify(model(['handled_by']), CTX)).toEqual([]);
  });

  it('data_table が阻害(採ったのに読めない)でも、口は見ない(分からないので判定を出さない。宣言の整合は見る)', () => {
    const blocked = { ...ctxWithParams(['p_inquiry_id']), dataTables: blockedInput<never>('load-failed') } as unknown as VerifyContext;

    expect(recordsActorVerifier.verify(model(['handled_by']), blocked)).toEqual([]);
    expect(recordsActorVerifier.verify(model(['handled_by']), ctxWithParams(['p_inquiry_id']))).toHaveLength(1);
  });

  it('その表に遷移 RPC が無ければ口を見ない', () => {
    const ctx = {
      guards: undefined,
      dataTables: loadedInput(dataTableModel([dataTable('inquiries', { entity: 'inquiry' })])),
    } as unknown as VerifyContext;

    expect(recordsActorVerifier.verify(model(['handled_by']), ctx)).toEqual([]);
  });
});
