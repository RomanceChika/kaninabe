/**
 * T6 の続き(action_spec の `input` の欄が、生成する RPC の本文に届く)のユニットテスト。
 *
 * 規約網羅(ARCH-SP-BE-0001 §書き込み RPC の形 / action-spec-writing.md §input):
 *   - 作成: `input` の欄は 1 欄ずつの引数(`p_{欄}`)か `p_values` の鍵で受ける。どちらでも受けない欄は error
 *   - 編集: `input` の欄は `access_spec` の `writes` に載るか、`p_{欄}` で受ける。対象の行の `id` は `p_{集約}_id` が受ける
 *   - 本文を生成しない関数(手書き・composite)と、action_spec が無い環境は見ない。手書き(`runner: manual`)の遷移の input も見ない
 *     (作成 / 編集は予約 ID で RPC が決まるので、手書きの操作の input も見る)
 *   - 他の集約の欄は作成 / 編集の本文に届く口が無い(error。その集約の行だけを書く関数に、他の集約の欄は運べない)
 *   - 遷移: `input` の欄は対象の行の `id`(`p_{集約}_id`)か 1 欄ずつの引数(`p_{欄}`)で受ける。袋は持たない。
 *     見るのはそのイベントを呼ぶ操作の `input` だけ(機械の全イベントが 1 本の RPC を共用する)
 */

import { describe, expect, it } from 'vitest';
import { verifyRpcMigration } from '../../../../lib/data/verifiers/t6-rpc-migration.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';
import type { ActionSpecModel } from '../../../../lib/model/trace/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { accessSpec, aggregate, create, entitySpec, field, machine, event, specModel, write } from '../../../helpers/model-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';

/** 予約(booking)と会議室(room)。予約の編集で書けるのは purpose と note だけ。 */
function domain(): SpecModel {
  return specModel([
    aggregate('booking', {
      entity: entitySpec('booking', {
        context: { booking: 'booking.id', room: 'booking.room_id' },
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('room_id', { kind: 'ref', entity: 'room' }, { required: true }),
          field('state', { kind: 'state', machine: 'booking' }),
          field('purpose', { kind: 'string' }),
          field('note', { kind: 'text' }),
          field('seats', { kind: 'integer' }),
        ],
      }),
      access: accessSpec('booking', {
        creates: [create('member')],
        writes: [write('member', ['purpose', 'note'])],
      }),
      stateMachines: [
        machine('booking', { states: ['held', 'done'], initial: 'held', events: [event('finish', { from: ['held'], to: 'done' })] }),
      ],
    }),
    aggregate('room', {
      entity: entitySpec('room', {
        context: { room: 'room.id' },
        fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'room' })],
      }),
      stateMachines: [machine('room', { states: ['open', 'closed'], initial: 'open', events: [event('close', { from: ['open'], to: 'closed' })] })],
    }),
  ]);
}

/** 関数 1 本(既定は生成する作成 RPC。引数は上書きする)。 */
function fn(overrides: Omit<Partial<DataFunctionDecl>, 'migration'> & { readonly migration?: string | null } = {}): DataFunctionDecl {
  const { migration, ...rest } = overrides;
  return {
    name: 'insert_booking',
    args: ['uuid', 'uuid', 'jsonb', 'uuid', 'text[]'],
    params: ['p_id', 'p_room_id', 'p_values', 'p_actor_id', 'p_actor_roles'],
    kind: 'rpc',
    shape: 'create',
    alsoWrites: [],
    ...rest,
    ...(migration === null ? {} : { migration: migration ?? '20260912000001_rpc_insert_booking.sql' }),
  };
}

/** 編集の RPC(対象の行・期待状態・変更集合)。 */
function updateFn(overrides: Omit<Partial<DataFunctionDecl>, 'migration'> = {}): DataFunctionDecl {
  return fn({
    name: 'update_booking',
    shape: 'update',
    args: ['uuid', 'text', 'jsonb', 'uuid', 'text[]'],
    params: ['p_booking_id', 'p_expected_state', 'p_changes', 'p_actor_id', 'p_actor_roles'],
    migration: '20260912000002_rpc_update_booking.sql',
    ...overrides,
  });
}

/** 表 2 つ(会議室の表も並べて、条件にする集約の表名が引ける)。 */
function tables(...functions: readonly DataFunctionDecl[]) {
  return dataTableModel([dataTable('bookings', { entity: 'booking', functions }), dataTable('rooms', { entity: 'room' })]);
}

/** 遷移の RPC(対象の行・期待状態・遷移先・副作用・イベント ID)。 */
function transitionFn(overrides: Omit<Partial<DataFunctionDecl>, 'migration'> & { readonly migration?: string | null } = {}): DataFunctionDecl {
  return fn({
    name: 'apply_booking_transition',
    shape: 'transition',
    args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]'],
    params: ['p_booking_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_actor_roles'],
    migration: '20260912000003_rpc_apply_booking_transition.sql',
    ...overrides,
  });
}

/** action_spec(作成・編集・遷移)。 */
function actions(input: {
  readonly create?: readonly string[];
  readonly update?: readonly string[];
  readonly finish?: readonly string[];
  readonly closeRoom?: readonly string[];
}): ActionSpecModel {
  return {
    actions: [
      actionSpec({ handles: 'booking.create', input: input.create ?? [] }),
      actionSpec({ handles: 'booking.update', input: input.update ?? [] }),
      actionSpec({ handles: 'booking.finish', input: input.finish ?? [] }),
      actionSpec({ handles: 'room.close', input: input.closeRoom ?? [] }),
    ],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
}

/** 指摘の文面。 */
function messages(findings: readonly { readonly message: string }[]): readonly string[] {
  return findings.map((finding) => finding.message);
}

describe('T6 input の欄が本文に届く: 作成', () => {
  it('p_values の袋で受ける欄は届く', () => {
    const findings = verifyRpcMigration(domain(), tables(fn()), actions({ create: ['booking.room_id', 'booking.purpose', 'booking.note'] }));

    expect(findings).toEqual([]);
  });

  it('1 欄ずつの引数で受ける欄も届く', () => {
    const declared = fn({
      args: ['uuid', 'uuid', 'text', 'uuid', 'text[]'],
      params: ['p_id', 'p_room_id', 'p_note', 'p_actor_id', 'p_actor_roles'],
    });

    expect(verifyRpcMigration(domain(), tables(declared), actions({ create: ['booking.room_id', 'booking.note'] }))).toEqual([]);
  });

  it('どの引数にも p_values にも当たらない欄は error(今まで黙って本文から落ちていた)', () => {
    const declared = fn({
      args: ['uuid', 'uuid', 'uuid', 'text[]'],
      params: ['p_id', 'p_room_id', 'p_actor_id', 'p_actor_roles'],
    });

    const findings = verifyRpcMigration(domain(), tables(declared), actions({ create: ['booking.room_id', 'booking.note'] }));

    expect(messages(findings)).toEqual([
      'booking.create の input の booking.note は、生成する insert_booking の本文のどこにも現れません(呼び手が値を渡しても捨てられます)',
    ]);
    expect(findings[0]?.verifier).toBe('T6');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.location?.file).toBe('docs/specs/backend/actions/booking/create.md');
    expect(findings[0]?.suggestion).toContain('p_note');
    expect(findings[0]?.counterexample?.['reachable']).toContain('room_id');
  });

  it('落ちた欄は欄ごとに 1 件ずつ出る', () => {
    const declared = fn({ args: ['uuid', 'uuid', 'text[]'], params: ['p_id', 'p_actor_id', 'p_actor_roles'] });

    const findings = verifyRpcMigration(domain(), tables(declared), actions({ create: ['booking.purpose', 'booking.note'] }));

    expect(messages(findings)).toHaveLength(2);
  });

  it('他の集約の欄は、届く口が無いので error(自集約の欄が落ちるのと同じ静かな脱落)', () => {
    const findings = verifyRpcMigration(domain(), tables(fn()), actions({ create: ['booking.room_id', 'room.state'] }));

    expect(messages(findings)).toEqual([
      'booking.create の input の room.state は、booking の欄ではありません(insert_booking が書くのは booking の行だけで、他の集約の欄は本文のどこにも現れず、呼び手が値を渡しても捨てられます)',
    ]);
    expect(findings[0]?.verifier).toBe('T6');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.location?.file).toBe('docs/specs/backend/actions/booking/create.md');
    expect(findings[0]?.suggestion).toContain('room を書く別の操作');
    expect(findings[0]?.counterexample).toEqual({ operation: 'booking.create', input: 'room.state', function: 'insert_booking', writes: 'booking' });
  });
});

describe('T6 input の欄が本文に届く: 編集', () => {
  it('writes に載る欄と、対象の行の id は届く', () => {
    const findings = verifyRpcMigration(domain(), tables(updateFn()), actions({ update: ['booking.id', 'booking.purpose', 'booking.note'] }));

    expect(findings).toEqual([]);
  });

  it('writes に載らず、引数でも受けない欄は error', () => {
    const findings = verifyRpcMigration(domain(), tables(updateFn()), actions({ update: ['booking.purpose', 'booking.seats'] }));

    expect(messages(findings)).toEqual([
      'booking.update の input の booking.seats は、生成する update_booking の本文のどこにも現れません(呼び手が値を渡しても捨てられます)',
    ]);
    expect(findings[0]?.suggestion).toContain('writes');
  });

  it('他の集約の欄は、編集でも error', () => {
    const findings = verifyRpcMigration(domain(), tables(updateFn()), actions({ update: ['booking.purpose', 'room.state'] }));

    expect(messages(findings)).toEqual([
      'booking.update の input の room.state は、booking の欄ではありません(update_booking が書くのは booking の行だけで、他の集約の欄は本文のどこにも現れず、呼び手が値を渡しても捨てられます)',
    ]);
  });

  it('writes に載らなくても、p_{欄} で受ける欄は届く(computes が決める欄)', () => {
    const declared = updateFn({
      args: ['uuid', 'text', 'jsonb', 'text', 'uuid', 'text[]'],
      params: ['p_booking_id', 'p_expected_state', 'p_changes', 'p_seats', 'p_actor_id', 'p_actor_roles'],
    });

    expect(verifyRpcMigration(domain(), tables(declared), actions({ update: ['booking.seats'] }))).toEqual([]);
  });
});

describe('T6 input の欄が本文に届く: 遷移', () => {
  /** 対応者の欄を 1 欄ずつ受ける遷移の RPC(`p_purpose`)。 */
  function withPurpose(): DataFunctionDecl {
    return transitionFn({
      args: ['uuid', 'text', 'text', 'text[]', 'text', 'text', 'uuid', 'text[]'],
      params: ['p_booking_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_purpose', 'p_actor_id', 'p_actor_roles'],
    });
  }

  it('対象の行の id と、p_{欄} で受ける欄は届く', () => {
    const findings = verifyRpcMigration(domain(), tables(withPurpose()), actions({ finish: ['booking.id', 'booking.purpose'] }));

    expect(findings).toEqual([]);
  });

  it('id だけの遷移は届く(実仕様の遷移の大半)', () => {
    expect(verifyRpcMigration(domain(), tables(transitionFn()), actions({ finish: ['booking.id'] }))).toEqual([]);
  });

  it('p_{欄} で受けない欄は error(今まで黙って捨てられていた。遷移は袋を持たない)', () => {
    const findings = verifyRpcMigration(domain(), tables(transitionFn()), actions({ finish: ['booking.id', 'booking.note'] }));

    expect(messages(findings)).toEqual([
      'booking.finish の input の booking.note は、生成する apply_booking_transition の本文のどこにも現れません(呼び手が値を渡しても捨てられます)',
    ]);
    expect(findings[0]?.verifier).toBe('T6');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.location?.file).toBe('docs/specs/backend/actions/booking/finish.md');
    expect(findings[0]?.suggestion).toContain('p_note');
    expect(findings[0]?.suggestion).toContain('袋を持たず');
    expect(findings[0]?.counterexample).toEqual({
      operation: 'booking.finish',
      input: 'booking.note',
      function: 'apply_booking_transition',
      reachable: 'id',
    });
  });

  it('袋(p_changes)を持つ編集と違い、writes に載っている欄でも遷移の input には効かない', () => {
    // purpose は編集の writes に載っているが、遷移の RPC は p_purpose を受けていないので届かない。
    const findings = verifyRpcMigration(domain(), tables(transitionFn()), actions({ finish: ['booking.purpose'] }));

    expect(messages(findings)).toHaveLength(1);
  });

  it('他の集約の欄は、遷移でも error', () => {
    const findings = verifyRpcMigration(domain(), tables(transitionFn()), actions({ finish: ['booking.id', 'room.state'] }));

    expect(messages(findings)).toEqual([
      'booking.finish の input の room.state は、booking の欄ではありません(apply_booking_transition が書くのは booking の行だけで、他の集約の欄は本文のどこにも現れず、呼び手が値を渡しても捨てられます)',
    ]);
  });

  it('別の機械の遷移・作成・編集の input は、この RPC の持ち場ではないので数えない', () => {
    const findings = verifyRpcMigration(
      domain(),
      tables(transitionFn()),
      actions({ finish: ['booking.id'], closeRoom: ['room.state'], create: ['booking.note'], update: ['booking.seats'] }),
    );

    expect(findings).toEqual([]);
  });

  it('遷移に接地しない操作(削除の予約 ID など)は数えない', () => {
    const model = actions({ finish: ['booking.id'] });
    const reserved: ActionSpecModel = {
      ...model,
      actions: [...model.actions, actionSpec({ handles: 'booking.delete', input: ['booking.note'], relPath: 'booking/delete.md' })],
    };

    expect(verifyRpcMigration(domain(), tables(transitionFn()), reserved)).toEqual([]);
  });

  /** 集約 booking の副次の機械 `review` を足した仕様と、その遷移を呼ぶ操作(booking.note は届かない欄)。 */
  function secondary(): { readonly model: SpecModel; readonly actions: ActionSpecModel } {
    const review = machine('review', { states: ['open', 'closed'], initial: 'open', events: [event('close_review', { from: ['open'], to: 'closed' })] });
    const base = domain();
    const aggregates = new Map(base.aggregates);
    const booking = aggregates.get('booking');
    if (booking === undefined) throw new Error('fixture');
    // 副次の機械は自分の状態列を持つ(遷移 RPC が動かす列が機械から 1 つに決まる)。
    const entity = booking.entity === undefined ? undefined : { ...booking.entity, fields: [...booking.entity.fields, field('review_state', { kind: 'state', machine: 'review' })] };
    aggregates.set('booking', { ...booking, ...(entity === undefined ? {} : { entity }), stateMachines: [...booking.stateMachines, review] });
    return {
      model: { ...base, aggregates },
      actions: {
        actions: [actionSpec({ handles: 'review.close_review', input: ['booking.id', 'booking.note'] })],
        unhandled: [],
        scans: [],
        unscanned: [],
        testTagBaseline: [],
      },
    };
  }

  it('機械の名前が集約の名前と違うときは、実行計画と同じ引き当て(機械名の RPC)でこの RPC を呼ぶ操作を引く', () => {
    const { model, actions: declared } = secondary();
    const rpc = transitionFn({ name: 'apply_review_transition', migration: '20260912000004_rpc_apply_review_transition.sql' });

    const findings = verifyRpcMigration(model, tables(rpc), declared);

    expect(messages(findings)).toEqual([
      'review.close_review の input の booking.note は、生成する apply_review_transition の本文のどこにも現れません(呼び手が値を渡しても捨てられます)',
    ]);
  });

  it('機械名の RPC が無くても集約名の RPC は受けない(別の機械のイベントを集約名の機械の遷移表で判定させない)', () => {
    const { model, actions: declared } = secondary();

    const findings = verifyRpcMigration(model, tables(transitionFn()), declared);

    expect(findings).toEqual([]);
  });

  it('機械名の RPC があれば、集約名の RPC は同じ操作を数えない(同じ欄を 2 度言わない)', () => {
    const { model, actions: declared } = secondary();
    const rpc = transitionFn({ name: 'apply_review_transition', migration: '20260912000004_rpc_apply_review_transition.sql' });

    const findings = verifyRpcMigration(model, tables(transitionFn(), rpc), declared);

    expect(messages(findings)).toHaveLength(1);
  });
});

describe('T6 input の欄が本文に届く: 見ないもの', () => {
  const dropped = fn({ args: ['uuid', 'uuid', 'text[]'], params: ['p_id', 'p_actor_id', 'p_actor_roles'] });

  it('本文を手書きと宣言した関数は見ない(本文の側が正)', () => {
    const handwritten = fn({ args: dropped.args, params: dropped.params, migration: null, handwritten: '本文に DSL 外の手順がある' });

    expect(verifyRpcMigration(domain(), tables(handwritten), actions({ create: ['booking.note'] }))).toEqual([]);
  });

  it('composite は見ない(定型に乗らない)', () => {
    expect(verifyRpcMigration(domain(), tables(fn({ args: dropped.args, params: dropped.params, shape: 'composite', migration: null })), actions({ create: ['booking.note'] }))).toEqual([]);
  });

  it('遷移でも、本文を手書きと宣言した関数は見ない', () => {
    const handwritten = transitionFn({ migration: null, handwritten: '本文に DSL 外の手順がある' });

    expect(verifyRpcMigration(domain(), tables(handwritten), actions({ finish: ['booking.note'] }))).toEqual([]);
  });

  /** 指定の操作を手書き(`runner: manual`)にした action_spec。input は届かない欄(booking.note)を持たせる。 */
  function manualActions(handles: string): ActionSpecModel {
    return {
      actions: [actionSpec({ handles, input: ['booking.note'], runner: { reason: '専用の RPC を自分で呼ぶ' } })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    };
  }

  it('手書き(runner: manual)の遷移が id 以外の欄を input に持っても、共用の遷移 RPC に照らして赤にしない', () => {
    // 手書きの遷移は専用の RPC を呼ぶ。引き当てが共用の apply_booking_transition に落ちても、その本文に照らして偽の error を出さない。
    expect(verifyRpcMigration(domain(), tables(transitionFn()), manualActions('booking.finish'))).toEqual([]);
  });

  it('同じ input でも手書きでなければ赤(上の反例が手書きの除外で効いていることの対)', () => {
    expect(messages(verifyRpcMigration(domain(), tables(transitionFn()), actions({ finish: ['booking.note'] })))).toHaveLength(1);
  });

  it('手書きの作成・編集は見る(予約 ID で RPC が 1 本に決まるので、届かない欄を捨てる真の検出を捨てない。手書きでなくても同じ件数)', () => {
    // 袋も p_note も受けない関数に、手書きの操作の note は届かない。作成 / 編集は手書きでも赤(遷移だけが除かれる)。
    const noBagCreate = fn({ args: dropped.args, params: dropped.params });
    const noBagUpdate = updateFn({ args: ['uuid', 'text', 'uuid', 'text[]'], params: ['p_booking_id', 'p_expected_state', 'p_actor_id', 'p_actor_roles'] });

    expect(messages(verifyRpcMigration(domain(), tables(noBagCreate), actions({ create: ['booking.note'] })))).toHaveLength(1);
    expect(messages(verifyRpcMigration(domain(), tables(noBagCreate), manualActions('booking.create')))).toHaveLength(1);
    // 編集は手書きでも手書きでなくても同じ判定(除外されるのは遷移だけ)。
    expect(messages(verifyRpcMigration(domain(), tables(noBagUpdate), manualActions('booking.update')))).toEqual(
      messages(verifyRpcMigration(domain(), tables(noBagUpdate), actions({ update: ['booking.note'] }))),
    );
  });

  it('action_spec が無い環境では見ない', () => {
    expect(verifyRpcMigration(domain(), tables(dropped))).toEqual([]);
  });
});
