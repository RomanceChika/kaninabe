/**
 * RLS の挙動テストの**world の設計図**(lib/world/rls-world*.ts)のテスト。
 *
 * 見るのは 2 つである。
 *
 * 1. **作れる world の形**: 実行者はポリシーに現れるロールごとに 1 人 + 既定のログイン実行者 + 未ログイン /
 *    行は実行者ごとに 1 系統で集約は 1 行ずつ共有 / 参照の循環でも止まる / 値は型と宣言(順序・範囲・
 *    一意)から決まる / 境界の列には実行者の値を写す / `claim` の欄を真にするとその含意の側も置く。
 * 2. **作れないと言うべき形**: 執行点の条件が宣言から読めない(DSL 外・数の上限)、行の参照先を
 *    トリガが決める、`pattern` に合う値を作れない。
 *
 * 期待の計算(オラクル)は app 側にあり、ここでは設計図の形だけを固定する ——
 * 実 DB での突き合わせは `app/src/infrastructure/__tests__/generated/rls/**` が受け持つ。
 */

import { describe, expect, it } from 'vitest';
import { buildRlsWorld, type RlsWorldResult } from '../../../lib/world/rls-world.js';
import { rlsWorldRoles } from '../../../lib/world/rls-world-roles.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import type { FieldDef, RoleDef, SpecModel } from '../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  read,
  role,
  roleSpec,
  specModel,
} from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';
import { dataTable } from '../../helpers/data-builder.js';

/**
 * 題材: 棚(shelf)→ 売場(section)→ 店(store)と、実行者の集約 staff_member。
 *
 * `deputy` を立てると、**同じ集約の別の列に束縛された 2 つ目のロール**が増える
 * (fixture `expenses` の `claim.employee_id` / `claim.approver_id` と同じ形)。
 */
function roles(options: Options = {}): readonly RoleDef[] {
  return roleSpec([
    role('anonymous', undefined, undefined, 'anonymous'),
    role('staff_member', undefined, undefined, 'authenticated_default'),
    role('system', undefined, undefined, 'system'),
    { ...role('company_admin', undefined, ['staff_member']), claim: 'staff_member.is_admin' },
    role('store_manager', 'store.manager_id == actor.id', ['staff_member']),
    ...(options.deputy === true ? [role('store_deputy', 'store.deputy_id == actor.id', ['staff_member'])] : []),
  ]).roles;
}

/** 制約(`field` の補助は min / max / pattern を受けないので、ここで足す)。 */
function constrained(base: FieldDef, extra: Partial<FieldDef>): FieldDef {
  return { ...base, ...extra };
}

/** world の作り方を切り替える軸。 */
interface Options {
  /** 境界(`filters`)を宣言するか。 */
  readonly filters?: boolean;
  /** 境界を親の列(`section.company_id`)で宣言するか。 */
  readonly parentFilter?: boolean;
  /** 店の slug に宣言する形(既定は機械的に置いた値が合う形)。 */
  readonly slugPattern?: string;
  /** 店の slug を `pattern` でなく `format: url` で宣言するか(`pattern` を使わない)。 */
  readonly slugUrl?: boolean;
  /** 棚に数の上限の不変条件を持たせるか(`max` の値。`keys` は参照の列)。 */
  readonly cardinalityMax?: number;
  /** 数の上限の群の鍵を参照でない列にするか。 */
  readonly cardinalityOnValue?: boolean;
  /** 店の別の列(`deputy_id`)に束縛された 2 つ目のロールを置くか。 */
  readonly deputy?: boolean;
  /** 棚に「売場の店舗の写し」の列(トリガが埋める必須の参照)を持たせるか。 */
  readonly copiedRef?: boolean;
}

/** ドメイン仕様。 */
function domain(options: Options = {}): SpecModel {
  return specModel(
    [
      aggregate('shelf', {
        entity: entitySpec('shelf', {
          context: { shelf: 'shelf.id', section: 'shelf.section_id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('section_id', { kind: 'ref', entity: 'section' }, { required: true }),
            field('label', { kind: 'string' }, { required: true }),
            field('company_id', { kind: 'uuid' }),
            ...(options.copiedRef === true
              ? [
                  {
                    ...field('store_id', { kind: 'ref', entity: 'store' }, { required: true }),
                    suppliedBy: 'db' as const,
                  },
                ]
              : []),
            constrained(field('slot', { kind: 'integer' }, { required: true }), { min: 1, max: 3 }),
          ],
        }),
        access: accessSpec('shelf', {
          reads: [
            read('anonymous', { kind: 'none' }),
            // 既定のログイン実行者には見せない —— こうしないと `context` の行が刈り込まれ、
            // 束縛のあるロールの実行者が world に現れない(刈り込みの規則そのものは ⑳-4a のテスト)。
            read('staff_member', { kind: 'none' }),
            read(
              'company_admin',
              { kind: 'all' },
              options.filters === true
                ? { company_id: 'company_id' }
                : options.parentFilter === true
                  ? { 'section.company_id': 'company_id' }
                  : undefined,
            ),
            read('store_manager', { kind: 'context', entity: 'store' }),
            ...(options.deputy === true ? [read('store_deputy', { kind: 'context', entity: 'store' })] : []),
            read('system', { kind: 'all' }),
          ],
        }),
        ...(options.cardinalityMax === undefined && options.copiedRef !== true
          ? {}
          : {
              invariants: invariantSpec([
                ...(options.cardinalityMax === undefined
                  ? []
                  : [
                      invariant({
                        id: 'INV-SHELF-001',
                        formal: {
                          kind: 'cardinality',
                          keys: [options.cardinalityOnValue === true ? 'slot' : 'section_id'],
                          max: options.cardinalityMax,
                        },
                      }),
                    ]),
                // 「棚が持つ店舗は、その売場の店舗と一致する」= 写しの宣言(執行はトリガ)。
                ...(options.copiedRef === true
                  ? [
                      invariant({
                        id: 'INV-SHELF-002',
                        formal: { kind: 'check', expr: 'shelf.store_id == section.store_id' },
                      }),
                    ]
                  : []),
              ]),
            }),
      }),
      aggregate('section', {
        entity: entitySpec('section', {
          context: { section: 'section.id', store: 'section.store_id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('store_id', { kind: 'ref', entity: 'store' }, { required: true }),
            // 親の列で書く境界(`section.company_id`)が読む列(必須でない —— 境界を宣言したときだけ埋まる)。
            field('company_id', { kind: 'uuid' }),
            field('opens_at', { kind: 'datetime' }, { required: true }),
            field('closes_at', { kind: 'datetime' }, { required: true }),
          ],
        }),
        invariants: invariantSpec([
          invariant({
            id: 'INV-SECTION-001',
            formal: { kind: 'check', expr: 'section.closes_at > section.opens_at' },
          }),
        ]),
      }),
      aggregate('store', {
        entity: entitySpec('store', {
          context: { store: 'store.id', staff_member: 'store.manager_id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('manager_id', { kind: 'ref', entity: 'staff_member' }, { required: true }),
            ...(options.deputy === true
              ? [field('deputy_id', { kind: 'ref', entity: 'staff_member' }, { required: true })]
              : []),
            constrained(
              field('slug', { kind: 'string' }, { required: true }),
              options.slugUrl === true
                ? { format: 'url', maxLength: 500 }
                : { pattern: options.slugPattern ?? '^[a-z0-9-]+$' },
            ),
          ],
        }),
      }),
      aggregate('staff_member', {
        entity: entitySpec('staff_member', {
          context: { staff_member: 'staff_member.id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('name', { kind: 'string' }, { required: true }),
            field('is_admin', { kind: 'boolean' }, { required: true, session: true }),
            field('company_id', { kind: 'uuid' }, { required: true, session: true }),
            field('state', { kind: 'state', machine: 'staff_member' }),
          ],
        }),
        invariants: invariantSpec([
          invariant({
            id: 'INV-STAFF-001',
            formal: { kind: 'check', expr: 'staff_member.is_admin == false or staff_member.state == active' },
          }),
        ]),
      }),
    ],
    roleSpec([...roles(options)]),
  );
}

/** 4 表の data_table(`policies_migration` を持つのは棚だけ)。 */
function tables(extra: Partial<DataTableSpec> = {}): readonly DataTableSpec[] {
  return [
    dataTable('shelves', {
      entity: 'shelf',
      policiesMigration: '20260101000001_policies_shelves.sql',
      ...extra,
    }),
    dataTable('sections', { entity: 'section' }),
    dataTable('stores', { entity: 'store' }),
    dataTable('staff_members', { entity: 'staff_member' }),
  ];
}

/** 棚の world を組み立てる。 */
function build(options: Options = {}, extra: Partial<DataTableSpec> = {}): RlsWorldResult {
  const all = tables(extra);
  const shelf = all[0];
  if (shelf === undefined) throw new Error('題材が壊れています');
  return buildRlsWorld(shelf, { domain: domain(options), tables: all });
}

/** 組み立てた world(作れなかったら理由を添えて落とす)。 */
function world(options: Options = {}): Extract<RlsWorldResult, { ok: true }>['world'] {
  const result = build(options);
  if (result.ok) return result.world;
  throw new Error(`world が作れません: ${result.problems.map((problem) => problem.message).join(' / ')}`);
}

describe('world の形', () => {
  it('実行者はポリシーに現れるロールごとに 1 人 + 既定のログイン + 未ログインで、system は作らない', () => {
    const built = world();
    expect(built.actors.map((actor) => actor.key)).toEqual([
      'company_admin',
      'store_manager',
      'staff_member',
      'anonymous',
      // どの表にも「ログインしているが実行者の集約に行が無い人」が 1 人いる。
      'staff_member_without_row',
    ]);
    expect(built.actors.find((actor) => actor.key === 'anonymous')?.row).toBeNull();
    expect(built.actors.find((actor) => actor.key === 'store_manager')?.row).toBe(
      'store_manager:staff_member',
    );
  });

  it('行は実行者ごとに 1 系統で、系統の中では集約ごとに 1 行を共有する', () => {
    const built = world();
    const branch = built.rows.filter((row) => row.key.startsWith('store_manager:'));
    // 参照先が先に来る(実行者の集約 → 店 → 売場 → 棚)。
    expect(branch.map((row) => row.entity)).toEqual(['staff_member', 'store', 'section', 'shelf']);
    expect(branch.find((row) => row.entity === 'shelf')?.ancestry).toEqual({
      shelf: 'store_manager:shelf',
      section: 'store_manager:section',
      store: 'store_manager:store',
      staff_member: 'store_manager:staff_member',
    });
  });

  it('的になる行は実行者ごとに 1 つで、束縛の列はその役の実行者だけを指す', () => {
    const built = world();
    expect(built.targets).toEqual(['company_admin:shelf', 'store_manager:shelf', 'staff_member:shelf']);
    expect(built.rows.find((row) => row.key === 'store_manager:store')?.refs['manager_id']).toBe(
      'store_manager:staff_member',
    );
    // その列に束縛されていない実行者の系統では、束縛の列は別人(分けた行)を指す ——
    // ここが実行者自身になっていると「束縛が立たない行」が world から消える。
    expect(built.rows.find((row) => row.key === 'company_admin:store')?.refs['manager_id']).toBe(
      'company_admin:staff_member#store.manager_id',
    );
  });

  it('値は型から決まり、順序・範囲・一意の宣言を満たす', () => {
    const built = world();
    const section = built.rows.find((row) => row.key === 'staff_member:section');
    expect(String(section?.values['opens_at']) < String(section?.values['closes_at'])).toBe(true);
    for (const row of built.rows.filter((candidate) => candidate.entity === 'shelf')) {
      expect(Number(row.values['slot'])).toBeGreaterThanOrEqual(1);
      expect(Number(row.values['slot'])).toBeLessThanOrEqual(3);
    }
    const labels = built.rows.filter((row) => row.entity === 'shelf').map((row) => row.values['label']);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('採番・状態の欄には値を置かない(DB が決める値をテストが書き写さない)', () => {
    const shelf = world().rows.find((row) => row.key === 'staff_member:shelf');
    expect(Object.keys(shelf?.values ?? {})).toEqual(['label', 'slot']);
  });

  it('claim の欄はそのロールの実行者だけ真になり、行内比較の含意の側も置かれる', () => {
    const built = world();
    const admin = built.rows.find((row) => row.key === 'company_admin:staff_member');
    expect(admin?.values['is_admin']).toBe(true);
    expect(admin?.values['state']).toBe('active');
    const plain = built.rows.find((row) => row.key === 'staff_member:staff_member');
    expect(plain?.values['is_admin']).toBe(false);
    expect(plain?.values['state']).toBeUndefined();
  });

  it('境界を宣言した列には、その系統の実行者のセッション属性が写る(系統が違えば値も違う)', () => {
    const shelves = world({ filters: true }).rows.filter((row) => row.entity === 'shelf');
    const built = world({ filters: true });
    for (const shelf of shelves) {
      const branch = shelf.key.slice(0, shelf.key.indexOf(':'));
      const actor = built.rows.find((row) => row.key === `${branch}:staff_member`);
      expect(shelf.values['company_id']).toBe(actor?.values['company_id']);
    }
    expect(new Set(shelves.map((shelf) => shelf.values['company_id'])).size).toBe(shelves.length);
  });

  it('親の列で書いた境界は、その系統の親の行に実行者の値を写し、設計図に辿る列の鎖を載せる', () => {
    const built = world({ parentFilter: true });
    const sections = built.rows.filter((row) => row.entity === 'section');
    for (const section of sections) {
      const branch = section.key.slice(0, section.key.indexOf(':'));
      const actor = built.rows.find((row) => row.key === `${branch}:staff_member`);
      expect(section.values['company_id']).toBe(actor?.values['company_id']);
    }
    expect(new Set(sections.map((section) => section.values['company_id'])).size).toBe(sections.length);
    // 的の行(棚)には写さない —— 境界の列は親にある。
    expect(built.rows.filter((row) => row.entity === 'shelf').every((row) => row.values['company_id'] === undefined)).toBe(true);
    const admin = built.reads.find((rule) => rule.by === 'company_admin');
    expect(admin?.filters).toEqual([{ field: 'company_id', actorField: 'company_id', via: ['section_id'] }]);
    expect(built.actors.map((actor) => actor.key)).toContain('staff_member_other');
  });

  it('自分の列の境界は辿る鎖を持たない(via は空)', () => {
    const admin = world({ filters: true }).reads.find((rule) => rule.by === 'company_admin');
    expect(admin?.filters).toEqual([{ field: 'company_id', actorField: 'company_id', via: [] }]);
  });

  it('境界を宣言した表には「別の境界を持つもう 1 人」が足される(他のテナントの行を world に置く)', () => {
    // 実行者が 1 人しかいない world には「他のテナントの行」が無いので、境界の条件を落とした
    // ポリシーでも検査が通ってしまう(T4 が塞ぎたかった形そのもの)。
    expect(world({ filters: true }).actors.map((actor) => actor.key)).toEqual([
      'company_admin',
      'store_manager',
      'staff_member',
      'anonymous',
      'staff_member_other',
      'staff_member_without_row',
    ]);
    const other = world({ filters: true }).actors.find((actor) => actor.key === 'staff_member_other');
    expect(other?.role).toBe('staff_member');
    expect(other?.anonymous).toBe(false);
    // 境界を宣言しない表には足さない。
    expect(world().actors.map((actor) => actor.key)).not.toContain('staff_member_other');
  });

  it('境界を宣言しなければその列は埋めない(必須でない列は world に現れない)', () => {
    const shelf = world().rows.find((row) => row.entity === 'shelf');
    expect(shelf?.values['company_id']).toBeUndefined();
  });

  it('設計図はポリシーの計画を 1 つも運ばない(権限の有無もオラクルが宣言から導く)', () => {
    // 翻訳器の計画(policyPlans)から `grant` の宛先をもらっていたあいだ、刈り込みの間違いを
    // 生成 SQL と期待が共有していた(独立レビュー ⑳-4b ①)。運ぶのは `reads` とロールの根拠だけ。
    expect(Object.keys(world()).sort()).toEqual([
      'actorTable',
      'actors',
      'entity',
      'reads',
      'rows',
      'table',
      'targets',
    ]);
    expect(world().reads.map((rule) => `${rule.by}:${rule.scope}`)).toEqual([
      'anonymous:none',
      'staff_member:none',
      'company_admin:all',
      'store_manager:context',
      'system:all',
    ]);
  });

  it('ログインしているが実行者の集約に行が無い人が必ず 1 人いる(系統は持たない)', () => {
    const built = world();
    const withoutRow = built.actors.find((actor) => actor.key === 'staff_member_without_row');
    expect(withoutRow?.anonymous).toBe(false);
    expect(withoutRow?.row).toBeNull();
    // 行を持たないので、その名前の行は world に 1 つも無い(未ログインと同じ扱いの系統なし)。
    expect(built.rows.some((row) => row.key.startsWith('staff_member_without_row:'))).toBe(false);
  });

  it('同じ集約を指す束縛の列は、実行者の束縛でなければ別の行(別人)を指す', () => {
    // `store.manager_id` と `store.deputy_id` を 1 行に畳むと、2 つの束縛が必ず同時に立つ
    // world になり、述語の列を隣に取り違えても検査が緑のままになる。
    const built = world({ deputy: true });
    const manager = built.rows.find((row) => row.key === 'store_manager:store');
    expect(manager?.refs['manager_id']).toBe('store_manager:staff_member');
    expect(manager?.refs['deputy_id']).toBe('store_manager:staff_member#store.deputy_id');
    const deputy = built.rows.find((row) => row.key === 'store_deputy:store');
    expect(deputy?.refs['deputy_id']).toBe('store_deputy:staff_member');
    expect(deputy?.refs['manager_id']).toBe('store_deputy:staff_member#store.manager_id');
    // 束縛を持たない実行者の系統では、どちらの列も実行者を指さない。
    const plain = built.rows.find((row) => row.key === 'staff_member:store');
    expect(plain?.refs['manager_id']).toBe('staff_member:staff_member#store.manager_id');
    expect(plain?.refs['deputy_id']).toBe('staff_member:staff_member#store.deputy_id');
    // 分けた行は実行者自身の行ではない(claim の欄も真にしない)。
    const split = built.rows.find((row) => row.key === 'company_admin:staff_member#store.manager_id');
    expect(split?.actor).toBeNull();
    expect(split?.values['is_admin']).toBe(false);
  });

  it('束縛の列でない参照は畳んだままである(行内比較の不変条件を落とさない)', () => {
    const built = world({ deputy: true });
    // 棚 → 売場 → 店は 1 系統に 1 行ずつ(棚と売場が別の店を指したら INV が落ちる)。
    const branch = built.rows.filter((row) => row.key.startsWith('store_manager:'));
    expect(branch.filter((row) => row.entity === 'store')).toHaveLength(1);
    expect(branch.filter((row) => row.entity === 'section')).toHaveLength(1);
  });
});

describe('作れないと言うべき形', () => {
  /** 数の上限のトリガを 1 本足した data_table。 */
  function withQuota(): Partial<DataTableSpec> {
    return {
      triggers: [
        {
          name: 'check_shelf_count',
          functionName: 'check_shelf_count',
          fires: 'before insert or update of section_id',
          deferred: false,
          supplies: [],
          params: {},
          invariant: 'INV-SHELF-001',
        },
      ],
    };
  }

  it('数の上限は「群の鍵が参照の列 + 上限 1 以上」なら作れる(系統ごとに 1 群 1 行になる)', () => {
    expect(build({ cardinalityMax: 3 }, withQuota()).ok).toBe(true);
  });

  it('数の上限が 0 なら作らない(1 行も置けないという宣言である)', () => {
    const result = build({ cardinalityMax: 0 }, withQuota());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('cardinality');
  });

  it('数の上限の群の鍵に参照でない列が混じれば作らない(系統をまたいで同じ群に入る)', () => {
    const result = build({ cardinalityMax: 3, cardinalityOnValue: true }, withQuota());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('cardinality');
  });

  it('挿入で実行されないトリガは無視する', () => {
    const result = build({}, {
      triggers: [
        {
          name: 'check_shelf_label',
          functionName: 'check_shelf_label',
          fires: 'before update of label on shelves',
          deferred: false,
          supplies: [],
          params: {},
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('必須の参照列をトリガが供給するなら作らない', () => {
    const result = build({}, {
      triggers: [
        {
          name: 'fill_shelf_section',
          functionName: 'fill_shelf_section',
          fires: 'before insert on shelves',
          deferred: false,
          supplies: ['section_id'],
          params: {},
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('参照先');
  });

  it('祖先の列の写しを宣言するトリガは止めない(その列を置かずに挿入すればトリガが埋める)', () => {
    // world の形が宣言から決まらないのは「行の置き場をトリガが決める」ときだけである。写しの列は
    // 値の出どころ(祖先の行)が world の中にあるので、置かずに挿入できる(⑳-4b-b ④)。
    const result = build({ copiedRef: true }, {
      triggers: [
        {
          name: 'sync_shelf_store',
          functionName: 'sync_shelf_store',
          fires: 'before insert or update of section_id',
          deferred: false,
          supplies: ['store_id'],
          params: {},
          invariant: 'INV-SHELF-002',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shelf = result.world.rows.find((row) => row.key === 'staff_member:shelf');
    // DB が決める列なので、テストは値も参照も置かない。
    expect(shelf?.refs['store_id']).toBeUndefined();
    expect(shelf?.values['store_id']).toBeUndefined();
  });

  it('写しの宣言が無い供給は止める(同じ列でも不変条件を宣言しなければ置き場が読めない)', () => {
    const result = build({ copiedRef: true }, {
      triggers: [
        {
          name: 'sync_shelf_store',
          functionName: 'sync_shelf_store',
          fires: 'before insert or update of section_id',
          deferred: false,
          supplies: ['store_id'],
          params: {},
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('参照先');
  });

  it('由来の不変条件を宣言しない CHECK があれば作らない', () => {
    const result = build({}, { checks: [{ name: 'shelves_label_not_blank', rule: "label <> ''" }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('宣言されていない');
  });

  it('format: url の列は文法に合う URL を置くので world が作れる(pattern の代用では作れなかった)', () => {
    const result = build({ slugUrl: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slugs = result.world.rows.flatMap((row) => (typeof row.values['slug'] === 'string' ? [row.values['slug']] : []));
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) expect(slug).toMatch(/^https:\/\/example\.test\//);
  });

  it('pattern に合う値を機械的に作れない列があれば作らない(参照先の表でも見る)', () => {
    // 店の slug を `^[a-z]+$` にすると「欄名 + 連番」(slug-1)は合わない。棚の world は店を含む。
    const result = build({ slugPattern: '^[a-z]+$' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.some((problem) => problem.message.includes('pattern'))).toBe(true);
  });
});

describe('ロールの根拠', () => {
  it('未ログイン / 既定 / claim / binding を宣言順に写す', () => {
    expect(rlsWorldRoles(domain())).toEqual([
      {
        id: 'anonymous',
        anonymous: true,
        system: false,
        authenticatedDefault: false,
        claimField: null,
        binding: null,
        implies: [],
      },
      {
        id: 'staff_member',
        anonymous: false,
        system: false,
        authenticatedDefault: true,
        claimField: null,
        binding: null,
        implies: [],
      },
      { id: 'system', anonymous: false, system: true, authenticatedDefault: false, claimField: null, binding: null, implies: [] },
      {
        id: 'company_admin',
        anonymous: false,
        system: false,
        authenticatedDefault: false,
        claimField: 'is_admin',
        binding: null,
        implies: ['staff_member'],
      },
      {
        id: 'store_manager',
        anonymous: false,
        system: false,
        authenticatedDefault: false,
        claimField: null,
        binding: { entity: 'store', column: 'manager_id', many: false },
        implies: ['staff_member'],
      },
    ]);
  });
});
