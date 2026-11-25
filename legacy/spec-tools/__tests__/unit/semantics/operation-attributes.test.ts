/**
 * deriveOperationAttributes(semantics/operation-attributes.ts)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「方針の導出（confirm_required / variant）と ux（上書き）」。
 * 文言(根拠の行・確認ダイアログの注意書き)は出力側の責務で、`generate/render/action-attributes-derive.test.ts` が見る。
 */

import { describe, expect, it } from 'vitest';
import { deriveOperationAttributes } from '../../../lib/semantics/operation-attributes.js';
import type { OperationCatalogs } from '../../../lib/semantics/operation-catalogs.js';
import type { ActionSpec } from '../../../lib/model/trace/types.js';
import type { SpecModel } from '../../../lib/model/types.js';
import type { DataTableSpec, DataWriteKind } from '../../../lib/model/data/types.js';
import type { JobCatalogSpec } from '../../../lib/model/job/types.js';
import type { NotificationCatalogSpec } from '../../../lib/model/notification/types.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import {
  accessSpec,
  aggregate,
  create,
  del,
  entitySpec,
  event,
  field,
  loc,
  machine,
  role,
  roleSpec,
  specModel,
  write,
} from '../../helpers/model-builder.js';

const ROLES = roleSpec([
  role('anonymous', undefined, undefined, 'anonymous'),
  role('member', undefined, undefined, 'authenticated_default'),
  role('staff'),
  role('system', undefined, undefined, 'system'),
  role('entry_owner', 'entry.owner_id == actor.id', ['member']),
  role('organizer', 'workshop.organizer_id == actor.id', ['member']),
]);

/** 検証も生成も呼ぶ意味解析の導出(テストでは action から操作 ID を引く)。 */
function derive(model: SpecModel, catalogs: OperationCatalogs, action: ActionSpec): ReturnType<typeof deriveOperationAttributes> {
  return deriveOperationAttributes(model, catalogs, action.handles.raw, action);
}

/** カタログを 1 つも渡さない(連鎖・外へ出る効果が見えない)入力。 */
const NO_CATALOGS: OperationCatalogs = {};

describe('deriveOperationAttributes', () => {
  it('irreversible: to から from へ戻る経路が無ければ true', () => {
    const m = machine('entry', {
      states: ['draft', 'submitted', 'withdrawn'],
      initial: 'draft',
      final: ['withdrawn'],
      events: [
        event('submit', { from: ['draft'], to: 'submitted', by: ['entry_owner'] }),
        event('withdraw', { from: ['submitted'], to: 'withdrawn', by: ['entry_owner'] }),
      ],
    });
    const model = specModel([aggregate('entry', { stateMachines: [m] })], ROLES);
    const action = actionSpec({ handles: 'entry.withdraw' });

    const attrs = derive(model, NO_CATALOGS, action);

    expect(attrs.irreversible).toBe(true);
    expect(attrs.terminal).toBe(true);
  });

  it('irreversible: to から from へ戻る経路があれば false', () => {
    const m = machine('entry', {
      states: ['draft', 'submitted'],
      initial: 'draft',
      final: [],
      events: [
        event('submit', { from: ['draft'], to: 'submitted', by: ['entry_owner'] }),
        event('revise', { from: ['submitted'], to: 'draft', by: ['entry_owner'] }),
      ],
    });
    const model = specModel([aggregate('entry', { stateMachines: [m] })], ROLES);

    const attrs = derive(model, NO_CATALOGS, actionSpec({ handles: 'entry.submit' }));

    expect(attrs.irreversible).toBe(false);
  });

  it('affects_others: by が所有者ロールだけなら false、他ロールを含めば true', () => {
    const ownerOnly = machine('entry', {
      states: ['draft', 'submitted'],
      initial: 'draft',
      final: [],
      events: [event('submit', { from: ['draft'], to: 'submitted', by: ['entry_owner'] })],
    });
    const withStaff = machine('entry', {
      states: ['draft', 'submitted'],
      initial: 'draft',
      final: [],
      events: [event('submit', { from: ['draft'], to: 'submitted', by: ['entry_owner', 'staff'] })],
    });

    const ownerModel = specModel([aggregate('entry', { stateMachines: [ownerOnly] })], ROLES);
    const staffModel = specModel([aggregate('entry', { stateMachines: [withStaff] })], ROLES);

    expect(derive(ownerModel, NO_CATALOGS, actionSpec({ handles: 'entry.submit' })).affectsOthers).toBe(
      false,
    );
    expect(derive(staffModel, NO_CATALOGS, actionSpec({ handles: 'entry.submit' })).affectsOthers).toBe(
      true,
    );
  });

  it('privileged: by が認証ユーザーの既定ロール(member)を含まないなら true', () => {
    const m = machine('inquiry', {
      states: ['received', 'in_progress'],
      initial: 'received',
      final: [],
      events: [event('start_handling', { from: ['received'], to: 'in_progress', by: ['staff'] })],
    });
    const model = specModel([aggregate('inquiry', { stateMachines: [m] })], ROLES);

    expect(derive(model, NO_CATALOGS, actionSpec({ handles: 'inquiry.start_handling' })).privileged).toBe(
      true,
    );
  });

  it('privileged: by に member(認証ユーザーの既定ロール)を含めば false(ロール名に依らない)', () => {
    const m = machine('entry', {
      states: ['draft', 'submitted'],
      initial: 'draft',
      final: [],
      events: [event('submit', { from: ['draft'], to: 'submitted', by: ['member'] })],
    });
    const model = specModel([aggregate('entry', { stateMachines: [m] })], ROLES);

    expect(derive(model, NO_CATALOGS, actionSpec({ handles: 'entry.submit' })).privileged).toBe(false);
  });

  it('privileged: by が member を含まない文脈依存ロールだけでも true(staff という名前に依らない)', () => {
    const m = machine('entry', {
      states: ['draft', 'submitted'],
      initial: 'draft',
      final: [],
      events: [event('submit', { from: ['draft'], to: 'submitted', by: ['entry_owner'] })],
    });
    const model = specModel([aggregate('entry', { stateMachines: [m] })], ROLES);

    expect(derive(model, NO_CATALOGS, actionSpec({ handles: 'entry.submit' })).privileged).toBe(true);
  });

  it('scheduled: guard に now を含む、または by に system を含めば true', () => {
    const m = machine('workshop', {
      states: ['accepting', 'closed'],
      initial: 'accepting',
      final: [],
      events: [
        event('close_deadline', { from: ['accepting'], to: 'closed', by: ['system'], guard: 'now >= x' }),
        event('close_manual', { from: ['accepting'], to: 'closed', by: ['organizer'] }),
      ],
    });
    const model = specModel([aggregate('workshop', { stateMachines: [m] })], ROLES);

    expect(
      derive(model, NO_CATALOGS, actionSpec({ handles: 'workshop.close_deadline' })).scheduled,
    ).toBe(true);
    expect(
      derive(model, NO_CATALOGS, actionSpec({ handles: 'workshop.close_manual' })).scheduled,
    ).toBe(false);
  });

  it('tone: negative への遷移は negativeTone を立て、confirm_required を true にする', () => {
    const m = machine('workshop', {
      states: ['accepting', 'cancelled'],
      initial: 'accepting',
      final: ['cancelled'],
      events: [event('cancel', { from: ['accepting'], to: 'cancelled', by: ['organizer'] })],
      stateTone: { cancelled: 'negative' },
    });
    const model = specModel([aggregate('workshop', { stateMachines: [m] })], ROLES);

    const attrs = derive(model, NO_CATALOGS, actionSpec({ handles: 'workshop.cancel' }));

    expect(attrs.negativeTone).toBe(true);
    expect(attrs.confirmRequired).toBe(true);
    expect(attrs.variant).toBe('danger');
  });

  it('settles: 持つ状態への遷移は settles を立て、confirm_required を true にする', () => {
    const m = machine('workshop', {
      states: ['closed', 'confirmed'],
      initial: 'closed',
      final: [],
      events: [event('confirm_fees', { from: ['closed'], to: 'confirmed', by: ['organizer'] })],
      stateSettles: { confirmed: ['fees'] },
      settlesVocabulary: { fees: '料金' },
    });
    const model = specModel([aggregate('workshop', { stateMachines: [m] })], ROLES);

    const attrs = derive(model, NO_CATALOGS, actionSpec({ handles: 'workshop.confirm_fees' }));

    expect(attrs.settles).toBe(true);
    expect(attrs.confirmRequired).toBe(true);
  });

  it('outbound: audience: public_channel の通知を effects に持てば true', () => {
    const m = machine('member', {
      states: ['guest', 'active'],
      initial: 'guest',
      final: [],
      events: [event('activate', { from: ['guest'], to: 'active', by: ['staff'] })],
      effects: [{ on: 'activate', do: ['notify_discord_new_member'], location: loc() }],
    });
    const model = specModel([aggregate('member', { stateMachines: [m] })], ROLES);
    const notifications: NotificationCatalogSpec = {
      id: 'notification-catalog',
      vocabulary: { medium: [], audience: [], mention: [] },
      notifications: [
        {
          id: 'notify_discord_new_member',
          medium: 'discord',
          audience: 'public_channel',
          mention: 'none',
          trigger: 'auto',
          summary: 'x',
          recipient: { kind: 'channel' },
          location: loc(),
        },
      ],
      testCases: [],
      location: loc(),
    };
    const ctx: OperationCatalogs = { notifications: { available: true, catalog: notifications } };

    const attrs = derive(model, ctx, actionSpec({ handles: 'member.activate' }));

    expect(attrs.outbound).toBe(true);
  });

  it('outbound: effects に snapshot を持てば true(通知が無くても)', () => {
    const m = machine('site_page', {
      states: ['draft', 'published'],
      initial: 'draft',
      final: [],
      events: [event('publish', { from: ['draft'], to: 'published', by: ['staff'] })],
      effects: [
        {
          on: 'publish',
          do: ['snapshot_public_site_page'],
          snapshot: { to: 'public_site_page', fields: [], location: loc() },
          location: loc(),
        },
      ],
    });
    const model = specModel([aggregate('site_page', { stateMachines: [m] })], ROLES);

    const attrs = derive(model, NO_CATALOGS, actionSpec({ handles: 'site_page.publish' }));

    expect(attrs.outbound).toBe(true);
  });

  /**
   * メンバーの退会（匿名化の効果つき）と、personal 列を持つ別集約の入った世界。`functions` はメンバーの表の関数の宣言、
   * `realizedBy` は匿名化の効果が名指しする RPC（イベント ID → RPC 名。省略すると名指し無し）。
   */
  function eraseWorld(
    functions: DataTableSpec['functions'],
    realizedBy?: Readonly<Record<string, string>>,
    extraEntry = false,
    mirror = false,
  ) {
    const m = machine('membership', {
      states: ['active', 'erased'],
      initial: 'active',
      final: ['erased'],
      events: [event('erase', { from: ['active'], to: 'erased', by: ['staff'] })],
      // memo を写しの表と宣言する（effects[].snapshot.to）。写しの行が消えても元のデータは残る。
      effects: [{ on: 'erase', do: ['anonymize_member_data'], ...(mirror ? { snapshot: { to: 'memo', fields: [], location: loc() } } : {}), location: loc() }],
    });
    const memberEntity = entitySpec('member', { fields: [] });
    const entryEntity = entitySpec('entry', { fields: [field('note', { kind: 'text' }, { personal: true })] });
    const noteEntity = { ...entitySpec('memo', { fields: [field('body', { kind: 'text' }, { personal: true })] }), ...(mirror ? { mirror: true as const } : {}) };
    const model = specModel(
      [
        aggregate('member', { entity: memberEntity, stateMachines: [m] }),
        aggregate('entry', { entity: entryEntity }),
        ...(extraEntry ? [aggregate('memo', { entity: noteEntity })] : []),
      ],
      ROLES,
    );
    const dataTable: DataTableSpec = {
      id: 'table-members',
      table: 'members',
      entity: 'member',
      internal: false,
      indexes: [],
      sequences: [],
      exclusions: [],
      foreignKeys: [],
      triggers: [],
      defaults: {},
      functions,
      checks: [],
      testCases: [],
      location: loc(),
      relPath: 'members.md',
    };
    const jobs: JobCatalogSpec = {
      id: 'job-catalog',
      vocabulary: { kind: [], on_failure: [] },
      jobs: [
        {
          id: 'anonymize_member_data',
          source: 'outbox',
          kind: 'transaction_effect',
          inTransaction: true,
          ...(realizedBy === undefined ? {} : { realizedBy }),
          onFailure: 'wiring_error',
          summary: 'x',
          location: loc(),
        },
      ],
      testCases: [],
      location: loc(),
    };
    const ctx: OperationCatalogs = {
      dataTables: { available: true, tables: [dataTable] },
      jobs: { available: true, catalog: jobs },
    };
    return { model, ctx };
  }

  /** RPC の宣言 1 本。 */
  const rpc = (
    name: string,
    alsoWrites: readonly string[],
    shape: 'composite' | 'transition' = 'composite',
    kinds: readonly DataWriteKind[] = ['update'],
  ): DataTableSpec['functions'][number] => ({
    name,
    args: ['uuid'],
    params: ['p_a'],
    kind: 'rpc',
    shape,
    alsoWrites,
    alsoWriteKinds: Object.fromEntries(alsoWrites.map((table) => [table, kinds])),
    ...(shape === 'composite' ? { selfWriteKinds: [] } : {}),
  });

  it('destructive/bulk: 同一トランザクションで実現される効果が名指しした RPC が、personal 列を持つ別集約へ also_writes すれば両方 true', () => {
    const { model, ctx } = eraseWorld([rpc('erase_member', ['entries'], 'composite', ['scrub'])], { 'membership.erase': 'erase_member' });

    const attrs = derive(model, ctx, actionSpec({ handles: 'membership.erase' }));

    expect(attrs.destructive).toBe(true);
    expect(attrs.bulk).toBe(true);
    expect(attrs.affectsOthers).toBe(true);
    expect(attrs.touchesPersonal).toBe(true);
    expect(attrs.evidence).toMatchObject({
      kind: 'transition',
      cascade: { rpcs: ['erase_member'], alsoWrites: ['entries'], personalTables: [{ table: 'entries', columns: ['note'] }] },
    });
  });

  it('連鎖は名指しされた RPC だけから導く: 同じ表に RPC がいくつ増えても、名指しが変わらなければ判定は変わらない', () => {
    const { model, ctx } = eraseWorld(
      [rpc('erase_member', ['entries'], 'composite', ['scrub']), rpc('revoke_sessions', []), rpc('merge_members', ['memos']), rpc('apply_transition', ['memos'], 'transition')],
      { 'membership.erase': 'erase_member' },
      true,
    );

    const attrs = derive(model, ctx, actionSpec({ handles: 'membership.erase' }));

    expect(attrs.destructive).toBe(true);
    expect(attrs.evidence).toMatchObject({
      kind: 'transition',
      cascade: { rpcs: ['erase_member'], alsoWrites: ['entries'], personalTables: [{ table: 'entries', columns: ['note'] }] },
    });
  });

  it('遷移の定型（shape: transition）の RPC も名指しでき、その also_writes が材料になる（複合でなくてもよい）', () => {
    const { model, ctx } = eraseWorld(
      [rpc('erase_member', ['entries'], 'composite', ['scrub']), rpc('apply_transition', ['memos'], 'transition')],
      { 'membership.erase': 'apply_transition' },
      true,
    );

    const attrs = derive(model, ctx, actionSpec({ handles: 'membership.erase' }));

    expect(attrs.evidence).toMatchObject({
      kind: 'transition',
      cascade: { rpcs: ['apply_transition'], alsoWrites: ['memos'], personalTables: [{ table: 'memos', columns: ['body'] }] },
    });
  });

  it('destructive は書き込みの種類から導く: 個人列を持つ表への update だけでは立たず（touches_personal は立つ）、scrub か delete で立つ', () => {
    const run = (kinds: readonly DataWriteKind[]) => {
      const { model, ctx } = eraseWorld([rpc('erase_member', ['entries'], 'composite', kinds)], { 'membership.erase': 'erase_member' });
      return derive(model, ctx, actionSpec({ handles: 'membership.erase' }));
    };

    const updated = run(['update']);
    expect(updated.destructive).toBe(false);
    expect(updated.touchesPersonal).toBe(true);
    expect(run(['insert']).destructive).toBe(false);
    expect(run(['scrub']).destructive).toBe(true);
    expect(run(['update', 'delete']).destructive).toBe(true);
    expect(run(['delete']).evidence).toMatchObject({
      cascade: { destructiveWrites: [{ table: 'entries', kind: 'delete' }] },
    });
    expect(run(['scrub']).evidence).toMatchObject({
      cascade: { destructiveWrites: [{ table: 'entries', kind: 'scrub' }] },
    });
  });

  it('他の表の写し（entity_spec の mirror: true の表）への delete だけなら破壊的ではない（元のデータは残る）。touches_personal は立つ', () => {
    const { model, ctx } = eraseWorld([rpc('erase_member', ['memos'], 'composite', ['delete', 'insert'])], { 'membership.erase': 'erase_member' }, true, true);

    const attrs = derive(model, ctx, actionSpec({ handles: 'membership.erase' }));

    expect(attrs.destructive).toBe(false);
    expect(attrs.touchesPersonal).toBe(true);
  });

  it('写しの表であることは宣言（mirror）で決まる: 宣言が無ければ同じ delete は破壊的', () => {
    const { model, ctx } = eraseWorld([rpc('erase_member', ['memos'], 'composite', ['delete', 'insert'])], { 'membership.erase': 'erase_member' }, true, false);

    expect(derive(model, ctx, actionSpec({ handles: 'membership.erase' })).destructive).toBe(true);
  });

  it('写しの表への delete に、別の表の delete / scrub が混ざれば破壊的（写しの扱いは写しの表だけ）', () => {
    const { model, ctx } = eraseWorld(
      [rpc('erase_member', ['memos'], 'composite', ['delete']), rpc('purge_entries', ['entries'], 'composite', ['delete'])],
      { 'membership.erase': 'erase_member' },
      true,
      true,
    );
    const mixed = eraseWorld(
      [{ ...rpc('erase_member', ['memos', 'entries']), alsoWriteKinds: { memos: ['delete'], entries: ['scrub'] } }],
      { 'membership.erase': 'erase_member' },
      true,
      true,
    );

    expect(derive(model, ctx, actionSpec({ handles: 'membership.erase' })).destructive).toBe(false);
    expect(derive(mixed.model, mixed.ctx, actionSpec({ handles: 'membership.erase' })).destructive).toBe(true);
  });

  it('書き込みの種類が宣言されていない表（宣言から読んだ関数では起こらない）は安全側に倒し、破壊的に数える', () => {
    const noKinds = { name: 'erase_member', args: ['uuid'], params: ['p_a'], kind: 'rpc' as const, shape: 'composite' as const, alsoWrites: ['entries'] };
    const { model, ctx } = eraseWorld([noKinds], { 'membership.erase': 'erase_member' });

    expect(derive(model, ctx, actionSpec({ handles: 'membership.erase' })).destructive).toBe(true);
  });

  it('名指しされた RPC の also_writes が空なら連鎖は無い（bulk は RPC が絡むので true、destructive は false）', () => {
    const { model, ctx } = eraseWorld([rpc('revoke_sessions', [])], { 'membership.erase': 'revoke_sessions' });

    const attrs = derive(model, ctx, actionSpec({ handles: 'membership.erase' }));

    expect(attrs.destructive).toBe(false);
    expect(attrs.bulk).toBe(true);
  });

  it('名指しが無い・別のイベントの名指しだけ・名指した RPC が実在しないときは、推測で別の RPC に寄せず、未検査として安全側（破壊的）に倒す', () => {
    const cases: readonly [Readonly<Record<string, string>> | undefined, string][] = [
      [undefined, 'rpc_unnamed'],
      [{ 'membership.other': 'erase_member' }, 'rpc_unnamed'],
      [{ 'membership.erase': 'no_such_rpc' }, 'rpc_missing'],
    ];
    for (const [realizedBy, reason] of cases) {
      const { model, ctx } = eraseWorld([rpc('erase_member', ['entries'])], realizedBy);
      const attrs = derive(model, ctx, actionSpec({ handles: 'membership.erase' }));
      expect(attrs.destructive, JSON.stringify(realizedBy)).toBe(true);
      expect(attrs.confirmRequired).toBe(true);
      expect(attrs.evidence).toMatchObject({ kind: 'transition', cascade: { rpcs: [], alsoWrites: [], unverified: [{ kind: reason }] } });
    }
  });

  it('カタログが読めない(ジョブ・テーブル仕様)・効果がカタログに無い・composite の自表の宣言が無い、は未検査として破壊的とみなす', () => {
    const { model, ctx } = eraseWorld([rpc('erase_member', ['entries'])], { 'membership.erase': 'erase_member' });
    const { jobs: _jobs, ...withoutJobs } = ctx;
    const noJobs = derive(model, withoutJobs, actionSpec({ handles: 'membership.erase' }));
    expect(noJobs.destructive).toBe(true);
    expect(noJobs.evidence).toMatchObject({ cascade: { unverified: [{ kind: 'jobs_unavailable', jobs: ['anonymize_member_data'] }] } });

    const noTables = derive(model, { ...ctx, dataTables: { available: false, tables: [] } }, actionSpec({ handles: 'membership.erase' }));
    expect(noTables.evidence).toMatchObject({ cascade: { unverified: [{ kind: 'data_tables_unavailable', rpcs: ['erase_member'] }] } });
    expect(noTables.destructive).toBe(true);

    const emptyJobs = { ...ctx, jobs: { available: true, catalog: { ...ctx.jobs?.catalog, jobs: [] } } } as OperationCatalogs;
    expect(derive(model, emptyJobs, actionSpec({ handles: 'membership.erase' })).evidence).toMatchObject({
      cascade: { unverified: [{ kind: 'job_unknown', job: 'anonymize_member_data' }] },
    });

    const { selfWriteKinds: _omit, ...undeclared } = rpc('erase_member', ['entries']);
    const noSelf = eraseWorld([undeclared], { 'membership.erase': 'erase_member' });
    expect(derive(noSelf.model, noSelf.ctx, actionSpec({ handles: 'membership.erase' })).evidence).toMatchObject({
      cascade: { unverified: [{ kind: 'self_writes_unknown', rpc: 'erase_member' }] },
    });
  });

  it('遷移そのものが通る RPC(命名規約)の後始末も材料になる: event_writes があればそのイベントの分だけ、無ければ全イベントに負わせる', () => {
    const cleanup = { ...rpc('apply_member_transition', ['entries'], 'transition', ['delete']) };
    const perEvent = { ...cleanup, eventWrites: { 'membership.erase': {} } };
    const { model, ctx } = eraseWorld([perEvent], { 'membership.erase': 'erase_member_x' });
    const withoutEffect = { ...ctx, jobs: { available: true, catalog: { ...ctx.jobs?.catalog, jobs: [] } } } as OperationCatalogs;

    // 効果を外しても(ジョブが無い = 名指しも無い)、遷移の RPC の後始末は残る。
    const plain = eraseWorld([cleanup]);
    const noEffect = { ...plain.ctx, jobs: { available: true, catalog: { ...plain.ctx.jobs?.catalog, jobs: [] } } } as OperationCatalogs;
    const machineNoEffect = { ...plain.model };
    const attrs = derive(machineNoEffect, noEffect, actionSpec({ handles: 'membership.erase' }));
    expect(attrs.evidence).toMatchObject({ cascade: { destructiveWrites: [{ table: 'entries', kind: 'delete' }] } });

    // event_writes がそのイベントで書かないと言えば、後始末は数えない。
    const scoped = derive(model, withoutEffect, actionSpec({ handles: 'membership.erase' }));
    expect(scoped.evidence).toMatchObject({ cascade: { destructiveWrites: [] } });
  });

  it('本文が呼ぶ関数(calls)の書き込みも合流する。呼び先が無ければ未検査', () => {
    const caller = { ...rpc('erase_member', []), calls: ['purge_entries'] };
    const callee = rpc('purge_entries', ['entries'], 'composite', ['delete']);
    const { model, ctx } = eraseWorld([caller, callee], { 'membership.erase': 'erase_member' });
    expect(derive(model, ctx, actionSpec({ handles: 'membership.erase' })).evidence).toMatchObject({
      cascade: { destructiveWrites: [{ table: 'entries', kind: 'delete' }] },
    });

    const missing = eraseWorld([caller], { 'membership.erase': 'erase_member' });
    expect(derive(missing.model, missing.ctx, actionSpec({ handles: 'membership.erase' })).evidence).toMatchObject({
      cascade: { unverified: [{ kind: 'callee_missing', rpc: 'erase_member', callee: 'purge_entries' }] },
    });
  });

  it('自表への scrub / 写しでない delete は破壊的(自表の insert / update は遷移の書き込みと同じで材料にしない)、写しへの scrub も破壊的', () => {
    const scrubSelf = eraseWorld([{ ...rpc('erase_member', []), selfWriteKinds: ['update', 'scrub'] }], { 'membership.erase': 'erase_member' });
    expect(derive(scrubSelf.model, scrubSelf.ctx, actionSpec({ handles: 'membership.erase' })).evidence).toMatchObject({
      cascade: { destructiveWrites: [{ table: 'members', kind: 'scrub' }] },
    });
    const updateSelf = eraseWorld([{ ...rpc('erase_member', []), selfWriteKinds: ['insert', 'update'] }], { 'membership.erase': 'erase_member' });
    expect(derive(updateSelf.model, updateSelf.ctx, actionSpec({ handles: 'membership.erase' })).destructive).toBe(false);
    const scrubMirror = eraseWorld([rpc('erase_member', ['memos'], 'composite', ['scrub'])], { 'membership.erase': 'erase_member' }, true, true);
    expect(derive(scrubMirror.model, scrubMirror.ctx, actionSpec({ handles: 'membership.erase' })).destructive).toBe(true);
  });

  it('遷移が clears で個人列を空にすれば destructive / touches_personal(根拠に列を載せる)', () => {
    const m = machine('membership', {
      states: ['linked', 'unlinked'],
      initial: 'linked',
      final: [],
      events: [{ ...event('unlink', { from: ['linked'], to: 'unlinked', by: ['staff'] }), clears: ['email', 'nickname'] }],
    });
    const member = entitySpec('member', { fields: [field('email', { kind: 'string' }, { personal: true }), field('nickname', { kind: 'string' })] });
    const model = specModel([aggregate('member', { entity: member, stateMachines: [m] })], ROLES);

    const attrs = derive(model, NO_CATALOGS, actionSpec({ handles: 'membership.unlink' }));

    expect(attrs.destructive).toBe(true);
    expect(attrs.touchesPersonal).toBe(true);
    expect(attrs.evidence).toMatchObject({ kind: 'transition', clearedPersonal: ['email'] });
  });

  it('touches_personal: input に personal 列があれば true', () => {
    const memberEntity = entitySpec('member', {
      fields: [field('bio', { kind: 'text' }, { personal: true })],
    });
    const model = specModel([
      aggregate('member', { entity: memberEntity, access: accessSpec('member', { writes: [write('account_owner', ['bio'])] }) }),
    ], ROLES);

    const attrs = derive(model, NO_CATALOGS, actionSpec({ handles: 'member.update', input: ['member.bio'] }));

    expect(attrs.touchesPersonal).toBe(true);
  });

  describe('予約 ID(create / delete / update)', () => {
    it('delete: irreversible / terminal / destructive が常に true', () => {
      const venueEntity = entitySpec('venue', { fields: [] });
      const model = specModel([
        aggregate('venue', { entity: venueEntity, access: accessSpec('venue', { deletes: [del('staff')] }) }),
      ], ROLES);

      const attrs = derive(model, NO_CATALOGS, actionSpec({ handles: 'venue.delete' }));

      expect(attrs.irreversible).toBe(true);
      expect(attrs.terminal).toBe(true);
      expect(attrs.destructive).toBe(true);
      expect(attrs.confirmRequired).toBe(true);
      expect(attrs.variant).toBe('danger');
    });

    it('update: bulk が true、その他は既定値', () => {
      const venueEntity = entitySpec('venue', { fields: [] });
      const model = specModel([
        aggregate('venue', {
          entity: venueEntity,
          access: accessSpec('venue', { writes: [write('staff', ['name'])] }),
        }),
      ], ROLES);

      const attrs = derive(model, NO_CATALOGS, actionSpec({ handles: 'venue.update' }));

      expect(attrs.bulk).toBe(true);
      expect(attrs.irreversible).toBe(false);
      expect(attrs.destructive).toBe(false);
    });

    it('create: irreversible が常に false なので affects_others の値にかかわらず confirm_required は false', () => {
      // create は「対象行がまだ無い」ため所有者ロールの概念が薄く、binding の無いグローバル
      // ロール(member 等)は affects_others 側に寄る(既知の粗さ。基準となる行が無いため
      // owner 判定が構造的に効かない)。ただし create は irreversible が常に false なので、
      // confirm_required の式(irreversible ∧ affects_others)には影響しない——この粗さが
      // 方針の結論を変えることは無い。
      const entryEntity = entitySpec('entry', { fields: [] });
      const model = specModel([
        aggregate('entry', { entity: entryEntity, access: accessSpec('entry', { creates: [create('member')] }) }),
      ], roleSpec([role('member')]));

      const attrs = derive(model, NO_CATALOGS, actionSpec({ handles: 'entry.create' }));

      expect(attrs.irreversible).toBe(false);
      expect(attrs.confirmRequired).toBe(false);
    });
  });

  describe('ux(上書き)', () => {
    it('confirm: none で導出の true を打ち消す', () => {
      const m = machine('workshop', {
        states: ['accepting', 'cancelled'],
        initial: 'accepting',
        final: ['cancelled'],
        events: [event('cancel', { from: ['accepting'], to: 'cancelled', by: ['organizer'] })],
        stateTone: { cancelled: 'negative' },
      });
      const model = specModel([aggregate('workshop', { stateMachines: [m] })], ROLES);
      const action = actionSpec({ handles: 'workshop.cancel', ux: { confirm: 'none', reason: 'テスト用の上書き' } });

      const attrs = derive(model, NO_CATALOGS, action);

      expect(attrs.confirmRequired).toBe(false);
      expect(attrs.variant).toBe('default');
      expect(attrs.overridden).toBe(true);
    });

    it('confirm: required で導出の false を上書きする', () => {
      const m = machine('workshop', {
        states: ['accepting', 'closed'],
        initial: 'accepting',
        final: [],
        events: [event('close_manual', { from: ['accepting'], to: 'closed', by: ['organizer'] })],
      });
      const model = specModel([aggregate('workshop', { stateMachines: [m] })], ROLES);
      const action = actionSpec({ handles: 'workshop.close_manual', ux: { confirm: 'required', reason: '運用上の要望' } });

      const attrs = derive(model, NO_CATALOGS, action);

      expect(attrs.confirmRequired).toBe(true);
      expect(attrs.variant).toBe('danger');
      expect(attrs.overridden).toBe(true);
    });
  });

  it('境界: 接地先が見つからない操作は全属性 false・安全側の既定値になる', () => {
    const model = specModel([], ROLES);

    const attrs = derive(model, NO_CATALOGS, actionSpec({ handles: 'ghost.vanish' }));

    expect(attrs.confirmRequired).toBe(false);
    expect(attrs.variant).toBe('default');
    expect(attrs.irreversible).toBe(false);
    expect(attrs.evidence.kind).toBe('unknown');
  });

  it('action_spec が無い操作でも、事実から確認要否が決まる(ux の上書きと input だけが無い)', () => {
    const m = machine('workshop', {
      states: ['accepting', 'cancelled'],
      initial: 'accepting',
      final: ['cancelled'],
      events: [event('cancel', { from: ['accepting'], to: 'cancelled', by: ['organizer'] })],
      stateTone: { cancelled: 'negative' },
    });
    const model = specModel([aggregate('workshop', { stateMachines: [m] })], ROLES);

    const attrs = deriveOperationAttributes(model, NO_CATALOGS, 'workshop.cancel', undefined);

    expect(attrs.confirmRequired).toBe(true);
    expect(attrs.overridden).toBe(false);
  });
});
