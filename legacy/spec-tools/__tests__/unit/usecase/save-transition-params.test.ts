/**
 * 保存点(複合 RPC)の**遷移の手順**の引数の供給元が、単発の同じ遷移と同じ判定になることのテスト(A6-1)。
 *
 * 以前は保存点(`!plan.single`)だけ「決まらない欄は入力から読む」に落ちていた —— そのイベントが
 * `records_actor` で書き留めない記録の列(誰が保管したか・誰が対応者か)を、保存点の経路だけ利用者が
 * 任意の値で書けた(単発の同じ遷移は空を渡す)。DB の CHECK に頼らず、**供給元の判定そのもの**と
 * 生成する SQL の字面を見る。
 *
 * 表は「欄の宣言」×「経路(単発 / 保存点)」。期待は経路によらず同じ(作成の手順の入力欄だけは
 * 保存点で入力に落ちる —— 従来どおり)。
 */

import { describe, expect, it } from 'vitest';
import { planSave } from '../../../lib/usecase/step-plan.js';
import { resolveSaveParams } from '../../../lib/usecase/param-source.js';
import type { ParamSource } from '../../../lib/usecase/param-source.js';
import { narrowCompositeParams } from '../../../lib/usecase/save-renderable.js';
import { callStatement } from '../../../lib/generate/render/usecase-sql.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import { accessSpec, aggregate, create, entitySpec, event, field, machine, role, roleSpec, specModel } from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { TEST_PLATFORM } from '../../helpers/platform.js';
import type { SpecModel } from '../../../lib/model/types.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';
import type { DataTableSpecModel } from '../../../lib/model/data/types.js';

/** 遷移 file の宣言のつまみ。 */
interface World {
  /** file が実行者を書き留める列(`records_actor`)。 */
  readonly recordsActor?: readonly string[];
  /** file が空にする列(`clears`)。 */
  readonly clears?: readonly string[];
  /** 遷移だけが書く列(`transition_writes`)。 */
  readonly transitionWrites?: readonly string[];
  /** file の action_spec の input(`doc.id` は常に入る)。 */
  readonly fileInput?: readonly string[];
}

/** staff(実行者)/ doc(作成 + 状態機械。記録の列 archived_by を持つ)。 */
function domain(world: World): SpecModel {
  return specModel(
    [
      aggregate('staff', {
        entity: entitySpec('staff', {
          fields: [field('id', { kind: 'uuid' }), field('name', { kind: 'string' }, { required: true, session: true })],
        }),
      }),
      aggregate('doc', {
        entity: entitySpec('doc', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('title', { kind: 'string' }, { required: true }),
            field('archived_by', { kind: 'ref', entity: 'staff' }),
            field('state', { kind: 'state', machine: 'doc' }),
          ],
        }),
        access: accessSpec('doc', {
          creates: [create('member')],
          ...(world.transitionWrites === undefined ? {} : { transitionWrites: world.transitionWrites }),
        }),
        stateMachines: [
          machine('doc', {
            states: ['draft', 'filed'],
            initial: 'draft',
            events: [
              event('file', {
                from: ['draft'],
                to: 'filed',
                by: ['member'],
                ...(world.recordsActor === undefined ? {} : { recordsActor: world.recordsActor }),
                ...(world.clears === undefined ? {} : { clears: world.clears }),
              }),
            ],
          }),
        ],
      }),
    ],
    roleSpec([role('member'), role('anonymous'), role('system')]),
  );
}

function actions(world: World): ActionSpecModel {
  return {
    actions: [
      actionSpec({ handles: 'doc.create', input: ['doc.title'] }),
      actionSpec({ handles: 'doc.file', input: ['doc.id', ...(world.fileInput ?? [])] }),
    ],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
}

function tables(): DataTableSpecModel {
  return dataTableModel([
    dataTable('docs', {
      entity: 'doc',
      functions: [
        {
          name: 'insert_doc',
          args: ['uuid', 'jsonb', 'uuid'],
          params: ['p_id', 'p_values', 'p_actor_id'],
          kind: 'rpc',
          shape: 'create',
          alsoWrites: [],
        },
        {
          name: 'apply_doc_transition',
          args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'uuid'],
          params: ['p_doc_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_archived_by'],
          kind: 'rpc',
          shape: 'transition',
          alsoWrites: [],
        },
      ],
    }),
  ]);
}

type Route = 'single' | 'save';

/** 経路ごとに file の手順を接地・解決し、p_archived_by の供給元(決まらなければ problems の文)を返す。 */
function archivedBySource(world: World, route: Route): ParamSource | string {
  const steps = route === 'single' ? [usecaseStep('doc.file')] : [usecaseStep('doc.create'), usecaseStep('doc.file')];
  const usecase = usecaseSpec({
    name: 'demo',
    saves: [usecaseSave('register', steps, { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' })],
  });
  const save = usecase.saves[0];
  if (save === undefined) throw new Error('保存点を組み立てられませんでした');
  const planned = planSave(usecase, save, { domain: domain(world), actions: actions(world), dataTables: tables() }, route === 'single');
  if (!planned.ok) throw new Error(planned.problems.map((problem) => problem.message).join(' / '));
  const resolved = resolveSaveParams(planned.plan, domain(world));
  if (!resolved.ok) return resolved.problems.map((problem) => problem.message).join(' / ');
  const fileStep = resolved.steps[resolved.steps.length - 1] ?? [];
  const param = fileStep.find((candidate) => candidate.name === 'p_archived_by');
  if (param === undefined) throw new Error('p_archived_by が解決結果にありません');
  return param.source;
}

const CASES: readonly { readonly name: string; readonly world: World; readonly expected: ParamSource | 'problem' }[] = [
  {
    name: 'records_actor で宣言した列は実行者',
    world: { recordsActor: ['archived_by'] },
    expected: { kind: 'actor' },
  },
  {
    name: 'transition_writes にあり records_actor に無い列は触れない(空を渡す)',
    world: { transitionWrites: ['archived_by'] },
    expected: { kind: 'not_written', field: 'archived_by', contract: 'untouched' },
  },
  {
    name: 'clears に並ぶ列は空にする(空を渡す)',
    world: { transitionWrites: ['archived_by'], clears: ['archived_by'] },
    expected: { kind: 'not_written', field: 'archived_by', contract: 'cleared' },
  },
  {
    name: 'その遷移の action_spec の input にある列だけは入力から読む',
    world: { fileInput: ['doc.archived_by'] },
    expected: { kind: 'input_field', field: 'archived_by', type: { kind: 'ref', entity: 'staff' } },
  },
  {
    name: 'どこにも宣言が無い列は決まらない(入力に落とさない)',
    world: {},
    expected: 'problem',
  },
];

describe('遷移の手順の p_{列} の供給元は単発と保存点で同じ(A6-1)', () => {
  for (const route of ['single', 'save'] as const) {
    it.each(CASES)(`${route}: $name`, ({ world, expected }) => {
      const source = archivedBySource(world, route);
      if (expected === 'problem') {
        expect(typeof source).toBe('string');
        expect(source).toContain('p_archived_by');
        return;
      }
      expect(source).toEqual(expected);
    });
  }

  it('保存点の遷移の手順が入力から読む欄は、その遷移の action_spec の input の部分集合である', () => {
    for (const { world } of CASES) {
      const source = archivedBySource(world, 'save');
      if (typeof source === 'string' || source.kind !== 'input_field') continue;
      expect(world.fileInput ?? []).toContain(`doc.${source.field}`);
    }
  });
});

describe('複合 RPC は空を渡す(遷移の RPC の本文が宣言どおりに扱う)', () => {
  it.each([
    { contract: 'untouched' as const, world: { transitionWrites: ['archived_by'] } },
    { contract: 'cleared' as const, world: { transitionWrites: ['archived_by'], clears: ['archived_by'] } },
  ])('not_written($contract)は narrow を通り、SQL では null を渡す(入力の鍵を読まない)', ({ world }) => {
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [
        usecaseSave('register', [usecaseStep('doc.create'), usecaseStep('doc.file')], {
          migration: '20260909000050_usecase_demo_register.sql',
          name: 'demo',
        }),
      ],
    });
    const save = usecase.saves[0];
    if (save === undefined) throw new Error('保存点を組み立てられませんでした');
    const planned = planSave(usecase, save, { domain: domain(world), actions: actions(world), dataTables: tables() });
    if (!planned.ok) throw new Error('接地に失敗');
    const resolved = resolveSaveParams(planned.plan, domain(world));
    if (!resolved.ok) throw new Error('解決に失敗');
    const narrowed = narrowCompositeParams(planned.plan, resolved.steps);
    expect(narrowed.ok).toBe(true);
    if (!narrowed.ok) return;
    const step = planned.plan.steps[1];
    if (step === undefined) throw new Error('遷移の手順がありません');
    const sql = callStatement(step, narrowed.steps[1] ?? [], new Map([[0, 'v_doc'], [1, 'v_row']]), '  ', TEST_PLATFORM);
    expect(sql).toContain('p_archived_by => null');
    expect(sql).not.toContain("'archived_by'");
  });
});
