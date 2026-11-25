/**
 * deriveActionAttributes(action-attributes-derive.ts)の規約網羅テスト(出力側の文言)。
 * 対象の要求: action-spec-writing.md「方針の導出（confirm_required / variant）と ux（上書き）」のうち、
 * 人が読む根拠の行(`basis`)と確認ダイアログの注意書き(`confirmNotes`)。事実と方針の真偽の導出は
 * 意味解析の層の責務で、`semantics/operation-attributes.test.ts` が見る。
 */

import { describe, expect, it } from 'vitest';
import { deriveActionAttributes, operationCatalogsOf } from '../../../../lib/generate/render/action-attributes-derive.js';
import { deriveOperationAttributes } from '../../../../lib/semantics/operation-attributes.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { DataTableSpec } from '../../../../lib/model/data/types.js';
import type { JobCatalogSpec } from '../../../../lib/model/job/types.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { aggregate, entitySpec, event, field, loc, machine, role, roleSpec, specModel } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

const ROLES = roleSpec([
  role('anonymous', undefined, undefined, 'anonymous'),
  role('member', undefined, undefined, 'authenticated_default'),
  role('staff'),
  role('organizer', 'workshop.organizer_id == actor.id', ['member']),
]);

describe('deriveActionAttributes(文言)', () => {
  it('tone: negative への遷移は「元に戻せません。」を確認文言に持つ', () => {
    const m = machine('workshop', {
      states: ['accepting', 'cancelled'],
      initial: 'accepting',
      final: ['cancelled'],
      events: [event('cancel', { from: ['accepting'], to: 'cancelled', by: ['organizer'] })],
      stateTone: { cancelled: 'negative' },
    });
    const model = specModel([aggregate('workshop', { stateMachines: [m] })], ROLES);

    const attrs = deriveActionAttributes(model, GEN_CTX, actionSpec({ handles: 'workshop.cancel' }));

    expect(attrs.confirmNotes).toContain('元に戻せません。');
    expect(attrs.basis).toEqual([
      'state_spec(workshop.cancel): to=cancelled から from(accepting)への経路 無し',
      'state_spec: to=cancelled の tone=negative',
      'state_spec: by=organizer(所有者のみ)',
    ]);
  });

  it('settles: 持つ状態への遷移は確定するものの表示名を確認文言に持つ', () => {
    const m = machine('workshop', {
      states: ['closed', 'confirmed'],
      initial: 'closed',
      final: [],
      events: [event('confirm_fees', { from: ['closed'], to: 'confirmed', by: ['organizer'] })],
      stateSettles: { confirmed: ['fees'] },
      settlesVocabulary: { fees: '料金' },
    });
    const model = specModel([aggregate('workshop', { stateMachines: [m] })], ROLES);

    const attrs = deriveActionAttributes(model, GEN_CTX, actionSpec({ handles: 'workshop.confirm_fees' }));

    expect(attrs.confirmNotes).toContain('料金がこの時点で確定します。');
    expect(attrs.basis).toContain('state_spec: to=confirmed の settles=fees');
  });

  it('連鎖: 効果が名指しした RPC の also_writes と personal 列を根拠の行に出す', () => {
    const m = machine('membership', {
      states: ['active', 'erased'],
      initial: 'active',
      final: ['erased'],
      events: [event('erase', { from: ['active'], to: 'erased', by: ['staff'] })],
      effects: [{ on: 'erase', do: ['anonymize_member_data'], location: loc() }],
    });
    const model = specModel(
      [
        aggregate('member', { entity: entitySpec('member', { fields: [] }), stateMachines: [m] }),
        aggregate('entry', { entity: entitySpec('entry', { fields: [field('note', { kind: 'text' }, { personal: true })] }) }),
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
      functions: [
        {
          name: 'erase_member',
          args: ['uuid'],
          params: ['p_a'],
          kind: 'rpc',
          shape: 'composite',
          alsoWrites: ['entries'],
          alsoWriteKinds: { entries: ['scrub'] },
          selfWriteKinds: ['update'],
        },
      ],
      checks: [],
      testCases: [],
      location: loc(),
      relPath: 'members.md',
    };
    const jobs: JobCatalogSpec = {
      id: 'job-catalog',
      vocabulary: { kind: [], on_failure: [] },
      jobs: [
        { id: 'anonymize_member_data', source: 'outbox', kind: 'transaction_effect', inTransaction: true, realizedBy: { 'membership.erase': 'erase_member' }, onFailure: 'wiring_error', summary: 'x', location: loc() },
      ],
      testCases: [],
      location: loc(),
    };
    const ctx: GenerateContext = {
      ...GEN_CTX,
      dataTables: { available: true, tables: [dataTable] },
      jobs: { available: true, catalog: jobs },
    };

    const attrs = deriveActionAttributes(model, ctx, actionSpec({ handles: 'membership.erase' }));

    expect(attrs.confirmNotes).toContain('データが削除されます。');
    expect(attrs.basis.slice(-3)).toEqual([
      'data_table: 同一トランザクションで実現される効果が実現する RPC erase_member の also_writes(entries)を伴う',
      'data_table: entries の個人列を置き換えて消す',
      'data_table: entries が personal 列 note を持つ',
    ]);
  });

  it('未検査(読めない材料)と、clears が空にする個人列を根拠に名指しする', () => {
    const m = machine('membership', {
      states: ['active', 'erased'],
      initial: 'active',
      final: ['erased'],
      events: [{ ...event('erase', { from: ['active'], to: 'erased', by: ['staff'] }), clears: ['email'] }],
      effects: [{ on: 'erase', do: ['anonymize_member_data'], location: loc() }],
    });
    const member = entitySpec('member', { fields: [field('email', { kind: 'string' }, { personal: true })] });
    const model = specModel([aggregate('member', { entity: member, stateMachines: [m] })], ROLES);

    const attrs = deriveActionAttributes(model, GEN_CTX, actionSpec({ handles: 'membership.erase' }));

    expect(attrs.confirmNotes).toContain('データが削除されます。');
    expect(attrs.basis).toContain('state_spec(membership.erase): clears が personal 列 email を空にする');
    expect(attrs.basis.some((line) => line.startsWith('未検査: ') && line.endsWith('(破壊的とみなす)'))).toBe(true);
  });

  it('ux: none で導出の true を打ち消すと確認文言は空になる', () => {
    const m = machine('workshop', {
      states: ['accepting', 'cancelled'],
      initial: 'accepting',
      final: ['cancelled'],
      events: [event('cancel', { from: ['accepting'], to: 'cancelled', by: ['organizer'] })],
      stateTone: { cancelled: 'negative' },
    });
    const model = specModel([aggregate('workshop', { stateMachines: [m] })], ROLES);
    const action = actionSpec({ handles: 'workshop.cancel', ux: { confirm: 'none', reason: 'テスト用の上書き' } });

    expect(deriveActionAttributes(model, GEN_CTX, action).confirmNotes).toEqual([]);
  });

  it('ux: required の reason が、事実からの定型文が無い操作の確認文言になる(句点を補う)', () => {
    const m = machine('workshop', {
      states: ['accepting', 'closed'],
      initial: 'accepting',
      final: [],
      events: [event('close_manual', { from: ['accepting'], to: 'closed', by: ['organizer'] })],
    });
    const model = specModel([aggregate('workshop', { stateMachines: [m] })], ROLES);
    const action = actionSpec({ handles: 'workshop.close_manual', ux: { confirm: 'required', reason: '運用上の要望' } });

    expect(deriveActionAttributes(model, GEN_CTX, action).confirmNotes).toContain('運用上の要望。');
  });

  it('境界: 接地先が見つからない操作の根拠は「接地先が見つからない」になる', () => {
    const attrs = deriveActionAttributes(specModel([], ROLES), GEN_CTX, actionSpec({ handles: 'ghost.vanish' }));

    expect(attrs.basis[0]).toContain('接地先が見つからない');
  });

  it('真偽の値は意味解析の層の導出と同じ(文言の層は何が真かを決めない)', () => {
    const m = machine('workshop', {
      states: ['accepting', 'cancelled'],
      initial: 'accepting',
      final: ['cancelled'],
      events: [event('cancel', { from: ['accepting'], to: 'cancelled', by: ['organizer'] })],
      stateTone: { cancelled: 'negative' },
    });
    const model = specModel([aggregate('workshop', { stateMachines: [m] })], ROLES);
    const action = actionSpec({ handles: 'workshop.cancel' });

    const rendered = deriveActionAttributes(model, GEN_CTX, action);
    const semantic = deriveOperationAttributes(model, operationCatalogsOf(GEN_CTX), 'workshop.cancel', action);

    expect(rendered.confirmRequired).toBe(semantic.confirmRequired);
    expect(rendered.variant).toBe(semantic.variant);
    expect(rendered.irreversible).toBe(semantic.irreversible);
  });
});
