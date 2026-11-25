/**
 * 実行計画 1 本 → 生成テストの**場面**(`lib/usecase/plan-scenario*.ts`。束 ⑰-3 / ⑰-3b)。
 *
 * 確かめるのは仕組みの規約であって製品の中身ではない ——
 *   - 意味クラスごとに場面が 1 つ出ること(成功 / 遷移元でない / 権限なし / **対象なし**)
 *   - **対象なしは A7 の要求に関わらず出る**(行を読む計画なら。独立レビュー 1-D)
 *   - **不変条件違反の場面は RPC が返しうる ID しか載せない**(独立レビュー 1-A)
 *   - RPC を呼び出す場面は**名前つき引数の期待**を持つ(独立レビュー 1-B)
 */

import { describe, expect, it } from 'vitest';
import { buildOperationPlans } from '../../../lib/usecase/operation-plan.js';
import { buildPlanScenarios } from '../../../lib/usecase/plan-scenario.js';
import { createGuardServices } from '../../../lib/guard/services.js';
import type { PlanScenario } from '../../../lib/usecase/plan-scenario.js';
import type { CoverageClass } from '../../../lib/testcase/types.js';
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
} from '../../helpers/model-builder-v8plus.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { jobModel, outboxJob } from '../../helpers/job-builder.js';
import type { EnforcementDef, InvariantSpec } from '../../../lib/model/types.js';

/** 執行点の宣言 1 つ(場所は反例の文面にだけ出るので固定でよい)。 */
function enforcement(kind: EnforcementDef['kind'], ref: string): EnforcementDef {
  return { kind, ref, location: { file: 'docs/specs/domain/test/invariants.md', pointer: 'enforced_by' } };
}

/** 遷移 1 本を持つ widget 集約(必要なら不変条件つき)。 */
function modelWith(invariants?: InvariantSpec) {
  return specModel({
    roles: [role('anonymous'), role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'widget',
        entity: entitySpec('widget', [
          field('state', { kind: 'state', machine: 'widget' }, { required: true }),
          field('amount', { kind: 'integer' }),
        ]),
        stateMachines: [
          {
            ...machine({
              machine: 'widget',
              states: ['draft', 'sent'],
              initial: 'draft',
              events: [event({ id: 'send', from: ['draft'], to: 'sent', by: ['member'] })],
            }),
            effects: [
              { on: 'send', do: ['notify'], location: { file: 'docs/specs/domain/widget/states.md' } },
            ],
          },
        ],
        access: accessSpec('widget', { writes: [writeRule('system', ['amount'])] }),
        ...(invariants === undefined ? {} : { invariants }),
      }),
    ],
  });
}

/** 遷移 RPC 1 本を持つ data_table。 */
const TABLES = dataTableModel([
  dataTable('widgets', {
    entity: 'widget',
    functions: [
      {
        name: 'apply_widget_transition',
        args: ['text', 'text', 'text', 'text', 'text', 'text'],
        params: ['p_widget_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id'],
        kind: 'rpc',
        shape: 'transition',
        alsoWrites: [],
      },
    ],
  }),
]);

/** その計画の場面を組み立てる(A7 が要求する意味クラスは呼び側が指定する)。 */
function scenariosOf(required: readonly CoverageClass[], invariants?: InvariantSpec): readonly PlanScenario[] {
  const { guards } = stubContext();
  const domain = modelWith(invariants);
  const built = buildOperationPlans({
    domain,
    guards,
    actions: {
      actions: [actionSpec({ handles: 'widget.send', input: ['widget.id'] })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
    dataTables: TABLES,
    jobs: jobModel([outboxJob('notify', { kind: 'notification' })]),
  });
  const operation = built.operations[0];
  if (operation === undefined) throw new Error('計画が組み立てられませんでした');
  return buildPlanScenarios({ operation, domain, guards, required, roles: ['member'] });
}

/** その意味クラスの場面(無ければ undefined)。 */
function withCover(scenarios: readonly PlanScenario[], cls: CoverageClass): PlanScenario | undefined {
  return scenarios.find((scenario) => scenario.covers.includes(cls));
}

describe('場面の並び', () => {
  it('A7 が何も要求しなくても、成功と「対象なし」は出る', () => {
    const scenarios = scenariosOf([]);

    expect(withCover(scenarios, 'success')).toBeDefined();
    // 行を読む計画なら、対象なしはゼロ費用で実行できる(「見えない」と「権限が無い」を
    // 区別しない設計判断は権限に直結するので、要求を待たずに固定する)。
    expect(withCover(scenarios, 'not_found')).toBeDefined();
  });

  it('対象なしの場面は行を 1 つも用意せず、権限の拒否に写る', () => {
    const absent = withCover(scenariosOf([]), 'not_found');

    expect(absent?.rows).toEqual([]);
    expect(absent?.expect.kind).toBe('forbidden');
    expect(absent?.calls).toBe(false);
  });

  it('要求された意味クラスの場面が出る(遷移元でない)', () => {
    const scenarios = scenariosOf(['invalid_from']);

    expect(withCover(scenarios, 'invalid_from')?.expect).toEqual({
      kind: 'guard_unsatisfied',
      blockedBy: 'state',
    });
  });
});

describe('不変条件違反の場面が載せる ID', () => {
  it('DB が執行する自集約の不変条件だけを載せる', () => {
    const scenarios = scenariosOf(
      ['invariant'],
      invariantSpec([
        invariant({ id: 'INV-W-001', entities: ['widget'], enforcedBy: [enforcement('db_constraint', 'widgets_x')] }),
      ]),
    );

    expect(withCover(scenarios, 'invariant')?.expect).toEqual({
      kind: 'invariant_violated',
      invariant: 'INV-W-001',
    });
  });

  it('application 執行しかない不変条件は載せない(RPC がその ID を返さない)', () => {
    const scenarios = scenariosOf(
      ['invariant'],
      invariantSpec([
        invariant({ id: 'INV-W-002', entities: ['widget'], enforcedBy: [enforcement('application', 'assertX')] }),
      ]),
    );

    // 場面そのものが作られない —— そのとき A7 が「宣言が足りない」と鳴るのが正しい姿である。
    expect(withCover(scenarios, 'invariant')).toBeUndefined();
  });
});

describe('RPC の名前つき引数', () => {
  it('成功の場面は引数の期待を持つ(遷移先・副作用・イベント・実行者・判断時の状態)', () => {
    const success = withCover(scenariosOf([]), 'success');

    expect(success?.args).toMatchObject({
      p_next_state: 'sent',
      p_effects: ['notify'],
      p_event_id: 'widget.send',
      p_actor_id: success?.actorId,
      p_expected_state: 'draft',
    });
  });

  it('RPC を呼び出さない場面は引数の期待を持たない', () => {
    const absent = withCover(scenariosOf([]), 'not_found');

    expect(absent?.args).toEqual({});
  });
});

describe('実行者の属性(actor.{欄})をガードが読む遷移(テナント境界。点検 3 回目 A3-1)', () => {
  /** 会社を持つ widget と、会社をセッションに載せる member。ガードが行の会社と実行者の会社を比べる。 */
  function tenantScenarios(required: readonly CoverageClass[]): readonly PlanScenario[] {
    const guards = createGuardServices();
    const domain = specModel({
      roles: [role('anonymous'), role('member'), role('system')],
      aggregates: [
        aggregate({
          name: 'member',
          entity: entitySpec('member', [field('company_id', { kind: 'ref', entity: 'company' }, { required: true, session: true })]),
        }),
        aggregate({
          name: 'widget',
          entity: entitySpec('widget', [
            field('state', { kind: 'state', machine: 'widget' }, { required: true }),
            field('company_id', { kind: 'ref', entity: 'company' }, { required: true }),
          ]),
          stateMachines: [
            machine({
              machine: 'widget',
              states: ['draft', 'sent'],
              initial: 'draft',
              events: [event({ id: 'send', from: ['draft'], to: 'sent', by: ['member'], guard: 'widget.company_id == actor.company_id' })],
            }),
          ],
        }),
      ],
    });
    const built = buildOperationPlans({
      domain,
      guards,
      actions: { actions: [actionSpec({ handles: 'widget.send', input: ['widget.id'] })], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      dataTables: TABLES,
      jobs: jobModel([]),
    });
    const operation = built.operations[0];
    if (operation === undefined) throw new Error('計画が組み立てられませんでした');
    return buildPlanScenarios({ operation, domain, guards, required, roles: ['member'] });
  }

  /** 場面の行の会社と、セッションの会社。 */
  function companies(scenario: PlanScenario | undefined): readonly unknown[] {
    const row = scenario?.rows.find((candidate) => candidate.table === 'widgets');
    return [row?.values['company_id'], scenario?.claims['company_id']];
  }

  it('成功の場面は、行の会社とセッションの会社を同じ値にする(以前は解けずに場面が 1 つも作られなかった)', () => {
    const success = withCover(tenantScenarios([]), 'success');
    expect(success).toBeDefined();
    const [row, session] = companies(success);
    expect(row).toBeDefined();
    expect(row).toBe(session);
  });

  it('前提が成立しない場面は、他の会社の行(行の会社 ≠ セッションの会社)になる = 他社の行の遷移が拒否される', () => {
    const refused = withCover(tenantScenarios(['guard_unsatisfied']), 'guard_unsatisfied');
    expect(refused?.expect).toEqual({ kind: 'guard_unsatisfied', blockedBy: 'guard' });
    const [row, session] = companies(refused);
    expect(row).toBeDefined();
    expect(session).toBeDefined();
    expect(row).not.toBe(session);
  });
});
