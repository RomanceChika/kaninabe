/**
 * R2(役の根拠の欄の書き手)の単体テスト。
 *
 * 根拠の欄の 3 種(claim・binding・actor.{欄})× 経路(編集・作成の初期値・遷移・内部実行の入口)の組を 1 つずつ固定し、
 * 「その役を持つか含意する書き手は通る」「持たない書き手は止まる」「self_assign を書けば通る」「腐った受け入れは止まる」
 * 「内部実行は追える入口があるときだけ通る」を見る。
 */

import { describe, expect, it } from 'vitest';
import { verifyGroundWriters, type GroundWritersInput } from '../../../lib/risk/verifiers/r2-ground-writers.js';
import type { AccessSpec, AggregateSpecs, EventDef, FieldDef, RoleDef, SelfAssignDecl, SpecModel } from '../../../lib/model/types.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';
import type { TraceCatalogs } from '../../../lib/risk/verifiers/r2-trace.js';
import {
  accessSpec,
  aggregate,
  create,
  entitySpec,
  event,
  field,
  machine,
  read,
  role,
  roleSpec,
  specModel,
  write,
} from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import { authBranch, authFlow } from '../../helpers/auth-builder.js';
import { integration, externalCatalog } from '../../helpers/external-builder.js';
import { jobCatalog, scheduledJob } from '../../helpers/job-builder.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';

/** 役の一式(状態の claim・boolean の claim・本人の役・所有者の役)。 */
const ROLES: readonly RoleDef[] = [
  role('anonymous'),
  { ...role('member'), claim: 'member.state', claimValues: ['active'], implies: ['anonymous'] },
  { ...role('staff', undefined, ['member']), claim: 'member.is_staff' },
  role('system'),
  role('self', 'member.id == actor.id', ['anonymous']),
  role('owner', 'thing.owner_id == actor.id', ['member']),
];

/** メンバーの状態機械(guest → active が役を与える)。 */
function membership(events: readonly EventDef[]) {
  return machine('membership', { states: ['guest', 'active', 'suspended'], initial: 'guest', events });
}

/** 既定の遷移(どれも役を与えないか、役を持つ人が起こす)。 */
const SAFE_EVENTS: readonly EventDef[] = [
  event('activate', { from: ['guest'], to: 'active', by: ['staff'] }),
  event('suspend', { from: ['active'], to: 'suspended', by: ['self', 'staff'] }),
];

/** 材料を組む。 */
function input(opts: {
  readonly memberAccess?: Partial<AccessSpec>;
  readonly thingAccess?: Partial<AccessSpec>;
  readonly events?: readonly EventDef[];
  readonly actions?: ActionSpecModel;
  readonly catalogs?: Partial<TraceCatalogs>;
  readonly blockedSources?: readonly string[];
  readonly roles?: readonly RoleDef[];
  /** thing に必須の 2 本目の実行者への参照 `reviewer_id` を足す(持ち主の欄の候補が 2 本の形。A8-1)。 */
  readonly reviewer?: boolean;
  /** member に足す欄(enum の claim の形。A11-1)。 */
  readonly memberFields?: readonly FieldDef[];
}): GroundWritersInput {
  const member: AggregateSpecs = aggregate('member', {
    entity: entitySpec('member', {
      fields: [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('is_staff', { kind: 'boolean' }, { session: true, required: true }),
        field('state', { kind: 'state', machine: 'membership' }, { session: true }),
        field('tenant_id', { kind: 'uuid' }, { session: true }),
        ...(opts.memberFields ?? []),
      ],
    }),
    stateMachines: [membership(opts.events ?? SAFE_EVENTS)],
    access: { ...accessSpec('member'), ...opts.memberAccess },
  });
  const thing: AggregateSpecs = aggregate('thing', {
    entity: entitySpec('thing', {
      fields: [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('owner_id', { kind: 'ref', entity: 'member' }, { required: true }),
        ...(opts.reviewer === true ? [field('reviewer_id', { kind: 'ref', entity: 'member' }, { required: true })] : []),
        field('tenant_id', { kind: 'uuid' }),
      ],
    }),
    access: { ...accessSpec('thing', { reads: [read('member', 'all', { tenant_id: 'tenant_id' })] }), ...opts.thingAccess },
  });
  const model: SpecModel = specModel([member, thing], roleSpec(opts.roles ?? ROLES));
  return {
    model,
    actions: opts.actions,
    dataTables: opts.catalogs?.dataTables,
    catalogs: { auth: undefined, external: undefined, jobs: undefined, dataTables: undefined, ...opts.catalogs },
    blockedSources: opts.blockedSources ?? [],
  };
}

/** R2 の指摘の message。 */
function messages(value: GroundWritersInput): readonly string[] {
  return verifyGroundWriters(value).findings.map((finding) => finding.message);
}

/** 受け入れ 1 要素(欄 × 役 × 書き手を名指す)。 */
function sa(qualified: string, role: string | undefined, by: readonly string[], reason: string): SelfAssignDecl {
  const [entity = '', name = ''] = qualified.split('.');
  return { entity, field: name, ...(role === undefined ? {} : { role }), by, reason, location: { file: 'access.md', pointer: `self_assign.${qualified}` } };
}

/** 1 つのモデルの actions。 */
function actions(...specs: ReturnType<typeof actionSpec>[]): ActionSpecModel {
  return { actions: specs, unhandled: [], scans: [], unscanned: [], testTagBaseline: [] };
}

describe('R2 claim の欄', () => {
  it('役を持つ書き手(staff が is_staff を書く)は通る', () => {
    expect(messages(input({ memberAccess: { writes: [write('staff', ['is_staff'])] } }))).toEqual([]);
  });

  it('役を持たない書き手(既定のログインロールが is_staff を書く)は自己昇格として止まる', () => {
    expect(messages(input({ memberAccess: { writes: [write('member', ['is_staff'])] } }))).toEqual([
      expect.stringContaining('役 staff の根拠の欄 member.is_staff(claim)をその役を持たない member が書ける形です'),
    ]);
  });

  it('本人が状態を役の立つ状態へ戻す遷移は止まる', () => {
    const events = [...SAFE_EVENTS, event('resume', { from: ['suspended'], to: 'active', by: ['self'] })];

    expect(messages(input({ events }))).toEqual([expect.stringContaining('遷移 membership.resume(by: self)')]);
  });

  it('その遷移に self_assign の理由を書けば通る', () => {
    const events = [...SAFE_EVENTS, { ...event('resume', { from: ['suspended'], to: 'active', by: ['self'] }), selfAssign: [sa('member.state', 'member', ['self'], '休会は本人の申し出なので復帰も本人ができる')] }];

    expect(messages(input({ events }))).toEqual([]);
  });

  it('役を与えない遷移の self_assign は腐った受け入れとして止まる', () => {
    const events = [SAFE_EVENTS[0] as EventDef, { ...(SAFE_EVENTS[1] as EventDef), selfAssign: [sa('member.state', 'member', ['self'], '理由')] }];

    expect(messages(input({ events }))).toEqual([expect.stringContaining('遷移 membership.suspend の self_assign は member.state(役 member) を書き手 self について名指していますが')]);
  });

  it('理由の空の self_assign は止まる(受け入れにならない)', () => {
    const rule = { ...write('member', ['is_staff']), selfAssign: [sa('member.is_staff', 'staff', ['member'], ' ')] };

    expect(messages(input({ memberAccess: { writes: [rule] } }))).toEqual([
      expect.stringContaining('その役を持たない member が書ける形です'),
      expect.stringContaining('self_assign(member.is_staff(役 staff))の理由が空です'),
    ]);
  });

  it('作成の既定値が役を与える(is_staff の既定が true)なら、作成者は役を持たなければ止まる', () => {
    const dataTables = dataTableModel([dataTable('members', { entity: 'member', defaults: { is_staff: 'true' } })]);

    expect(messages(input({ memberAccess: { creates: [create('member')] }, catalogs: { dataTables } }))).toEqual([
      expect.stringContaining('既定値 true'),
    ]);
  });

  // 点検 11 回目 A11-1: 値を小文字に潰さない(比較を無視するのは boolean だけ)・読めない式は supplied_by: db と同じく経路を立てる。
  describe('既定値の式の読み方(A11-1)', () => {
    /** enum の欄 tier を持つ member と、claim のロール paid(値は引数)。 */
    function tiered(values: readonly string[], raw: string): GroundWritersInput {
      const tier = field('tier', { kind: 'enum', values: [...values, 'other'] } as FieldDef['type'], { session: true });
      const paid: RoleDef = { ...role('paid'), claim: 'member.tier', claimValues: values };
      return input({
        roles: [...ROLES, paid],
        memberFields: [tier],
        memberAccess: { creates: [create('member')] },
        catalogs: { dataTables: dataTableModel([dataTable('members', { entity: 'member', defaults: { tier: raw } })]) },
      });
    }

    it.each([
      { name: '対照(小文字 + text)', values: ['pro'], raw: "'pro'::text" },
      { name: '先頭が大文字の値(探り台本 D1)', values: ['Pro'], raw: "'Pro'::text" },
      { name: '全部大文字の値', values: ['PRO'], raw: "'PRO'::text" },
      { name: '下線のある型(探り台本 D2)', values: ['pro'], raw: "'pro'::account_tier" },
      { name: '長さつきの型(探り台本 D3)', values: ['pro'], raw: "'pro'::character varying(10)" },
      { name: '括弧(探り台本 D4)', values: ['pro'], raw: "('pro'::text)" },
    ])('役を与える既定値は経路が立つ: $name', ({ values, raw }) => {
      expect(messages(tiered(values, raw))).toEqual([expect.stringContaining(`既定値 ${raw}`)]);
    });

    it.each([
      { name: '関数', raw: 'pick_tier()' },
      { name: '連結', raw: "'p'::text || 'ro'::text" },
      { name: '関数を通した大文字', raw: "lower('PRO'::text)" },
      { name: '引用符の無い綴り', raw: 'Pro' },
    ])('読めない式は「役を与えない」に倒さず経路が立つ(supplied_by: db と同じ): $name', ({ raw }) => {
      expect(messages(tiered(['pro'], raw))).toEqual([expect.stringContaining('式を読めない値は仕様から追えない')]);
    });

    it.each([
      { name: '別の値', raw: "'free'::text" },
      { name: '綴りの違う値(実行時の比較も綴りのまま)', raw: "'PRO'::text" },
      { name: 'NULL', raw: 'null' },
    ])('読めて役を与えない既定値は経路が立たない: $name', ({ raw }) => {
      expect(messages(tiered(['pro'], raw))).toEqual([]);
    });

    it.each([
      { raw: 'nextval_flag()', hit: '式を読めない値' },
      { raw: "'t'::boolean", hit: '式を読めない値' },
      { raw: 'TRUE', hit: '既定値 TRUE' },
    ])('boolean の claim: $raw は経路が立つ', ({ raw, hit }) => {
      const dataTables = dataTableModel([dataTable('members', { entity: 'member', defaults: { is_staff: raw } })]);

      expect(messages(input({ memberAccess: { creates: [create('member')] }, catalogs: { dataTables } }))).toEqual([expect.stringContaining(hit)]);
    });

    it('読めない式でも、役を持つ書き手・理由つきの受け入れは通る', () => {
      const dataTables = dataTableModel([dataTable('members', { entity: 'member', defaults: { is_staff: 'pick()' } })]);

      expect(messages(input({ memberAccess: { creates: [create('staff')] }, catalogs: { dataTables } }))).toEqual([]);
      expect(
        messages(
          input({
            memberAccess: { creates: [{ ...create('member'), selfAssign: [sa('member.is_staff', 'staff', ['member'], '登録の既定は DB の関数が決める')] }] },
            catalogs: { dataTables },
          }),
        ),
      ).toEqual([]);
    });
  });

  it('作成の既定値が役を与えない(false)なら作成者を問わない', () => {
    const dataTables = dataTableModel([dataTable('members', { entity: 'member', defaults: { is_staff: "'false'::boolean" } })]);

    expect(messages(input({ memberAccess: { creates: [create('member')] }, catalogs: { dataTables } }))).toEqual([]);
  });

  it('作成の入力で claim の欄を受けると、作成者は役を持たなければ止まる', () => {
    const value = input({ memberAccess: { creates: [create('member')] }, actions: actions(actionSpec({ handles: 'member.create', input: ['member.is_staff'] })) });

    expect(messages(value)).toEqual([expect.stringContaining('経路: input member.is_staff')]);
  });
});

describe('受け入れは名指した書き手にだけ効く(点検 10 回目 A10-1)', () => {
  const REASON = '休会は本人の申し出なので復帰も本人ができる';
  /** 復帰の遷移(suspended → active。member の claim を満たす状態へ動かす)を by と受け入れつきで足す。 */
  function resume(by: readonly string[], decls: readonly SelfAssignDecl[]): GroundWritersInput {
    const resumeEvent = { ...event('resume', { from: ['suspended'], to: 'active', by: [...by] }), ...(decls.length === 0 ? {} : { selfAssign: decls }) };
    return input({ events: [...SAFE_EVENTS, resumeEvent] });
  }
  const selfFinding = expect.stringContaining('遷移 membership.resume(by: self) は、役 member の根拠の欄 member.state(claim)をその役を持たない self が書ける形です');
  const anonymousFinding = expect.stringContaining('遷移 membership.resume(by: anonymous) は、役 member の根拠の欄 member.state(claim)をその役を持たない anonymous が書ける形です');

  it.each([
    { name: '探り台本 E0: by: [self] + self の受け入れは通る(基準)', by: ['self'], decls: [sa('member.state', 'member', ['self'], REASON)], expected: [] },
    {
      name: '探り台本 E1: 同じ受け入れのまま by に anonymous を足すと、anonymous の自己昇格は受け入れず止まる(回帰)',
      by: ['self', 'anonymous'],
      decls: [sa('member.state', 'member', ['self'], REASON)],
      expected: [anonymousFinding],
    },
    { name: '探り台本 E1c: 受け入れ無しなら 2 人とも止まる(対照)', by: ['self', 'anonymous'], decls: [], expected: [selfFinding, anonymousFinding] },
    {
      name: '2 人とも名指せば通る(理由が両方に当てはまると書き手が判断した形)',
      by: ['self', 'anonymous'],
      decls: [sa('member.state', 'member', ['self', 'anonymous'], REASON)],
      expected: [],
    },
    {
      name: '書き手ごとに別の要素で名指しても通る',
      by: ['self', 'anonymous'],
      decls: [sa('member.state', 'member', ['self'], REASON), sa('member.state', 'member', ['anonymous'], '別の理由')],
      expected: [],
    },
    {
      name: '遷移の by から外した書き手を名指した組は、腐った受け入れとして止まる(by を替えた後の取り残し)',
      by: ['self'],
      decls: [sa('member.state', 'member', ['self', 'anonymous'], REASON)],
      expected: [expect.stringContaining('遷移 membership.resume の self_assign(member.state(役 member))は書き手 anonymous を名指していますが、anonymous はこの宣言の by にいません')],
    },
    {
      name: '役を含意する書き手(staff)を名指した組は、何も受け入れないので腐った受け入れとして止まる(境界)',
      by: ['self', 'staff'],
      decls: [sa('member.state', 'member', ['self', 'staff'], REASON)],
      expected: [expect.stringContaining('遷移 membership.resume の self_assign は member.state(役 member) を書き手 staff について名指していますが')],
    },
    {
      name: '書き手が合っても欄 × 役が違えば受け入れない(欄 × 役 × 書き手の 3 つが要る)',
      by: ['self'],
      decls: [sa('member.is_staff', 'staff', ['self'], REASON)],
      expected: [selfFinding, expect.stringContaining('member.is_staff(役 staff) を書き手 self について名指していますが')],
    },
  ])('$name', ({ by, decls, expected }) => {
    expect(messages(resume(by, decls))).toEqual(expected);
  });

  it('writes / creates も規則の by に無い書き手を名指した組は腐った受け入れとして止まる(規則の by を替えた後の取り残し)', () => {
    const value = input({
      thingAccess: { creates: [{ ...create('member'), selfAssign: [sa('thing.owner_id', 'owner', ['staff'], '作る人が所有者を指名する')] }] },
      actions: actions(actionSpec({ handles: 'thing.create', input: ['thing.owner_id'] })),
    });

    expect(messages(value)).toEqual([
      expect.stringContaining('thing の creates[0](by: member) は、役 owner の根拠の欄 thing.owner_id(binding)をその役を持たない member が書ける形です'),
      expect.stringContaining('thing の creates[0](by: member) の self_assign(thing.owner_id(役 owner))は書き手 staff を名指していますが、staff はこの宣言の by にいません'),
    ]);
  });

  it('直し方は、止まった書き手を名指した受け入れの書き方を示す', () => {
    const run = verifyGroundWriters(resume(['self', 'anonymous'], [sa('member.state', 'member', ['self'], REASON)]));

    expect(run.findings[0]?.suggestion).toContain('by: [anonymous]');
  });
});

describe('R2 binding の欄', () => {
  it('誰でも既存の行の所有者の欄を書ける形は止まる(所有者のすり替え)', () => {
    expect(messages(input({ thingAccess: { writes: [write('member', ['owner_id'])] } }))).toEqual([
      expect.stringContaining('役 owner の根拠の欄 thing.owner_id(binding)をその役を持たない member が書ける形です'),
    ]);
  });

  it('所有者が譲る(所有者自身が書く)のは通る', () => {
    expect(messages(input({ thingAccess: { writes: [write('owner', ['owner_id'])] } }))).toEqual([]);
  });

  it('owner の宣言が無ければ、必須で入力に無い実行者への参照を作成者で埋める経路は無い(推測しない。値の出どころは実行計画が止める)', () => {
    const value = input({ thingAccess: { creates: [create('member')] }, actions: actions(actionSpec({ handles: 'thing.create', input: ['thing.tenant_id'] })) });

    expect(messages(value)).toEqual([]);
  });

  it('作成の入力で所有者の欄を受ける(他人を所有者に据えられる)形は止まり、欄 × 役を名指した self_assign を書けば通る', () => {
    const withInput = actions(actionSpec({ handles: 'thing.create', input: ['thing.owner_id'] }));
    const accepted = { ...create('member'), selfAssign: [sa('thing.owner_id', 'owner', ['member'], '作る人が所有者を指名する')] };

    expect(messages(input({ thingAccess: { creates: [create('member')] }, actions: withInput }))).toEqual([expect.stringContaining('経路: input thing.owner_id')]);
    expect(messages(input({ thingAccess: { creates: [accepted] }, actions: withInput }))).toEqual([]);
  });

  it('何も書かせない作成の規則に書いた self_assign は、要素ごとに腐った受け入れとして止まる', () => {
    const rule = { ...create('member'), selfAssign: [sa('thing.owner_id', 'owner', ['member'], '作った人がその行の所有者になる')] };
    const value = input({ thingAccess: { creates: [rule] }, actions: actions(actionSpec({ handles: 'thing.create', input: ['thing.tenant_id'] })) });

    expect(messages(value)).toEqual([expect.stringContaining('thing の creates[0](by: member) の self_assign は thing.owner_id(役 owner) を書き手 member について名指していますが')]);
  });

  describe('明示の持ち主の欄(action_spec の owner)は作成の書き手として数える(点検 9 回目 A9-1)', () => {
    const roles = [...ROLES, role('reviewer', 'thing.reviewer_id == actor.id', ['member'])];
    const ownerFinding = expect.stringContaining('役 owner の根拠の欄 thing.owner_id(binding)をその役を持たない member が書ける形です');
    const reviewerFinding = expect.stringContaining('役 reviewer の根拠の欄 thing.reviewer_id(binding)をその役を持たない member が書ける形です');

    it.each([
      { name: 'owner の欄は作成の書き手として数え、受け入れが無ければ止まる', owner: 'thing.owner_id', input: ['thing.tenant_id'], rule: create('member'), expected: [ownerFinding] },
      {
        name: '欄 × 役を名指した受け入れで通る',
        owner: 'thing.owner_id',
        input: ['thing.tenant_id'],
        rule: { ...create('member'), selfAssign: [sa('thing.owner_id', 'owner', ['member'], '作った人がその行の所有者になる')] },
        expected: [],
      },
      {
        name: '役を持つ書き手(owner を含意する役)なら受け入れは要らない(境界)',
        owner: 'thing.owner_id',
        input: ['thing.tenant_id'],
        rule: create('owner'),
        expected: [],
      },
      {
        name: '査閲者の欄を owner にすると、その役(reviewer)の根拠として止まる(D3 の形を明示しても名指しの受け入れが要る)',
        owner: 'thing.reviewer_id',
        input: ['thing.owner_id'],
        rule: { ...create('member'), selfAssign: [sa('thing.owner_id', 'owner', ['member'], '起案者を指名して代わりに起案する')] },
        expected: [reviewerFinding],
      },
      {
        name: '別の役を名指した受け入れでは owner の欄は通らない(役まで一致が要る)',
        owner: 'thing.owner_id',
        input: ['thing.tenant_id'],
        rule: { ...create('member'), selfAssign: [sa('thing.owner_id', 'reviewer', ['member'], '理由')] },
        expected: [ownerFinding, expect.stringContaining('thing.owner_id(役 reviewer) を書き手 member について名指していますが')],
      },
      {
        name: 'owner の宣言が別の集約を指すなら数えない',
        owner: 'member.id',
        input: ['thing.tenant_id'],
        rule: create('member'),
        expected: [],
      },
    ])('$name', ({ owner, input: fields, rule, expected }) => {
      const value = input({ roles, reviewer: true, thingAccess: { creates: [rule] }, actions: actions(actionSpec({ handles: 'thing.create', input: fields, owner })) });

      expect(messages(value)).toEqual(expected);
    });
  });

  describe('受け入れは名指した欄 × 役にだけ効く(点検 9 回目 A9-2)', () => {
    const roles = [...ROLES, role('auditor', 'thing.auditor_id == actor.id', ['member'])];
    /** thing に監査担当の欄を足し、同じ編集の規則が owner_id と auditor_id の両方を書く(探り台本 S0 / S1 の形)。 */
    function audited(selfAssign: readonly SelfAssignDecl[]): GroundWritersInput {
      const base = input({ roles, thingAccess: { writes: [{ ...write('member', ['owner_id', 'auditor_id']), ...(selfAssign.length === 0 ? {} : { selfAssign }) }] } });
      const thing = base.model.aggregates.get('thing');
      const entity = thing?.entity;
      if (thing === undefined || entity === undefined) throw new Error('thing が無い');
      const fields = [...entity.fields, field('auditor_id', { kind: 'ref', entity: 'member' })];
      const aggregates = new Map(base.model.aggregates);
      aggregates.set('thing', { ...thing, entity: { ...entity, fields } });
      return { ...base, model: { ...base.model, aggregates } };
    }
    const owner = expect.stringContaining('役 owner の根拠の欄 thing.owner_id');
    const auditor = expect.stringContaining('役 auditor の根拠の欄 thing.auditor_id');

    it.each([
      { name: 'S0: 受け入れ無しなら 2 欄とも止まる', decls: [], expected: [owner, auditor] },
      { name: 'S1: 責任者の欄のための受け入れは、後から足した監査担当の欄を受け入れない', decls: [sa('thing.owner_id', 'owner', ['member'], '管理者が責任者を任免する')], expected: [auditor] },
      {
        name: '2 欄とも名指せば通る',
        decls: [sa('thing.owner_id', 'owner', ['member'], '責任者を任免する'), sa('thing.auditor_id', 'auditor', ['member'], '監査担当を任免する')],
        expected: [],
      },
      {
        name: '役を書き忘れた要素は役のある根拠を受け入れず、腐った受け入れとしても止まる',
        decls: [sa('thing.owner_id', undefined, ['member'], '理由')],
        expected: [owner, auditor, expect.stringContaining('self_assign は thing.owner_id を書き手 member について名指していますが')],
      },
      {
        name: '腐った要素は、同じ規則の別の要素が受け入れていても要素ごとに止まる',
        decls: [sa('thing.owner_id', 'owner', ['member'], '理由'), sa('thing.auditor_id', 'auditor', ['member'], '理由'), sa('thing.tenant_id', 'owner', ['member'], '理由')],
        expected: [expect.stringContaining('thing.tenant_id(役 owner) を書き手 member について名指していますが')],
      },
    ])('$name', ({ decls, expected }) => {
      expect(messages(audited(decls))).toEqual(expected);
    });
  });

  it('binding の形が読めない役は、根拠の欄を追えないので止まる', () => {
    const roles = [...ROLES, role('odd', 'thing.owner_id != actor.id', ['member'])];

    expect(messages(input({ roles }))).toEqual([expect.stringContaining('役 odd の binding を')]);
  });
});

describe('R2 実行者の属性(actor.{欄})', () => {
  it('本人が自分の境界の欄を書ける形は止まる(境界の乗り換え)', () => {
    expect(messages(input({ memberAccess: { writes: [write('self', ['tenant_id'])] } }))).toEqual([
      expect.stringContaining('実行者の属性 member.tenant_id(actor.tenant_id の欄)'),
    ]);
  });

  it('境界の欄には役が無いので、特権の役(staff)が書いても止まる', () => {
    const thingAccess = { creates: [create('member', 'thing.tenant_id == actor.tenant_id')] };
    const value = input({ thingAccess, memberAccess: { writes: [write('staff', ['tenant_id'])] }, actions: actions(actionSpec({ handles: 'thing.create' })) });

    expect(messages(value)).toEqual([expect.stringContaining('実行者の属性 member.tenant_id')]);
  });
});

describe('R2 内部実行の入口', () => {
  const systemGrant = [...SAFE_EVENTS, event('auto_activate', { from: ['guest'], to: 'active', by: ['system'] })];

  it('入口の宣言が無い内部実行の役の付与は止まる(kind: system を無条件で許さない)', () => {
    expect(messages(input({ events: systemGrant }))).toEqual([expect.stringContaining('誰の指示で書くのかが仕様から追えません')]);
  });

  it('サインインの決定表が主語以外の軸の条件つきで起こすなら通る', () => {
    const auth = authFlow({ branches: [authBranch('guest_ok', { values: { member: 'guest', guild: 'joined' }, runs: ['membership.auto_activate'] })] });

    expect(messages(input({ events: systemGrant, catalogs: { auth } }))).toEqual([]);
  });

  it('主語の軸だけで役を立てる決定表の行は追えたことにしない', () => {
    const auth = authFlow({ branches: [authBranch('guest_any', { values: { member: 'guest' }, runs: ['membership.auto_activate'] })] });

    expect(messages(input({ events: systemGrant, catalogs: { auth } }))).toHaveLength(1);
  });

  it('受信 Webhook の emits が起こすなら通る', () => {
    const external = externalCatalog([integration('hook', { direction: 'inbound', emits: 'membership.auto_activate', signature: 'hmac_sha256', signatureKey: 'K', eventIdTable: 'table-x' })]);

    expect(messages(input({ events: systemGrant, catalogs: { external } }))).toEqual([]);
  });

  it('発火時刻の供給元つきの走査なら通り、供給元の無い走査は追えない', () => {
    const traced = jobCatalog([scheduledJob('scan', { fires: 'membership.auto_activate', dueFrom: 'member.created_at' })]);
    const untraced = jobCatalog([scheduledJob('scan', { fires: 'membership.auto_activate' })]);

    expect(messages(input({ events: systemGrant, catalogs: { jobs: traced } }))).toEqual([]);
    expect(messages(input({ events: systemGrant, catalogs: { jobs: untraced } }))).toHaveLength(1);
  });

  it('入口の材料が阻害なら判定を出さず、見ていない書き込みとして返す', () => {
    const run = verifyGroundWriters(input({ events: systemGrant, blockedSources: ['auth'] }));

    expect(run.findings).toEqual([]);
    expect(run.withheld).toEqual([expect.stringContaining('membership.auto_activate')]);
  });

  describe('内部実行の編集の規則(writes)は、入口の追える内部実行の遷移が同じ欄を書くときだけ通る', () => {
    const thingWithMachine = (events: readonly EventDef[], catalogs?: Partial<TraceCatalogs>): GroundWritersInput => {
      const base = input({ thingAccess: { writes: [write('system', ['owner_id'])] }, ...(catalogs === undefined ? {} : { catalogs }) });
      const thing = base.model.aggregates.get('thing') as AggregateSpecs;
      const aggregates = new Map(base.model.aggregates);
      aggregates.set('thing', { ...thing, stateMachines: [machine('thing_flow', { states: ['guest'], initial: 'guest', events })] });
      return { ...base, model: { ...base.model, aggregates } };
    };
    const systemWriteUntraced = expect.stringContaining('thing の writes[0](by: system) は、内部実行が役 owner の根拠の欄 thing.owner_id(binding)を書く形');

    it('同じ欄を書く遷移が無ければ止まる', () => {
      expect(messages(thingWithMachine([]))).toEqual([systemWriteUntraced]);
    });

    it('同じ欄を書くのが人の別の遷移だけなら(書き手が許可された所有者でも)、内部実行の入口は追えないので止まる', () => {
      const human = [event('hand_over', { from: ['guest'], to: 'guest', by: ['owner'], recordsActor: ['owner_id'] })];

      expect(messages(thingWithMachine(human))).toEqual([systemWriteUntraced]);
      expect(verifyGroundWriters(thingWithMachine(human)).findings[0]?.suggestion).toContain('transition_writes へ移す');
    });

    it('同じ欄を書く内部実行の遷移があっても、その遷移の入口が追えなければ止まる(遷移も編集の規則も)', () => {
      const untraced = [event('assign', { from: ['guest'], to: 'guest', by: ['system'], recordsActor: ['owner_id'] })];

      expect(messages(thingWithMachine(untraced))).toEqual([
        systemWriteUntraced,
        expect.stringContaining('遷移 thing_flow.assign(by: system) は、内部実行が役 owner の根拠の欄 thing.owner_id(binding)を書く形'),
      ]);
    });

    it('同じ欄を書く内部実行の遷移に追える入口(発火時刻の供給元つきの走査)があれば通る', () => {
      const traced = [event('assign', { from: ['guest'], to: 'guest', by: ['system'], recordsActor: ['owner_id'] })];
      const jobs = jobCatalog([scheduledJob('scan', { fires: 'thing_flow.assign', dueFrom: 'thing.created_at' })]);

      expect(messages(thingWithMachine(traced, { jobs }))).toEqual([]);
    });
  });

  it('内部実行が作る行の境界の欄は、受信の記録の表なら追える', () => {
    const dataTables = dataTableModel([dataTable('members', { entity: 'member' })]);
    const external = externalCatalog([integration('hook', { direction: 'inbound', emits: 'membership.activate', signature: 'hmac_sha256', signatureKey: 'K', eventIdTable: 'table-members' })]);
    const base = { memberAccess: { creates: [create('system')] } };

    expect(messages(input({ ...base, catalogs: { dataTables } }))).toEqual([expect.stringContaining('member の creates[0](by: system)')]);
    expect(messages(input({ ...base, catalogs: { dataTables, external } }))).toEqual([]);
  });
});

describe('R2 計算値の経路(writes に行を持たない computes)', () => {
  // 計算で決まる値は writes に並べない(V18。2026-10-20 の裁定)。編集の computes と別の集約の操作の computes は
  // 編集の経路に現れないので、その操作を起こせるロールを書き手として数える(以前は by: system の行が拾っていた)。
  it('編集の computes が所有者の欄を書く形は、その編集の規則の書き手を見て止まる', () => {
    const value = input({
      thingAccess: { writes: [write('member', ['tenant_id'])] },
      actions: actions(actionSpec({ handles: 'thing.update', input: ['thing.tenant_id'], computes: { 'thing.owner_id': 'pickOwner' } })),
    });

    expect(messages(value)).toEqual([
      expect.stringMatching(/thing の writes\[0\]\(by: member\) は、役 owner の根拠の欄 thing\.owner_id\(binding\).*経路: computes thing\.owner_id/u),
    ]);
  });

  it('編集の computes でも、書き手が役を持つ(所有者の編集)なら通る', () => {
    const value = input({
      thingAccess: { writes: [write('owner', ['tenant_id'])] },
      actions: actions(actionSpec({ handles: 'thing.update', input: ['thing.tenant_id'], computes: { 'thing.owner_id': 'pickOwner' } })),
    });

    expect(messages(value)).toEqual([]);
  });

  it('別の集約の遷移の computes が根拠の欄を書く形は、その遷移の書き手を見る(自分の集約の遷移の外でも取り逃がさない)', () => {
    const events = [...SAFE_EVENTS, event('reassign', { from: ['active'], to: 'active', by: ['self'] })];
    const value = input({ events, actions: actions(actionSpec({ handles: 'membership.reassign', computes: { 'thing.owner_id': 'pickOwner' } })) });

    expect(messages(value)).toEqual([expect.stringContaining('遷移 membership.reassign(by: self)')]);
  });
});
