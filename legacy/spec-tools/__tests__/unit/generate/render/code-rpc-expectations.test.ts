/**
 * code-rpc-expectations(data_table の functions + access_spec → RPC 本文の期待)の
 * ユニットテスト。
 *
 * 生成物は統合テスト(rpc-parity)が実 DB の `pg_get_functiondef` と突き合わせる期待である。
 * ここで固定するのは「どの形にどの期待が付くか」——
 * update だけが許可列を持ち、楽観的並行制御の有無は writes の条件の有無から決まり、
 * composite は本文の意味を突き合わせない、の 3 点である。
 *
 * 加えて「空を渡された列の扱い」(`eventColumnContracts`。束 ⑰-3b)—— 宣言はイベント単位
 * なのだから期待もイベント単位で持つ、を固定する(独立レビュー 3-A)。
 */

import { describe, expect, it } from 'vitest';
import {
  eventColumnContracts,
  rpcExpectationsGenerator,
} from '../../../../lib/generate/render/code-rpc-expectations.js';
import type { BuiltOperation } from '../../../../lib/usecase/operation-plan.js';
import type { DataTableSpec } from '../../../../lib/model/data/types.js';
import { RESEND_INPUT_MISMATCH, RESEND_SIGNAL_SETTING } from '../../../../lib/sql/rpc-resend.js';
import { handwrittenResendExpectation } from '../../../../lib/sql/rpc-resend-handwritten.js';
import type { ResolvedParam } from '../../../../lib/usecase/param-source.js';
import { stubGuards } from '../../../helpers/model-builder.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
  entitySpec,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';
import * as v7 from '../../../helpers/model-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { actorBindStatement } from '../../../../lib/sql/rpc-transition-columns.js';
import type { ActionSpecModel } from '../../../../lib/model/trace/types.js';

/** entry の writes は状態で変わる(= 楽観的並行制御が要る)。venue の writes は条件を持たない。 */
const DOMAIN = specModel({
  aggregates: [
    aggregate({
      name: 'entry',
      entity: entitySpec('entry', []),
      access: accessSpec('entry', {
        writes: [writeRule('entry_owner', ['note', 'kind'], 'state == draft')],
      }),
    }),
    aggregate({
      name: 'venue',
      entity: entitySpec('venue', []),
      access: accessSpec('venue', { writes: [writeRule('staff', ['name', 'address'])] }),
    }),
  ],
});

/** 従属集約の形: creates / deletes が親の状態を条件にする（判断が古びうる）。 */
const GUARDED_DOMAIN = specModel({
  aggregates: [
    aggregate({
      name: 'entry',
      entity: entitySpec('entry', []),
      access: accessSpec('entry', {
        creates: [createRule('member', 'workshop.state == accepting')],
        deletes: [deleteRule('entry_owner', 'state == draft')],
      }),
    }),
  ],
});

/** 指定したドメインで生成本文を 1 つだけ取り出す。 */
function renderWith(domain: SpecModel, model: DataTableSpecModel): string {
  const sections = rpcExpectationsGenerator.generate(domain, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    guards: stubGuards(),
    dataTables: model,
  });
  expect(sections).toHaveLength(1);
  return sections[0]?.content ?? '';
}

/** 生成本文を 1 つだけ取り出す短縮形。 */
function render(model: DataTableSpecModel): string {
  return renderWith(DOMAIN, model);
}

describe('code-rpc-expectations', () => {
  it('shape: update は writes の和を許可列に持ち、条件つきの規則があれば OCC を要求する', () => {
    const content = render(
      dataTableModel([
        dataTable('entries', {
          entity: 'entry',
          functions: [
            {
              name: 'update_entry',
              args: ['uuid', 'text', 'jsonb', 'uuid'],
              params: ['p_a', 'p_b', 'p_c', 'p_d'],
              kind: 'rpc',
              shape: 'update',
              alsoWrites: ['domain_events'],
            },
          ],
        }),
      ]),
    );

    expect(content).toContain("columns: ['kind', 'note']");
    expect(content).toContain('optimisticLock: true');
    expect(content).toContain("alsoWrites: ['domain_events']");
  });

  it('writes に条件が 1 本も無ければ OCC は期待しない', () => {
    const content = render(
      dataTableModel([
        dataTable('venues', {
          entity: 'venue',
          functions: [
            { name: 'update_venue', args: ['uuid', 'jsonb', 'uuid'], params: ['p_a', 'p_b', 'p_c'], kind: 'rpc', shape: 'update', alsoWrites: [] },
          ],
        }),
      ]),
    );

    expect(content).toContain("columns: ['address', 'name']");
    expect(content).toContain('optimisticLock: false');
  });

  it('shape: transition は無条件に OCC を期待し、許可列は持たない', () => {
    const content = render(
      dataTableModel([
        dataTable('entries', {
          entity: 'entry',
          functions: [
            {
              name: 'apply_entry_transition',
              args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid'],
              params: ['p_a', 'p_b', 'p_c', 'p_d', 'p_e', 'p_f'],
              kind: 'rpc',
              shape: 'transition',
              alsoWrites: ['jobs', 'domain_events'],
            },
          ],
        }),
      ]),
    );

    expect(content).toContain('optimisticLock: true');
    expect(content).not.toContain('columns:');
    // 宣言順に依らず突き合わせられるよう、書き込み先は並べ替えて出す。
    expect(content).toContain("alsoWrites: ['domain_events', 'jobs']");
  });

  it('shape: composite は書き込み先だけを期待し、create / delete は when の有無で OCC が決まる', () => {
    const content = render(
      dataTableModel([
        dataTable('entries', {
          entity: 'entry',
          functions: [
            { name: 'insert_entry', args: ['uuid'], params: ['p_a'], kind: 'rpc', shape: 'create', alsoWrites: ['domain_events'] },
            { name: 'delete_entry', args: ['uuid'], params: ['p_a'], kind: 'rpc', shape: 'delete', alsoWrites: [] },
            { name: 'confirm_late_entry', args: ['uuid'], params: ['p_a'], kind: 'rpc', shape: 'composite', alsoWrites: ['jobs'] },
          ],
        }),
      ]),
    );

    // `creates` / `deletes` に `when` が 1 本も無いので、古びうる判断が存在しない。
    expect(content).toContain('optimisticLock: false');
    expect(content).not.toContain('optimisticLock: true');
    expect(content).not.toContain('columns:');
    expect(content).toContain("shape: 'composite'");
  });

  // 従属集約の作成・削除は親の状態を条件にする（判断が古びうる）。
  it('creates / deletes に when があれば create / delete も OCC を期待する', () => {
    const content = renderWith(
      GUARDED_DOMAIN,
      dataTableModel([
        dataTable('entries', {
          entity: 'entry',
          functions: [
            { name: 'insert_entry', args: ['uuid'], params: ['p_a'], kind: 'rpc', shape: 'create', alsoWrites: [] },
            { name: 'delete_entry', args: ['uuid'], params: ['p_a'], kind: 'rpc', shape: 'delete', alsoWrites: [] },
          ],
        }),
      ]),
    );

    expect(content).toContain('optimisticLock: true');
    expect(content).not.toContain('optimisticLock: false');
  });

  it('kind: rpc でない関数は期待表に現れない', () => {
    const content = render(
      dataTableModel([
        dataTable('entries', {
          entity: 'entry',
          functions: [
            { name: 'check_entry_capacity', args: [], params: [], kind: 'trigger', alsoWrites: [] },
            { name: 'update_entry', args: ['uuid'], params: ['p_a'], kind: 'rpc', shape: 'update', alsoWrites: [] },
          ],
        }),
      ]),
    );

    expect(content).not.toContain('check_entry_capacity');
    expect(content).toContain('update_entry');
  });

  it('RPC が 1 本も無ければ何も生成しない', () => {
    expect(
      rpcExpectationsGenerator.generate(DOMAIN, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
        guards: stubGuards(),
        dataTables: dataTableModel([dataTable('entries', { entity: 'entry' })]),
      }),
    ).toEqual([]);
  });

  it('data_table が 1 件も無ければ何も生成しない', () => {
    expect(
      rpcExpectationsGenerator.generate(DOMAIN, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards(), dataTables: dataTableModel([]) }),
    ).toEqual([]);
  });
});

/** 「この遷移はその列を決めない」引数 1 本。 */
function notWritten(name: string, field: string, contract: 'untouched' | 'cleared'): ResolvedParam {
  return { name, source: { kind: 'not_written', field, contract } };
}

/** 値を供給する引数 1 本(契約を持たない側の代表)。 */
function fromInput(name: string, field: string): ResolvedParam {
  return { name, source: { kind: 'input_field', field, type: { kind: 'string' } } };
}

describe('空を渡された列の扱い(イベント × 列)', () => {
  it('clears を宣言した遷移は代入、宣言していない遷移は coalesce を要求する', () => {
    expect(
      eventColumnContracts([
        { op: 'link.unlink', params: [notWritten('p_member_id', 'member_id', 'cleared')] },
        { op: 'link.pause', params: [notWritten('p_member_id', 'member_id', 'untouched')] },
      ]),
    ).toEqual({
      'link.unlink': { member_id: 'assign' },
      'link.pause': { member_id: 'coalesce' },
    });
  });

  it('同じ列に別々の契約を要求する遷移が同居しても、片方に寄らない', () => {
    const contracts = eventColumnContracts([
      { op: 'link.unlink', params: [notWritten('p_member_id', 'member_id', 'cleared')] },
      { op: 'link.pause', params: [notWritten('p_member_id', 'member_id', 'untouched')] },
    ]);

    // 列単位に潰していたころは、この 2 つが `member_id: 'assign'` の 1 行になり、
    // 触れないはずの遷移がその列を消す形が黙って通っていた。
    const wanted = Object.values(contracts).map(
      (columns) => (columns as Readonly<Record<string, string>>)['member_id'],
    );
    expect(new Set(wanted)).toEqual(new Set(['assign', 'coalesce']));
  });

  it('値を供給する遷移は契約を持たない(空が届かないので扱いを要求しない)', () => {
    expect(
      eventColumnContracts([{ op: 'link.link', params: [fromInput('p_member_id', 'member_id')] }]),
    ).toEqual({});
  });

  it('契約を持つ遷移が 1 つも無ければ空になる', () => {
    expect(eventColumnContracts([])).toEqual({});
  });
});

describe('records_actor の縛りの期待は、本文の生成と同じ代入文の字面(点検 8 回目 A8-2)', () => {
  const ARCHIVE = v7.event('archive', { from: ['circulating'], to: 'archived', recordsActor: ['archived_by'] });
  const HANDOVER = v7.event('handover', { from: ['archived'], to: 'archived' });
  const machineSpec = v7.machine('document', { states: ['circulating', 'archived'], initial: 'circulating', events: [ARCHIVE, HANDOVER] });
  const domain = v7.specModel([
    v7.aggregate('document', {
      entity: v7.entitySpec('document', {
        fields: [
          v7.field('id', { kind: 'uuid' }, { auto: true }),
          v7.field('state', { kind: 'state', machine: 'document' }),
          v7.field('archived_by', { kind: 'ref', entity: 'member' }),
        ],
      }),
      stateMachines: [machineSpec],
    }),
  ]);
  const tables = dataTableModel([
    dataTable('documents', {
      entity: 'document',
      functions: [
        {
          name: 'apply_document_transition',
          args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'uuid'],
          params: ['p_document_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_archived_by'],
          kind: 'rpc',
          shape: 'transition',
          alsoWrites: [],
        },
      ],
    }),
  ]);
  const actionsOf = (input: readonly string[]): ActionSpecModel => ({
    actions: [actionSpec({ handles: 'document.handover', input: [...input] })],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  });

  it.each([
    { name: '記録するイベントだけ実行者・それ以外は null', input: ['document.id'] },
    { name: 'input で受けるイベントの枝つき', input: ['document.id', 'document.archived_by'] },
  ])('$name', ({ input }) => {
    const actions = actionsOf(input);
    const sections = rpcExpectationsGenerator.generate(domain, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards(), dataTables: tables, actions });
    const statement = actorBindStatement({ machine: machineSpec, column: 'archived_by', entity: 'document', actions });

    expect(statement).not.toBeNull();
    expect(sections[0]?.content ?? '').toContain(`archived_by: '${(statement ?? '').replace(/'/gu, "\\'")}'`);
  });
});

/**
 * 本文が手書きの作成 RPC に付く、再送の入力の比べの期待(点検 20 回目 B20-1 の残り)。対象の条件(手書き・作成の操作の RPC・
 * 再送で既存の行を返す表)の 1 つでも欠ければ付かないこと、比べる列が入力の欄から引かれトリガの供給列と id を除くことを表で固定する。
 */
describe('handwrittenResendExpectation', () => {
  const field = (name: string): { readonly name: string } => ({ name });
  /** 作成の操作 1 本(実行計画の最初の手順の形・呼ぶ RPC・入力の引数だけを持つ)。 */
  const operation = (rpcName: string, kind: string, params: readonly unknown[]): Pick<BuiltOperation, 'plan' | 'params'> =>
    ({ plan: { rpcName, steps: [{ kind }] }, params }) as unknown as Pick<BuiltOperation, 'plan' | 'params'>;
  const values = { name: 'p_values', source: { kind: 'input_values', fields: [field('title'), field('capacity'), field('reminder_at'), field('id')] } };
  const venue = { name: 'p_venue_id', source: { kind: 'input_field', field: 'venue_id' } };
  const actor = { name: 'p_organizer_id', source: { kind: 'actor' } };
  const table = (returnsExisting: boolean | undefined): Pick<DataTableSpec, 'resend' | 'triggers'> =>
    ({
      ...(returnsExisting === undefined ? {} : { resend: { returnsExisting, location: { file: 't.md', line: 1 } } }),
      triggers: [{ name: 'fill', functionName: 'fill', supplies: ['reminder_at'] }],
    }) as unknown as Pick<DataTableSpec, 'resend' | 'triggers'>;
  const HANDWRITTEN = { name: 'insert_t' };

  it('手書きの作成 RPC には、拒否の語と入力の欄(トリガの供給列と id を除く・辞書順)と再送の印(点検 22 回目 A22-1)と消された後の押し直しの語(点検 23 回目 O23-2)が付く', () => {
    expect(handwrittenResendExpectation(HANDWRITTEN, table(true), [operation('insert_t', 'create', [actor, values, venue])])).toEqual({
      word: RESEND_INPUT_MISMATCH,
      compared: ['capacity', 'title', 'venue_id'],
      signal: RESEND_SIGNAL_SETTING,
      deleted: 'resend_target_deleted',
    });
  });

  it.each([
    { label: '本文が生成物(migration がある)', fn: { name: 'insert_t', migration: '1_rpc_insert_t.sql' }, returnsExisting: true, ops: [operation('insert_t', 'create', [values])] },
    { label: '再送で既存の行を返さない表', fn: HANDWRITTEN, returnsExisting: false, ops: [operation('insert_t', 'create', [values])] },
    { label: 'resend の宣言が無い表', fn: HANDWRITTEN, returnsExisting: undefined, ops: [operation('insert_t', 'create', [values])] },
    { label: '作成の操作の RPC ではない(遷移)', fn: HANDWRITTEN, returnsExisting: true, ops: [operation('insert_t', 'transition', [values])] },
    { label: 'どの操作も呼ばない', fn: HANDWRITTEN, returnsExisting: true, ops: [operation('insert_other', 'create', [values])] },
  ])('付かない: $label', ({ fn, returnsExisting, ops }) => {
    expect(handwrittenResendExpectation(fn, table(returnsExisting), ops)).toBeNull();
  });
});
