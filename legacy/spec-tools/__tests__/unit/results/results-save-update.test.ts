/**
 * 保存点の結果表が、**編集(`update`)の手順を欄ごとに判定する**ことを固定する(束 ⑳-5b-b)。
 *
 * ## なぜ合成した計画で実行するのか
 *
 * 製品にも 4 題材にも、**`update` の手順を持つ保存点は 1 つも無い**(保存点に置ける定型は
 * 作成と遷移だけであり、削除・編集の定型 RPC は複合 RPC の中から呼ぶ形になっていない ——
 * `lib/usecase/step-plan.ts` の `SaveStepPlan.kind` の JSDoc)。これは検査の穴ではなく**仕様の
 * 現状**であり、Finding で報告するものではない。
 *
 * だが結果表は「判定は先読み(engine)そのものである」と読者に約束している。最初にその形の
 * 保存点が生まれた瞬間に表が嘘をつかないことを、いま固定しておく必要がある —— 束 ⑳-5b の
 * 実装は `field: null` を渡していたため、`update` の手順は**無条件で ✅**になっていた
 * (独立レビュー ⑳-5b の「止める」1 件)。
 *
 * ## 何を実行するか
 *
 * 表の 1 マスが通る道そのもの(`lib/results/save-cases.ts` の `caseOf`)である
 * `decidePlanWith` に、編集の手順を 1 つ持つ計画を渡す。規則表は**仕様から組んだ本物**
 * (`engineTablesOf`)であり、判定は app の実行器が下す。
 */

import { describe, expect, it } from 'vitest';
import type { RunPlan, RunStepPlan } from '@kaninabe/runtime/plan';
import { decidePlanWith } from '@kaninabe/runtime/template/evaluate';
import { asResultDecision, engineTablesOf, roleTablesOf } from '../../../lib/results/decide.js';
import { runStepData } from '../../../lib/usecase/step-plan-data.js';
import type { SaveStepPlan } from '../../../lib/usecase/step-plan.js';
import { createGuardServices } from '../../../lib/guard/services.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  specModel,
  write,
} from '../../helpers/model-builder.js';

/**
 * 欄によって書ける人が違う集約。
 *
 * - `title` は `member` が書ける
 * - `fee` は `staff` だけが書ける
 */
function domainWithFieldSplit(): ReturnType<typeof specModel> {
  return specModel([
    aggregate('item', {
      entity: entitySpec('item', {
        fields: [field('title', { kind: 'text' }), field('fee', { kind: 'integer' })],
      }),
      access: accessSpec('item', { writes: [write('member', ['title']), write('staff', ['fee'])] }),
    }),
  ]);
}

/** 編集の手順を 1 つだけ持つ保存点の計画(合成)。 */
function updatePlan(fields: readonly string[]): RunPlan {
  const domain = domainWithFieldSplit();
  const tables = engineTablesOf(domain, createGuardServices());
  const step: SaveStepPlan = {
    index: 0,
    op: 'item.update',
    alias: 'item.update',
    label: '品目を直す',
    repeat: false,
    defaultsSelf: false,
    kind: 'update',
    runner: 'auto',
    aggregate: 'item',
    entity: 'item',
    table: 'items',
    fn: { name: 'update_item', args: [], params: [], kind: 'rpc', alsoWrites: [] },
    machine: null,
    event: null,
    effects: [],
    inputFields: [...fields],
    computes: {},
    computeReads: [],
    transitionWrittenFields: [],
  };
  const runStep: RunStepPlan = {
    ...runStepData(step, {
      stateFrom: null,
      guardFacts: [],
      roleFacts: [],
      claimFacts: [],
      unresolvableRoles: [],
      inputKeys: fields,
    }),
    createRules: null,
    deleteRules: null,
    writeRules: tables.writes.get('item') ?? null,
    machine: null,
  };
  return {
    usecase: 'demo',
    save: 'edit',
    rpc: 'usecase_demo_edit',
    call: { kind: 'composite' },
    reads: [],
    expectedKeys: [],
    steps: [runStep],
    invariantHooks: [],
    result: { entity: 'item', idFrom: { kind: 'idempotency' }, state: null },
  };
}

/** その入力でその実行者が編集できるか(表の 1 マスと同じ道)。 */
function decide(fields: readonly string[], input: Readonly<Record<string, unknown>>) {
  const plan = updatePlan(fields);
  const outcome = decidePlanWith(roleTablesOf(domainWithFieldSplit()), plan, {
    resolution: {
      facts: {},
      actorId: 'actor-1',
      session: {} as never,
      input: { 'item.update': input },
      now: '2026-01-01T00:00:00.000Z',
    },
    system: false,
  })[0];
  return outcome === undefined ? null : asResultDecision(outcome.decision);
}

describe('保存点の結果表: 編集の手順', () => {
  it('送った欄が書ける欄だけなら通る', () => {
    expect(decide(['title', 'fee'], { id: 'x', title: '新しい題' })?.allowed).toBe(true);
  });

  it('書けない欄が 1 つでも混ざれば、その欄の理由で落ちる(欄ごとの判定)', () => {
    const decision = decide(['title', 'fee'], { id: 'x', title: '新しい題', fee: 100 });
    expect(decision?.allowed).toBe(false);
    expect(decision?.reason).toBe('role_forbidden');
    // 落ちたのは `fee` の規則であり、`title` の規則ではない —— 許されるロールがそれを示す。
    expect(decision?.allowedRoles).toEqual(['staff']);
  });

  it('対象の識別子だけを送ると、動かす欄が 1 つも無いので判定は通る(実行器の `changedFields`)', () => {
    expect(decide(['title', 'fee'], { id: 'x' })?.allowed).toBe(true);
  });
});
