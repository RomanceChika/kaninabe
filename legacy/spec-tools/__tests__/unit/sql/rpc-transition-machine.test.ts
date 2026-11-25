/**
 * 遷移 RPC が動かす機械と状態列の決め方(`rpc-transition-machine.ts`)と、それを通す T6。
 *
 * 規約網羅(ARCH-SP-BE-0001 §書き込み RPC の形):
 *   - 名前が `apply_{機械}_transition` の形でなければ決まらない(集約の最初の機械に倒さない)
 *   - `{機械}` が表の集約の機械でなければ決まらない(別の集約の同じ名前の機械を拾わない)
 *   - 名前が集約の名前なら、その集約の機械が**ちょうど 1 本**のときだけその機械に決まる(2 本以上なら断る)
 *   - `state({機械})` の列がちょうど 1 本でなければ決まらない(名前が `state` の列に倒さない)
 *   - 決まる宣言では機械と列を返す(対照)・2 本の機械を持つ集約で名前どおりの機械を選ぶ(境界)
 *   - 本文を生成する遷移も、手書きの遷移も T6 が名指して止める
 */

import { describe, expect, it } from 'vitest';
import { verifyRpcMigration } from '../../../lib/data/verifiers/t6-rpc-migration.js';
import { collectRpcFacts } from '../../../lib/sql/rpc-facts.js';
import { transitionTargetOf } from '../../../lib/sql/rpc-transition-machine.js';
import type { DataFunctionDecl } from '../../../lib/model/data/types.js';
import type { FieldDef, SpecModel } from '../../../lib/model/types.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { aggregate, entitySpec, event, field, machine, specModel } from '../../helpers/model-builder.js';

/** 進行と掲載の 2 本の機械を持つ催しと、別の集約の会場。 */
function domain(fields?: readonly FieldDef[]): SpecModel {
  return specModel([
    aggregate('show', {
      entity: entitySpec('show', {
        fields: fields ?? [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('state', { kind: 'state', machine: 'show' }),
          field('listing_state', { kind: 'state', machine: 'show_listing' }),
        ],
      }),
      stateMachines: [
        machine('show', { states: ['draft', 'done'], initial: 'draft', events: [event('finish', { from: ['draft'], to: 'done' })] }),
        machine('show_listing', {
          states: ['hidden', 'listed'],
          initial: 'hidden',
          events: [event('list', { from: ['hidden'], to: 'listed' })],
        }),
      ],
    }),
    aggregate('member', {
      entity: entitySpec('member', {
        fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'membership' })],
      }),
      stateMachines: [
        machine('membership', { states: ['active', 'left'], initial: 'active', events: [event('leave', { from: ['active'], to: 'left' })] }),
      ],
    }),
    aggregate('venue', {
      entity: entitySpec('venue', {
        fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'venue' })],
      }),
      stateMachines: [
        machine('venue', { states: ['open', 'closed'], initial: 'open', events: [event('close', { from: ['open'], to: 'closed' })] }),
      ],
    }),
  ]);
}

describe('遷移 RPC の機械と状態列', () => {
  it('名前どおりの機械と、その機械の状態列を返す(2 本の機械を持つ集約でも、最初の機械に倒さない)', () => {
    const progress = transitionTargetOf('apply_show_transition', 'show', domain());
    const listing = transitionTargetOf('apply_show_listing_transition', 'show', domain());

    expect(progress.ok && [progress.target.machine.machine, progress.target.field.name]).toEqual(['show', 'state']);
    expect(listing.ok && [listing.target.machine.machine, listing.target.field.name]).toEqual(['show_listing', 'listing_state']);
  });

  it('名前が集約の名前なら、機械が 1 本の集約ではその機械に決まり、2 本の集約では決まらない', () => {
    const sole = transitionTargetOf('apply_member_transition', 'member', domain());
    const twoMachines = specModel([
      aggregate('ticket', {
        entity: entitySpec('ticket', {
          fields: [
            field('progress_state', { kind: 'state', machine: 'ticket_progress' }),
            field('review_state', { kind: 'state', machine: 'ticket_review' }),
          ],
        }),
        stateMachines: [
          machine('ticket_progress', { states: ['open', 'done'], initial: 'open', events: [event('close', { from: ['open'], to: 'done' })] }),
          machine('ticket_review', { states: ['none', 'ok'], initial: 'none', events: [event('approve', { from: ['none'], to: 'ok' })] }),
        ],
      }),
    ]);
    const two = transitionTargetOf('apply_ticket_transition', 'ticket', twoMachines);

    expect(sole.ok && [sole.target.machine.machine, sole.target.field.name]).toEqual(['membership', 'state']);
    expect(two.ok).toBe(false);
  });

  it('名前が apply_{機械}_transition の形でなければ決まらない', () => {
    const result = transitionTargetOf('move_show', 'show', domain());

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problem.message).toContain('apply_{状態機械}_transition の形ではない');
  });

  it('名指した機械が表の集約に無ければ決まらない(別の集約の同じ名前の機械を拾わない)', () => {
    const result = transitionTargetOf('apply_venue_transition', 'show', domain());

    expect(result.ok ? '' : result.problem.message).toContain('状態機械 venue は、表の集約 show の状態機械にありません');
  });

  it('機械の状態列が無い・2 本あるときは決まらない(名前が state の列に倒さない)', () => {
    const none = transitionTargetOf('apply_show_listing_transition', 'show', domain([field('state', { kind: 'state', machine: 'show' })]));
    const two = transitionTargetOf(
      'apply_show_transition',
      'show',
      domain([field('state', { kind: 'state', machine: 'show' }), field('mirror_state', { kind: 'state', machine: 'show' })]),
    );

    expect(none.ok ? '' : none.problem.message).toContain('state(show_listing) の列が 0 本');
    expect(two.ok ? '' : two.problem.message).toContain('state(show) の列が 2 本');
  });
});

/** 遷移 RPC 1 本の宣言。 */
function transition(name: string, origin: { readonly migration: string } | { readonly handwritten: string }): DataFunctionDecl {
  return {
    name,
    args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]'],
    params: ['p_show_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_actor_roles'],
    kind: 'rpc',
    shape: 'transition',
    alsoWrites: [],
    ...origin,
  };
}

describe('T6 が遷移 RPC の機械を名指して止める', () => {
  const tables = (fn: DataFunctionDecl) => dataTableModel([dataTable('shows', { entity: 'show', functions: [fn] }), dataTable('venues', { entity: 'venue' })]);

  it('本文を生成する遷移: 名前から機械が決まらなければ T6 の error(事実の収集も同じ理由で止まる)', () => {
    const fn = transition('apply_venue_transition', { migration: '20260912000001_rpc_apply_venue_transition.sql' });
    const findings = verifyRpcMigration(domain(), tables(fn));
    const facts = collectRpcFacts({
      name: fn.name,
      params: fn.params,
      args: fn.args,
      shape: 'transition',
      table: dataTable('shows', { entity: 'show' }),
      domain: domain(),
      tableOf: () => null,
      actions: undefined,
    });

    expect(findings.map((finding) => [finding.verifier, finding.severity])).toContainEqual(['T6', 'error']);
    expect(findings.some((finding) => finding.message.includes('表の集約 show の状態機械にありません'))).toBe(true);
    expect(facts.ok).toBe(false);
  });

  it('本文が手書きの遷移でも、名前から機械が決まらなければ T6 の error。決まる名前なら何も言わない(対照)', () => {
    const bad = verifyRpcMigration(domain(), tables(transition('apply_show_progress', { handwritten: '連鎖を本文が持つ' })));
    const good = verifyRpcMigration(domain(), tables(transition('apply_show_transition', { handwritten: '連鎖を本文が持つ' })));

    expect(bad.map((finding) => finding.message)).toEqual([expect.stringContaining('apply_{状態機械}_transition の形ではない')]);
    expect(good).toEqual([]);
  });
});
