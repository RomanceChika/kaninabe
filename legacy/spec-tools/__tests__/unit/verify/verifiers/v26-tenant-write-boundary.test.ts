/**
 * V26(テナント境界の宣言漏れ — 書き込みの側)の規約網羅テスト。
 *
 * 対象の要求: 実行者の属性(`actor.{欄}`)を表す列を持つエンティティへの書き込み(`creates` / `writes` /
 * `deletes`)は、`when` のトップレベルの `and` の項に「境界の列 == actor.{欄}」を持つ。無ければ error。
 * 受け入れは V20 と同じ `accept:`(対象のロールと列を名指す)でだけ消える。
 *
 * 式の読みは**本物のガード式のパーサー**を使う(スタブの式は中身を持たず、`and` / `or` / `not` の
 * 構造を区別できないので、この検査の核心が試せない)。
 */

import { describe, expect, it } from 'vitest';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { tenantWriteBoundaryVerifier } from '../../../../lib/verify/verifiers/v26-tenant-write-boundary.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
  entitySpec,
  event,
  field,
  invariant,
  invariantSpec,
  machine,
  readRule,
  role,
  specModel,
  stubContext,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import type { FieldDef, InvariantSpec, ReadFilterAccept, SpecModel } from '../../../../lib/model/types.js';
import type { VerifyContext } from '../../../../lib/check-api/contract.js';
import { loadedInput } from '../../../helpers/verify-inputs.js';
import { actionSpec } from '../../../helpers/trace-builder.js';

/** 本物のパーサーを載せた検証の文脈。 */
function realContext(): VerifyContext {
  return { ...stubContext({}).ctx, guards: createGuardServices() };
}

/** 書き込みの規則を並べた 1 モデル(`store` が境界の列を持つ。`staff_member` が実行者の集約)。 */
interface StoreInit {
  /** 規則 1 本(`when` を書くなら文字列・書かないなら `{}`)。省略は規則そのものを置かない。 */
  readonly create?: { readonly when?: string };
  readonly write?: { readonly when?: string };
  readonly remove?: { readonly when?: string };
  readonly columns?: readonly FieldDef[];
  readonly accepts?: readonly ReadFilterAccept[];
}

const COMPANY = { kind: 'ref', entity: 'company' } as const;

/** 受け入れ 1 件。 */
function accept(by: string, column: string, on?: ReadFilterAccept['on']): ReadFilterAccept {
  return {
    by,
    field: column,
    reason: '対象の行の持ち主の中にしか立たないロールなので、跨がない',
    ...(on === undefined ? {} : { on }),
    location: { file: 'docs/specs/domain/store/access.md' },
  };
}

/** 書き込み 3 種を全部受け入れる `on`。 */
const ALL: ReadFilterAccept['on'] = ['create', 'write', 'delete'];

/** 書き込みの規則を並べたモデル。 */
function storeModel(init: StoreInit = {}): SpecModel {
  const rule = <T>(value: { readonly when?: string } | undefined, build: (when?: string) => T): T[] =>
    value === undefined ? [] : [build(value.when)];
  return specModel({
    roles: [role('anonymous'), role('system'), role('staff_member'), role('company_admin', undefined, ['staff_member'], undefined)],
    aggregates: [
      aggregate({
        name: 'staff_member',
        entity: entitySpec('staff_member', [field('company_id', COMPANY, { required: true, session: true })]),
        access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
      }),
      aggregate({
        name: 'store',
        entity: entitySpec(
          'store',
          init.columns ?? [field('company_id', COMPANY, { required: true }), field('manager_id', { kind: 'ref', entity: 'staff_member' })],
        ),
        access: accessSpec('store', {
          reads: [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'company_id', actorField: 'company_id' }] }],
          creates: rule(init.create, (when) => createRule('company_admin', when)),
          writes: rule(init.write, (when) => writeRule('company_admin', ['name'], when)),
          deletes: rule(init.remove, (when) => deleteRule('company_admin', when)),
          ...(init.accepts === undefined ? {} : { accepts: init.accepts }),
        }),
      }),
    ],
  });
}

/** `when` を書くか書かないかを規則の形にする。 */
function withWhen(when: string | undefined): { readonly when?: string } {
  return when === undefined ? {} : { when };
}

/** 境界を結ぶ正しい when。 */
const BOUND = 'store.company_id == actor.company_id';

describe('V26 テナント境界(書き込み) — 規則の種類 × when の形(表)', () => {
  /** 書き込みの 3 種類のどれでも同じ判定になる(creates / writes / deletes)。 */
  const KEYS: readonly { readonly key: 'creates' | 'writes' | 'deletes'; readonly build: (when: string | undefined) => StoreInit }[] = [
    { key: 'creates', build: (when) => ({ create: withWhen(when) }) },
    { key: 'writes', build: (when) => ({ write: withWhen(when) }) },
    { key: 'deletes', build: (when) => ({ remove: withWhen(when) }) },
  ];

  /** 境界を結んでいない形(error になる)。 */
  const UNBOUND: readonly { readonly name: string; readonly when: string | undefined }[] = [
    { name: 'when が無い', when: undefined },
    { name: 'actor を使わない条件', when: 'store.manager_id == actor.id' },
    { name: '境界ではない列を actor.company_id と比べる', when: 'store.manager_id == actor.company_id' },
    { name: '境界の列を actor.id と比べる(欄が違う)', when: 'store.company_id == actor.id' },
    { name: '境界の列を別の列と比べる', when: 'store.company_id == store.manager_id' },
    { name: '!= は結んだことにならない', when: 'store.company_id != actor.company_id' },
    { name: 'or の片側だけ結ぶ', when: 'store.company_id == actor.company_id or store.manager_id == actor.id' },
    { name: 'or の左側だけ結ぶ', when: 'store.manager_id == actor.id or store.company_id == actor.company_id' },
    { name: 'not の中で結ぶ', when: 'not store.company_id == actor.company_id' },
    { name: '順序比較は結んだことにならない', when: 'store.company_id >= actor.company_id' },
    { name: '別のエンティティ名の同名の列', when: 'other.company_id == actor.company_id' },
  ];

  /** 境界を結んでいる形(通る)。 */
  const BOUNDED: readonly { readonly name: string; readonly when: string }[] = [
    { name: '単独の等式', when: BOUND },
    { name: '辺を入れ替えた等式', when: 'actor.company_id == store.company_id' },
    { name: 'and の右', when: 'store.manager_id == actor.id and store.company_id == actor.company_id' },
    { name: 'and の左', when: 'store.company_id == actor.company_id and store.manager_id == actor.id' },
    { name: '3 項の and の中ほど', when: 'store.manager_id == actor.id and store.company_id == actor.company_id and store.manager_id == actor.id' },
  ];

  for (const kind of KEYS) {
    describe(kind.key, () => {
      for (const row of UNBOUND) {
        it(`error: ${row.name}`, () => {
          const findings = tenantWriteBoundaryVerifier.verify(storeModel(kind.build(row.when)), realContext());

          expect(findings).toHaveLength(1);
          expect(findings[0]?.severity).toBe('error');
          expect(findings[0]?.verifier).toBe('V26');
          expect(findings[0]?.message).toContain(`store の ${kind.key}(by: company_admin)`);
          expect(findings[0]?.message).toContain('company_id');
          expect(findings[0]?.suggestion).toContain('store.company_id == actor.company_id');
          expect(findings[0]?.counterexample).toMatchObject({ entity: 'store', key: kind.key, by: 'company_admin', column: 'company_id' });
        });
      }
      for (const row of BOUNDED) {
        it(`通る: ${row.name}`, () => {
          expect(tenantWriteBoundaryVerifier.verify(storeModel(kind.build(row.when)), realContext())).toEqual([]);
        });
      }
    });
  }
});

/** 未ログイン / システム起点のロールが、境界の列を持つ集約へ書ける形。 */
function actorlessModel(accepts: readonly ReadFilterAccept[]): SpecModel {
  return specModel({
    roles: [role('anonymous'), role('system'), role('staff_member')],
    aggregates: [
      aggregate({
        name: 'staff_member',
        entity: entitySpec('staff_member', [field('company_id', COMPANY, { required: true, session: true }), field('nickname', { kind: 'string' })]),
        access: accessSpec('staff_member', {
          reads: [readRule('staff_member', { kind: 'own' })],
          writes: [writeRule('staff_member', ['nickname'], 'staff_member.company_id == actor.company_id')],
        }),
      }),
      aggregate({
        name: 'store',
        entity: entitySpec('store', [field('company_id', COMPANY, { required: true })]),
        access: accessSpec('store', {
          reads: [readRule('anonymous', { kind: 'none' })],
          creates: [createRule('system'), createRule('anonymous')],
          writes: [writeRule('system', ['company_id'])],
          deletes: [deleteRule('system')],
          accepts,
        }),
      }),
    ],
  });
}

describe('V26 — 規則が無ければ何も言わない・対象にしないもの', () => {
  it('書き込みの規則が 1 本も無い集約は黙る(書けないものは跨げない)', () => {
    expect(tenantWriteBoundaryVerifier.verify(storeModel(), realContext())).toEqual([]);
  });

  it('未ログイン / システム起点のロールの規則は error にせず warning にする(実行者の属性が供給されない。誰も理由を言っていない形は黙って通さない)', () => {
    const findings = tenantWriteBoundaryVerifier.verify(actorlessModel([]), realContext());

    expect(findings.map((finding) => [finding.severity, finding.counterexample?.['key'], finding.counterexample?.['by']])).toEqual([
      ['warning', 'creates', 'system'],
      ['warning', 'creates', 'anonymous'],
      ['warning', 'writes', 'system'],
      ['warning', 'deletes', 'system'],
    ]);
    expect(findings[0]?.suggestion).toContain('on: [create]');
  });

  it('未ログイン / システム起点の warning は on つきの accept が種類ごとに消す(読み取りだけの accept では消えない)', () => {
    const readOnly = tenantWriteBoundaryVerifier.verify(actorlessModel([accept('system', 'company_id')]), realContext());
    expect(readOnly).toHaveLength(4);

    const some = tenantWriteBoundaryVerifier.verify(
      actorlessModel([accept('system', 'company_id', ['create', 'write']), accept('anonymous', 'company_id', ['create'])]),
      realContext(),
    );
    expect(some.map((finding) => [finding.counterexample?.['key'], finding.counterexample?.['by']])).toEqual([['deletes', 'system']]);
  });

  it('実行者の属性をどこでも使っていない仕様では何も見ない(語を発明しない)', () => {
    const plain = specModel({
      roles: [role('staff_member')],
      aggregates: [
        aggregate({
          name: 'store',
          entity: entitySpec('store', [field('company_id', { kind: 'string' })]),
          access: accessSpec('store', { creates: [createRule('staff_member')] }),
        }),
      ],
    });

    expect(tenantWriteBoundaryVerifier.verify(plain, realContext())).toEqual([]);
  });

  it('読めない when は V2 / V9 が言う(二重に言わない)', () => {
    expect(tenantWriteBoundaryVerifier.verify(storeModel({ create: { when: 'store.company_id ==' } }), realContext())).toEqual([]);
  });

  it('列名が違っても同じ ref 先を指す列は境界の列として扱う(改名で視界から外れない)', () => {
    const renamed = storeModel({ columns: [field('owner_company_id', COMPANY, { required: true })], create: { when: BOUND } });

    const findings = tenantWriteBoundaryVerifier.verify(renamed, realContext());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['column']).toBe('owner_company_id');
  });

  it('列が 2 本あれば、どちらも結ぶまで error(片方だけでは通らない)', () => {
    const two = [field('company_id', COMPANY, { required: true }), field('owner_company_id', COMPANY, { required: true })];

    const half = tenantWriteBoundaryVerifier.verify(storeModel({ columns: two, create: { when: BOUND } }), realContext());
    expect(half.map((finding) => finding.counterexample?.['column'])).toEqual(['owner_company_id']);
    expect(
      tenantWriteBoundaryVerifier.verify(
        storeModel({ columns: two, create: { when: `${BOUND} and store.owner_company_id == actor.company_id` } }),
        realContext(),
      ),
    ).toEqual([]);
  });
});

describe('V26 — 理由つき受け入れ(accept)', () => {
  it('対象のロールと列を名指した accept があれば消える(読み取りの受け入れと同じ 1 件)', () => {
    expect(
      tenantWriteBoundaryVerifier.verify(storeModel({ create: {}, accepts: [accept('company_admin', 'company_id', ALL)] }), realContext()),
    ).toEqual([]);
  });

  it('別のロールの accept では消えない(受け入れは 1 件ずつ)', () => {
    expect(
      tenantWriteBoundaryVerifier.verify(storeModel({ create: {}, accepts: [accept('staff_member', 'company_id', ALL)] }), realContext()),
    ).toHaveLength(1);
  });

  it('別の列の accept では消えない', () => {
    expect(
      tenantWriteBoundaryVerifier.verify(storeModel({ create: {}, accepts: [accept('company_admin', 'manager_id', ALL)] }), realContext()),
    ).toHaveLength(1);
  });

  it('同じ (ロール, 列) の accept は作成・編集・削除のどの規則にも効く(1 件の理由が全部に当てはまるのが通例で、種類では分けない)', () => {
    const findings = tenantWriteBoundaryVerifier.verify(
      storeModel({ create: {}, write: {}, remove: {}, accepts: [accept('company_admin', 'company_id', ALL)] }),
      realContext(),
    );

    expect(findings).toEqual([]);
  });
});

/** DB が埋める列(supplied_by: db)・祖先だけが持つ列の形。 */
function childModel(init: {
  readonly ownColumn: 'none' | 'client' | 'db';
  readonly when?: string;
  readonly accepts?: readonly ReadFilterAccept[];
}): SpecModel {
  const own =
    init.ownColumn === 'none'
      ? []
      : [field('company_id', COMPANY, init.ownColumn === 'db' ? { required: true, suppliedBy: 'db' } : { required: true })];
  return specModel({
    roles: [role('anonymous'), role('system'), role('staff_member')],
    aggregates: [
      aggregate({
        name: 'staff_member',
        entity: entitySpec('staff_member', [field('company_id', COMPANY, { required: true, session: true })]),
        access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
      }),
      aggregate({
        name: 'store',
        entity: entitySpec('store', [field('company_id', COMPANY, { required: true })], { store: 'store.id' }),
        access: accessSpec('store', {
          reads: [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'company_id', actorField: 'company_id' }] }],
        }),
      }),
      aggregate({
        name: 'shelf',
        entity: entitySpec('shelf', [...own, field('store_id', { kind: 'ref', entity: 'store' }, { required: true })], {
          store: 'shelf.store_id',
          shelf: 'shelf.id',
        }),
        access: accessSpec('shelf', {
          reads: [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ entity: 'store', field: 'company_id', actorField: 'company_id' }] }],
          creates: [createRule('staff_member', init.when)],
          ...(init.accepts === undefined ? {} : { accepts: init.accepts }),
        }),
      }),
    ],
  });
}

describe('V26 — 入力から来ない境界の列(DB が埋める列・祖先だけが持つ列)', () => {
  const ANCESTOR = 'store.company_id == actor.company_id';

  it('自分は列を持たない子表: 祖先の列で結べば通る', () => {
    expect(tenantWriteBoundaryVerifier.verify(childModel({ ownColumn: 'none', when: ANCESTOR }), realContext())).toEqual([]);
  });

  it('自分は列を持たない子表: 結ばなければ祖先の列を名指して error', () => {
    const findings = tenantWriteBoundaryVerifier.verify(childModel({ ownColumn: 'none' }), realContext());

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['column']).toBe('store.company_id');
    expect(findings[0]?.suggestion).toContain('store.company_id == actor.company_id');
  });

  it('DB が埋める列を持つ子表: 祖先の列で結べば通る(作成の時点では自分の列がまだ無い)', () => {
    expect(tenantWriteBoundaryVerifier.verify(childModel({ ownColumn: 'db', when: ANCESTOR }), realContext())).toEqual([]);
  });

  it('DB が埋める列を持つ子表: 結ばなければ error', () => {
    expect(tenantWriteBoundaryVerifier.verify(childModel({ ownColumn: 'db' }), realContext())).toHaveLength(1);
  });

  it('入力から来る列を持つ子表: 祖先の列だけを結んでも通らない(入力の列は別の値でありうる)', () => {
    const findings = tenantWriteBoundaryVerifier.verify(childModel({ ownColumn: 'client', when: ANCESTOR }), realContext());

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['column']).toBe('company_id');
  });

  it('入力から来る列を持つ子表: 自分の列だけを結んでも通らない(入力で受ける親の列も結ぶ)', () => {
    const findings = tenantWriteBoundaryVerifier.verify(childModel({ ownColumn: 'client', when: 'shelf.company_id == actor.company_id' }), realContext());

    expect(findings.map((finding) => finding.counterexample?.['column'])).toEqual(['store.company_id']);
  });

  it('入力から来る列を持つ子表: 自分の列も入力の親の列も結べば通る', () => {
    expect(
      tenantWriteBoundaryVerifier.verify(
        childModel({ ownColumn: 'client', when: `shelf.company_id == actor.company_id and ${ANCESTOR}` }),
        realContext(),
      ),
    ).toEqual([]);
  });

  it('作成では、DB が埋める自分の列は結んだことに数えない(まだ行が無い)', () => {
    const findings = tenantWriteBoundaryVerifier.verify(childModel({ ownColumn: 'db', when: 'shelf.company_id == actor.company_id' }), realContext());

    expect(findings.map((finding) => finding.counterexample?.['column'])).toEqual(['store.company_id']);
  });

  it('祖先の列を名指した accept でも消える', () => {
    expect(
      tenantWriteBoundaryVerifier.verify(
        childModel({ ownColumn: 'none', accepts: [accept('staff_member', 'store.company_id', ALL)] }),
        realContext(),
      ),
    ).toEqual([]);
  });

  it('context に宣言の無い祖先へ生の参照で届くなら、境界を書けない形として error(A3-2(b)。以前は死角の warning で済ませていた)', () => {
    const model = childModel({ ownColumn: 'none' });
    const shelf = model.aggregates.get('shelf');
    if (shelf?.entity === undefined) throw new Error('fixture');
    const cut = specModel({
      roles: model.roles.roles,
      aggregates: [
        ...[...model.aggregates.values()].filter((specs) => specs.name !== 'shelf'),
        aggregate({ name: 'shelf', entity: { ...shelf.entity, context: {} }, ...(shelf.access === undefined ? {} : { access: shelf.access }) }),
      ],
    });

    // 作成: 入力で受ける参照の欄(store_id)ごとに、結べない形として名指す。
    const findings = tenantWriteBoundaryVerifier.verify(cut, realContext());
    expect(findings.map((finding) => [finding.severity, finding.counterexample?.['kind'], finding.counterexample?.['column']])).toEqual([
      ['error', 'unbound_ref', 'store_id'],
    ]);
    expect(findings[0]?.message).toContain('context にその欄を通る道が無い');
    // 削除: 境界を書けない形として名指す(今ある行の会社を辿る道が無い)。
    const deletes = specModel({
      roles: cut.roles.roles,
      aggregates: [...cut.aggregates.values()].map((specs) =>
        specs.name === 'shelf' && specs.access !== undefined ? { ...specs, access: { ...specs.access, creates: [], deletes: [deleteRule('staff_member')] } } : specs,
      ),
    });
    const removal = tenantWriteBoundaryVerifier.verify(deletes, realContext());
    expect(removal.map((finding) => [finding.severity, finding.counterexample?.['key'], finding.counterexample?.['kind'], finding.counterexample?.['column']])).toEqual([
      ['error', 'deletes', 'unreachable', 'store_id'],
    ]);
    expect(removal[0]?.message).toContain('context で 2 段以内・1 通りに辿れない');
    // 生の参照の欄を名指した accept(on: [create])なら消える。
    const accepted = specModel({
      roles: cut.roles.roles,
      aggregates: [...cut.aggregates.values()].map((specs) =>
        specs.name === 'shelf' && specs.access !== undefined ? { ...specs, access: { ...specs.access, accepts: [accept('staff_member', 'store_id', ['create'])] } } : specs,
      ),
    });
    expect(tenantWriteBoundaryVerifier.verify(accepted, realContext())).toEqual([]);
  });
});

/**
 * 在庫の移動の形: 入力で受ける参照が 2 本(伝票・商品)、DB の写しの参照が 1 本(棚)。
 * 伝票・商品・棚はどれも会社の列を持ち、移動自身の会社の列は DB が埋める。
 */
function moveModel(init: {
  readonly when?: string | undefined;
  readonly writeWhen?: string | undefined;
  readonly deleteWhen?: string | undefined;
  readonly accepts?: readonly ReadFilterAccept[];
  readonly shelfInput?: boolean;
  /** 編集で書く欄(既定は境界と無関係の qty)。 */
  readonly writeFields?: readonly string[];
  readonly invariants?: InvariantSpec;
}): SpecModel {
  const tenant = (extra: readonly FieldDef[] = []): readonly FieldDef[] => [field('company_id', COMPANY, { required: true }), ...extra];
  const parent = (name: string): ReturnType<typeof aggregate> =>
    aggregate({
      name,
      entity: entitySpec(name, tenant(), { [name]: `${name}.id` }),
      access: accessSpec(name, {
        reads: [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'company_id', actorField: 'company_id' }] }],
      }),
    });
  return specModel({
    roles: [role('anonymous'), role('system'), role('staff_member')],
    aggregates: [
      aggregate({
        name: 'staff_member',
        entity: entitySpec('staff_member', [field('company_id', COMPANY, { required: true, session: true })]),
        access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
      }),
      parent('receipt'),
      parent('product'),
      parent('shelf'),
      aggregate({
        name: 'move',
        entity: entitySpec(
          'move',
          [
            field('company_id', COMPANY, { required: true, suppliedBy: 'db' }),
            field('qty', { kind: 'integer' }),
            field('receipt_id', { kind: 'ref', entity: 'receipt' }, { required: true }),
            field('product_id', { kind: 'ref', entity: 'product' }, { required: true }),
            field('shelf_id', { kind: 'ref', entity: 'shelf' }, init.shelfInput === true ? { required: true } : { required: true, suppliedBy: 'db' }),
          ],
          { receipt: 'move.receipt_id', product: 'move.product_id', shelf: 'move.shelf_id' },
        ),
        access: accessSpec('move', {
          reads: [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'company_id', actorField: 'company_id' }] }],
          creates: [createRule('staff_member', init.when)],
          writes: [writeRule('staff_member', init.writeFields ?? ['qty'], init.writeWhen)],
          deletes: [deleteRule('staff_member', init.deleteWhen)],
          ...(init.accepts === undefined ? {} : { accepts: init.accepts }),
        }),
        ...(init.invariants === undefined ? {} : { invariants: init.invariants }),
      }),
    ],
  });
}

describe('V26 — 入力で受ける親が複数ある書き込み(在庫の移動の形)', () => {
  const RECEIPT = 'receipt.company_id == actor.company_id';
  const PRODUCT = 'product.company_id == actor.company_id';
  const SHELF = 'shelf.company_id == actor.company_id';
  const columnsOf = (model: SpecModel, key: string): (string | undefined)[] =>
    tenantWriteBoundaryVerifier
      .verify(model, realContext())
      .filter((finding) => finding.counterexample?.['key'] === key)
      .map((finding) => finding.counterexample?.['column'] as string | undefined);

  const CREATES: readonly { readonly name: string; readonly when: string | undefined; readonly unbound: readonly string[] }[] = [
    { name: 'どれも結ばない', when: undefined, unbound: ['receipt.company_id', 'product.company_id'] },
    { name: '伝票だけ結ぶ(商品が別の会社でも通ってはならない)', when: RECEIPT, unbound: ['product.company_id'] },
    { name: '商品だけ結ぶ', when: PRODUCT, unbound: ['receipt.company_id'] },
    { name: 'DB の写しの棚だけ結ぶ(入力の親は結べていない)', when: SHELF, unbound: ['receipt.company_id', 'product.company_id'] },
    { name: '伝票と商品を結ぶ(DB の写しの棚は要らない)', when: `${RECEIPT} and ${PRODUCT}`, unbound: [] },
    { name: '順序が違っても同じ', when: `${PRODUCT} and ${SHELF} and ${RECEIPT}`, unbound: [] },
    { name: 'or でつなぐと結んだことにならない', when: `${RECEIPT} or ${PRODUCT}`, unbound: ['receipt.company_id', 'product.company_id'] },
  ];
  for (const row of CREATES) {
    it(`作成: ${row.name}`, () => {
      expect(columnsOf(moveModel({ when: row.when }), 'creates')).toEqual(row.unbound);
    });
  }

  it('棚も入力で受ける形なら、棚の会社の列も結ぶ(3 本)', () => {
    expect(columnsOf(moveModel({ shelfInput: true, when: `${RECEIPT} and ${PRODUCT}` }), 'creates')).toEqual(['shelf.company_id']);
    expect(columnsOf(moveModel({ shelfInput: true, when: `${RECEIPT} and ${PRODUCT} and ${SHELF}` }), 'creates')).toEqual([]);
  });

  it('編集: 付け替える新しい親は when から見えないので、入力の参照の親は要求しない(今ある行の会社のどれかを結べばよい)', () => {
    expect(columnsOf(moveModel({ writeWhen: RECEIPT }), 'writes')).toEqual([]);
    expect(columnsOf(moveModel({ writeWhen: 'move.company_id == actor.company_id' }), 'writes')).toEqual([]);
    expect(columnsOf(moveModel({ writeWhen: undefined }), 'writes')).toHaveLength(1);
  });

  it('削除: 既にある行の会社(自分の DB が埋めた列・どの親の列でも)のどれかを結べば通る', () => {
    expect(columnsOf(moveModel({ deleteWhen: 'move.company_id == actor.company_id' }), 'deletes')).toEqual([]);
    expect(columnsOf(moveModel({ deleteWhen: RECEIPT }), 'deletes')).toEqual([]);
    expect(columnsOf(moveModel({ deleteWhen: undefined }), 'deletes')).toHaveLength(1);
  });

  it('accept は既定で読み取りだけ: on の無い accept は書き込みを受け入れない', () => {
    const readOnly = moveModel({ accepts: [accept('staff_member', 'receipt.company_id'), accept('staff_member', 'product.company_id')] });
    expect(columnsOf(readOnly, 'creates')).toEqual(['receipt.company_id', 'product.company_id']);
  });

  it('accept の on が種類を名指す: create だけの accept は編集・削除を受け入れない', () => {
    const createOnly = moveModel({
      accepts: [accept('staff_member', 'receipt.company_id', ['create']), accept('staff_member', 'product.company_id', ['create'])],
    });
    expect(columnsOf(createOnly, 'creates')).toEqual([]);
    expect(columnsOf(createOnly, 'writes')).toHaveLength(1);
    expect(columnsOf(createOnly, 'deletes')).toHaveLength(1);
  });
});

describe('V26 — 導ける境界が無い書き込み(V20 / V26 の死角)', () => {
  /** 境界の欄を使う集約(store)のほかに、会社も親も持たない集約(note)が書き込みの規則を持つ。 */
  function blindModel(noteRules: boolean): SpecModel {
    return specModel({
      roles: [role('anonymous'), role('system'), role('staff_member')],
      aggregates: [
        aggregate({
          name: 'staff_member',
          entity: entitySpec('staff_member', [field('company_id', COMPANY, { required: true, session: true }), field('nickname', { kind: 'string' })]),
          access: accessSpec('staff_member', {
            reads: [readRule('staff_member', { kind: 'own' })],
            writes: [writeRule('staff_member', ['nickname'], 'staff_member.company_id == actor.company_id')],
          }),
        }),
        aggregate({
          name: 'note',
          entity: entitySpec('note', [field('body', { kind: 'string' })]),
          access: accessSpec('note', noteRules ? { creates: [createRule('staff_member')], writes: [writeRule('staff_member', ['body'])] } : {}),
        }),
      ],
    });
  }

  it('書き込みの規則を持つが境界の列を導けない集約は warning で名指す', () => {
    const findings = tenantWriteBoundaryVerifier.verify(blindModel(true), realContext());

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('note');
    expect(findings[0]?.message).toContain('creates / writes');
    expect(findings[0]?.counterexample).toMatchObject({ entity: 'note' });
  });

  it('書き込みの規則が無ければ黙る', () => {
    expect(tenantWriteBoundaryVerifier.verify(blindModel(false), realContext())).toEqual([]);
  });

  it('境界の欄がモデルのどこにも無ければ黙る(境界を持たない仕様を警告で汚さない)', () => {
    const plain = specModel({
      roles: [role('staff_member')],
      aggregates: [
        aggregate({
          name: 'note',
          entity: entitySpec('note', [field('body', { kind: 'string' })]),
          access: accessSpec('note', { creates: [createRule('staff_member')] }),
        }),
      ],
    });

    expect(tenantWriteBoundaryVerifier.verify(plain, realContext())).toEqual([]);
  });

  it('作成: DB が埋める自分の列だけで祖先が無ければ、結びようが無いので accept(on: create)だけが消す', () => {
    const lonely = (accepts: readonly ReadFilterAccept[]): SpecModel =>
      specModel({
        roles: [role('staff_member')],
        aggregates: [
          aggregate({
            name: 'staff_member',
            entity: entitySpec('staff_member', [field('company_id', COMPANY, { required: true, session: true })]),
            access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
          }),
          aggregate({
            name: 'log',
            entity: entitySpec('log', [field('company_id', COMPANY, { required: true, suppliedBy: 'db' })]),
            access: accessSpec('log', { creates: [createRule('staff_member', 'log.company_id == actor.company_id')], accepts }),
          }),
        ],
      });

    expect(tenantWriteBoundaryVerifier.verify(lonely([]), realContext())).toHaveLength(1);
    expect(tenantWriteBoundaryVerifier.verify(lonely([accept('staff_member', 'company_id', ['create'])]), realContext())).toEqual([]);
  });
});

describe('V26 — 実行者の参照の欄・同じ欄を経て届く祖先', () => {
  /** 持ち主(実行者の集約への必須の参照)と部門(入力の参照。さらにその先に会社を持つ上位がある)を持つ品物。 */
  function itemModel(by: 'staff_member' | 'admin', when?: string, delegate: readonly string[] = []): SpecModel {
    const admin = { ...role('admin', undefined, ['staff_member']), claim: 'staff_member.is_admin' };
    return specModel({
      roles: [role('anonymous'), role('system'), role('staff_member'), admin],
      aggregates: [
        aggregate({
          name: 'staff_member',
          entity: entitySpec('staff_member', [
            field('company_id', COMPANY, { required: true, session: true }),
            field('is_admin', { kind: 'boolean' }, { session: true }),
          ]),
          access: accessSpec('staff_member', {
            reads: [readRule('staff_member', { kind: 'own' })],
            writes: [writeRule('staff_member', ['is_admin'], 'staff_member.company_id == actor.company_id')],
          }),
        }),
        aggregate({
          name: 'division',
          entity: entitySpec('division', [field('company_id', COMPANY, { required: true })], { division: 'division.id' }),
          access: accessSpec('division', {}),
        }),
        aggregate({
          name: 'team',
          entity: entitySpec('team', [field('division_id', { kind: 'ref', entity: 'division' }, { required: true })], {
            division: 'team.division_id',
            team: 'team.id',
          }),
          access: accessSpec('team', {}),
        }),
        aggregate({
          name: 'item',
          entity: entitySpec(
            'item',
            [
              field('company_id', COMPANY, { required: true, suppliedBy: 'db' }),
              field('owner_id', { kind: 'ref', entity: 'staff_member' }, { required: true }),
              field('team_id', { kind: 'ref', entity: 'team' }, { required: true }),
            ],
            { staff_member: 'item.owner_id', team: 'item.team_id' },
          ),
          access: accessSpec('item', {
            creates: [
              {
                ...createRule(by, when),
                ...(delegate.length === 0 ? {} : { delegate: delegate.map((name) => ({ entity: 'item', field: name, reason: '代理で作る', location: { file: 'access.md', pointer: 'creates[0].delegate' } })) }),
              },
            ],
          }),
        }),
      ],
    });
  }
  const columnsOf = (model: SpecModel): (string | undefined)[] =>
    tenantWriteBoundaryVerifier.verify(model, realContext()).map((finding) => finding.counterexample?.['column'] as string | undefined);

  it('作成の規則が実行者に縛る参照の欄(持ち主)の先は、会社を改めて結ばない(実行者の集約そのもの)', () => {
    // staff_member は既定のログインロール: 持ち主の欄は実行者に縛られる。入力で受ける team 経由の division だけ結ぶ。
    expect(columnsOf(itemModel('staff_member'))).toEqual(['division.company_id']);
    expect(columnsOf(itemModel('staff_member', 'division.company_id == actor.company_id'))).toEqual([]);
  });

  /** 持ち主の欄を作成の input に出した文脈(`delegate` で解ける B の欄にする)。 */
  const ownerInInput = (): VerifyContext => ({
    ...realContext(),
    actions: loadedInput({ actions: [actionSpec({ handles: 'item.create', input: ['item.owner_id', 'item.team_id'] })], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] }),
  });

  it('delegate で持ち主の欄を解いた claim のロールの規則は他人を持ち主にできるので、持ち主の会社も結ぶ', () => {
    const columns = (model: SpecModel) => tenantWriteBoundaryVerifier.verify(model, ownerInInput()).map((finding) => finding.counterexample?.['column']);

    expect(columns(itemModel('admin', 'division.company_id == actor.company_id', ['owner_id']))).toEqual(['staff_member.company_id']);
    expect(columns(itemModel('admin', 'division.company_id == actor.company_id and staff_member.company_id == actor.company_id', ['owner_id']))).toEqual([]);
  });

  it('claim のロールでも delegate の無い規則は持ち主を実行者に縛るので、持ち主の会社は改めて結ばない(点検 11 回目 A11-3)', () => {
    expect(columnsOf(itemModel('admin', 'division.company_id == actor.company_id'))).toEqual([]);
  });
});

describe('V26 — 編集で行の持ち主を付け替える口(外部レビュー P2-2)', () => {
  const RECEIPT = 'receipt.company_id == actor.company_id';
  const OWN = 'move.company_id == actor.company_id';
  const retargets = (model: SpecModel, ctx: VerifyContext = realContext()) =>
    tenantWriteBoundaryVerifier
      .verify(model, ctx)
      .filter((finding) => finding.counterexample?.['kind'] === 'retarget')
      .map((finding) => finding.counterexample?.['field']);

  /** 付け替えを塞ぐ不変条件(move の会社 = 商品の会社)。 */
  const tie = (enforcedBy: InvariantSpec['invariants'][number]['enforcedBy']): InvariantSpec =>
    invariantSpec([
      invariant({
        id: 'INV-MOVE-001',
        entities: ['move'],
        formal: { kind: 'check', expr: 'move.company_id == product.company_id' },
        enforcedBy,
      }),
    ]);
  const trigger = { kind: 'trigger', ref: 'sync_move_company', location: { file: 'x' } } as const;
  const carrierCtx = (invariantId: string | undefined): VerifyContext => ({
    ...realContext(),
    dataTables: {
      state: 'loaded',
      findings: [],
      value: dataTableModel([
        dataTable('moves', {
          triggers: [{ name: 'sync_move_company', functionName: 'sync_move_company', ...(invariantId === undefined ? {} : { invariant: invariantId }) } as never],
        }),
      ]),
    },
  });

  it('旧い値への when だけで、自分の境界の列そのものを書ける編集は error(自社の行を他社へ移せる)', () => {
    expect(retargets(moveModel({ writeFields: ['company_id'], writeWhen: OWN }))).toEqual(['company_id']);
  });

  it('入力の参照の欄(商品)を付け替えられる編集は error(他社の商品を指せる)', () => {
    expect(retargets(moveModel({ writeFields: ['product_id'], writeWhen: OWN }))).toEqual(['product_id']);
    expect(retargets(moveModel({ writeFields: ['receipt_id', 'product_id'], writeWhen: OWN }))).toEqual(['receipt_id', 'product_id']);
  });

  it('旧い親を結んでいても、新しい親は縛らない(error のまま)', () => {
    expect(retargets(moveModel({ writeFields: ['receipt_id'], writeWhen: RECEIPT }))).toEqual(['receipt_id']);
  });

  it('境界と無関係の欄だけを書く編集は黙る(列を fields から外すのが定石)', () => {
    expect(retargets(moveModel({ writeFields: ['qty'], writeWhen: OWN }))).toEqual([]);
  });

  it('正例: 執行点が実在する不変条件(trigger を data_table が名指す)が、商品の付け替えを塞ぐ', () => {
    const model = moveModel({ writeFields: ['product_id'], writeWhen: OWN, invariants: tie([trigger]) });
    expect(retargets(model, carrierCtx('INV-MOVE-001'))).toEqual([]);
  });

  it('負例: 不変条件が宣言されているだけ(data_table が執行点を名指さない)なら数えない', () => {
    const model = moveModel({ writeFields: ['product_id'], writeWhen: OWN, invariants: tie([trigger]) });
    expect(retargets(model, carrierCtx(undefined))).toEqual(['product_id']);
    expect(retargets(model, realContext())).toEqual(['product_id']);
  });

  it('負例: guard の執行点は編集の経路を通らないので数えない', () => {
    const guard = { kind: 'guard', ref: 'move.confirm', location: { file: 'x' } } as const;
    const model = moveModel({ writeFields: ['product_id'], writeWhen: OWN, invariants: tie([guard]) });
    expect(retargets(model, carrierCtx('INV-MOVE-001'))).toEqual(['product_id']);
  });

  it('負例: 不変条件が付け替える親の会社を結んでいない(別の親の会社の一致)なら数えない', () => {
    const other = invariantSpec([
      invariant({ id: 'INV-MOVE-001', entities: ['move'], formal: { kind: 'check', expr: 'move.company_id == receipt.company_id' }, enforcedBy: [trigger] }),
    ]);
    const model = moveModel({ writeFields: ['product_id'], writeWhen: OWN, invariants: other });
    expect(retargets(model, carrierCtx('INV-MOVE-001'))).toEqual(['product_id']);
  });

  it('正例: application の執行点は export され呼び出し口があれば数える(呼ばれていなければ数えない)', () => {
    const application = { kind: 'application', ref: 'assertSameCompany', location: { file: 'x' } } as const;
    const model = moveModel({ writeFields: ['product_id'], writeWhen: OWN, invariants: tie([application]) });
    const called = { ...realContext(), applicationRefs: { exportedNames: new Set(['assertSameCompany']), referencedNames: new Set(['assertSameCompany']) } };
    const unused = { ...realContext(), applicationRefs: { exportedNames: new Set(['assertSameCompany']), referencedNames: new Set<string>() } };
    expect(retargets(model, called)).toEqual([]);
    expect(retargets(model, unused)).toEqual(['product_id']);
  });

  it('正例: 自分の境界の列を書く編集は、別のテナントの列と結ぶ不変条件が執行されていれば通る', () => {
    const model = moveModel({ writeFields: ['company_id'], writeWhen: OWN, invariants: tie([trigger]) });
    expect(retargets(model, carrierCtx('INV-MOVE-001'))).toEqual([]);
  });

  it('正例: on: [write] の accept(列・参照の欄・親の列のどれの綴りでも)が消す。create だけ・on 無しの accept は消さない', () => {
    for (const filter of ['company_id', 'product_id', 'product.company_id']) {
      const field = filter === 'company_id' ? 'company_id' : 'product_id';
      expect(retargets(moveModel({ writeFields: [field], writeWhen: OWN, accepts: [accept('staff_member', filter, ['write'])] }))).toEqual([]);
    }
    expect(retargets(moveModel({ writeFields: ['product_id'], writeWhen: OWN, accepts: [accept('staff_member', 'product_id', ['create'])] }))).toEqual(['product_id']);
    expect(retargets(moveModel({ writeFields: ['product_id'], writeWhen: OWN, accepts: [accept('staff_member', 'product_id')] }))).toEqual(['product_id']);
  });

  it('別のロールの accept は消さない', () => {
    expect(retargets(moveModel({ writeFields: ['product_id'], writeWhen: OWN, accepts: [accept('company_admin', 'product_id', ['write'])] }))).toEqual(['product_id']);
  });

  /** 任意の式の check を、実在する執行点つきで宣言した不変条件。 */
  const check = (expr: string, id = 'INV-MOVE-001'): InvariantSpec['invariants'][number] =>
    invariant({ id, entities: ['move'], formal: { kind: 'check', expr }, enforcedBy: [trigger] });
  const carrying = (...ids: readonly string[]): VerifyContext => ({
    ...realContext(),
    dataTables: {
      state: 'loaded',
      findings: [],
      value: dataTableModel([
        dataTable('moves', { triggers: ids.map((id) => ({ name: `t_${id}`, functionName: `t_${id}`, invariant: id }) as never) }),
      ]),
    },
  });
  const withExpr = (fields: readonly string[], ...exprs: readonly string[]): { model: SpecModel; ctx: VerifyContext } => ({
    model: moveModel({
      writeFields: fields,
      writeWhen: OWN,
      invariants: invariantSpec(exprs.map((expr, index) => check(expr, `INV-MOVE-00${index + 1}`))),
    }),
    ctx: carrying(...exprs.map((_, index) => `INV-MOVE-00${index + 1}`)),
  });

  it('負例(外部レビュー P2-2): 2 つの列が式に現れるだけでは結ばない(!= / or の片側 / not / 無関係な比較 / 違う列)', () => {
    for (const expr of [
      'move.company_id != product.company_id',
      'move.company_id == product.company_id or move.company_id == move.company_id',
      'move.company_id == product.company_id or move.qty >= 0',
      'not move.company_id == product.company_id',
      'move.company_id == receipt.company_id and product.company_id == receipt.company_id',
      'move.company_id == actor.company_id and product.company_id == actor.company_id',
      'move.qty >= 1 and move.company_id >= product.company_id',
      'move.company_id == product.id',
      'move.id == product.company_id',
    ]) {
      const { model, ctx } = withExpr(['product_id'], expr);
      expect(retargets(model, ctx), expr).toEqual(['product_id']);
    }
  });

  it('正例: 逆向きの等式・and の必須の項のうちの 1 本は結ぶ', () => {
    for (const expr of [
      'product.company_id == move.company_id',
      'move.qty >= 1 and product.company_id == move.company_id',
      'move.company_id == product.company_id and move.qty >= 1 and move.qty >= 0',
    ]) {
      const { model, ctx } = withExpr(['product_id'], expr);
      expect(retargets(model, ctx), expr).toEqual([]);
    }
  });

  it('負例: cardinality の where・state_dependency の if/then に等式があっても、無条件の一致ではないので数えない', () => {
    const where = invariant({
      id: 'INV-MOVE-001',
      entities: ['move'],
      formal: { kind: 'cardinality', keys: ['product_id'], max: 1, where: 'move.company_id == product.company_id' },
      enforcedBy: [trigger],
    });
    const model = moveModel({ writeFields: ['product_id'], writeWhen: OWN, invariants: invariantSpec([where]) });
    expect(retargets(model, carrying('INV-MOVE-001'))).toEqual(['product_id']);
  });

  it('負例: 自分の境界の列と親の参照の欄を同じ編集で書けると、等式を保ったまま 2 つとも他社へ動かせる(error)', () => {
    const both = withExpr(['company_id', 'product_id'], 'move.company_id == product.company_id');
    expect(retargets(both.model, both.ctx)).toEqual(['company_id', 'product_id']);
    const [finding] = tenantWriteBoundaryVerifier.verify(both.model, both.ctx).filter((entry) => entry.counterexample?.['field'] === 'product_id');
    expect(finding?.suggestion).toContain('同じ編集で書ける');
  });

  it('正例: 両方を書ける編集でも、書けない側の親の列との等式があれば自分の列の口は塞がる(参照の欄の口は error のまま)', () => {
    const { model, ctx } = withExpr(['company_id', 'product_id'], 'move.company_id == product.company_id', 'move.company_id == receipt.company_id');
    expect(retargets(model, ctx)).toEqual(['product_id']);
  });

  it('正例: 自分の境界の列を書かない編集なら、参照の欄の付け替えは等式で塞がる(列を fields から外すのが前提)', () => {
    const { model, ctx } = withExpr(['product_id', 'receipt_id'], 'move.company_id == product.company_id and move.company_id == receipt.company_id');
    expect(retargets(model, ctx)).toEqual([]);
  });

  it('error の文面: 何が動かせるか・外す/不変条件/accept の 3 択を示す', () => {
    const [finding] = tenantWriteBoundaryVerifier.verify(moveModel({ writeFields: ['product_id'], writeWhen: OWN }), realContext()).filter((entry) => entry.counterexample?.['kind'] === 'retarget');
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('product_id');
    expect(finding?.suggestion).toContain('fields から外す');
    expect(finding?.suggestion).toContain('on: [write]');
  });

  /** 会社の列を持たず、親(会社を持つ)への参照の欄だけで届く子(外部レビュー の反例の形)。 */
  function childModel(accepts: readonly ReadFilterAccept[] = []): SpecModel {
    return specModel({
      roles: [role('anonymous'), role('system'), role('staff_member')],
      aggregates: [
        aggregate({
          name: 'staff_member',
          entity: entitySpec('staff_member', [field('company_id', COMPANY, { required: true, session: true })]),
          access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
        }),
        aggregate({
          name: 'parent',
          entity: entitySpec('parent', [field('company_id', COMPANY, { required: true })], { parent: 'parent.id' }),
          access: accessSpec('parent', {
            reads: [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'company_id', actorField: 'company_id' }] }],
          }),
        }),
        aggregate({
          name: 'child',
          entity: entitySpec('child', [field('parent_id', { kind: 'ref', entity: 'parent' }, { required: true })], { parent: 'child.parent_id' }),
          access: accessSpec('child', {
            reads: [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'parent.company_id', actorField: 'company_id' }] }],
            writes: [writeRule('staff_member', ['parent_id'], 'parent.company_id == actor.company_id')],
            accepts,
          }),
        }),
      ],
    });
  }

  it('会社の列を持たない子の親の付け替え: 行に会社が無いので不変条件では結べない(旧い親を結んでも error。accept だけが消す)', () => {
    expect(retargets(childModel())).toEqual(['parent_id']);
    expect(retargets(childModel([accept('staff_member', 'parent_id', ['write'])]))).toEqual([]);
  });
});

/**
 * 状態遷移の境界(A3-1)。店舗に状態機械を持たせ、`by` のロールの種別ごとに guard の要否を見る。
 *
 * - `company_admin`(claim)・`staff_member`(既定のログインロール)は対象に依らず立つ → guard に境界が要る
 * - `store_manager`(binding)は対象の行と結ばれて立つ → 要らない
 * - `system`(実行者の供給されない種別)→ 要らない
 */
function storeWithEvents(init: {
  readonly by: readonly string[];
  readonly guard?: string;
  readonly accepts?: readonly ReadFilterAccept[];
  readonly recordsActor?: readonly string[];
}): SpecModel {
  const admin = { ...role('company_admin', undefined, ['staff_member']), claim: 'staff_member.is_admin' };
  return specModel({
    roles: [role('anonymous'), role('system'), role('staff_member'), admin, role('store_manager', 'store.manager_id == actor.id', ['staff_member'])],
    aggregates: [
      aggregate({
        name: 'staff_member',
        entity: entitySpec('staff_member', [
          field('company_id', COMPANY, { required: true, session: true }),
          field('is_admin', { kind: 'boolean' }, { required: true, session: true }),
        ]),
        access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
      }),
      aggregate({
        name: 'store',
        entity: entitySpec('store', [
          field('company_id', COMPANY, { required: true }),
          field('manager_id', { kind: 'ref', entity: 'staff_member' }),
          field('state', { kind: 'state', machine: 'store' }),
        ]),
        stateMachines: [
          machine({
            machine: 'store',
            states: ['open', 'closed'],
            events: [
              event({
                id: 'close',
                from: ['open'],
                to: 'closed',
                by: init.by,
                ...(init.guard === undefined ? {} : { guard: init.guard }),
                ...(init.recordsActor === undefined ? {} : { recordsActor: init.recordsActor }),
              }),
            ],
          }),
        ],
        access: accessSpec('store', {
          reads: [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'company_id', actorField: 'company_id' }] }],
          ...(init.accepts === undefined ? {} : { accepts: init.accepts }),
        }),
      }),
    ],
  });
}

describe('V26 — 状態遷移の境界(A3-1)', () => {
  const lines = (model: SpecModel): string[] =>
    tenantWriteBoundaryVerifier
      .verify(model, realContext())
      .map((finding) => `${finding.severity} ${finding.counterexample?.['key']} ${finding.counterexample?.['event']} ${finding.counterexample?.['by']}`);

  /** ロールの種別 × guard の形(表)。 */
  const CASES: readonly { readonly name: string; readonly by: readonly string[]; readonly guard?: string; readonly expected: readonly string[] }[] = [
    { name: 'claim のロール・guard 無し → error', by: ['company_admin'], expected: ['error events close company_admin'] },
    { name: '既定のログインロール・guard 無し → error', by: ['staff_member'], expected: ['error events close staff_member'] },
    // 点検 5 回目 A5-2: binding のロールも編集の when と揃えて境界を求める(人の側の境界の属性は変わりうる)。
    { name: 'binding のロールだけ・guard 無し → error(A5-2)', by: ['store_manager'], expected: ['error events close store_manager'] },
    { name: 'binding のロールでも guard が境界を結べば黙る(A5-2)', by: ['store_manager'], guard: 'store.company_id == actor.company_id', expected: [] },
    { name: 'システム起点 → 黙る(実行者の属性が供給されない)', by: ['system'], expected: [] },
    { name: 'binding と claim の混在・guard 無し → 両方 error(A5-2)', by: ['store_manager', 'company_admin'], expected: ['error events close store_manager', 'error events close company_admin'] },
    { name: 'guard が境界を結ぶ → 黙る', by: ['company_admin'], guard: 'store.company_id == actor.company_id', expected: [] },
    { name: '辺を入れ替えた等式 → 黙る', by: ['company_admin'], guard: 'actor.company_id == store.company_id', expected: [] },
    { name: 'and の項として結ぶ → 黙る', by: ['company_admin'], guard: 'store.manager_id != actor.id and store.company_id == actor.company_id', expected: [] },
    { name: 'or の片側だけ → error', by: ['company_admin'], guard: 'store.company_id == actor.company_id or store.manager_id == actor.id', expected: ['error events close company_admin'] },
    { name: 'not の中 → error', by: ['company_admin'], guard: 'not store.company_id != actor.company_id', expected: ['error events close company_admin'] },
    { name: '!= → error', by: ['company_admin'], guard: 'store.company_id != actor.company_id', expected: ['error events close company_admin'] },
    { name: '境界と無関係の guard → error', by: ['company_admin'], guard: 'store.manager_id == actor.id', expected: ['error events close company_admin'] },
  ];
  for (const row of CASES) {
    it(row.name, () => {
      expect(lines(storeWithEvents({ by: row.by, ...(row.guard === undefined ? {} : { guard: row.guard }) }))).toEqual(row.expected);
    });
  }

  it('records_actor が binding の根拠の列を書く遷移(他社の行で自分を責任者にする形)も同じ規則で止まる', () => {
    expect(lines(storeWithEvents({ by: ['company_admin'], recordsActor: ['manager_id'] }))).toEqual(['error events close company_admin']);
    expect(lines(storeWithEvents({ by: ['company_admin'], recordsActor: ['manager_id'], guard: 'store.company_id == actor.company_id' }))).toEqual([]);
  });

  it('受け入れは on: [transition] だけが消す(on 無し・書き込みの種類だけの accept は消さない)', () => {
    expect(lines(storeWithEvents({ by: ['company_admin'], accepts: [{ ...accept('company_admin', 'company_id', ['transition']), events: ['close'] }] }))).toEqual([]);
    expect(lines(storeWithEvents({ by: ['company_admin'], accepts: [accept('company_admin', 'company_id')] }))).toEqual(['error events close company_admin']);
    expect(lines(storeWithEvents({ by: ['company_admin'], accepts: [accept('company_admin', 'company_id', ALL)] }))).toEqual(['error events close company_admin']);
    expect(lines(storeWithEvents({ by: ['company_admin'], accepts: [{ ...accept('staff_member', 'company_id', ['transition']), events: ['close'] }] }))).toEqual(['error events close company_admin']);
  });

  it('文面: guard に足す項と on: [transition] の受け入れを示す', () => {
    const [finding] = tenantWriteBoundaryVerifier.verify(storeWithEvents({ by: ['company_admin'] }), realContext());
    expect(finding?.message).toContain('store の遷移 close(by: company_admin)');
    expect(finding?.suggestion).toContain('store.company_id == actor.company_id');
    expect(finding?.suggestion).toContain('on: [transition]');
  });

  it('読めない guard は V2 / V9 が言う(二重に言わない)', () => {
    expect(lines(storeWithEvents({ by: ['company_admin'], guard: 'store.company_id ==' }))).toEqual([]);
  });
});

/**
 * 作成の入力で受ける参照の欄が、`context` に無いまま境界の列を持つ表を指す形(A3-2(c))。
 * 注文(会社の列は DB が店舗から写す)が商品を入力で受けるが、`context` に商品が無い。
 */
function orderModel(init: {
  readonly when: string;
  readonly productInContext?: boolean;
  readonly createInputs?: readonly string[];
  readonly accepts?: readonly ReadFilterAccept[];
  readonly invariants?: InvariantSpec;
  readonly tables?: boolean;
}): { readonly model: SpecModel; readonly ctx: VerifyContext } {
  const tenant = (name: string): ReturnType<typeof aggregate> =>
    aggregate({
      name,
      entity: entitySpec(name, [field('company_id', COMPANY, { required: true })], { [name]: `${name}.id` }),
      access: accessSpec(name, { reads: [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'company_id', actorField: 'company_id' }] }] }),
    });
  const model = specModel({
    roles: [role('anonymous'), role('system'), role('staff_member')],
    aggregates: [
      aggregate({
        name: 'staff_member',
        entity: entitySpec('staff_member', [field('company_id', COMPANY, { required: true, session: true })]),
        access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
      }),
      tenant('store'),
      tenant('product'),
      aggregate({
        name: 'order',
        entity: entitySpec(
          'order',
          [
            field('company_id', COMPANY, { required: true, suppliedBy: 'db' }),
            field('store_id', { kind: 'ref', entity: 'store' }, { required: true }),
            field('product_id', { kind: 'ref', entity: 'product' }, { required: true }),
            field('memo_product_id', { kind: 'ref', entity: 'product' }),
          ],
          { order: 'order.id', store: 'order.store_id', ...(init.productInContext === true ? { product: 'order.product_id' } : {}) },
        ),
        access: accessSpec('order', {
          reads: [{ ...readRule('staff_member', { kind: 'all' }), filters: [{ field: 'company_id', actorField: 'company_id' }] }],
          creates: [createRule('staff_member', init.when)],
          ...(init.accepts === undefined ? {} : { accepts: init.accepts }),
        }),
        ...(init.invariants === undefined ? {} : { invariants: init.invariants }),
      }),
    ],
  });
  const base = realContext();
  const actions =
    init.createInputs === undefined
      ? base.actions
      : ({ state: 'loaded', findings: [], value: { actions: [{ handles: { raw: 'order.create' }, input: init.createInputs.map((name) => ({ entity: 'order', field: name })) }] } } as never);
  const dataTables =
    init.tables === true
      ? ({
          state: 'loaded',
          findings: [],
          value: dataTableModel([dataTable('orders', { triggers: [{ name: 'check_order_product_company', functionName: 'check_order_product_company', invariant: 'INV-ORDER-001' } as never] })]),
        } as never)
      : base.dataTables;
  return { model, ctx: { ...base, actions, dataTables } as unknown as VerifyContext };
}

describe('V26 — 作成の入力の参照の欄が context に無い形(A3-2(c))', () => {
  const STORE = 'store.company_id == actor.company_id';
  const columns = ({ model, ctx }: { readonly model: SpecModel; readonly ctx: VerifyContext }): unknown[] =>
    tenantWriteBoundaryVerifier.verify(model, ctx).map((finding) => [finding.counterexample?.['column'], finding.counterexample?.['kind'] ?? 'bound']);

  it('context に無い必須の参照の欄(商品)は、店舗を結んでいても error(他社の商品を指す注文を作れる)', () => {
    expect(columns(orderModel({ when: STORE }))).toEqual([['product_id', 'unbound_ref']]);
  });

  it('作成の action_spec の入力に無い参照の欄は求めない(空で入るので他の行を指せない)', () => {
    expect(columns(orderModel({ when: STORE, createInputs: ['store_id'] }))).toEqual([]);
    expect(columns(orderModel({ when: STORE, createInputs: ['store_id', 'product_id', 'memo_product_id'] }))).toEqual([
      ['product_id', 'unbound_ref'],
      ['memo_product_id', 'unbound_ref'],
    ]);
  });

  it('context で商品へ届けば、when で結べば通る(結ばなければ商品の列を名指して error)', () => {
    expect(columns(orderModel({ when: STORE, productInContext: true }))).toEqual([['product.company_id', 'bound']]);
    expect(columns(orderModel({ when: `${STORE} and product.company_id == actor.company_id`, productInContext: true }))).toEqual([]);
  });

  it('参照の欄を名指した accept(on: [create])なら消える', () => {
    expect(columns(orderModel({ when: STORE, accepts: [accept('staff_member', 'product_id', ['create'])] }))).toEqual([]);
    expect(columns(orderModel({ when: STORE, accepts: [accept('staff_member', 'product_id')] }))).toEqual([['product_id', 'unbound_ref']]);
  });

  it('自分の境界の列と商品の境界の列の等式を、執行点が実在する不変条件(trigger)が持てば通る', () => {
    const invariants = invariantSpec([
      invariant({
        id: 'INV-ORDER-001',
        entities: ['order', 'product'],
        enforcedBy: [{ kind: 'trigger', ref: 'check_order_product_company', location: { file: 'x' } } as never],
        formal: { kind: 'check', expr: 'order.company_id == product.company_id' },
      }),
    ]);
    expect(columns(orderModel({ when: STORE, invariants, tables: true }))).toEqual([]);
    // 執行点を data_table が名指さなければ数えない。
    expect(columns(orderModel({ when: STORE, invariants }))).toEqual([['product_id', 'unbound_ref']]);
  });
});
