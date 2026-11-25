/**
 * Y8(引数の供給元)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md §引数名 → 供給元「保存点の全手順の全引数が規約の値域で
 * 解決できる」「`defaults.self` が指す欄が一意に決まり、その手順の RPC に届く」
 * 「呼ぶ RPC が data_table に実在する」。
 */

import { describe, expect, it } from 'vitest';
import { paramSourceVerifier } from '../../../../lib/usecase/verifiers/y8-param-source.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../../helpers/usecase-rpc-fixture.js';
import { stubGuards } from '../../../helpers/model-builder.js';
import type { UsecaseContext } from '../../../../lib/usecase/verifier.js';
import type { UsecaseInput } from '../../../../lib/usecase/derive.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import type { UsecaseSpec } from '../../../../lib/model/usecase/types.js';
import { testGates, testScreens } from '../_fixtures.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** 複合 RPC の世界を持つ UsecaseInput / UsecaseContext。 */
function inputFor(usecase: UsecaseSpec): { input: UsecaseInput; ctx: UsecaseContext } {
  return {
    input: {
      domain: rpcDomain(),
      usecases: { available: true, usecases: [usecase] },
      actions: rpcActions(),
      screens: testScreens(),
      gates: testGates(),
      catalogs: {},
    },
    ctx: { guards: stubGuards(), dataTables: loadedInput(rpcDataTables()), actions: UNSELECTED, reachabilityGaps: [] },
  };
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

describe('Y8 引数の供給元', () => {
  it('規約で全部解決できる保存点は通る', () => {
    const { input, ctx } = inputFor(registerUsecase());

    expect(paramSourceVerifier.verify(input, ctx)).toEqual([]);
  });

  it('規約に載らない引数名があると、関数・引数・手順を反例にして違反になる', () => {
    const { input } = inputFor(registerUsecase());
    // insert_item の引数名を entity_spec のどのフィールドでもない名前に差し替える。
    const broken: DataTableSpecModel = dataTableModel([
      dataTable('items', {
        entity: 'item',
        functions: [
          {
            name: 'insert_item',
            args: ['uuid', 'uuid', 'jsonb', 'uuid'],
            params: ['p_id', 'p_mystery', 'p_values', 'p_actor_id'],
            kind: 'rpc',
            shape: 'create',
            alsoWrites: [],
          },
          {
            name: 'apply_item_transition',
            args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid'],
            params: ['p_item_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id'],
            kind: 'rpc',
            shape: 'transition',
            alsoWrites: [],
          },
        ],
      }),
      ...rpcDataTables().tables.filter((table) => table.table !== 'items'),
    ]);

    const findings = paramSourceVerifier.verify(input, { guards: stubGuards(), dataTables: loadedInput(broken), actions: UNSELECTED, reachabilityGaps: [] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y8');
    expect(findings[0]?.counterexample).toMatchObject({
      function: 'insert_item',
      param: 'p_mystery',
      step: 'item.create',
    });
  });

  it('手順が呼ぶ RPC が data_table に無ければ違反になる', () => {
    const { input } = inputFor(registerUsecase());
    const onlyContainers = dataTableModel(rpcDataTables().tables.filter((table) => table.table === 'containers'));

    const findings = paramSourceVerifier.verify(input, { guards: stubGuards(), dataTables: loadedInput(onlyContainers), actions: UNSELECTED, reachabilityGaps: [] });

    expect(findings.some((finding) => finding.message.includes('insert_item'))).toBe(true);
  });

  it('defaults.self を書いた手順の集約に実行者を指す欄が無ければ違反になる', () => {
    // item は ref(owner) の欄を持たないので、「自分として」が何を埋めるか決まらない。
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [
        usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create', { defaultsSelf: true })], {
          migration: '20260909000050_usecase_demo_register.sql',
          name: 'demo',
        }),
      ],
    });
    const { input, ctx } = inputFor(usecase);

    const findings = paramSourceVerifier.verify(input, ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('実行者を指す欄が 0 件');
  });

  it('defaults.self の欄を受け取る引数が RPC に無ければ、手順・欄名・RPC 名を反例にして違反になる', () => {
    // insert_container から p_owner_id を落とす(p_values の中身も入力欄だけなので owner_id は届かない)。
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [
        usecaseSave('register', [usecaseStep('container.create', { defaultsSelf: true })], {
          migration: '20260909000050_usecase_demo_register.sql',
          name: 'demo',
        }),
      ],
    });
    const { input } = inputFor(usecase);
    const unreachable: DataTableSpecModel = dataTableModel([
      dataTable('containers', {
        entity: 'container',
        functions: [
          {
            name: 'insert_container',
            args: ['uuid', 'jsonb', 'uuid'],
            params: ['p_id', 'p_values', 'p_actor_id'],
            kind: 'rpc',
            shape: 'create',
            alsoWrites: [],
          },
        ],
      }),
      ...rpcDataTables().tables.filter((table) => table.table !== 'containers'),
    ]);

    const findings = paramSourceVerifier.verify(input, { guards: stubGuards(), dataTables: loadedInput(unreachable), actions: UNSELECTED, reachabilityGaps: [] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y8');
    expect(findings[0]?.counterexample).toMatchObject({
      step: 'container.create',
      field: 'owner_id',
      function: 'insert_container',
    });
  });

  it('defaults.self の欄が引数として届いていれば通る', () => {
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [
        usecaseSave('register', [usecaseStep('container.create', { defaultsSelf: true })], {
          migration: '20260909000050_usecase_demo_register.sql',
          name: 'demo',
        }),
      ],
    });
    const { input, ctx } = inputFor(usecase);

    expect(paramSourceVerifier.verify(input, ctx)).toEqual([]);
  });

  it('data_table が使えない(未選択・阻害)環境では何も見ない(見ていないことは実行ログが言う)', () => {
    const { input } = inputFor(registerUsecase());

    expect(paramSourceVerifier.verify(input, { guards: stubGuards(), dataTables: UNSELECTED, actions: UNSELECTED, reachabilityGaps: [] })).toEqual([]);
    expect(paramSourceVerifier.verify(input, { guards: stubGuards(), dataTables: blockedInput(), actions: UNSELECTED, reachabilityGaps: [] })).toEqual([]);
  });

  it('action_spec が阻害なら判定を出さない(引数の供給元に入力欄を引く)。未選択は「action_spec は無い」事実で従来どおり判定する', () => {
    const { input } = inputFor(registerUsecase());
    const onlyContainers = dataTableModel(rpcDataTables().tables.filter((table) => table.table === 'containers'));
    const ctx = { guards: stubGuards(), dataTables: loadedInput(onlyContainers), reachabilityGaps: [] };

    expect(paramSourceVerifier.verify(input, { ...ctx, actions: UNSELECTED }).length).toBeGreaterThan(0);
    expect(paramSourceVerifier.verify(input, { ...ctx, actions: blockedInput('missing') })).toEqual([]);
  });
});

