/**
 * 保存点が複合 RPC に写せるかの判定(save-renderable)のユニットテスト。
 *
 * 検査 Y12 と生成器(code-usecase-rpc)が**共有する 1 組の関数**そのものを見る。Y12 側の
 * 規約網羅は y12-save-renderable.test.ts が持ち、ここは束 ⑲-1 で直した 2 点を固定する。
 *
 *   - `narrowCompositeParams` は**写せない供給元を 1 つも取りこぼさない**(`UNRENDERABLE` の
 *     鍵が `CompositeParamSource` の `Exclude` と同じ集合であること。以前は `Partial` で
 *     鍵が欠けても型が通り、無検査のキャストが嘘になった)
 *   - `readbackPlans`(導出の層。Y12 と共有)が**読み直せるかの判定と問い合わせの構造**を返し、
 *     `readbackEntries`(生成器)が**それを字面にするだけ**である(生成器が同じ判定をもう一度回して
 *     `?? ''` で空の SQL 式を出す経路を消す)
 */

import { describe, expect, it } from 'vitest';
import { narrowCompositeParams } from '../../../lib/usecase/save-renderable.js';
import { readbackPlans } from '../../../lib/usecase/save-readback.js';
import { readbackEntries } from '../../../lib/generate/render/usecase-sql.js';
import { planSave } from '../../../lib/usecase/step-plan.js';
import { resolveSaveParams } from '../../../lib/usecase/param-source.js';
import type { ResolvedParam } from '../../../lib/usecase/param-source.js';
import type { SavePlan } from '../../../lib/usecase/step-plan.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../helpers/usecase-rpc-fixture.js';
import type { UsecaseStepDecl } from '../../../lib/model/usecase/types.js';

/** 手順の列を接地し、引数まで解決した状態を返す。 */
function resolved(steps: readonly UsecaseStepDecl[]): {
  readonly plan: SavePlan;
  readonly steps: readonly (readonly ResolvedParam[])[];
} {
  const usecase = usecaseSpec({
    name: 'demo',
    saves: [usecaseSave('register', steps, { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' })],
  });
  const save = usecase.saves[0];
  if (save === undefined) throw new Error('保存点を組み立てられませんでした');
  const planned = planSave(usecase, save, {
    domain: rpcDomain(),
    actions: rpcActions(),
    dataTables: rpcDataTables(),
  });
  if (!planned.ok) throw new Error(`接地に失敗: ${planned.problems.map((problem) => problem.message).join(' / ')}`);
  const params = resolveSaveParams(planned.plan, rpcDomain());
  if (!params.ok) throw new Error(`解決に失敗: ${params.problems.map((problem) => problem.message).join(' / ')}`);
  return { plan: planned.plan, steps: params.steps };
}

/** 作成 → 作成 → 遷移(参照の鎖が 2 段)の保存点。 */
function chain(): ReturnType<typeof resolved> {
  return resolved([usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')]);
}

describe('narrowCompositeParams', () => {
  it('写せる引数だけの保存点はそのまま絞り込める(手順の数も引数の数も変わらない)', () => {
    const world = chain();

    const narrowed = narrowCompositeParams(world.plan, world.steps);

    expect(narrowed.ok).toBe(true);
    if (!narrowed.ok) return;
    expect(narrowed.steps).toHaveLength(world.steps.length);
    expect(narrowed.steps.map((params) => params.length)).toEqual(world.steps.map((params) => params.length));
  });

  it.each([
    { kind: 'computed' as const, source: { kind: 'computed' as const, field: 'size', ref: 'computeSize' } },
    { kind: 'write_effects' as const, source: { kind: 'write_effects' as const } },
  ])('写せない供給元($kind)は 1 本でも混ざれば理由つきで落ちる', ({ kind, source }) => {
    const world = chain();
    const injected = world.steps.map((params, index) =>
      index === 0 ? [...params, { name: 'p_x', source }] : params,
    );

    const narrowed = narrowCompositeParams(world.plan, injected);

    expect(narrowed.ok).toBe(false);
    if (narrowed.ok) return;
    expect(narrowed.problems).toHaveLength(1);
    expect(narrowed.problems[0]?.message).toContain(kind);
    expect(narrowed.problems[0]?.suggestion.length).toBeGreaterThan(0);
    expect(narrowed.problems[0]?.counterexample).toMatchObject({ param: 'p_x' });
  });

  it('遷移が自分で決めない列(not_written)は写せる —— 複合 RPC は単発と同じく空を渡す(A6-1)', () => {
    const world = chain();
    const source = { kind: 'not_written' as const, field: 'closed_at', contract: 'untouched' as const };
    const injected = world.steps.map((params, index) => (index === 2 ? [...params, { name: 'p_x', source }] : params));

    const narrowed = narrowCompositeParams(world.plan, injected);

    expect(narrowed.ok).toBe(true);
    if (!narrowed.ok) return;
    expect(narrowed.steps[2]?.some((param) => param.name === 'p_x')).toBe(true);
  });
});

describe('readbackPlans(導出の層。SQL の字面を持たない)', () => {
  it('手順ごとに別名と問い合わせの構造を返し、最初に作る行は再送のキーで引く', () => {
    const world = chain();

    const planned = readbackPlans(world.plan, world.steps);

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.entries.map((entry) => entry.alias)).toEqual(['container.create', 'item.create', 'item.submit']);
    expect(planned.entries[0]?.query).toEqual({ kind: 'by_id', table: expect.any(String), id: { kind: 'first' } });
    expect(JSON.stringify(planned.entries)).not.toContain('select');
  });

  it('作成を持たない保存点は錨が無く、読み直せない手順は理由つきで落ちる(readbackEntries と同じ判定)', () => {
    const none = resolved([usecaseStep('item.submit')]);
    expect(readbackPlans(none.plan, none.steps)).toEqual({ ok: true, anchor: null, resend: null, entries: [] });
    const two = resolved([
      usecaseStep('container.create'),
      usecaseStep('item.create', { as: 'first' }),
      usecaseStep('item.create', { as: 'more', repeat: true }),
    ]);
    const planned = readbackPlans(two.plan, two.steps);
    const entries = readbackEntries(two.plan, two.steps);
    expect(planned.ok).toBe(false);
    expect(entries).toEqual(planned);
  });
});

describe('readbackEntries', () => {
  it('手順ごとに別名と読み直しの式を返す(式は空にならない)', () => {
    const world = chain();

    const readback = readbackEntries(world.plan, world.steps);

    expect(readback.ok).toBe(true);
    if (!readback.ok) return;
    expect(readback.anchor?.op).toBe('container.create');
    expect(readback.entries.map((entry) => entry.alias)).toEqual([
      'container.create',
      'item.create',
      'item.submit',
    ]);
    for (const entry of readback.entries) {
      expect(entry.expression.startsWith('(select ')).toBe(true);
    }
  });

  it('作成を持たない保存点は冪等の錨が無い(anchor: null・式も無い)', () => {
    const world = resolved([usecaseStep('item.submit')]);

    const readback = readbackEntries(world.plan, world.steps);

    expect(readback).toEqual({ ok: true, anchor: null, resend: null, entries: [] });
  });

  it('同じ表に行を作る手順が 2 つあると読み直せず、理由つきで落ちる(式は返さない)', () => {
    const world = resolved([
      usecaseStep('container.create'),
      usecaseStep('item.create', { as: 'first' }),
      usecaseStep('item.create', { as: 'more', repeat: true }),
    ]);

    const readback = readbackEntries(world.plan, world.steps);

    expect(readback.ok).toBe(false);
    if (readback.ok) return;
    expect(readback.problems.map((problem) => problem.counterexample['alias'])).toContain('more');
  });
});
