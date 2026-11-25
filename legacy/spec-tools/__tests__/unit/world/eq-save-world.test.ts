/**
 * 保存点の一致の証明の**world と軸**(`eq-save-world` / `eq-save-cases` / `eq-save-fold`)の
 * テスト(束 ⑳-5a2)。
 *
 * ここで固定するのは 6 つである。
 *   1. world に置くのは「読む集約」と「作る行が指す集約」と「動かすだけの集約」だけで、
 *      **保存点が作る集約の行は置かない**(作るのは保存点自身である)
 *   2. 軸は 2 つの grid に分かれる(判定 / 書き込み経路)—— 掛け合わせない
 *   3. 再送の見立てと手順ごとの enforcement は**宣言から決まる**
 *   4. 実行者の集約の表が引けない題材では world を作らず、理由を報告する(T11 が出す形)
 *   5. 実行する間に片付ける相手は「作る集約の表 + 手順の `also_writes`」であり、**追記専用を
 *      宣言した表だけは報告して飛ばす**(独立レビュー ⑳-5a2 の直す 4)
 *   6. 畳みは二段で、**畳んだ軸がテスト名に出る**(同 直す 5。実物は 4 題材とも上限に
 *      届かないので、ここが唯一この経路を実行する場所である)
 *
 * 実物の 4 題材(`__tests__/samples/**`)が通しの回帰を受け持つので、ここは**判断の分かれ目**
 * だけを小さな題材で固定する。
 */

import { describe, expect, it } from 'vitest';
import { eqSaveCatalog, eqSaveTestCaseIdOf } from '../../../lib/world/eq-save-catalog.js';
import { layoutPath } from '../../../lib/model/product/layout.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
import type { EqSaveCatalogEntry } from '../../../lib/world/eq-save-catalog.js';
import { createGuardServices } from '../../../lib/guard/services.js';
import { EQ_TEST_WORDS } from '../../../lib/messages/messages-eq.js';
import type { EqAxis } from '../../../lib/world/eq-cases.js';
import { foldSaveGrid } from '../../../lib/world/eq-save-fold.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../helpers/usecase-rpc-fixture.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import type { DataTableSpecModel } from '../../../lib/model/data/types.js';
import type { UsecaseSpec } from '../../../lib/model/usecase/types.js';

/** container.create → item.create → item.submit の 1 保存点(複合 RPC の単体テストと同じ題材)。 */
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

/** 実行者の集約(`owner`)の表も持つ data_table(world を置くには実行者の行が要る)。 */
function tablesWithActor(): DataTableSpecModel {
  return dataTableModel([...rpcDataTables().tables, dataTable('owners', { entity: 'owner', functions: [] })]);
}

/** 追記専用(削除で起こすトリガを持つ)を宣言した台帳も持つ data_table。 */
function tablesWithAppendOnlyLedger(): DataTableSpecModel {
  return dataTableModel([
    ...tablesWithActor().tables,
    dataTable('outbox', {
      internal: true,
      triggers: [
        {
          name: 'outbox_append_only',
          functionName: 'reject_outbox_mutation',
          fires: 'before update or delete',
          deferred: false,
          supplies: [],
          params: {},
        },
      ],
    }),
  ]);
}

/** 値が `count` 個ある軸 1 本(置き直す値の中身は畳みの判断に関わらない)。 */
function axisOf(key: string, count: number): EqAxis {
  return {
    key,
    values: Array.from({ length: count }, (_, index) => ({ label: `v${index}`, placements: [] })),
  };
}

/** 目録を 1 件だけ引く。 */
function entry(tables: DataTableSpecModel): EqSaveCatalogEntry {
  const found = eqSaveCatalog({
    domain: rpcDomain(),
    guards: createGuardServices(),
    actions: rpcActions(),
    dataTables: tables,
    usecases: { available: true, usecases: [registerUsecase()] },
  })[0];
  if (found === undefined) throw new Error('目録が空です(題材の組み立てが失敗しています)');
  return found;
}

describe('eq-save-world / eq-save-cases', () => {
  it('保存点が作る集約の行は world に置かない(置くのは実行者の集約と、作る行が指す相手だけ)', () => {
    const found = entry(tablesWithActor());
    expect(found.key).toBe('demo.register');
    expect(found.result.ok).toBe(true);
    if (!found.result.ok) return;
    // 作る集約(container / item)の行は 1 つも無い —— 保存点自身が作るからである。
    expect(found.result.world.rows.map((row) => row.entity)).toEqual(['owner']);
    expect(found.result.world.actorTable).toBe('owners');
    // 後片付けの相手は「作る集約の表」も含む(実行するたびに消すため)。
    expect(Object.keys(found.result.world.tables).sort()).toEqual(['container', 'item', 'owner']);
  });

  it('実行者の並びは「役ごとに 1 人 + 既定 + 行が無い人」である', () => {
    const found = entry(tablesWithActor());
    expect(found.result.ok).toBe(true);
    if (!found.result.ok) return;
    expect(found.result.world.actors.map((actor) => `${actor.key}:${actor.basis}`)).toEqual([
      'member:default',
      'member_without_row:no_row',
    ]);
    // 行が無い人は系統を持たない(実行するときは他人の的を借りる)。
    expect(found.result.world.actors[1]?.targets).toEqual({});
  });

  it('軸は 2 つの grid に分かれ、掛け合わせない', () => {
    const found = entry(tablesWithActor());
    expect(found.result.ok).toBe(true);
    if (!found.result.ok) return;
    const grid = found.result.cases;
    // 判定の grid: 実行者 2 × 呼び出し元の文脈 3(この題材にはガードも外の状態も無い)。
    expect(grid.decisionCount).toBe(grid.actors.length * grid.callers.length);
    expect(grid.axes).toEqual([]);
    // 書き込み経路の軸は判定の grid に入っていない(代表値 1 つに固定されている)。
    expect(grid.decisionRepeats).toEqual([1]);
    expect(grid.decisionInputs).toEqual(['full']);
    expect(grid.writeCount).toBe(grid.writeRepeats.length * grid.writeInputs.length * grid.resends.length);
  });

  it('呼び出し元の文脈は 3 通りで、実行者 id を渡すのは人の入口だけである', () => {
    const found = entry(tablesWithActor());
    expect(found.result.ok).toBe(true);
    if (!found.result.ok) return;
    expect(found.result.cases.callers).toEqual([
      { name: 'from_session', actor: true, session: true, system: false },
      { name: 'from_runtime', actor: false, session: false, system: true },
      { name: 'empty', actor: false, session: false, system: false },
    ]);
  });

  it('再送の見立てと手順ごとの enforcement は宣言から決まる', () => {
    const found = entry(tablesWithActor());
    expect(found.result.ok).toBe(true);
    if (!found.result.ok) return;
    const cases = found.result.cases;
    // 先頭の手順が作成 = 冪等の錨があるので、再送は既存の行を読み直す。
    expect(cases.resend).toBe('idempotent');
    expect(cases.resendOp).toBeNull();
    expect(cases.resends).toEqual([1, 2]);
    // 5 形の本文が生成物である手順は理由まで報告する。
    expect(cases.steps.map((step) => step.enforcement)).toEqual(['named', 'named', 'named']);
    // 状態を持たない集約が結末なら、状態の突合は要求しない。
    expect(cases.resultStateColumn).toBeNull();
    expect(cases.resultIdFrom).toBeNull();
  });

  it('実行者の集約の表が引けない題材では world を作らず、理由を報告する', () => {
    const found = entry(rpcDataTables());
    expect(found.result.ok).toBe(false);
    if (found.result.ok) return;
    expect(found.result.problems).toHaveLength(1);
    expect(found.result.problems[0]?.message).toContain('world を組み立てる土台がありません');
  });

  it('実行する間に片付ける相手は「作る集約の表 + 手順の also_writes」である', () => {
    const found = entry(tablesWithActor());
    expect(found.result.ok).toBe(true);
    if (!found.result.ok) return;
    const cases = found.result.cases;
    // 手順の RPC は帰属表のほかにも書く —— その宣言(`also_writes`)をそのまま運ぶ。
    expect(cases.steps.map((step) => [...step.alsoWrites])).toEqual([[], ['audits'], ['outbox']]);
    // 台帳が先・作る集約の表は逆順(子が親を指すので)。台帳を片付けないと、そこに一意の
    // 宣言がある日に**2 回目の許可**が 23505 で落ち、「許可 + 制約違反 = 一致」に飲まれる。
    expect(cases.cleanup.tables).toEqual(['audits', 'outbox', 'items', 'containers']);
    expect(cases.cleanup.appendOnly).toEqual([]);
  });

  it('追記専用を宣言した台帳は片付けず、飛ばしたことを設計図が報告する', () => {
    const found = entry(tablesWithAppendOnlyLedger());
    expect(found.result.ok).toBe(true);
    if (!found.result.ok) return;
    const cleanup = found.result.cases.cleanup;
    // 削除で起こすトリガがある表は消せない —— 黙って飛ばすのではなく、相手を報告する。
    expect(cleanup.appendOnly).toEqual(['outbox']);
    expect(cleanup.tables).toEqual(['audits', 'items', 'containers']);
  });

  it('畳みの 1 段目(CASE_LIMIT)はガード変数だけを成立 / 不成立の 2 側に畳む', () => {
    const guard = axisOf('g', 3);
    const result = foldSaveGrid({
      actors: 4,
      callers: ['from_session', 'from_runtime', 'empty'],
      stateAxes: [axisOf('s', 7)],
      valueAxes: [guard],
      repeats: [1],
      inputs: ['full'],
      foldGuards: () => ({
        axes: [{ ...guard, values: [guard.values[0] ?? { label: 'v0', placements: [] }] }],
        folded: [{ key: 'g', satisfying: ['v0'], refuting: [] }],
      }),
    });
    // 4 × 3 × 7 × 3 = 252 > 200 なので 1 段目が走り、その結果 84 に収まって 2 段目は走らない。
    expect(result.folded).toEqual(['guard']);
    expect(result.count).toBe(84);
    expect(result.callers).toHaveLength(3);
    expect(result.stateAxes[0]?.values).toHaveLength(7);
  });

  it('畳みの 2 段目(HARD_LIMIT)は文脈 → 状態 → 件数の順で、畳んだ軸がテスト名に出る', () => {
    const guard = axisOf('g', 5);
    const result = foldSaveGrid({
      actors: 30,
      callers: ['from_session', 'from_runtime', 'empty'],
      stateAxes: [axisOf('s', 7)],
      valueAxes: [guard],
      repeats: [0, 1, 2],
      inputs: ['full', 'minimal'],
      foldGuards: (axes) => ({
        axes: axes.map((axis) => ({ ...axis, values: axis.values.slice(0, 2) })),
        folded: [{ key: 'g', satisfying: ['v0'], refuting: ['v4'] }],
      }),
    });
    expect(result.folded).toEqual(['guard', 'array', 'state', 'input']);
    // 30 × 2 × 2 × 2 × 2 × 2 = 960(実行者の数と軸の本数は畳まない)。
    expect(result.count).toBe(960);
    expect(result.callers).toEqual(['from_session', 'empty']);
    expect(result.repeats).toEqual([0, 2]);
    // 畳んだことは主張の側に出る —— 代表値で実行したことを読む人が数えられる。
    expect(
      EQ_TEST_WORDS.saveDecisionTitle({
        op: 'demo.register',
        count: result.count,
        folded: result.folded,
        guards: result.foldedGuards.map((entry) => EQ_TEST_WORDS.foldedGuard(entry)),
        unenforced: [],
        allUnenforced: false,
      }),
    ).toContain('(畳んだ軸 guard array state input: g 成立 v0 不成立 v4)');
  });

  it('生成物の置き場と注釈の ID は規約どおりである', () => {
    expect(layoutPath(TEST_LAYOUT, 'app', 'eq-save-test', 'demo')).toBe(
      'app/src/composition/__tests__/generated/equivalence/demo.uc.eq.test.ts',
    );
    // 区切りは 3 つに固定されている(テストケース ID の文法)。
    expect(eqSaveTestCaseIdOf('demo', 1)).toBe('TC-EQ-UC_DEMO-0001');
    expect(eqSaveTestCaseIdOf('demo', 12).split('-')).toHaveLength(4);
  });
});
