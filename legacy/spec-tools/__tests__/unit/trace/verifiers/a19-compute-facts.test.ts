/**
 * A19(計算の材料 —— `computes` の純関数に届く事実が宣言されている)の規約網羅テスト。
 *
 * 見るのは 3 つ。`reads` の欄が実在すること(error)/ その欄が**その操作の計画の読み取りに
 * 載る**こと(error)/ `reads` を 1 本も宣言していない計算を報告すること(warning)である。
 * 「材料が足りている」は機械には言えない —— 言えるのはこの 3 つまでで、境界はここで固定する。
 */

import { describe, expect, it } from 'vitest';
import type { AggregateSpecs, FieldDef, SpecModel } from '../../../../lib/model/types.js';
import type { DataTableSpec, DataTableSpecModel } from '../../../../lib/model/data/types.js';
import { buildOperationPlans } from '../../../../lib/usecase/operation-plan.js';
import { computeFactsVerifier } from '../../../../lib/trace/verifiers/a19-compute-facts.js';
import { jobModelOf } from '../../../../lib/trace/input.js';
import { actionSpec, traceInput } from '../../../helpers/trace-builder.js';
import { A19_REASONS } from '../../../../lib/trace/compute-reasons.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  invariant,
  invariantSpec,
  machine,
  role,
  specModel,
  stubContext,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';

/** widget(対象)・gadget(1 段先で読める相手)・orphan(どこからも辿れない)・子 2 種(part / memo)。 */
function domainWith(
  init: {
    /** widget に足す欄(親の側の道を作る: 子への ref など)。 */
    readonly widgetFields?: readonly FieldDef[];
    /** widget の context に足すキー(親の側の道を作る)。 */
    readonly widgetContext?: Readonly<Record<string, string>>;
    /** 足す集約(判定の材料にする子)。 */
    readonly extra?: readonly AggregateSpecs[];
  } = {},
): SpecModel {
  return specModel({
    roles: [role('anonymous'), role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'widget',
        entity: entitySpec(
          'widget',
          [
            field('state', { kind: 'state', machine: 'widget' }, { required: true }),
            field('gadget_id', { kind: 'ref', entity: 'gadget' }, { required: true }),
            field('amount', { kind: 'integer' }),
            field('score', { kind: 'integer' }),
            ...(init.widgetFields ?? []),
          ],
          { gadget: 'widget.gadget_id', ...init.widgetContext },
        ),
        stateMachines: [
          machine({
            machine: 'widget',
            states: ['draft', 'sent'],
            initial: 'draft',
            events: [event({ id: 'send', from: ['draft'], to: 'sent', by: ['member'] })],
          }),
        ],
        access: accessSpec('widget', { writes: [writeRule('system', ['amount'])] }),
      }),
      aggregate({ name: 'gadget', entity: entitySpec('gadget', [field('label', { kind: 'string' })]) }),
      aggregate({ name: 'orphan', entity: entitySpec('orphan', [field('note', { kind: 'string' })]) }),
      // widget の子(context で widget へ辿れる。ref の欄も持つ)
      aggregate({
        name: 'part',
        entity: entitySpec(
          'part',
          [field('widget_id', { kind: 'ref', entity: 'widget' }, { required: true }), field('size', { kind: 'integer' })],
          { widget: 'part.widget_id' },
        ),
      }),
      // widget の子(ref の欄だけ。context は無い)
      aggregate({
        name: 'memo',
        entity: entitySpec('memo', [
          field('widget_id', { kind: 'ref', entity: 'widget' }, { required: true }),
          field('rank', { kind: 'integer' }),
        ]),
      }),
      // widget の子(context だけ。参照の欄は ref ではなく素の文字列 = context の枝だけが親子を言う)
      aggregate({
        name: 'note',
        entity: entitySpec(
          'note',
          [field('widget_key', { kind: 'string' }), field('body', { kind: 'string' })],
          { widget: 'note.widget_key' },
        ),
      }),
      ...(init.extra ?? []),
    ],
  });
}

/** 既定の領域(親から子への道は無い)。 */
const DOMAIN = domainWith();

/** widget の子 `slot`(widget への ref の欄を持つ)。不変条件・表の一意で 1:1 にもできる。 */
function slotAggregate(invariants: ReturnType<typeof invariant>[] = []): AggregateSpecs {
  return aggregate({
    name: 'slot',
    entity: entitySpec('slot', [
      field('widget_id', { kind: 'ref', entity: 'widget' }, { required: true }),
      field('size', { kind: 'integer' }),
    ]),
    ...(invariants.length === 0 ? {} : { invariants: invariantSpec(invariants) }),
  });
}

/** 遷移 RPC 1 本(規約に載る引数 + 計算値を受け取る `p_amount`)。 */
function tablesWith(extra: readonly DataTableSpec[] = []): DataTableSpecModel {
  const overridden = new Set(extra.map((table) => table.entity));
  return dataTableModel([
    dataTable('widgets', {
      entity: 'widget',
      functions: [
        {
          name: 'apply_widget_transition',
          args: ['text', 'text', 'text', 'text', 'text', 'text', 'text'],
          params: [
            'p_widget_id',
            'p_expected_state',
            'p_next_state',
            'p_effects',
            'p_event_id',
            'p_actor_id',
            'p_amount',
          ],
          kind: 'rpc',
          shape: 'transition',
          alsoWrites: [],
        },
      ],
    }),
    dataTable('gadgets', { entity: 'gadget', functions: [] }),
    dataTable('orphans', { entity: 'orphan', functions: [] }),
    dataTable('parts', { entity: 'part', functions: [] }),
    dataTable('memos', { entity: 'memo', functions: [] }),
    dataTable('notes', { entity: 'note', functions: [] }),
    dataTable('slots', { entity: 'slot', functions: [] }),
  ].filter((table) => !overridden.has(table.entity)).concat(extra));
}

/** 検証の入力(`reads` を宣言した widget.send)。 */
function inputFor(reads: readonly string[], init: { manual?: boolean; domain?: SpecModel; tables?: DataTableSpecModel } = {}) {
  const { guards } = stubContext();
  return traceInput({
    domain: init.domain ?? DOMAIN,
    guards,
    dataTables: init.tables ?? tablesWith(),
    actions: [
      actionSpec({
        handles: 'widget.send',
        input: ['widget.id'],
        computes: { 'widget.amount': 'computeAmount' },
        computeReads: { 'widget.amount': reads },
        ...(init.manual === true ? { runner: { reason: '定型に乗らない RPC' } } : {}),
      }),
    ],
  });
}

/** `reads` を宣言した widget.send について A19 を実行する。 */
function verify(reads: readonly string[], init: { manual?: boolean; domain?: SpecModel; tables?: DataTableSpecModel } = {}) {
  return computeFactsVerifier.verify(inputFor(reads, init));
}

describe('A19 計算の材料', () => {
  it('計画から読める欄を宣言していれば何も言わない', () => {
    expect(verify(['widget.score', 'gadget.label'])).toEqual([]);
  });

  it('実在しない欄を宣言したら error(綴りの誤りは材料を運ばない)', () => {
    const findings = verify(['widget.missing']);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('widget.missing');
    expect(findings[0]?.message).toContain('実在しません');
  });

  it('計画から読めない集約を宣言したら error(宣言しても届かない)', () => {
    const findings = verify(['orphan.note']);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('orphan.note');
    expect(findings[0]?.message).toContain('実行計画から読めません');
  });

  it('対象を親として参照する子の集合(context で辿れる側)を宣言したら、理由つきの warning(error ではない)', () => {
    const findings = verify(['part.size']);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.reason).toBe(A19_REASONS.childSetRead);
    expect(findings[0]?.message).toContain('part.size');
    expect(findings[0]?.message).toContain('子の行の集合');
    expect(findings[0]?.suggestion).toContain('X-child-set-reads');
    expect(findings[0]?.suggestion).toContain('runner: manual');
  });

  it('子の判定は ref の欄だけでも成り立つ(context が無くても、親を指す ref の欄があれば子の集合)', () => {
    const findings = verify(['memo.rank']);

    expect(findings.map((f) => f.severity)).toEqual(['warning']);
    expect(findings[0]?.reason).toBe(A19_REASONS.childSetRead);
  });

  it('子の集合と届かない欄を並べたら、子だけが warning・届かない欄は error のまま(境界)', () => {
    const findings = verify(['part.size', 'orphan.note']);

    expect(findings.map((f) => `${f.severity}:${f.message.includes('part.size') ? 'part' : 'orphan'}`)).toEqual([
      'warning:part',
      'error:orphan',
    ]);
    expect(findings[1]?.reason).toBeUndefined();
  });

  it('子の集合の材料は、生成器が計画の読み取りに積まない・throw もしない(材料は届かないまま)', () => {
    const input = inputFor(['part.size', 'widget.score']);
    const build = () =>
      buildOperationPlans({
        domain: input.domain,
        guards: stubContext().guards,
        dataTables: tablesWith(),
        actions: input.actions,
        jobs: jobModelOf(input),
      });

    expect(build).not.toThrow();
    const plan = build().operations.find((operation) => operation.op === 'widget.send');
    const read = plan?.facts.reads.flatMap((entry) => entry.fields.map((field) => `${entry.entity}.${field}`));
    // 子(part)は積まれない。同じ宣言の自集約の欄(widget.score)は積まれる = 積む仕組み自体は生きている
    expect(read).toContain('widget.score');
    expect(read?.some((key) => key.startsWith('part.'))).toBe(false);
  });

  it('context だけで親を指す子(ref の欄が無い)も子の集合 = warning(context の枝を単独で見る)', () => {
    const findings = verify(['note.body']);

    expect(findings.map((f) => f.severity)).toEqual(['warning']);
    expect(findings[0]?.reason).toBe(A19_REASONS.childSetRead);
  });

  it('親が子を ref の欄で指す(双方向)なら error のまま(1 行に絞る道が親側にある)', () => {
    const domain = domainWith({
      widgetFields: [field('main_slot_id', { kind: 'ref', entity: 'slot' })],
      extra: [slotAggregate()],
    });
    const findings = verify(['slot.size'], { domain });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.reason).toBeUndefined();
    expect(findings[0]?.message).toContain('実行計画から読めません');
    // 直し方(context を宣言して 1 段で辿れるようにする)が消えない
    expect(findings[0]?.suggestion).toContain('context');
  });

  it('親の context に子へのキーがあれば、計画が辿れない形でも error のまま', () => {
    // キーは子を指すが、参照パスの先頭が親の集約でないので計画は辿れない(= 直す道が親の側に実在する形)
    const domain = domainWith({ widgetContext: { slot: 'gadget.slot_id' }, extra: [slotAggregate()] });
    const findings = verify(['slot.size'], { domain });

    expect(findings.map((f) => f.severity)).toEqual(['error']);
    expect(findings[0]?.reason).toBeUndefined();
  });

  it('親の欄の ref も context も子を指さなければ、同じ子は warning(道が無い = 集合)', () => {
    const findings = verify(['slot.size'], { domain: domainWith({ extra: [slotAggregate()] }) });

    expect(findings.map((f) => f.severity)).toEqual(['warning']);
  });

  it('子の親への参照が一意(uniqueness の不変条件)なら 1:1 = 1 行で、error のまま', () => {
    const oneToOne = invariant({
      id: 'INV-SLOT-001',
      formal: { kind: 'uniqueness', keys: ['widget_id'] },
    });
    const findings = verify(['slot.size'], { domain: domainWith({ extra: [slotAggregate([oneToOne])] }) });

    expect(findings.map((f) => f.severity)).toEqual(['error']);
    expect(findings[0]?.reason).toBeUndefined();
  });

  it('子の親への参照が一意(data_table の一意索引)なら 1:1 = 1 行で、error のまま', () => {
    const tables = tablesWith([
      dataTable('slots', {
        entity: 'slot',
        indexes: [{ name: 'slots_widget_unique', on: ['widget_id'], unique: true }],
      }),
    ]);
    const findings = verify(['slot.size'], { domain: domainWith({ extra: [slotAggregate()] }), tables });

    expect(findings.map((f) => f.severity)).toEqual(['error']);
  });

  it('複合の鍵・限定つきの一意は 1:1 ではない(親 1 行に子が複数行ありうる)ので warning のまま', () => {
    const composite = invariant({ id: 'INV-SLOT-002', formal: { kind: 'uniqueness', keys: ['widget_id', 'size'] } });
    const partial = invariant({
      id: 'INV-SLOT-003',
      formal: { kind: 'uniqueness', keys: ['widget_id'], where: 'slot.size > 0' },
    });
    const tables = tablesWith([
      dataTable('slots', {
        entity: 'slot',
        indexes: [{ name: 'slots_widget_partial', on: ['widget_id'], unique: true, where: 'size > 0' }],
      }),
    ]);
    const domain = domainWith({ extra: [slotAggregate([composite, partial])] });

    expect(verify(['slot.size'], { domain, tables }).map((f) => f.severity)).toEqual(['warning']);
  });

  it('reads を 1 本も宣言していない計算は warning で報告する', () => {
    const findings = verify([]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('computeAmount');
    // 宣言が無い警告は理由の欄を持たない(compute_child_set に当たらない)
    expect(findings[0]?.reason).toBeUndefined();
  });

  it('runner: manual の操作は計画を持たないので、計画を母集合とする 2 つは見ない', () => {
    expect(verify([], { manual: true })).toEqual([]);
    // 綴りの誤りはどちらでも嘘なので、実在だけは見る。
    expect(verify(['widget.missing'], { manual: true })).toHaveLength(1);
  });
});
