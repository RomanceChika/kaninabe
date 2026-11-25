/**
 * Y12(保存点が複合 RPC に写せる)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md §保存点に置ける手順の形 —— 供給元が plpgsql に写せること、
 * 再送のときに全手順の結果が「最初に作る行からの鎖」で読み直せること。
 *
 * 3 つの形はどれも束 ⑱ の題材が実測したもので、直す前は **verify が緑のまま generate が例外**で
 * 落ちていた。
 */

import { describe, expect, it } from 'vitest';
import { saveRenderableVerifier } from '../../../../lib/usecase/verifiers/y12-save-renderable.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../../helpers/usecase-rpc-fixture.js';
import { stubGuards } from '../../../helpers/model-builder.js';
import type { UsecaseContext } from '../../../../lib/usecase/verifier.js';
import type { UsecaseInput } from '../../../../lib/usecase/derive.js';
import type { ActionSpecModel } from '../../../../lib/model/trace/types.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import type { UsecaseStepDecl } from '../../../../lib/model/usecase/types.js';
import { testGates, testScreens } from '../_fixtures.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** 手順を並べた 1 保存点を、複合 RPC の世界で検査する。 */
function verify(
  steps: readonly UsecaseStepDecl[],
  overrides: { readonly actions?: ActionSpecModel; readonly dataTables?: DataTableSpecModel } = {},
): ReturnType<typeof saveRenderableVerifier.verify> {
  const usecase = usecaseSpec({
    name: 'demo',
    saves: [usecaseSave('register', steps, { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' })],
  });
  const input: UsecaseInput = {
    domain: rpcDomain(),
    usecases: { available: true, usecases: [usecase] },
    actions: overrides.actions ?? rpcActions(),
    screens: testScreens(),
    gates: testGates(),
    catalogs: {},
  };
  const ctx: UsecaseContext = { guards: stubGuards(), dataTables: loadedInput(overrides.dataTables ?? rpcDataTables()), actions: UNSELECTED, reachabilityGaps: [] };
  return saveRenderableVerifier.verify(input, ctx);
}

/** `apply_item_transition` が自集約の列 `p_size` も受け取る世界(計算値の受け皿)。 */
function itemsWithSizeParam(): DataTableSpecModel {
  return dataTableModel([
    ...rpcDataTables().tables.filter((table) => table.table !== 'items'),
    dataTable('items', {
      entity: 'item',
      functions: [
        {
          name: 'insert_item',
          args: ['uuid', 'uuid', 'jsonb', 'uuid'],
          params: ['p_id', 'p_container_id', 'p_values', 'p_actor_id'],
          kind: 'rpc',
          shape: 'create',
          alsoWrites: [],
        },
        {
          name: 'apply_item_transition',
          args: ['uuid', 'text', 'text', 'text[]', 'text', 'integer', 'uuid'],
          params: [
            'p_item_id',
            'p_expected_state',
            'p_next_state',
            'p_effects',
            'p_event_id',
            'p_size',
            'p_actor_id',
          ],
          kind: 'rpc',
          shape: 'transition',
          alsoWrites: [],
        },
      ],
    }),
  ]);
}

describe('Y12 保存点が複合 RPC に写せる', () => {
  it('作成 → 作成 → 遷移の保存点は写せる(通る)', () => {
    const steps = [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')];

    expect(verify(steps)).toEqual([]);
  });

  it('保存点の外にある別集約への遷移は、再送の読み直しが辿れず違反になる', () => {
    // item を保存点の中で作らずに動かすので、その行は「最初に作る行」から鎖で辿れない。
    const findings = verify([usecaseStep('container.create'), usecaseStep('item.submit')]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y12');
    expect(findings[0]?.message).toContain('再送のときに読み直せません');
    expect(findings[0]?.counterexample).toMatchObject({ step: 'item.submit', table: 'items' });
  });

  it('同じ表に行を作る手順が 2 つあって行を 1 つに定められないと違反になる', () => {
    const steps = [
      usecaseStep('container.create'),
      usecaseStep('item.create', { as: 'first' }),
      usecaseStep('item.create', { as: 'more', repeat: true }),
    ];

    const findings = verify(steps);

    expect(findings.map((finding) => finding.counterexample?.['alias'])).toContain('more');
    expect(findings.every((finding) => finding.verifier === 'Y12')).toBe(true);
  });

  it('計算値(computes)を持つ遷移が保存点にあると違反になる', () => {
    const actions: ActionSpecModel = {
      ...rpcActions(),
      actions: [
        actionSpec({ handles: 'container.create', input: ['container.title'], owner: 'container.owner_id' }),
        actionSpec({ handles: 'item.create', input: ['item.container_id', 'item.name'] }),
        actionSpec({ handles: 'item.submit', input: ['item.id'], computes: { 'item.size': 'computeSize' } }),
      ],
    };

    const findings = verify(
      [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')],
      { actions, dataTables: itemsWithSizeParam() },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('複合 RPC に渡せません');
    expect(findings[0]?.counterexample).toMatchObject({ param: 'p_size', field: 'size' });
  });

  it('接地・引数の解決が失敗する保存点では何も言わない(Y8 が反例つきで報告する)', () => {
    const onlyContainers = dataTableModel(rpcDataTables().tables.filter((table) => table.table === 'containers'));

    expect(verify([usecaseStep('container.create'), usecaseStep('item.create')], { dataTables: onlyContainers })).toEqual(
      [],
    );
  });

  it('data_table が使えない(未選択・阻害)環境では何も見ない(見ていないことは実行ログが言う)', () => {
    const input: UsecaseInput = {
      domain: rpcDomain(),
      usecases: { available: true, usecases: [usecaseSpec({ name: 'demo', saves: [usecaseSave('register', [usecaseStep('container.create')], { name: 'demo' })] })] },
      actions: rpcActions(),
      screens: testScreens(),
      gates: testGates(),
      catalogs: {},
    };

    expect(saveRenderableVerifier.verify(input, { guards: stubGuards(), dataTables: UNSELECTED, actions: UNSELECTED, reachabilityGaps: [] })).toEqual([]);
    expect(saveRenderableVerifier.verify(input, { guards: stubGuards(), dataTables: blockedInput(), actions: UNSELECTED, reachabilityGaps: [] })).toEqual([]);
  });

  it('action_spec が阻害なら判定を出さない(実行計画が入力欄を引く)。未選択は従来どおり判定する', () => {
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.submit')], { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' })],
    });
    const input: UsecaseInput = {
      domain: rpcDomain(),
      usecases: { available: true, usecases: [usecase] },
      actions: rpcActions(),
      screens: testScreens(),
      gates: testGates(),
      catalogs: {},
    };
    const ctx = { guards: stubGuards(), dataTables: loadedInput(rpcDataTables()), reachabilityGaps: [] };

    expect(saveRenderableVerifier.verify(input, { ...ctx, actions: UNSELECTED })).toHaveLength(1);
    expect(saveRenderableVerifier.verify(input, { ...ctx, actions: blockedInput('invalid') })).toEqual([]);
  });
});

