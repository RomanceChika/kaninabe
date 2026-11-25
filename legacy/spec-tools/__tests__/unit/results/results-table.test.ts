/**
 * **結果表**(`lib/results/**`)のテスト(束 ⑳-5b)。
 *
 * ここで固定するのは 5 つである。
 *   1. 表の元データは**一致の証明と同じ列挙**から出る(件数が設計図の直積の大きさと一致し、
 *      組み合わせが重複しない)—— 表とテストが別の列挙から出たら、表は「実測していないこと」を
 *      主張することになる
 *   2. 判定は **app の engine そのもの**が下す(ロール配列が空なら権限で落ちる、など)
 *   3. **境界がマスに出る**(同じ実行者・同じ状態でも、ガード変数の値で ✅ と ❌ に分かれたら
 *      どの値でどちらになったかを書く)—— ユーザーの要求(2026-09-11)がこれである
 *   4. 保存点は**最初に落ちた手順**を出し、その後ろは「判定に届かない」になる
 *   5. world を宣言から作れない集約・保存点は**理由を報告する**(T11 と同じ構え。黙って表を消さない)
 *
 * 実物の 4 題材(`__tests__/samples/**`)が通しの回帰を受け持つので、ここは判断の分かれ目だけを
 * 小さな題材で固定する。
 */

import { describe, expect, it } from 'vitest';
import { createGuardServices } from '../../../lib/guard/services.js';
import type { SpecModel } from '../../../lib/model/types.js';
import type { GenerateContext } from '../../../lib/gen-kit/generator.js';
import { resultAggregates } from '../../../lib/results/cases.js';
import { saveResults } from '../../../lib/results/save-cases.js';
import { operationTableView, saveTableView } from '../../../lib/results/table.js';
import { noProofNote, resultLabelsOf } from '../../../lib/generate/render/book/results-section.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../helpers/usecase-rpc-fixture.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import type { DataTableSpecModel } from '../../../lib/model/data/types.js';
import type { UsecaseSpec } from '../../../lib/model/usecase/types.js';

/** `item.submit` に「大きいものだけ出せる」ガードを足したドメイン(境界を確かめるための題材)。 */
function guardedDomain(): SpecModel {
  const domain = rpcDomain();
  const item = domain.aggregates.get('item');
  const machine = item?.stateMachines[0];
  const submit = machine?.events[0];
  if (item === undefined || machine === undefined || submit === undefined) return domain;
  const aggregates = new Map(domain.aggregates);
  aggregates.set('item', {
    ...item,
    stateMachines: [{ ...machine, events: [{ ...submit, guard: 'item.size > 10' }] }],
  });
  return { ...domain, aggregates };
}

/** 実行者の集約(`owner`)の表も持つ data_table(world を置くには実行者の行が要る)。 */
function tablesWithActor(): DataTableSpecModel {
  return dataTableModel([...rpcDataTables().tables, dataTable('owners', { entity: 'owner', functions: [] })]);
}

/** container.create → item.create → item.submit の 1 保存点。 */
function registerUsecase(): UsecaseSpec {
  return usecaseSpec({
    name: 'demo',
    saves: [
      usecaseSave(
        'register',
        [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')],
        { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' },
      ),
    ],
  });
}

/** 生成器に渡す最小の文脈(表の語はガードのパーサーだけを使う)。 */
function context(tables: DataTableSpecModel): GenerateContext {
  return { repoRoot: '/repo', guards: createGuardServices(), dataTables: tables } as unknown as GenerateContext;
}

/** 単発の操作の結果(ガードつきの題材)。 */
function operationResults(tables = tablesWithActor()) {
  return resultAggregates({
    domain: guardedDomain(),
    guards: createGuardServices(),
    actions: rpcActions(),
    dataTables: tables,
    jobs: undefined,
  });
}

describe('結果表(単発の操作)', () => {
  it('元データは一致の証明と同じ軸から出る(件数が直積の大きさと一致し、組み合わせが重複しない)', () => {
    for (const aggregate of operationResults()) {
      expect(aggregate.problems).toEqual([]);
      expect(aggregate.operations.length).toBeGreaterThan(0);
      for (const operation of aggregate.operations) {
        expect(operation.cases.length, `${operation.op} の組み合わせの数`).toBe(operation.count);
        const keys = operation.cases.map((found) =>
          [found.state, found.actor, found.array, found.field, ...found.axis.map((axis) => axis.label)].join('|'),
        );
        expect(new Set(keys).size, `${operation.op} の組み合わせが重複している`).toBe(keys.length);
      }
    }
  });

  it('判定は engine が下す —— ロール配列が空の実行者は権限で落ちる', () => {
    const item = operationResults().find((aggregate) => aggregate.aggregate === 'item');
    const submit = item?.operations.find((operation) => operation.op === 'item.submit');
    const empty = (submit?.cases ?? []).filter((found) => found.array === 'empty' && found.state === 'draft');
    expect(empty.length).toBeGreaterThan(0);
    for (const found of empty) {
      expect(found.decision.allowed).toBe(false);
      expect(found.decision.reason).toBe('role_forbidden');
      expect(found.decision.allowedRoles).toEqual(['member']);
    }
  });

  it('境界がマスに出る(同じ実行者・同じ状態でもガード変数の値で ✅ と ❌ に分かれる)', () => {
    const results = operationResults();
    const item = results.find((aggregate) => aggregate.aggregate === 'item');
    const submit = item?.operations.find((operation) => operation.op === 'item.submit');
    expect(submit).toBeDefined();
    expect(item).toBeDefined();
    if (item === undefined || submit === undefined) return;
    const view = operationTableView(submit, item.actors, resultLabelsOf(guardedDomain(), context(tablesWithActor()), 'item'));
    const boundary = view.rows.flat().filter((text) => text.includes('✅') && text.includes('❌'));
    expect(boundary.length, '境界のマスが 1 つも無い').toBeGreaterThan(0);
    // どの値で分かれたかがマスに出る(ガード変数の名前と値)。
    expect(boundary[0]).toContain('item.size=');
    // 落ちた理由は凡例に 1 度だけ並び、成立しなかった条件が読める。
    expect(view.legend.some((line) => line.includes('前提が成立しない'))).toBe(true);
    expect(view.reasonKinds).toBeGreaterThan(0);
  });

  it('world を宣言から作れない集約は、表の代わりに理由を報告する', () => {
    // 実行者の集約(owner)の表が無い題材 —— world に実行者の行を置けない。
    const found = operationResults(dataTableModel(rpcDataTables().tables));
    const blocked = found.filter((aggregate) => aggregate.problems.length > 0);
    expect(blocked.length).toBeGreaterThan(0);
    for (const aggregate of blocked) {
      expect(aggregate.operations).toEqual([]);
      expect(noProofNote(aggregate)).toContain('一致の証明が無い');
    }
  });
});

describe('結果表(保存点)', () => {
  /** 保存点の結果(ガードつきの題材)。 */
  function saves() {
    return saveResults({
      domain: guardedDomain(),
      guards: createGuardServices(),
      actions: rpcActions(),
      dataTables: tablesWithActor(),
      usecases: { available: true, usecases: [registerUsecase()] },
    });
  }

  it('元データは判定の grid と同じ大きさで、最初に落ちた手順から後ろは判定に届かない', () => {
    const save = saves()[0];
    expect(save?.key).toBe('demo.register');
    expect(save?.cases.length).toBe(save?.count);
    const blocked = (save?.cases ?? []).filter((found) => found.blockedAt !== null);
    expect(blocked.length, '落ちる組み合わせが 1 つも無い').toBeGreaterThan(0);
    for (const found of blocked) {
      const at = found.blockedAt ?? 0;
      expect(found.steps[at]?.reached).toBe(true);
      expect(found.steps[at]?.decision.allowed).toBe(false);
      for (const step of found.steps.slice(at + 1)) expect(step.reached).toBe(false);
    }
  });

  it('表は手順ごとの列を持ち、届かなかった手順をそう示す', () => {
    const save = saves()[0];
    expect(save).toBeDefined();
    if (save === undefined) return;
    const view = saveTableView(save, resultLabelsOf(guardedDomain(), context(tablesWithActor()), 'item'));
    expect(view.headers).toEqual(['実行者', '呼び出し元の文脈', '`container.create`', '`item.create`', '`item.submit`']);
    expect(view.rows.flat().some((text) => text.includes('判定に届かない'))).toBe(true);
  });
});
