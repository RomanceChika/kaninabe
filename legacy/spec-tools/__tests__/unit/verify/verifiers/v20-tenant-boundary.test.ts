/**
 * V20(テナント境界の宣言漏れ)の規約網羅テスト。束 ⑲-2a。
 *
 * 対象の要求: 実行者の属性(`actor.{欄}`)で狭める宣言を持てる列を持つエンティティが、
 * `scope: all` / `scope: context(...)` を `filters` 無しで宣言していたら error(以前は warning。商用の製品に当てられないため error に上げた)。
 * 受け入れは対象を名指しする `accept:` でだけ消える(免除リストは無い)。
 */

import { describe, expect, it } from 'vitest';
import { tenantBoundaryVerifier } from '../../../../lib/verify/verifiers/v20-tenant-boundary.js';
import {
  accessSpec,
  aggregate,
  createRule,
  entitySpec,
  field,
  readRule,
  role,
  specModel,
  stubContext,
} from '../../../helpers/model-builder-v8plus.js';
import type { ReadRule } from '../../../../lib/model/types.js';

/** テナント境界を宣言した読み取り 1 本。 */
function withFilters(by: string, scope: ReadRule['scope']): ReadRule {
  return { ...readRule(by, scope), filters: [{ field: 'company_id', actorField: 'company_id' }] };
}

/**
 * 会社(テナント)を持つ 2 集約のモデル。
 *
 * `staff_member.company_id` が `session: true`(= 実行者の属性)で、`store` がその列を持つ。
 * `store.creates[].when` が `actor.company_id` を使っているので、この欄は「境界を表す欄」である。
 */
function model(init: {
  storeReads: readonly ReadRule[];
  accepts?: readonly { by: string; field: string; reason: string; location: { file: string } }[];
}) {
  return specModel({
    roles: [
      role('anonymous'),
      role('system'),
      role('staff_member'),
      role('store_manager', 'store.manager_id == actor.id'),
    ],
    aggregates: [
      aggregate({
        name: 'staff_member',
        entity: entitySpec('staff_member', [
          field('company_id', { kind: 'ref', entity: 'company' }, { required: true, session: true }),
        ]),
        access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
      }),
      aggregate({
        name: 'store',
        entity: entitySpec('store', [
          field('company_id', { kind: 'ref', entity: 'company' }, { required: true }),
          field('manager_id', { kind: 'ref', entity: 'staff_member' }),
        ]),
        access: accessSpec('store', {
          reads: init.storeReads,
          creates: [createRule('staff_member', 'store.company_id == actor.company_id')],
          ...(init.accepts === undefined ? {} : { accepts: init.accepts }),
        }),
      }),
    ],
  });
}

describe('tenantBoundaryVerifier', () => {
  it('scope: all を filters 無しで宣言していたら error(書き忘れを黙って通さない)', () => {
    const { ctx } = stubContext({});
    const findings = tenantBoundaryVerifier.verify(
      model({ storeReads: [readRule('staff_member', { kind: 'all' })] }),
      ctx,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('実行者の属性を表す列 company_id で狭める filters がありません');
    expect(findings[0]?.suggestion).toContain('filters: { company_id: actor.company_id }');
  });

  it('filters を書いていれば黙る', () => {
    const { ctx } = stubContext({});
    expect(
      tenantBoundaryVerifier.verify(model({ storeReads: [withFilters('staff_member', { kind: 'all' })] }), ctx),
    ).toEqual([]);
  });

  it('scope: context も対象にする(原理の集合が狭いだけで、境界の宣言にはならない)', () => {
    const { ctx } = stubContext({});
    const findings = tenantBoundaryVerifier.verify(
      model({ storeReads: [readRule('store_manager', { kind: 'context', entity: 'store' })] }),
      ctx,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['scope']).toBe('context(store)');
  });

  it('対象を名指しした accept があれば消える(理由つき受け入れ)', () => {
    const { ctx } = stubContext({});
    const findings = tenantBoundaryVerifier.verify(
      model({
        storeReads: [readRule('store_manager', { kind: 'context', entity: 'store' })],
        accepts: [
          {
            by: 'store_manager',
            field: 'company_id',
            reason: '対象の店舗の責任者としてしか立たないロールなので、跨いだ行は集合に入らない',
            location: { file: 'docs/specs/domain/store/access.md' },
          },
        ],
      }),
      ctx,
    );

    expect(findings).toEqual([]);
  });

  describe('accept の on は書いた種類にだけ効く(A3-4)', () => {
    const base = { by: 'staff_member', field: 'company_id', reason: '作成のときは DB が写すので結ばなくてよい', location: { file: 'docs/specs/domain/store/access.md' } };
    const CASES: readonly { readonly name: string; readonly on: readonly ('read' | 'create' | 'write' | 'delete' | 'transition')[] | undefined; readonly silent: boolean }[] = [
      { name: 'on 無し = 読み取りだけ(従来どおり)', on: undefined, silent: true },
      { name: 'on: [create] は読み取りを受け入れない', on: ['create'], silent: false },
      { name: 'on: [write, delete, transition] も読み取りを受け入れない', on: ['write', 'delete', 'transition'], silent: false },
      { name: 'on: [read] は読み取りを受け入れる', on: ['read'], silent: true },
      { name: 'on: [read, create] は読み取りも受け入れる', on: ['read', 'create'], silent: true },
    ];
    for (const entry of CASES) {
      it(entry.name, () => {
        const { ctx } = stubContext({});
        const accept = entry.on === undefined ? base : { ...base, on: entry.on };
        const findings = tenantBoundaryVerifier.verify(model({ storeReads: [readRule('staff_member', { kind: 'all' })], accepts: [accept] }), ctx);
        expect(findings.length === 0).toBe(entry.silent);
      });
    }
  });

  it('別のロールを名指しした accept では消えない(受け入れは 1 件ずつ)', () => {
    const { ctx } = stubContext({});
    const findings = tenantBoundaryVerifier.verify(
      model({
        storeReads: [readRule('staff_member', { kind: 'all' })],
        accepts: [
          {
            by: 'store_manager',
            field: 'company_id',
            reason: '別の規則についての受け入れ',
            location: { file: 'docs/specs/domain/store/access.md' },
          },
        ],
      }),
      ctx,
    );

    expect(findings).toHaveLength(1);
  });

  it('scope: own / none は対象にしない(原理として実行者の行しか返らない)', () => {
    const { ctx } = stubContext({});
    expect(
      tenantBoundaryVerifier.verify(
        model({
          storeReads: [readRule('staff_member', { kind: 'own' }), readRule('anonymous', { kind: 'none' })],
        }),
        ctx,
      ),
    ).toEqual([]);
  });

  it('システム起点のロールは対象にしない(実行者の属性が供給されず、RLS も通らない)', () => {
    const { ctx } = stubContext({});
    expect(tenantBoundaryVerifier.verify(model({ storeReads: [readRule('system', { kind: 'all' })] }), ctx)).toEqual([]);
  });

  it('未ログインの scope: all は error にせず warning で名指す(A3-3。ログイン中の人の境界まで実質消える)', () => {
    const { ctx } = stubContext({});
    const findings = tenantBoundaryVerifier.verify(
      model({ storeReads: [readRule('anonymous', { kind: 'all' }), withFilters('staff_member', { kind: 'all' })] }),
      ctx,
    );

    expect(findings.map((finding) => [finding.severity, finding.counterexample?.['by'], finding.counterexample?.['kind']])).toEqual([
      ['warning', 'anonymous', 'actorless_open'],
    ]);
    expect(findings[0]?.message).toContain('ログイン中の人にも当たる');
  });

  it('未ログインの scope: all も、名指した accept(読み取り)があれば消える', () => {
    const { ctx } = stubContext({});
    const reason = '公開のカタログで、会社を跨いで見せる';
    const accept = { by: 'anonymous', field: 'company_id', reason, location: { file: 'docs/specs/domain/store/access.md' } };
    expect(tenantBoundaryVerifier.verify(model({ storeReads: [readRule('anonymous', { kind: 'all' })], accepts: [accept] }), ctx)).toEqual([]);
  });

  it('未ログインの scope: none は対象にしない', () => {
    const { ctx } = stubContext({});
    expect(tenantBoundaryVerifier.verify(model({ storeReads: [readRule('anonymous', { kind: 'none' })] }), ctx)).toEqual([]);
  });

  it('session: true の参照の欄は、どこで使われていなくても境界になる(A3-2(a)。全部消すと 0 件、を閉じる)', () => {
    const { ctx } = stubContext({});
    const unused = specModel({
      roles: [role('anonymous'), role('system'), role('staff_member')],
      aggregates: [
        aggregate({
          name: 'staff_member',
          entity: entitySpec('staff_member', [field('company_id', { kind: 'ref', entity: 'company' }, { required: true, session: true })]),
          access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
        }),
        aggregate({
          name: 'store',
          entity: entitySpec('store', [field('company_id', { kind: 'ref', entity: 'company' }, { required: true })]),
          // `actor.company_id` をどこにも書いていない(境界を全部書き忘れた形)。
          access: accessSpec('store', { reads: [readRule('staff_member', { kind: 'all' })] }),
        }),
      ],
    });

    const findings = tenantBoundaryVerifier.verify(unused, ctx);
    expect(findings.map((finding) => [finding.severity, finding.counterexample?.['entity'], finding.counterexample?.['column']])).toEqual([
      ['error', 'store', 'company_id'],
    ]);
  });

  it('session: true でも参照でない欄(表示名・真偽)は境界にしない', () => {
    const { ctx } = stubContext({});
    const plain = specModel({
      roles: [role('staff_member')],
      aggregates: [
        aggregate({
          name: 'staff_member',
          entity: entitySpec('staff_member', [field('display_name', { kind: 'string' }, { session: true }), field('is_admin', { kind: 'boolean' }, { session: true })]),
          access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
        }),
        aggregate({
          name: 'note',
          entity: entitySpec('note', [field('display_name', { kind: 'string' })]),
          access: accessSpec('note', { reads: [readRule('staff_member', { kind: 'all' })] }),
        }),
      ],
    });

    expect(tenantBoundaryVerifier.verify(plain, ctx)).toEqual([]);
  });

  it('実行者の属性をどこでも使っていない仕様では何も見ない(語を発明しない)', () => {
    const { ctx } = stubContext({});
    const plain = specModel({
      roles: [role('staff_member')],
      aggregates: [
        aggregate({
          name: 'store',
          entity: entitySpec('store', [field('company_id', { kind: 'string' })]),
          access: accessSpec('store', { reads: [readRule('staff_member', { kind: 'all' })] }),
        }),
      ],
    });

    expect(tenantBoundaryVerifier.verify(plain, ctx)).toEqual([]);
  });

  it('列名が違っても同じ ref 先を指していれば対象にする(改名で視界から外れない)', () => {
    const { ctx } = stubContext({});
    const renamed = specModel({
      roles: [role('staff_member')],
      aggregates: [
        aggregate({
          name: 'staff_member',
          entity: entitySpec('staff_member', [
            field('company_id', { kind: 'ref', entity: 'company' }, { required: true, session: true }),
          ]),
          access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
        }),
        aggregate({
          name: 'store',
          entity: entitySpec('store', [field('owner_company_id', { kind: 'ref', entity: 'company' })]),
          access: accessSpec('store', {
            reads: [readRule('staff_member', { kind: 'all' })],
            creates: [createRule('staff_member', 'store.owner_company_id == actor.company_id')],
          }),
        }),
      ],
    });

    const findings = tenantBoundaryVerifier.verify(renamed, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['column']).toBe('owner_company_id');
  });
});

/**
 * 会議室の予約(rooms の題材)に会社を足した形 —— 予約 → 部屋 → 部門 のうち、**部門だけ**が会社の列を持つ。
 *
 * 予約と部屋は会社の列を持たないので、以前の V20 は候補を見つけず warning すら出さなかった
 * (予約の `reads: by user scope all` が他社の予約を全部返すのに)。実行者(利用者)は `session: true` の
 * `company_id` を持ち、部門の reads がそれで境界を書いている。
 */
function roomsModel(init: {
  bookingReads: readonly ReadRule[];
  roomReads?: readonly ReadRule[];
  accepts?: readonly { by: string; field: string; reason: string; location: { file: string } }[];
}) {
  return specModel({
    roles: [role('anonymous'), role('system'), role('user'), role('booking_owner', 'booking.user_id == actor.id')],
    aggregates: [
      aggregate({
        name: 'user',
        entity: entitySpec(
          'user',
          [field('company_id', { kind: 'ref', entity: 'company' }, { required: true, session: true })],
          { user: 'user.id' },
        ),
        access: accessSpec('user', { reads: [readRule('user', { kind: 'own' })] }),
      }),
      aggregate({
        name: 'department',
        entity: entitySpec(
          'department',
          [field('company_id', { kind: 'ref', entity: 'company' }, { required: true })],
          { department: 'department.id' },
        ),
        access: accessSpec('department', {
          reads: [{ ...readRule('user', { kind: 'all' }), filters: [{ field: 'company_id', actorField: 'company_id' }] }],
        }),
      }),
      aggregate({
        name: 'room',
        entity: entitySpec('room', [field('department_id', { kind: 'ref', entity: 'department' }, { required: true })], {
          department: 'room.department_id',
        }),
        access: accessSpec('room', { reads: init.roomReads ?? [] }),
      }),
      aggregate({
        name: 'booking',
        entity: entitySpec('booking', [field('room_id', { kind: 'ref', entity: 'room' }, { required: true })], {
          booking: 'booking.id',
          room: 'booking.room_id',
        }),
        access: accessSpec('booking', {
          reads: init.bookingReads,
          ...(init.accepts === undefined ? {} : { accepts: init.accepts }),
        }),
      }),
    ],
  });
}

/** 親の列で境界を書いた読み取り 1 本。 */
function withParentFilter(by: string, scope: ReadRule['scope'], entity: string): ReadRule {
  return { ...readRule(by, scope), filters: [{ entity, field: 'company_id', actorField: 'company_id' }] };
}

describe('tenantBoundaryVerifier — 祖先が境界の列を持つ子表(予約 → 部屋 → 部門)', () => {
  it('自分は会社の列を持たない子表の scope: all を、祖先の列を名指して error にする(2 段先まで)', () => {
    const { ctx } = stubContext({});
    const findings = tenantBoundaryVerifier.verify(
      roomsModel({ bookingReads: [readRule('user', { kind: 'all' })], roomReads: [readRule('user', { kind: 'all' })] }),
      ctx,
    );

    const booking = findings.find((finding) => finding.counterexample?.['entity'] === 'booking');
    const room = findings.find((finding) => finding.counterexample?.['entity'] === 'room');
    expect(findings).toHaveLength(2);
    expect(booking?.severity).toBe('error');
    expect(booking?.message).toContain('祖先が持つ実行者の属性を表す列(department.company_id)');
    expect(booking?.suggestion).toContain('filters: { department.company_id: actor.company_id }');
    expect(room?.message).toContain('department.company_id');
  });

  it('親の列({集約}.{列})で境界を書けば黙る', () => {
    const { ctx } = stubContext({});
    expect(
      tenantBoundaryVerifier.verify(
        roomsModel({
          bookingReads: [withParentFilter('user', { kind: 'all' }, 'department')],
          roomReads: [withParentFilter('user', { kind: 'all' }, 'department')],
        }),
        ctx,
      ),
    ).toEqual([]);
  });

  it('祖先の列を名指した accept でも消える(理由つき受け入れ)', () => {
    const { ctx } = stubContext({});
    const findings = tenantBoundaryVerifier.verify(
      roomsModel({
        bookingReads: [readRule('user', { kind: 'all' })],
        accepts: [
          {
            by: 'user',
            field: 'department.company_id',
            reason: '会社を跨いで空きを探す運用である',
            location: { file: 'docs/specs/domain/booking/access.md' },
          },
        ],
      }),
      ctx,
    );

    expect(findings).toEqual([]);
  });

  it('scope: own の子表は対象にしない(原理として実行者の行しか返らない)', () => {
    const { ctx } = stubContext({});
    expect(
      tenantBoundaryVerifier.verify(roomsModel({ bookingReads: [readRule('booking_owner', { kind: 'own' })] }), ctx),
    ).toEqual([]);
  });

  /** 予約の `context` を差し替えたモデル(生の参照 room_id はそのまま)。 */
  function withBookingContext(context: Readonly<Record<string, string>>, accepts?: Parameters<typeof roomsModel>[0]['accepts']) {
    const model = roomsModel({ bookingReads: [readRule('user', { kind: 'all' })], ...(accepts === undefined ? {} : { accepts }) });
    const booking = model.aggregates.get('booking');
    const cut = booking?.entity === undefined ? undefined : { ...booking.entity, context };
    return { ...model, aggregates: new Map([...model.aggregates, ['booking', { ...booking!, entity: cut! }]]) };
  }

  it('context に祖先の宣言が無くても、生の参照で境界の列に届くなら黙らない(A3-2(b)。境界を書けない形として error)', () => {
    const { ctx } = stubContext({});
    const findings = tenantBoundaryVerifier.verify(withBookingContext({ booking: 'booking.id' }), ctx);

    expect(findings.map((finding) => [finding.severity, finding.counterexample?.['entity'], finding.counterexample?.['kind'], finding.counterexample?.['column']])).toEqual([
      ['error', 'booking', 'unreachable', 'room_id'],
    ]);
    expect(findings[0]?.message).toContain('context で 2 段以内・1 通りに辿れない');
  });

  it('境界を書けない形も、生の参照の欄を名指した accept(読み取り)なら消える', () => {
    const { ctx } = stubContext({});
    const accept = { by: 'user', field: 'room_id', reason: '会社を跨いで空きを探す運用である', location: { file: 'docs/specs/domain/booking/access.md' } };
    expect(tenantBoundaryVerifier.verify(withBookingContext({ booking: 'booking.id' }, [accept]), ctx)).toEqual([]);
  });

  it('祖先が 3 段先(context の 2 段で届かない)でも黙らない', () => {
    const { ctx } = stubContext({});
    const base = roomsModel({ bookingReads: [withParentFilter('user', { kind: 'all' }, 'department')] });
    const attendee = aggregate({
      name: 'attendee',
      entity: entitySpec('attendee', [field('booking_id', { kind: 'ref', entity: 'booking' }, { required: true })], {
        attendee: 'attendee.id',
        booking: 'attendee.booking_id',
      }),
      access: accessSpec('attendee', { reads: [readRule('user', { kind: 'all' })] }),
    });
    const deep = { ...base, aggregates: new Map([...base.aggregates, ['attendee', attendee]]) };

    const findings = tenantBoundaryVerifier.verify(deep, ctx);
    expect(findings.map((finding) => [finding.counterexample?.['entity'], finding.counterexample?.['kind']])).toEqual([['attendee', 'unreachable']]);
  });

  it('境界の列を持つ表へ生の参照でも届かない表(共有の参照データ)は対象にしない', () => {
    const { ctx } = stubContext({});
    const base = roomsModel({ bookingReads: [withParentFilter('user', { kind: 'all' }, 'department')] });
    const shared = aggregate({
      name: 'holiday',
      entity: entitySpec('holiday', [field('name', { kind: 'string' })], { holiday: 'holiday.id' }),
      access: accessSpec('holiday', { reads: [readRule('user', { kind: 'all' })] }),
    });
    const model = { ...base, aggregates: new Map([...base.aggregates, ['holiday', shared]]) };
    expect(tenantBoundaryVerifier.verify(model, ctx)).toEqual([]);
  });
});

describe('tenantBoundaryVerifier — 境界の欄が 0 本でも黙らない(点検 5 回目 A5-4)', () => {
  /** 実行者の集約の欄・店舗の欄・店舗の作成の when を差し替えられるモデル。 */
  function zeroModel(init: { actorField: Partial<import('../../../../lib/model/types.js').FieldDef>; storeTarget?: string; storeWhen?: string; extraActorRef?: boolean }) {
    return specModel({
      roles: [role('anonymous'), role('system'), role('staff_member')],
      aggregates: [
        aggregate({
          name: 'staff_member',
          entity: entitySpec('staff_member', [
            field('display_name', { kind: 'string' }, { session: true }),
            field('company_id', { kind: 'ref', entity: 'company' }, { required: true, ...init.actorField }),
            ...(init.extraActorRef === true ? [field('favorite_store_id', { kind: 'ref', entity: 'store' })] : []),
          ]),
          access: accessSpec('staff_member', { reads: [readRule('staff_member', { kind: 'own' })] }),
        }),
        aggregate({
          name: 'store',
          entity: entitySpec('store', [field('company_id', { kind: 'ref', entity: init.storeTarget ?? 'company' }, { required: true })]),
          access: accessSpec('store', {
            reads: [readRule('staff_member', { kind: 'all' })],
            creates: [createRule('staff_member', init.storeWhen)],
          }),
        }),
      ],
    });
  }

  /** [題, 実行者の会社の欄, 店舗の参照先, 店舗の作成の when, 期待する指摘(`重さ 集約.欄 → 参照先`)]。 */
  const CASES: readonly (readonly [string, Partial<import('../../../../lib/model/types.js').FieldDef>, string | undefined, string | undefined, readonly string[]])[] = [
    ['session を付けず境界を 1 本も書かない → 会社の欄を error で名指す(fail-closed)', {}, undefined, undefined, ['error staff_member.company_id → company']],
    ['not_boundary で理由を書けば外れ、受け入れた危険として名指す(A6-3)', { notBoundary: '所属の印で、見える行を狭めない' }, undefined, undefined, ['warning staff_member.company_id not_boundary']],
    ['ほかの集約が同じ参照先を指さなければ、テナントの欄に見えない(境界: 共有 0 集約)', {}, 'region', undefined, []],
    ['session: true なら境界の欄があり、ふつうの V20 が店舗の filters の書き忘れを言う', { session: true }, undefined, undefined, ['error store reads']],
    ['actor.{欄} の使用で境界の欄が 1 本でもあれば、0 本の扱いにはならない', {}, undefined, 'store.company_id == actor.company_id', ['error store reads']],
  ];

  it.each(CASES)('%s', (_title, actorField, storeTarget, storeWhen, expected) => {
    const { ctx } = stubContext({});
    const findings = tenantBoundaryVerifier.verify(zeroModel({ actorField, ...(storeTarget === undefined ? {} : { storeTarget }), ...(storeWhen === undefined ? {} : { storeWhen }) }), ctx);
    expect(
      findings.map((finding) =>
        finding.counterexample?.['kind'] === 'latent_boundary'
          ? `${finding.severity} ${String(finding.counterexample['entity'])}.${String(finding.counterexample['field'])} → ${String(finding.counterexample['target'])}`
          : finding.counterexample?.['kind'] === 'not_boundary'
            ? `${finding.severity} ${String(finding.counterexample['entity'])}.${String(finding.counterexample['field'])} not_boundary`
            : `${finding.severity} ${String(finding.counterexample?.['entity'] ?? '')} reads`,
      ),
    ).toEqual(expected);
  });

  it('名指しの文は V20 / V26 が何も見ていないことと、session: true か not_boundary の直し方を言う', () => {
    const { ctx } = stubContext({});
    const [finding] = tenantBoundaryVerifier.verify(zeroModel({ actorField: {} }), ctx);
    expect(finding?.message).toContain('V20 / V26 は何も見ていません');
    expect(finding?.message).toContain('ほかの集約(store)');
    expect(finding?.suggestion).toContain('session: true');
    expect(finding?.suggestion).toContain('not_boundary');
  });

  it('実行者の集約のほかの参照の欄(店舗を指す好みの欄)も、共有されていれば同じく名指す', () => {
    const { ctx } = stubContext({});
    const findings = tenantBoundaryVerifier.verify(zeroModel({ actorField: { notBoundary: '所属の印' }, extraActorRef: true }), ctx);
    // 店舗を指すのは実行者の集約自身だけ(参照先の店舗自身は数えない)なので、共有されていない(残るのは not_boundary の名指しだけ)。
    expect(findings.map((finding) => `${finding.severity} ${String(finding.counterexample?.['kind'])}`)).toEqual(['warning not_boundary']);
  });
});
