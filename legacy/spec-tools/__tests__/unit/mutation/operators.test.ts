/**
 * 変異器(`lib/mutation/operators.ts` と、そこが束ねる `operators-reads.ts` /
 * `operators-invariants.ts`)の単体テスト(束 ⑳-5c)。
 *
 * 見るのは 3 つ。
 *   1. **1 か所しか壊さない**(他の宣言が道連れにならない)
 *   2. 壊した場所を**宣言する**(対応表の「壊した例」欄になる)
 *   3. 壊せる場所が無ければ**空**を返す(空振りを穴と混同しない)
 *
 * 実物の題材での実測は `__tests__/mutation/mutation-matrix.test.ts` が受け持つ。
 */

import { describe, expect, it } from 'vitest';
import type { SpecModel } from '../../../lib/model/types.js';
import { ALL_MUTATION_OPERATORS } from '../../../lib/mutation/operators.js';
import { UNMUTATED_DECLARATIONS } from '../../../lib/mutation/scope.js';
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
  writeRule,
} from '../../helpers/model-builder-v8plus.js';

/** 変異器 1 つを ID で引く。 */
function operator(id: string) {
  const found = ALL_MUTATION_OPERATORS.find((candidate) => candidate.id === id);
  expect(found, `変異器 ${id} が目録に無い`).toBeDefined();
  return found!;
}

/** 遷移 2 本・読み取り 2 本・作成 / 編集 / 削除つきの題材。 */
function model(): SpecModel {
  return specModel({
    roles: [role('member'), role('owner', 'doc.owner_id == actor.id', ['member']), role('system')],
    aggregates: [
      aggregate({
        name: 'doc',
        entity: entitySpec('doc', [
          field('state', { kind: 'state', machine: 'doc' }),
          field('owner_id', { kind: 'ref', entity: 'member' }),
          field('size', { kind: 'integer' }),
        ]),
        stateMachines: [
          machine({
            machine: 'doc',
            states: ['draft', 'published'],
            events: [
              event({
                id: 'publish',
                from: ['draft'],
                to: 'published',
                by: ['owner', 'member'],
                guard: 'doc.size > 10',
              }),
              event({ id: 'retract', from: ['published'], to: 'draft', by: ['owner'] }),
            ],
          }),
        ],
        access: accessSpec('doc', {
          reads: [readRule('member', { kind: 'own' }), readRule('owner', { kind: 'all' })],
          creates: [createRule('member', 'doc.size > 0')],
          writes: [writeRule('owner', ['size'], 'state == draft')],
          deletes: [deleteRule('owner', 'state == draft')],
        }),
      }),
    ],
  });
}

/**
 * 不変条件を 3 本持つ題材(空の判定を裏返す変異器のための最小の材料)。
 *
 * `formal` を持たない 1 本・空の判定を 1 つ持つ `check` 1 本・`where` に 2 つ持つ
 * `uniqueness` 1 本を並べる —— 「式を持つ formal はすべて対象」と「持たないものは壊さない」の
 * 両方をこの 1 つの題材で見る。
 */
function modelWithInvariants(): SpecModel {
  const base = model();
  const specs = base.aggregates.get('doc');
  expect(specs).toBeDefined();
  const aggregates = new Map(base.aggregates);
  aggregates.set('doc', {
    ...specs!,
    invariants: invariantSpec([
      invariant({ id: 'INV-DOC-001' }),
      invariant({ id: 'INV-DOC-002', formal: { kind: 'check', expr: 'doc.owner_id is not null' } }),
      invariant({
        id: 'INV-DOC-003',
        formal: { kind: 'uniqueness', keys: ['owner_id'], where: 'doc.size is null or doc.owner_id is null' },
      }),
    ]),
  });
  return { ...base, aggregates };
}

/** その集約の access_spec。 */
function accessOf(target: SpecModel) {
  const access = target.aggregates.get('doc')?.access;
  expect(access).toBeDefined();
  return access!;
}

/** その遷移。 */
function eventOf(target: SpecModel, id: string) {
  const found = target.aggregates.get('doc')?.stateMachines[0]?.events.find((candidate) => candidate.id === id);
  expect(found).toBeDefined();
  return found!;
}

describe('drop_role_from_by', () => {
  it('ロールが 2 つ以上ある `by` を先に壊す(微妙な変異が先)', () => {
    const mutants = operator('drop_role_from_by').mutate(model());

    expect(mutants).toHaveLength(2);
    expect(mutants[0]?.at).toContain('doc.publish');
    expect(mutants[0]?.at).toContain('owner');
    expect(eventOf(mutants[0]!.model, 'publish').by).toEqual(['member']);
    // もう 1 本の遷移と、他の宣言は元のまま。
    expect(eventOf(mutants[0]!.model, 'retract').by).toEqual(['owner']);
    expect(accessOf(mutants[0]!.model)).toEqual(accessOf(model()));
  });

  it('ロールが 1 つだけの `by` は空になる(執行点が誰も通さなくなる)', () => {
    const mutants = operator('drop_role_from_by').mutate(model());
    expect(eventOf(mutants[1]!.model, 'retract').by).toEqual([]);
  });
});

describe('flip_guard_compare', () => {
  it('最初の比較演算子だけを反転し、どう反転したかを示す', () => {
    const mutants = operator('flip_guard_compare').mutate(model());

    expect(mutants).toHaveLength(1);
    expect(eventOf(mutants[0]!.model, 'publish').guard).toBe('doc.size <= 10');
    expect(mutants[0]?.at).toContain('doc.size > 10');
    expect(mutants[0]?.at).toContain('doc.size <= 10');
  });

  it('ガードの無い遷移は壊さない', () => {
    const mutants = operator('flip_guard_compare').mutate(model());
    expect(mutants.every((mutant) => eventOf(mutant.model, 'retract').guard)).toBe(false);
  });
});

describe('flip_null_test', () => {
  it('式を持つ formal の空の判定を 1 つずつ裏返す(formal が無い不変条件は壊さない)', () => {
    const mutants = operator('flip_null_test').mutate(modelWithInvariants());

    // `check` の 1 か所 + `uniqueness` の `where` の 2 か所 = 3 件。formal 無しの 1 本は 0 件。
    expect(mutants).toHaveLength(3);
    expect(mutants.map((mutant) => mutant.at.includes('INV-DOC-001'))).toEqual([false, false, false]);
  });

  it('裏返すのは 1 か所だけで、他の欄と他の不変条件は元のまま', () => {
    const mutants = operator('flip_null_test').mutate(modelWithInvariants());
    const first = mutants[0];
    expect(first).toBeDefined();
    const invariants = first!.model.aggregates.get('doc')?.invariants?.invariants ?? [];

    const check = invariants.find((current) => current.id === 'INV-DOC-002')?.formal;
    expect(check?.kind === 'check' ? check.expr : '').toBe('doc.owner_id is null');
    const unique = invariants.find((current) => current.id === 'INV-DOC-003')?.formal;
    expect(unique?.kind === 'uniqueness' ? unique.where : '').toBe('doc.size is null or doc.owner_id is null');
  });

  it('`where` の 2 か所は別の変異になる(1 件で 2 か所を壊さない)', () => {
    const mutants = operator('flip_null_test')
      .mutate(modelWithInvariants())
      .filter((mutant) => mutant.at.includes('INV-DOC-003'));

    expect(mutants).toHaveLength(2);
    const wheres = mutants.map((mutant) => {
      const found = (mutant.model.aggregates.get('doc')?.invariants?.invariants ?? []).find(
        (current) => current.id === 'INV-DOC-003',
      )?.formal;
      return found?.kind === 'uniqueness' ? found.where : '';
    });
    expect(wheres).toEqual([
      'doc.size is not null or doc.owner_id is null',
      'doc.size is null or doc.owner_id is not null',
    ]);
  });

  it('空の判定を持たない仕様では空を返す(空振りを穴と混同しない)', () => {
    expect(operator('flip_null_test').mutate(model())).toEqual([]);
  });
});

describe('drop_read_filters', () => {
  it('境界(filters)の宣言が無ければ空を返す', () => {
    expect(operator('drop_read_filters').mutate(model())).toEqual([]);
  });

  it('宣言があれば、その 1 本からだけ落とす', () => {
    const base = model();
    const access = accessOf(base);
    const aggregates = new Map(base.aggregates);
    aggregates.set('doc', {
      ...base.aggregates.get('doc')!,
      access: {
        ...access,
        reads: [
          { ...access.reads[0]!, filters: [{ field: 'company_id', actorField: 'company_id' }] },
          access.reads[1]!,
        ],
      },
    });
    const target: SpecModel = { ...base, aggregates };

    const mutants = operator('drop_read_filters').mutate(target);

    expect(mutants).toHaveLength(1);
    expect(mutants[0]?.at).toContain('company_id');
    expect(accessOf(mutants[0]!.model).reads[0]?.filters).toBeUndefined();
    expect(accessOf(mutants[0]!.model).reads[1]).toEqual(access.reads[1]);
  });
});

describe('drop_read_when', () => {
  it('状態の条件が無ければ空を返す', () => {
    expect(operator('drop_read_when').mutate(model())).toEqual([]);
  });

  it('宣言があれば、その 1 本からだけ落とす(他の軸は残る)', () => {
    const base = model();
    const access = accessOf(base);
    const aggregates = new Map(base.aggregates);
    aggregates.set('doc', {
      ...base.aggregates.get('doc')!,
      access: {
        ...access,
        reads: [
          access.reads[0]!,
          {
            ...access.reads[1]!,
            when: 'doc.state != published',
            filters: [{ field: 'company_id', actorField: 'company_id' }],
          },
        ],
      },
    });
    const target: SpecModel = { ...base, aggregates };

    const mutants = operator('drop_read_when').mutate(target);

    expect(mutants).toHaveLength(1);
    expect(mutants[0]?.at).toContain('doc.state != published');
    expect(accessOf(mutants[0]!.model).reads[1]?.when).toBeUndefined();
    // 同じ規則の境界は残る(1 か所だけ壊す)。
    expect(accessOf(mutants[0]!.model).reads[1]?.filters).toHaveLength(1);
    expect(accessOf(mutants[0]!.model).reads[0]).toEqual(access.reads[0]);
  });
});

describe('widen_read_scope', () => {
  it('`all` でない読み取りだけを `all` に広げる', () => {
    const mutants = operator('widen_read_scope').mutate(model());

    expect(mutants).toHaveLength(1);
    expect(mutants[0]?.at).toContain('own');
    expect(accessOf(mutants[0]!.model).reads[0]?.scope).toEqual({ kind: 'all' });
    expect(accessOf(mutants[0]!.model).reads[1]?.scope).toEqual({ kind: 'all' });
  });
});

describe('drop_write_when', () => {
  it('creates / writes / deletes の `when` をそれぞれ 1 か所ずつ落とす', () => {
    const mutants = operator('drop_write_when').mutate(model());

    expect(mutants.map((mutant) => mutant.at.includes('creates'))).toContain(true);
    expect(mutants).toHaveLength(3);
    const creates = mutants.find((mutant) => mutant.at.includes('creates'));
    expect(accessOf(creates!.model).creates[0]?.when).toBeUndefined();
    // 同じ変異で writes / deletes の条件は残る(1 か所だけ壊す)。
    expect(accessOf(creates!.model).writes[0]?.when).toBe('state == draft');
    expect(accessOf(creates!.model).deletes[0]?.when).toBe('state == draft');
  });
});

describe('drop_role_implies', () => {
  it('ロール階層を 1 つ落とし、他のロールは元のまま', () => {
    const mutants = operator('drop_role_implies').mutate(model());

    expect(mutants).toHaveLength(1);
    expect(mutants[0]?.at).toContain('owner');
    const roles = mutants[0]!.model.roles.roles;
    expect(roles.find((current) => current.id === 'owner')?.implies).toEqual([]);
    expect(roles.find((current) => current.id === 'member')).toEqual(
      model().roles.roles.find((current) => current.id === 'member'),
    );
  });
});

describe('目録', () => {
  it('ID が重複しない(対応表の行が混ざらない)', () => {
    const ids = ALL_MUTATION_OPERATORS.map((current) => current.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('どの変異器も、壊したモデルを元のモデルと同一視しない', () => {
    const base = model();
    for (const current of ALL_MUTATION_OPERATORS) {
      for (const mutant of current.mutate(base)) {
        expect(mutant.model, current.id).not.toBe(base);
        expect(mutant.at.length, current.id).toBeGreaterThan(0);
      }
    }
  });

  // 目録の範囲(保証の章の冒頭の 1 段落)は、この 2 つの宣言から**生成される**。
  // 手で書いた範囲の文を章に貼らないための欄なので、欄が空だと範囲の説明が黙って薄くなる。
  it('どの変異器も「何を壊すか」(breaks)を宣言する', () => {
    for (const current of ALL_MUTATION_OPERATORS) {
      expect(current.breaks.length, current.id).toBeGreaterThan(0);
    }
  });

  it('「まだ壊す変異器を持たない宣言」は、実際にどの変異器も壊していない', () => {
    const mutated = ALL_MUTATION_OPERATORS.map((current) => current.breaks);
    // 宣言が 0 件なのは正しい状態なので、確かめるのは突き合わせる相手(変異器の表)が空でないことである(15 回目 C15-2)。
    expect(mutated.length).toBeGreaterThan(0);
    for (const pending of UNMUTATED_DECLARATIONS) {
      expect(
        mutated.some((name) => name === pending.declaration || name.startsWith(`${pending.declaration}[`)),
        `${pending.declaration} は変異器を持っている(宣言から消す)`,
      ).toBe(false);
      expect(pending.pending.length).toBeGreaterThan(0);
    }
  });
});

describe('add_ground_writer', () => {
  it('役の根拠の欄(binding の欄)を既定のログインロールが書ける編集の規則を 1 本だけ足す', () => {
    const mutants = operator('add_ground_writer').mutate(model());

    expect(mutants).toHaveLength(1);
    expect(mutants[0]?.at).toContain('by: member / fields: [owner_id]');
    expect(accessOf(mutants[0]!.model).writes.map((rule) => `${rule.by}:${rule.fields.join(',')}`)).toEqual(['owner:size', 'member:owner_id']);
  });

  it('既定のログインロールが既にその役を持つ(含意する)根拠の欄は壊さない', () => {
    const base = model();
    const roles = base.roles.roles.map((current) => (current.id === 'member' ? { ...current, implies: ['owner'] } : current));

    expect(operator('add_ground_writer').mutate({ ...base, roles: { ...base.roles, roles } })).toEqual([]);
  });
});
