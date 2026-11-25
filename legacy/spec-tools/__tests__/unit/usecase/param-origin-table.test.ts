/**
 * 欄を指す引数の**出どころの許可表**(param-source-fields.ts の `FIELD_ORIGINS`)のテスト(点検 7 回目 A7-1 / A7-2)。
 *
 * 表は「手順の形(作成 / 遷移 / 編集)× 経路(単発 / 保存点)× runner(auto / manual)× 欄の宣言」。
 * 原則は 3 つ —— 利用者の入力から読むのは action_spec の input に宣言された欄だけ・実行者が入るのは
 * `records_actor` か作成の手順の実行者参照(`defaults.self` / action_spec の `owner` で**明示した**持ち主の欄)だけ・
 * 遷移には作成の自動補完が効かない。「必須で入力に無い実行者への参照は作成者」の推測はしない(点検 9 回目 A9-1)。
 * 期待は経路にも runner にもよらない(どの組み合わせでも同じ行を当てる)。
 */

import { describe, expect, it } from 'vitest';
import { planSave } from '../../../lib/usecase/step-plan.js';
import type { StepKind, StepRunner } from '../../../lib/usecase/step-plan.js';
import { resolveSaveParams } from '../../../lib/usecase/param-source.js';
import type { ParamSource } from '../../../lib/usecase/param-source.js';
import { FIELD_ORIGINS, ORIGIN_ORDER, originSource } from '../../../lib/usecase/param-source-fields.js';
import type { StepRoute } from '../../../lib/usecase/param-source-fields.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import { accessSpec, aggregate, create, entitySpec, event, field, machine, role, roleSpec, specModel, write } from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import type { SpecModel } from '../../../lib/model/types.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';
import type { DataFunctionDecl, DataTableSpecModel } from '../../../lib/model/data/types.js';

/** 1 行ぶんの宣言のつまみ。 */
interface World {
  /** 調べる手順の action_spec の input(`doc.{欄}`)。 */
  readonly input?: readonly string[];
  /** 遷移 file が実行者を書き留める列。 */
  readonly recordsActor?: readonly string[];
  /** 保存点の手順の `defaults.self`。 */
  readonly self?: boolean;
  /** `author_id` を持たない(実行者への参照を `reviewer_id` 1 本にする。`defaults.self` の指す欄を 1 つに決める)。 */
  readonly noAuthor?: boolean;
  /** `reviewer_id` も必須にする(必須で入力に無い実行者への参照を 2 本にする形。A8-1)。 */
  readonly reviewerRequired?: boolean;
  /** doc.create の action_spec の `owner`(作成者で埋めると明示する欄の名前)。 */
  readonly owner?: string;
}

/**
 * staff(実行者)/ doc(作成・遷移・編集)。doc は実行者への参照を 2 本持つ ——
 * 必須の `author_id`(持ち主の欄)と任意の `reviewer_id`。どちらも 3 つの RPC が `p_{欄}` で受ける。
 */
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
            ...(world.noAuthor === true ? [] : [field('author_id', { kind: 'ref', entity: 'staff' }, { required: true })]),
            field('reviewer_id', { kind: 'ref', entity: 'staff' }, { required: world.reviewerRequired === true }),
            field('state', { kind: 'state', machine: 'doc' }),
          ],
        }),
        access: accessSpec('doc', { creates: [create('member')], writes: [write('member', ['title'])] }),
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
              }),
            ],
          }),
        ],
      }),
    ],
    roleSpec([role('member'), role('anonymous'), role('system')]),
  );
}

/** 調べる操作(`op`)の action_spec にだけ、行の input と runner を載せる。 */
function actions(op: string, world: World, runner: StepRunner): ActionSpecModel {
  const declared = (handles: string, base: readonly string[]) =>
    actionSpec({
      handles,
      input: [...base, ...(handles === op ? (world.input ?? []) : [])],
      ...(handles === 'doc.create' && world.owner !== undefined ? { owner: `doc.${world.owner}` } : {}),
      ...(handles === op && runner === 'manual' ? { runner: { reason: '定型の RPC の外で照合してから書くため' } } : {}),
    });
  return {
    actions: [declared('doc.create', ['doc.title']), declared('doc.file', ['doc.id']), declared('doc.update', ['doc.id', 'doc.title'])],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
}

/** 3 つの RPC。どれも実行者への参照の欄を 2 本とも `p_{欄}` で受ける(宣言の外の口を作れる形)。 */
function tables(world: World): DataTableSpecModel {
  // author_id を持たない行では、その引数(型の並びの同じ位置)を落とす。
  const fn = (decl: Omit<DataFunctionDecl, 'kind' | 'alsoWrites'>): DataFunctionDecl => {
    const keep = decl.params.map((name) => world.noAuthor !== true || name !== 'p_author_id');
    return {
      ...decl,
      params: decl.params.filter((_, index) => keep[index]),
      args: decl.args.filter((_, index) => keep[index]),
      kind: 'rpc',
      alsoWrites: [],
    };
  };
  return dataTableModel([
    dataTable('docs', {
      entity: 'doc',
      functions: [
        fn({
          name: 'insert_doc',
          args: ['uuid', 'text', 'uuid', 'uuid', 'uuid'],
          params: ['p_id', 'p_title', 'p_author_id', 'p_reviewer_id', 'p_actor_id'],
          shape: 'create',
        }),
        fn({
          name: 'apply_doc_transition',
          args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'uuid', 'uuid'],
          params: ['p_doc_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_author_id', 'p_reviewer_id'],
          shape: 'transition',
        }),
        fn({
          name: 'update_doc',
          args: ['uuid', 'jsonb', 'uuid', 'uuid', 'uuid'],
          params: ['p_doc_id', 'p_changes', 'p_actor_id', 'p_author_id', 'p_reviewer_id'],
          shape: 'update',
        }),
      ],
    }),
  ]);
}

/** 手順の形 → 操作 ID。 */
const OP: Readonly<Record<Exclude<StepKind, 'delete'>, string>> = { create: 'doc.create', transition: 'doc.file', update: 'doc.update' };

/** 1 行を解決し、調べる引数の供給元(決まらなければ problems の文をつないだもの)を返す。 */
function sourceOf(kind: Exclude<StepKind, 'delete'>, route: StepRoute, runner: StepRunner, world: World, param: string): ParamSource | string {
  const op = OP[kind];
  const usecase = usecaseSpec({
    name: 'demo',
    saves: [usecaseSave('register', [usecaseStep(op, world.self === true ? { defaultsSelf: true } : {})], { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' })],
  });
  const save = usecase.saves[0];
  if (save === undefined) throw new Error('保存点を組み立てられませんでした');
  const model = domain(world);
  const planned = planSave(usecase, save, { domain: model, actions: actions(op, world, runner), dataTables: tables(world) }, route === 'single');
  if (!planned.ok) throw new Error(planned.problems.map((problem) => problem.message).join(' / '));
  expect(planned.plan.steps[0]?.runner).toBe(runner);
  const resolved = resolveSaveParams(planned.plan, model);
  if (!resolved.ok) return resolved.problems.map((problem) => `${problem.message} ${problem.suggestion}`).join(' / ');
  const found = resolved.steps[0]?.find((candidate) => candidate.name === param);
  if (found === undefined) throw new Error(`${param} が解決結果にありません`);
  return found.source;
}

const ACTOR: ParamSource = { kind: 'actor' };
const REVIEWER_INPUT: ParamSource = { kind: 'input_field', field: 'reviewer_id', type: { kind: 'ref', entity: 'staff' } };

/** 期待: 供給元そのもの、または指摘の文に含まれるべき断片。 */
type Expected = ParamSource | { readonly problem: string };

interface Row {
  readonly name: string;
  readonly kind: Exclude<StepKind, 'delete'>;
  readonly world: World;
  readonly param: string;
  readonly expected: Expected;
  /** 編集の手順は保存点に置けない(単発だけ)。 */
  readonly singleOnly?: boolean;
}

const ROWS: readonly Row[] = [
  // ── 作成: 新しい行の持ち主は owner で明示した欄だけが作る人。残りは宣言された入力だけ ──
  { name: '作成: owner で明示した欄は実行者(持ち主の欄)', kind: 'create', world: { input: ['doc.reviewer_id'], owner: 'author_id' }, param: 'p_author_id', expected: ACTOR },
  { name: '作成: input に宣言した任意の欄は入力から読む', kind: 'create', world: { input: ['doc.reviewer_id'], owner: 'author_id' }, param: 'p_reviewer_id', expected: REVIEWER_INPUT },
  {
    name: '作成: input に無い任意の欄は決まらない(保存点・manual でも入力に落とさない。A7-2)',
    kind: 'create',
    world: { owner: 'author_id' },
    param: 'p_reviewer_id',
    expected: { problem: 'insert_doc の引数 p_reviewer_id に渡す値が仕様のどこにもありません' },
  },
  // ── 作成: 持ち主の欄は推測しない(点検 9 回目 A9-1。8 回目の「候補が 1 本なら作成者」も無くした)──
  {
    name: '作成: owner の宣言が無ければ、必須で入力に無い実行者への参照も作成者で埋めない(直し方は input か owner の明示)',
    kind: 'create',
    world: { input: ['doc.reviewer_id'] },
    param: 'p_author_id',
    expected: { problem: '"owner: doc.author_id" を宣言する' },
  },
  {
    name: '作成: 代理作成(起案者を input)で残った必須の査閲者を作成者で埋めない(探り台本 D3 の形)',
    kind: 'create',
    world: { reviewerRequired: true, input: ['doc.author_id'] },
    param: 'p_reviewer_id',
    expected: { problem: 'insert_doc の引数 p_reviewer_id に渡す値が仕様のどこにもありません' },
  },
  {
    name: '作成: 必須で入力に無い実行者への参照が 2 本なら、owner で明示しない 2 本目は作成者で埋めない(8 回目 N4b の形)',
    kind: 'create',
    world: { reviewerRequired: true, owner: 'author_id' },
    param: 'p_reviewer_id',
    expected: { problem: 'insert_doc の引数 p_reviewer_id に渡す値が仕様のどこにもありません' },
  },
  {
    name: '作成: 2 本あっても owner で明示した欄は実行者・もう 1 本は input(境界)',
    kind: 'create',
    world: { reviewerRequired: true, owner: 'author_id', input: ['doc.reviewer_id'] },
    param: 'p_author_id',
    expected: ACTOR,
  },
  {
    name: '作成: 必須の実行者参照が 1 本だけでも、宣言が無ければ決まらない(境界。推測しない)',
    kind: 'create',
    world: { reviewerRequired: true, noAuthor: true },
    param: 'p_reviewer_id',
    expected: { problem: 'insert_doc の引数 p_reviewer_id に渡す値が仕様のどこにもありません' },
  },
  { name: '作成: owner を宣言した欄が input にもあれば入力が決める(V18 が宣言を咎める)', kind: 'create', world: { reviewerRequired: true, noAuthor: true, owner: 'reviewer_id', input: ['doc.reviewer_id'] }, param: 'p_reviewer_id', expected: REVIEWER_INPUT },
  // ── 遷移: 既存の他人の行。作成の自動補完は効かない(A7-1)──
  {
    name: '遷移: 必須で入力に無い実行者への参照でも実行者にしない(records_actor を案内する)',
    kind: 'transition',
    world: { input: ['doc.reviewer_id'] },
    param: 'p_author_id',
    expected: { problem: 'records_actor: [author_id]' },
  },
  { name: '遷移: records_actor の列は実行者', kind: 'transition', world: { recordsActor: ['reviewer_id', 'author_id'] }, param: 'p_reviewer_id', expected: ACTOR },
  { name: '遷移: input に宣言した欄は入力から読む', kind: 'transition', world: { input: ['doc.reviewer_id'], recordsActor: ['author_id'] }, param: 'p_reviewer_id', expected: REVIEWER_INPUT },
  {
    name: '遷移: records_actor と input の両方にある列は実行者(実行者の宣言が利用者の入力より先)',
    kind: 'transition',
    world: { input: ['doc.reviewer_id'], recordsActor: ['reviewer_id', 'author_id'] },
    param: 'p_reviewer_id',
    expected: ACTOR,
  },
  // ── 編集: 既存の行。実行者の自動補完は無い ──
  {
    name: '編集: 必須で入力に無い実行者への参照でも実行者にしない',
    kind: 'update',
    world: { input: ['doc.reviewer_id'] },
    param: 'p_author_id',
    expected: { problem: 'update_doc の引数 p_author_id に渡す値が仕様のどこにもありません' },
    singleOnly: true,
  },
];

/** `defaults.self` を書いた保存点の行(単発の計画は宣言を持たない。実行者への参照は reviewer_id 1 本)。 */
const SELF_ROWS: readonly Omit<Row, 'singleOnly'>[] = [
  { name: '作成: defaults.self は任意の実行者への参照を実行者にする', kind: 'create', world: { self: true, noAuthor: true }, param: 'p_reviewer_id', expected: ACTOR },
  {
    name: '遷移: defaults.self は input に宣言された欄を自分に絞る',
    kind: 'transition',
    world: { self: true, noAuthor: true, input: ['doc.reviewer_id'] },
    param: 'p_reviewer_id',
    expected: ACTOR,
  },
  {
    name: '遷移: input に無い欄の defaults.self は error(書ける列を増やさない。records_actor を案内する)',
    kind: 'transition',
    world: { self: true, noAuthor: true },
    param: 'p_reviewer_id',
    expected: { problem: 'defaults.self を宣言した遷移の手順 doc.file の reviewer_id は、その遷移の action_spec の input にありません' },
  },
  {
    name: '遷移: records_actor がある列でも、input に無い defaults.self は消すよう求める(宣言の二重化を残さない)',
    kind: 'transition',
    world: { self: true, noAuthor: true, recordsActor: ['reviewer_id'] },
    param: 'p_reviewer_id',
    expected: { problem: 'records_actor: [reviewer_id]' },
  },
];

const COMBOS: readonly { readonly route: StepRoute; readonly runner: StepRunner }[] = [
  { route: 'single', runner: 'auto' },
  { route: 'single', runner: 'manual' },
  { route: 'save', runner: 'auto' },
  { route: 'save', runner: 'manual' },
];

/** 期待と照らす(指摘なら断片が含まれること)。 */
function expectSource(actual: ParamSource | string, expected: Expected): void {
  if ('problem' in expected) {
    expect(typeof actual).toBe('string');
    expect(actual).toContain(expected.problem);
    return;
  }
  expect(actual).toEqual(expected);
}

describe('許可表そのもの', () => {
  it('全ての形 × 経路 × runner のマスを書き下してあり、経路と runner で出どころが広がらない', () => {
    for (const kind of ['create', 'transition', 'update', 'delete'] as const) {
      const row = FIELD_ORIGINS[kind];
      const cells = [row.single.auto, row.single.manual, row.save.auto, row.save.manual];
      for (const cell of cells) expect(cell).toEqual(row.single.auto);
    }
  });

  it.each([
    { kind: 'create' as const, allowed: ['created_ref', 'self', 'owner', 'input', 'computed'] },
    { kind: 'transition' as const, allowed: ['created_ref', 'self_narrowing', 'records_actor', 'input', 'computed', 'not_written'] },
    { kind: 'update' as const, allowed: ['created_ref', 'input', 'computed'] },
    { kind: 'delete' as const, allowed: ['created_ref', 'input', 'computed'] },
  ])('$kind が使える出どころは閉じた集合', ({ kind, allowed }) => {
    expect([...FIELD_ORIGINS[kind].single.auto].sort()).toEqual([...allowed].sort());
  });

  it('作成の自動補完(self / owner)を許すのは作成だけ', () => {
    for (const kind of ['transition', 'update', 'delete'] as const) {
      expect(FIELD_ORIGINS[kind].save.manual).not.toContain('self');
      expect(FIELD_ORIGINS[kind].save.manual).not.toContain('owner');
    }
  });

  it('試す順では実行者の宣言(records_actor)が利用者の入力より先', () => {
    expect(ORIGIN_ORDER.indexOf('records_actor')).toBeLessThan(ORIGIN_ORDER.indexOf('input'));
  });
});

describe('欄を指す引数の供給元は 形 × 経路 × runner の許可表だけが決める', () => {
  for (const { route, runner } of COMBOS) {
    it.each(ROWS.filter((row) => route === 'single' || row.singleOnly !== true))(`${route} / ${runner}: $name`, ({ kind, world, param, expected }) => {
      expectSource(sourceOf(kind, route, runner, world, param), expected);
    });
  }
});

describe('保存点の defaults.self', () => {
  for (const runner of ['auto', 'manual'] as const) {
    it.each(SELF_ROWS)(`save / ${runner}: $name`, ({ kind, world, param, expected }) => {
      expectSource(sourceOf(kind, 'save', runner, world, param), expected);
    });
  }
});

describe('出どころ 1 つずつの当てはまり(Y8 と二重の柵の片側)', () => {
  /** 保存点の手順 1 つ(既定は遷移)を接地する(解決はしない)。 */
  function transitionStep(world: World, op = 'doc.file') {
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [usecaseSave('register', [usecaseStep(op, { defaultsSelf: world.self === true })], { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' })],
    });
    const save = usecase.saves[0];
    if (save === undefined) throw new Error('保存点を組み立てられませんでした');
    const model = domain(world);
    const planned = planSave(usecase, save, { domain: model, actions: actions(op, world, 'auto'), dataTables: tables(world) });
    if (!planned.ok) throw new Error('接地に失敗');
    const step = planned.plan.steps[0];
    const reviewer = model.aggregates.get('doc')?.entity?.fields.find((candidate) => candidate.name === 'reviewer_id');
    if (step === undefined || reviewer === undefined) throw new Error('手順か欄がありません');
    return { plan: planned.plan, step, reviewer, model };
  }

  it.each([
    { name: 'input にある欄を自分に絞る', world: { self: true, noAuthor: true, input: ['doc.reviewer_id'] }, expected: ACTOR },
    { name: 'input に無い欄には当てはまらない', world: { self: true, noAuthor: true }, expected: null },
    { name: 'defaults.self が無ければ当てはまらない', world: { noAuthor: true, input: ['doc.reviewer_id'] }, expected: null },
  ])('self_narrowing: $name', ({ world, expected }) => {
    const { plan, step, reviewer, model } = transitionStep(world);
    expect(originSource('self_narrowing', reviewer, plan, step, model)).toEqual(expected);
  });

  it.each([
    { name: 'owner で明示した必須の欄は持ち主の欄', world: { noAuthor: true, reviewerRequired: true, owner: 'reviewer_id' }, expected: ACTOR },
    { name: '宣言が無ければ、必須で input に無い唯一の実行者参照でも当てはまらない(推測しない。A9-1)', world: { noAuthor: true, reviewerRequired: true }, expected: null },
    { name: '別の欄を owner にしていれば当てはまらない', world: { reviewerRequired: true, owner: 'author_id' }, expected: null },
    { name: '必須でない欄は宣言しても持ち主の欄にならない(作成 RPC の縛りの外に落ちるので。V18 が宣言を咎める)', world: { noAuthor: true, owner: 'reviewer_id' }, expected: null },
    { name: 'input にあれば持ち主の欄ではない(入力が決める)', world: { noAuthor: true, reviewerRequired: true, owner: 'reviewer_id', input: ['doc.reviewer_id'] }, expected: null },
  ])('owner: $name', ({ world, expected }) => {
    const { plan, step, reviewer, model } = transitionStep(world, 'doc.create');
    expect(originSource('owner', reviewer, plan, step, model)).toEqual(expected);
  });

  it('owner は作成の手順にだけ載る(遷移の手順は宣言を持たない)', () => {
    const { plan, step, reviewer, model } = transitionStep({ noAuthor: true, reviewerRequired: true, owner: 'reviewer_id' });
    expect(step.owner).toBeUndefined();
    expect(originSource('owner', reviewer, plan, step, model)).toBeNull();
  });
});
