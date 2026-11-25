/**
 * 凍結のトリガ(`triggers[].freezes`。`sql/ddl-freeze-triggers.ts`。点検 fix26 2 回目)のユニットテスト。
 *
 * 固定するのは: 本文の字面(`after update`・列を絞らない・`is distinct from`・不変条件の違反の口)・`generatedTriggers` の 6 番目の家族として出ること・
 * 宣言が通らない形の閉じた表(凍らせた列を書き換える宣言・外部キーの set null / set default・発火の形・供給との併記・欄の外)・
 * 端の覆いが凍らせた列の `update of` の端を消すこと・T17 がその宣言を赤にすること。
 */

import { describe, expect, it } from 'vitest';
import { freezeProblemsOf, freezeTriggersIn } from '../../../lib/sql/ddl-freeze-triggers.js';
import { generatedTriggers } from '../../../lib/sql/ddl-triggers.js';
import { invariantEdgeGapsOf } from '../../../lib/sql/ddl-ref-check-edges.js';
import { verifyTriggerBody } from '../../../lib/data/verifiers/t17-trigger-body.js';
import type { DataTableSpec, DataTriggerDecl } from '../../../lib/model/data/types.js';
import type { SpecModel } from '../../../lib/model/types.js';
import { accessSpec, aggregate, create, entitySpec, event, field, loc, machine, specModel, write } from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { actionSpec } from '../../helpers/trace-builder.js';

/** 店(shop)と、店を指す棚(shelf)。棚の不変条件は店の欄を読む(端の覆いを見るため)。 */
function domain(opts: { readonly writes?: readonly string[]; readonly transitionWrites?: readonly string[]; readonly recordsActor?: readonly string[]; readonly clears?: readonly string[] } = {}): SpecModel {
  return specModel([
    aggregate('shop', {
      entity: entitySpec('shop', { fields: [field('id', { kind: 'uuid' }), field('open', { kind: 'boolean' })] }),
    }),
    aggregate('shelf', {
      entity: entitySpec('shelf', {
        context: { shelf: 'shelf.id', shop: 'shelf.shop_id' },
        fields: [
          field('id', { kind: 'uuid' }),
          field('shop_id', { kind: 'ref', entity: 'shop' }, { required: true }),
          field('label', { kind: 'string' }),
          field('code', { kind: 'string' }),
          field('state', { kind: 'state', machine: 'shelf' }),
          field('contact', { kind: 'string' }, { personal: true, personalPlaceholder: '(消去済み)' }),
          field('starts_at', { kind: 'datetime' }),
          { ...field('ends_at', { kind: 'datetime' }), suppliedBy: 'db' as const },
          { ...field('position', { kind: 'integer' }), suppliedBy: 'db' as const },
        ],
      }),
      access: accessSpec('shelf', { creates: [create('member')], writes: [write('member', ['label', ...(opts.writes ?? [])])], transitionWrites: opts.transitionWrites ?? [] }),
      stateMachines: [
        machine('shelf', {
          states: ['draft', 'done'],
          initial: 'draft',
          events: [
            event('finish', {
              from: ['draft'],
              to: 'done',
              ...(opts.recordsActor === undefined ? {} : { recordsActor: opts.recordsActor }),
              ...(opts.clears === undefined ? {} : { clears: opts.clears }),
            }),
          ],
        }),
      ],
      invariants: invariantSpec([
        invariant({ id: 'INV-SHELF-001', entities: ['shelf', 'shop'], statement: '棚は開いた店にだけ置く', formal: { kind: 'check', expr: 'shop.open == true' }, enforcedBy: [{ kind: 'trigger', ref: 'check_shelf_shop', location: loc() }] }),
      ]),
    }),
  ]);
}

/** 凍結のトリガの宣言。 */
function freeze(extra: Partial<DataTriggerDecl> = {}): DataTriggerDecl {
  return { name: 'freeze_shelves', functionName: 'freeze_shelves', fires: 'after update', deferred: false, supplies: [], params: {}, freezes: ['shop_id'], ...extra };
}

/** 棚の表(凍結のトリガと、行の側の条件のトリガ)。 */
function shelves(trigger: DataTriggerDecl = freeze(), extra: Partial<DataTableSpec> = {}): DataTableSpec {
  return dataTable('shelves', {
    entity: 'shelf',
    triggers: [trigger, { name: 'check_shelf_shop', functionName: 'check_shelf_shop', fires: 'before insert', deferred: false, supplies: [], params: {}, invariant: 'INV-SHELF-001' }],
    functions: [
      { name: 'freeze_shelves', args: [], params: [], kind: 'trigger', alsoWrites: [], lookup: [] },
      { name: 'check_shelf_shop', args: [], params: [], kind: 'trigger', alsoWrites: [], lookup: [] },
    ] as unknown as DataTableSpec['functions'],
    ...extra,
  });
}

const SHOPS = dataTable('shops', { entity: 'shop' });

/** 凍結のトリガに並べて、別のトリガ(供給・導出)を足した棚の表。 */
function shelvesWith(trigger: DataTriggerDecl, other: DataTriggerDecl): DataTableSpec {
  const base = shelves(trigger);
  return { ...base, triggers: [...base.triggers, other] };
}

/** 別のトリガ 1 本(既定は供給だけ)。 */
function supplier(extra: Partial<DataTriggerDecl>): DataTriggerDecl {
  return { name: 'supply_shelves', functionName: 'supply_shelves', fires: 'before insert or update', deferred: false, supplies: [], params: {}, ...extra };
}

/** 導出の先・元(`follow` は元の列の更新で引き直す)。 */
const FOLLOW = supplier({ fires: 'before insert or update of starts_at', supplies: ['ends_at'], derives: [{ column: 'ends_at', from: 'starts_at', offset: '+1 hour', mode: 'follow' }] });
/** 末尾の番号の差し込み(同じ店の後ろの行の番号をずらす)。 */
const INSERT_AT = supplier({ fires: 'before insert', supplies: ['position'], derives: [{ column: 'position', within: 'shop_id', mode: 'insert_at' }] });

describe('凍結のトリガの本文(freezeTriggersIn)', () => {
  it('after update の行トリガで、列を絞らず、OLD と NEW を is distinct from で比べ、違えば不変条件の違反の口で断る', () => {
    const [trigger] = freezeTriggersIn(shelves(freeze({ freezes: ['shop_id', 'code'], invariant: 'INV-SHELF-001' })), domain());
    expect(trigger?.fires).toBe('after update');
    expect(trigger?.fires).not.toMatch(/\bof\b/u);
    expect(trigger?.deferred).toBeUndefined();
    expect(trigger?.function.securityDefiner).toBeUndefined();
    expect(trigger?.function.body).toEqual([
      'if new.shop_id is distinct from old.shop_id or new.code is distinct from old.code then',
      '    raise exception using',
      "        message = 'freeze_shelves: INV-SHELF-001: shop_id, code は作成の後に変えられません',",
      "        errcode = 'check_violation',",
      "        constraint = 'freeze_shelves';",
      'end if;',
      'return null;',
    ]);
    expect(trigger?.function.comment).toBe('作成の後に変えない列を凍らせる(shop_id, code)');
  });

  it('由来の不変条件を書かない凍結は、文面の不変条件 ID の位置に frozen を置く', () => {
    const [trigger] = freezeTriggersIn(shelves(), domain());
    expect(trigger?.function.body[2]).toBe("        message = 'freeze_shelves: frozen: shop_id は作成の後に変えられません',");
  });

  it('generatedTriggers の家族として出る(data-table-parity の本文の md5 の期待値はこの列から作られる)', () => {
    expect(generatedTriggers(shelves(), domain(), [shelves(), SHOPS]).map((trigger) => trigger.name)).toContain('freeze_shelves');
  });

  it('宣言が通らなければ出さない(部分的な本文は出さない)', () => {
    expect(freezeTriggersIn(shelves(freeze({ fires: 'after update of shop_id' })), domain())).toEqual([]);
  });
});

describe('凍結の宣言が通らない形(freezeProblemsOf。閉じた表)', () => {
  it('通る形: after update・欄の列・書き換える宣言なし・外部キーは restrict', () => {
    expect(freezeProblemsOf(freeze(), shelves(freeze(), { foreignKeys: [{ column: 'shop_id', references: 'shops', onDelete: 'restrict' }] }), domain())).toEqual([]);
  });

  it.each<[string, DataTriggerDecl, SpecModel, Partial<DataTableSpec>, string]>([
    ['update of で列を絞る', freeze({ fires: 'after update of shop_id' }), domain(), {}, 'fires は "after update"'],
    ['before のトリガ', freeze({ fires: 'before update' }), domain(), {}, 'fires は "after update"'],
    ['挿入でも発火する', freeze({ fires: 'after insert or update' }), domain(), {}, 'fires は "after update"'],
    ['文ごとのトリガ', freeze({ fires: 'after update for each statement' }), domain(), {}, 'fires は "after update"'],
    ['コミット時の制約トリガ', freeze({ deferred: true }), domain(), {}, 'fires は "after update"'],
    ['凍らせる列が無い', freeze({ freezes: [] }), domain(), {}, '1 つも無い'],
    ['欄に無い列', freeze({ freezes: ['nope'] }), domain(), {}, 'nope が shelves の欄'],
    ['主キー', freeze({ freezes: ['id'] }), domain(), {}, 'id が shelves の欄'],
    ['状態の欄', freeze({ freezes: ['state'] }), domain(), {}, '状態の欄'],
    ['writes にある別の列', freeze({ freezes: ['label'] }), domain(), {}, '書き換える宣言がある'],
    ['値を供給する', freeze({ supplies: ['shop_id'] }), domain(), {}, '値を供給しない'],
    ['access_spec の writes にある', freeze(), domain({ writes: ['shop_id'] }), {}, '書き換える宣言がある'],
    ['transition_writes にある', freeze(), domain({ transitionWrites: ['shop_id'] }), {}, '書き換える宣言がある'],
    ['遷移の records_actor にある', freeze(), domain({ recordsActor: ['shop_id'] }), {}, '書き換える宣言がある'],
    ['遷移の clears にある', freeze(), domain({ clears: ['shop_id'] }), {}, '書き換える宣言がある'],
    ['外部キーが set_null', freeze(), domain(), { foreignKeys: [{ column: 'shop_id', references: 'shops', onDelete: 'set_null' }] }, 'on_delete: set_null'],
    ['外部キーが set_default', freeze(), domain(), { foreignKeys: [{ column: 'shop_id', references: 'shops', onDelete: 'set_default' }] }, 'on_delete: set_default'],
  ])('赤: %s', (_name, trigger, model, extra, reason) => {
    const problems = freezeProblemsOf(trigger, shelves(trigger, extra), model);
    expect(problems.map((problem) => problem.reason).join(' / ')).toContain(reason);
  });

  // 作成の後に書き換える宣言のうち、凍結にだけ要るもの(点検 fix26 3 回目 D26c-3。持ち主は model/written-after-create.ts の rewritesOfFrozen)。
  it.each<[string, DataTriggerDecl, DataTableSpec, string]>([
    ['個人列(消去の匿名化が書く)', freeze({ freezes: ['contact'] }), shelves(freeze({ freezes: ['contact'] })), 'は個人列'],
    ['follow の導出の先(元の列は凍っていない)', freeze({ freezes: ['ends_at'] }), shelvesWith(freeze({ freezes: ['ends_at'] }), FOLLOW), '元の列 starts_at'],
    ['末尾の番号の insert_at(差し込みが番号を振り直す)', freeze({ freezes: ['position'] }), shelvesWith(freeze({ freezes: ['position'] }), INSERT_AT), 'insert_at'],
    ['列を名指さない更新で発火する供給', freeze({ freezes: ['code'] }), shelvesWith(freeze({ freezes: ['code'] }), supplier({ supplies: ['code'] })), '元の列 全部'],
    ['列の名指しと名指さない更新の混在(広い側に読む)', freeze({ freezes: ['shop_id', 'code'] }), shelvesWith(freeze({ freezes: ['shop_id', 'code'] }), supplier({ fires: 'before update of shop_id or update', supplies: ['code'] })), '元の列 全部'],
    ['見ている元の列の一部だけが凍っている供給', freeze({ freezes: ['shop_id', 'code'] }), shelvesWith(freeze({ freezes: ['shop_id', 'code'] }), supplier({ fires: 'before insert or update of shop_id, label', supplies: ['code'] })), '元の列 shop_id, label'],
  ])('赤: %s', (_name, trigger, table, reason) => {
    expect(freezeProblemsOf(trigger, table, domain()).map((problem) => problem.reason).join(' / ')).toContain(reason);
  });

  it('赤: 作成でない操作の computes が書く列(action_spec を渡したときだけ見る。作成の computes は数えない)', () => {
    const trigger = freeze({ freezes: ['code'] });
    const update = [actionSpec({ handles: 'shelf.update', computes: { 'shelf.code': 'shelfCode' } })];
    expect(freezeProblemsOf(trigger, shelves(trigger), domain(), update).map((problem) => problem.reason).join(' / ')).toContain('computes が書く');
    expect(freezeProblemsOf(trigger, shelves(trigger), domain(), [actionSpec({ handles: 'shelf.create', computes: { 'shelf.code': 'shelfCode' } })])).toEqual([]);
  });

  it('通る: 供給が見ている元の列が全部凍っていれば数えない(写しは値を変えない)・挿入でしか発火しない供給も数えない', () => {
    const both = freeze({ freezes: ['shop_id', 'code'] });
    expect(freezeProblemsOf(both, shelvesWith(both, supplier({ fires: 'before insert or update of shop_id', supplies: ['code'] })), domain())).toEqual([]);
    const code = freeze({ freezes: ['code'] });
    expect(freezeProblemsOf(code, shelvesWith(code, supplier({ fires: 'before insert', supplies: ['code'] })), domain())).toEqual([]);
  });
});

describe('端の覆い(invariantEdgeGapsOf)と T17', () => {
  it('凍らせた列の update of の端は覆われる(凍らせなければ、行の側が挿入しか見ないので update of shop_id が開く)', () => {
    const plain = shelves(freeze({ freezes: ['code'] }));
    expect(invariantEdgeGapsOf(domain(), [plain, SHOPS]).map((gap) => `${gap.table} ${gap.edge}`)).toContain('shelves update of shop_id');
    expect(invariantEdgeGapsOf(domain(), [shelves(), SHOPS]).map((gap) => `${gap.table} ${gap.edge}`)).not.toContain('shelves update of shop_id');
  });

  it.each<[string, DataTriggerDecl, SpecModel]>([
    ['通らない宣言(凍らせた列を writes が書く)', freeze(), domain({ writes: ['shop_id'] })],
    ['凍結の関数が handwritten(本文を生成しない。T17 は手書きの migration の実在だけを見る)', freeze(), domain()],
  ])('凍結を覆いに数えないもの(本文を生成できない宣言。点検 fix26 3 回目 D26c-4): %s', (name, trigger, model) => {
    const base = shelves(trigger);
    const table = name.includes('handwritten')
      ? { ...base, functions: base.functions.map((fn) => (fn.name === 'freeze_shelves' ? { ...fn, handwritten: '手書きの migration が同じ関数を作っている' } : fn)) }
      : base;
    expect(freezeTriggersIn(table, model)).toEqual([]);
    expect(invariantEdgeGapsOf(model, [table, SHOPS]).map((gap) => `${gap.table} ${gap.edge}`)).toContain('shelves update of shop_id');
  });

  it('T17: 凍らせた列が access_spec の writes にあれば、本文を生成できない理由として赤にする(宣言の値だけを見る)', () => {
    const findings = verifyTriggerBody(domain({ writes: ['shop_id'] }), dataTableModel([shelves(), SHOPS]), undefined, TEST_ROOTS);
    expect(findings.filter((finding) => finding.message.includes('freeze_shelves')).map((finding) => finding.message).join('\n')).toContain('書き換える宣言がある');
    const clean = verifyTriggerBody(domain(), dataTableModel([shelves(), SHOPS]), undefined, TEST_ROOTS);
    expect(clean.filter((finding) => finding.message.includes('freeze_shelves'))).toEqual([]);
  });
});
