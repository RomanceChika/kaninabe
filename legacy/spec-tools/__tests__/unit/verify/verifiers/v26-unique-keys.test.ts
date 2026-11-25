/**
 * V26 の一意の範囲(`v26-unique-keys.ts`。点検 12 回目 A12-3)のテスト。
 *
 * 表: 鍵の形(境界の列・境界へ届く参照の欄の有無)× 人の入力で書けるか(作成・編集・遷移・内部実行)× 受け入れ(`formal.global_key`)。
 */

import { describe, expect, it } from 'vitest';
import { checkUniqueKeys } from '../../../../lib/verify/verifiers/v26-unique-keys.js';
import { tenantWriteBoundaryVerifier } from '../../../../lib/verify/verifiers/v26-tenant-write-boundary.js';
import { boundaryFields } from '../../../../lib/verify/verifiers/tenant-boundary-model.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import type { InvariantDef, SpecModel } from '../../../../lib/model/types.js';
import type { GlobalKeyAccept } from '../../../../lib/model/parse-global-key.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import { accessSpec, aggregate, createRule, entitySpec, event, field, invariant, invariantSpec, machine, readRule, role, specModel, stubContext, writeRule } from '../../../helpers/model-builder-v8plus.js';
import { loadedInput } from '../../../helpers/verify-inputs.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { loc } from '../../../helpers/model-builder.js';
import type { DataIndexDecl } from '../../../../lib/model/data/types-shape.js';

const COMPANY = { kind: 'ref', entity: 'company' } as const;
const SYSTEM = 'system';
const ACCEPT = { keys: ['sku'], reason: '理由' };

interface Init {
  readonly keys?: readonly string[];
  readonly kind?: 'uniqueness' | 'cardinality' | 'exclusion';
  readonly globalKey?: GlobalKeyAccept;
  readonly creator?: string | null;
  readonly writer?: string | null;
  readonly input?: readonly string[];
  readonly eventBy?: string;
  readonly single?: boolean;
  readonly dbSupplied?: boolean;
  /** 作成の `computes` で埋める欄(点検 13 回目 A13-3)。 */
  readonly computes?: readonly string[];
  /** 表の索引(点検 13 回目 A13-1)。 */
  readonly indexes?: readonly DataIndexDecl[];
  /** `sku` を隠す相手(点検 13 回目 A13-5)。 */
  readonly hiddenFrom?: readonly string[];
}

/** 形式定義。 */
function formal(init: Init): NonNullable<InvariantDef['formal']> {
  const keys = init.keys ?? ['sku'];
  const accepted = init.globalKey === undefined ? {} : { globalKey: init.globalKey };
  if (init.kind === 'cardinality') return { kind: 'cardinality', keys, max: 3, ...accepted };
  if (init.kind === 'exclusion') return { kind: 'exclusion', keys, range: ['a', 'b'], ...accepted };
  return { kind: 'uniqueness', keys, ...accepted };
}

/** 会社の列を持つ商品・親の棚を持つ明細のモデル(`single` は境界の無い製品)。 */
function model(init: Init = {}): SpecModel {
  const creator = init.creator === undefined ? 'staff_member' : init.creator;
  const writer = init.writer === undefined ? null : init.writer;
  const flow = init.eventBy === undefined ? [] : [machine({ machine: 'product', states: ['a', 'b'], initial: 'a', events: [event({ id: 'rename', from: ['a'], to: 'b', by: [init.eventBy] })] })];
  return specModel({
    roles: [role('anonymous'), role(SYSTEM), role('staff_member')],
    aggregates: [
      aggregate({ name: 'company', entity: entitySpec('company', [field('id', { kind: 'uuid' }, { auto: true }), field('name', { kind: 'string' })]) }),
      aggregate({
        name: 'staff_member',
        entity: entitySpec('staff_member', init.single === true ? [field('id', { kind: 'uuid' }, { auto: true })] : [field('company_id', COMPANY, { required: true, session: true })]),
        access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
      }),
      aggregate({
        name: 'shelf',
        entity: entitySpec('shelf', [field('company_id', COMPANY, { required: true })]),
      }),
      aggregate({
        name: 'product',
        entity: entitySpec('product', [
          ...(init.single === true ? [] : [field('company_id', COMPANY, { required: true })]),
          field('sku', { kind: 'string' }, { required: true, ...(init.dbSupplied === true ? { suppliedBy: 'db' as const } : {}) }),
          field('shelf_id', { kind: 'ref', entity: 'shelf' }),
        ]),
        access: accessSpec('product', {
          creates: creator === null ? [] : [createRule(creator)],
          writes: writer === null ? [] : [writeRule(writer, ['sku'])],
          ...(init.hiddenFrom === undefined ? {} : { fieldsHidden: [{ field: 'sku', from: init.hiddenFrom, location: loc() }] }),
        }),
        invariants: invariantSpec([invariant({ id: 'INV-PRODUCT-001', entities: ['product'], formal: formal(init) })]),
        stateMachines: flow,
      }),
    ],
  });
}

/** 文脈(`input` は作成の action_spec の入力)。 */
function context(init: Init): VerifyContext {
  const computed = (init.computes ?? []).map((name) => ({ raw: `product.${name}`, entity: 'product', field: name, ref: 'makeKey', reads: [], shape: 'facts_input' as const, examples: [], location: loc() }));
  const actions = [
    ...(init.input === undefined ? [] : [{ ...actionSpec({ handles: 'product.create', input: init.input.map((name) => `product.${name}`) }), computes: computed }]),
    ...(init.eventBy === undefined ? [] : [actionSpec({ handles: 'product.rename', input: ['product.sku'] })]),
  ];
  return {
    ...stubContext({}).ctx,
    guards: createGuardServices(),
    ...(init.indexes === undefined ? {} : { dataTables: loadedInput(dataTableModel([dataTable('products', { entity: 'product', indexes: init.indexes })])) }),
    ...(actions.length === 0 ? {} : { actions: loadedInput({ actions, unhandled: [], scans: [], unscanned: [], testTagBaseline: [] }) }),
  } as VerifyContext;
}

const run = (init: Init = {}) => {
  const built = model(init);
  const ctx = context(init);
  return checkUniqueKeys(built, boundaryFields(built, ctx), ctx);
};

describe('V26 一意の範囲', () => {
  it('検証器の本体を通る: 境界のある製品の指摘と、境界の無い製品の腐った受け入れ', () => {
    const verify = (init: Init) => tenantWriteBoundaryVerifier.verify(model(init), context(init)).filter((finding) => finding.counterexample?.['invariant'] === 'INV-PRODUCT-001');
    expect(verify({})).toEqual([expect.objectContaining({ message: expect.stringContaining('境界 company_id を含まず') })]);
    expect(verify({ single: true, globalKey: ACCEPT })).toEqual([expect.objectContaining({ message: expect.stringContaining('global_key は何も受け入れていません') })]);
  });

  it.each<{ name: string; init: Init }>([
    { name: '境界の列を落とした一意の鍵(探り台本 U1 の形)', init: {} },
    { name: '件数の鍵', init: { kind: 'cardinality' } },
    { name: '排他の鍵', init: { kind: 'exclusion' } },
    { name: '作成の action_spec が無い(入力を狭められない)', init: { creator: 'staff_member' } },
    { name: '作成の入力で受ける', init: { input: ['sku'] } },
    { name: '編集で書ける', init: { creator: null, writer: 'staff_member' } },
    // 作るときの値は DB が決めても、writes に載れば人が書き換えられる(点検 24 回目 B24-1 の末尾の番号の形)。
    { name: 'DB が埋める欄でも編集で書ける', init: { creator: null, writer: 'staff_member', dbSupplied: true } },
    { name: '遷移の入力で書ける', init: { creator: null, eventBy: 'staff_member' } },
    { name: '未ログインの作成', init: { creator: 'anonymous' } },
  ])('赤: $name', ({ init }) => {
    expect(run(init)).toEqual([
      expect.objectContaining({ verifier: 'V26', severity: 'error', message: expect.stringContaining('境界 company_id を含まず'), counterexample: expect.objectContaining({ invariant: 'INV-PRODUCT-001', boundary: 'company_id' }) }),
    ]);
  });

  it.each<{ name: string; init: Init }>([
    { name: '鍵に境界の列がある', init: { keys: ['company_id', 'sku'] } },
    { name: '鍵に境界へ届く参照の欄がある', init: { keys: ['shelf_id', 'sku'] } },
    { name: '内部実行だけが作る', init: { creator: SYSTEM } },
    { name: '内部実行だけが編集する', init: { creator: null, writer: SYSTEM } },
    { name: '内部実行だけの遷移', init: { creator: null, eventBy: SYSTEM } },
    { name: '鍵の欄を作成の入力で受けない', init: { input: ['shelf_id'] } },
    { name: 'DB が埋める欄(宣言上の入力でも人は書けない)', init: { dbSupplied: true, input: ['sku'] } },
    { name: '境界の無い製品', init: { single: true } },
    { name: '受け入れ', init: { globalKey: { keys: ['sku'], reason: '公開の識別子は全テナントで一意' } } },
  ])('緑: $name', ({ init }) => {
    expect(run(init)).toEqual([]);
  });

  it('緑: 境界の根は行そのものがテナントで、鍵に足せる列が無い', () => {
    const built = model({ keys: ['company_id', 'sku'] });
    const root = built.aggregates.get('company');
    const withKey = new Map(built.aggregates);
    if (root !== undefined) {
      withKey.set('company', {
        ...root,
        access: accessSpec('company', { writes: [writeRule('staff_member', ['name'])] }),
        invariants: invariantSpec([invariant({ id: 'INV-COMPANY-001', entities: ['company'], formal: { kind: 'uniqueness', keys: ['name'] } })]),
      });
    }
    const ctx = context({});
    expect(checkUniqueKeys({ ...built, aggregates: withKey }, boundaryFields(built, ctx), ctx)).toEqual([]);
  });

  it.each<{ name: string; init: Init }>([
    { name: '鍵が境界を結んでいる', init: { keys: ['company_id', 'sku'], globalKey: { keys: ['company_id', 'sku'], reason: '理由' } } },
    { name: '人の入力で書けない', init: { creator: SYSTEM, globalKey: ACCEPT } },
    { name: '境界の無い製品', init: { single: true, globalKey: ACCEPT } },
  ])('赤: 腐った受け入れ — $name', ({ init }) => {
    expect(run(init)).toEqual([expect.objectContaining({ severity: 'error', message: expect.stringContaining('global_key は何も受け入れていません') })]);
  });

  it('受け入れは不変条件 1 本にだけ効く(同じ集約の別の鍵には効かない)', () => {
    const built = model({ globalKey: ACCEPT });
    const product = built.aggregates.get('product');
    const aggregates = new Map(built.aggregates);
    if (product !== undefined) {
      aggregates.set('product', {
        ...product,
        invariants: invariantSpec([...(product.invariants?.invariants ?? []), invariant({ id: 'INV-PRODUCT-002', entities: ['product'], formal: { kind: 'uniqueness', keys: ['sku'] } })]),
      });
    }
    const ctx = context({});
    const found = checkUniqueKeys({ ...built, aggregates }, boundaryFields(built, ctx), ctx);
    expect(found).toEqual([expect.objectContaining({ counterexample: expect.objectContaining({ invariant: 'INV-PRODUCT-002' }) })]);
  });

  // 点検 13 回目 A13-1: 不変条件を持たない一意の索引も同じ規則。
  describe('不変条件を持たない一意の索引', () => {
    const SCOPED = { keys: ['company_id', 'sku'] } as const; // 不変条件の側は緑にしておく
    const INDEX = { name: 'products_sku_idx', on: ['sku'], unique: true } as const;

    it('赤: U3 検索の索引に unique: true を足しただけ', () => {
      expect(run({ ...SCOPED, indexes: [INDEX] })).toEqual([
        expect.objectContaining({ verifier: 'V26', severity: 'error', message: expect.stringContaining('products_sku_idx の on [sku] は product の境界 company_id を含まず'), counterexample: expect.objectContaining({ index: 'products_sku_idx' }) }),
      ]);
    });

    it.each<{ name: string; init: Init }>([
      { name: 'unique でない索引', init: { ...SCOPED, indexes: [{ ...INDEX, unique: false }] } },
      { name: '境界の列を含む', init: { ...SCOPED, indexes: [{ ...INDEX, on: ['company_id', 'sku'] }] } },
      { name: '境界へ届く参照の欄を含む', init: { ...SCOPED, indexes: [{ ...INDEX, on: ['shelf_id', 'sku'] }] } },
      { name: '不変条件の索引(一致は T23 が見る)', init: { ...SCOPED, indexes: [{ ...INDEX, invariant: 'INV-PRODUCT-001' }] } },
      { name: '内部実行だけが書く', init: { ...SCOPED, creator: SYSTEM, indexes: [INDEX] } },
      { name: '境界の無い製品', init: { ...SCOPED, keys: ['sku'], single: true, indexes: [INDEX] } },
      { name: '受け入れ', init: { ...SCOPED, indexes: [{ ...INDEX, globalKey: ACCEPT }] } },
    ])('緑: $name', ({ init }) => {
      expect(run(init)).toEqual([]);
    });

    it.each<{ name: string; init: Init; message: string }>([
      { name: '鍵の列が違う受け入れ(A13-4)', init: { ...SCOPED, indexes: [{ ...INDEX, globalKey: { keys: ['name'], reason: '理由' } }] }, message: '名指した列 [name] が今の鍵 [sku] と違います' },
      { name: '効いていない受け入れ', init: { ...SCOPED, creator: SYSTEM, indexes: [{ ...INDEX, globalKey: ACCEPT }] }, message: 'global_key は何も受け入れていません' },
    ])('赤: 腐った受け入れ — $name', ({ init, message }) => {
      expect(run(init)).toEqual([expect.objectContaining({ message: expect.stringContaining(message) })]);
    });
  });

  // 点検 13 回目 A13-3: 計算した鍵も人の入力に数える。
  describe('computes の鍵', () => {
    it('赤: U7 鍵の欄を input から外して computes で埋める', () => {
      expect(run({ input: ['shelf_id'], computes: ['sku'] })).toEqual([expect.objectContaining({ message: expect.stringContaining('境界 company_id を含まず'), counterexample: expect.objectContaining({ invariant: 'INV-PRODUCT-001' }) })]);
    });

    it.each<{ name: string; init: Init }>([
      { name: '内部実行だけの作成の computes', init: { creator: SYSTEM, input: ['shelf_id'], computes: ['sku'] } },
      { name: '別の欄の computes', init: { input: ['shelf_id'], computes: ['shelf_id'] } },
      { name: 'DB が埋める欄(computes に書いても人は決められない)', init: { dbSupplied: true, input: ['shelf_id'], computes: ['sku'] } },
    ])('緑: $name', ({ init }) => {
      expect(run(init)).toEqual([]);
    });

    it('受け入れは computes の鍵にも効く', () => {
      expect(run({ input: ['shelf_id'], computes: ['sku'], globalKey: ACCEPT })).toEqual([]);
    });
  });

  // 点検 13 回目 A13-4: 受け入れは鍵の列を名指す。
  it('赤: G6 受け入れの後で鍵を変えた', () => {
    expect(run({ keys: ['sku', 'name'], globalKey: ACCEPT })).toEqual([expect.objectContaining({ message: expect.stringContaining('名指した列 [sku] が今の鍵 [sku, name] と違います') })]);
    expect(run({ keys: ['name', 'sku'], globalKey: { keys: ['sku', 'name'], reason: '理由' } })).toEqual([]);
  });

  it('赤: 受け入れの keys に実在しない列を書いても通らない', () => {
    expect(run({ globalKey: { keys: ['no_such_column'], reason: '理由' } })).toEqual([expect.objectContaining({ message: expect.stringContaining('名指した列 [no_such_column] が今の鍵 [sku] と違います') })]);
  });

  // 点検 13 回目 A13-5: 隠し列の鍵。
  describe('隠し列の鍵', () => {
    const KEYED = { keys: ['company_id', 'sku'] } as const;
    it.each<{ name: string; init: Init }>([
      { name: 'U8 隠した相手が作成で書く', init: { ...KEYED, hiddenFrom: ['staff_member'] } },
      { name: '隠した相手が編集で書く', init: { ...KEYED, creator: null, writer: 'staff_member', hiddenFrom: ['staff_member'] } },
      { name: '隠した相手が computes で決める', init: { ...KEYED, input: ['shelf_id'], computes: ['sku'], hiddenFrom: ['staff_member'] } },
      { name: '未ログインの作成(隠した相手も通る)', init: { ...KEYED, creator: 'anonymous', hiddenFrom: ['staff_member'] } },
    ])('赤: $name', ({ init }) => {
      expect(run(init)).toEqual([expect.objectContaining({ verifier: 'V26', severity: 'error', message: expect.stringContaining('staff_member から隠した列で、staff_member が書けます') })]);
    });

    it.each<{ name: string; init: Init }>([
      { name: '隠していない', init: KEYED },
      { name: '書かない相手から隠す', init: { ...KEYED, hiddenFrom: ['anonymous'] } },
      { name: '内部実行だけが書く', init: { ...KEYED, creator: SYSTEM, hiddenFrom: ['staff_member'] } },
      { name: '作成の入力に無い', init: { ...KEYED, input: ['shelf_id'], hiddenFrom: ['staff_member'] } },
    ])('緑: $name', ({ init }) => {
      expect(run(init)).toEqual([]);
    });

    it('赤: 不変条件を持たない一意の索引でも同じ', () => {
      const found = run({ ...KEYED, hiddenFrom: ['staff_member'], input: ['shelf_id'], indexes: [{ name: 'p_unique', on: ['company_id', 'sku'], unique: true }], writer: 'staff_member' });
      expect(found.map((finding) => finding.counterexample?.['index'] ?? finding.counterexample?.['invariant'])).toEqual(['INV-PRODUCT-001', 'p_unique']);
    });
  });
});
