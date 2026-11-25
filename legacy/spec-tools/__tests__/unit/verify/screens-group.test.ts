/**
 * 画面検証の配線(screens-group)のテスト。
 *
 * 対象の要求: S17 (e)「`kind: form` の `action` は実行計画で走る操作(`runner: manual` でない)」・
 * S18 (d)「`kind: form` の `reads` の source が操作の入力の ref の欄の参照先と一致する」・
 * S19 (c)「確認が要る操作を載せた部品は確認の重ね表示を持つ」。
 * 検査器の単体(`s17-form-component.test.ts` / `s18-read-component.test.ts` / `s19-operation-component.test.ts`)は
 * `manualOperations` / `operationInputs` / `confirmRequiredOperations` を直接渡すので、**パイプラインが action_spec の `runner` / `input` からそれらを作って検査器に
 * 渡していること**(結線)はそこでは測れない。ここは `runScreens`(`lib/compose/verify-pipeline.ts` が呼ぶ口)を通して固定する。
 */

import { describe, expect, it } from 'vitest';
import { runScreens } from '../../../lib/verify/screens-group.js';
import type { ScreenRunArgs } from '../../../lib/verify/screens-group.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';
import { accessSpec, aggregate, deleteRule, entitySpec, field, specModel, writeRule } from '../../helpers/model-builder-v8plus.js';
import { querySpec } from '../../helpers/query-builder.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../helpers/screen-builder.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { actionSpec } from '../../helpers/trace-builder.js';

/** 編集できる標本 1 つだけのドメイン。 */
function domain() {
  return specModel({
    aggregates: [aggregate({ name: 'sample', access: accessSpec('sample', { writes: [writeRule('staff', ['name'])] }) })],
  });
}

/** 編集の操作を `kind: form` に載せた画面 1 枚と、その操作を含む action_spec から、画面検証の入力を作る。 */
function args(runner: { reason: string } | undefined): ScreenRunArgs {
  const input = screenInput({
    domain: domain(),
    screens: [
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.update'],
        slots: [{ slot: 'body.center', components: [{ name: 'sample_editor', kind: 'form', action: 'sample.update' }] }],
      }),
    ],
  });
  const actions: ActionSpecModel = {
    actions: [actionSpec({ handles: 'sample.update', input: ['sample.id'], ...(runner === undefined ? {} : { runner }) })],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
  return {
    model: input.domain,
    queries: input.queries,
    screens: input.screens,
    app: input.app,
    registry: input.registry,
    tests: input.tests,
    auth: input.auth,
    usecases: input.usecases,
    actions,
    reachabilityGaps: [],
    blockedInputs: [],
  };
}

/** S17 の指摘だけを取り出す。 */
function s17(runArgs: ScreenRunArgs) {
  return runScreens(runArgs, SCREEN_CTX.guards, TEST_ROOTS, TEST_LAYOUT, () => undefined).filter((finding) => finding.verifier === 'S17');
}

describe('runScreens: action_spec の runner が S17 (e) に結線されている', () => {
  it('runner: manual の操作を kind: form に載せると、パイプライン経由でも S17 の error が出る', () => {
    const findings = s17(args({ reason: '定型に乗らない RPC' }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'S17', severity: 'error' });
    expect(findings[0]?.message).toContain('runner: manual');
    expect(findings[0]?.message).toContain('sample.update');
  });

  it('runner を宣言していない同じ操作なら S17 は何も言わない(上の赤が結線の結果であることの対照)', () => {
    expect(s17(args(undefined))).toEqual([]);
  });

  it('action_spec が読めていない(null)環境でも壊れず、manual は 0 件として扱う', () => {
    expect(s17({ ...args(undefined), actions: null })).toEqual([]);
  });
});

/** 会場への ref を持つ催しの編集フォームに、会場の選択肢の読みを載せた画面検証の入力。`inputs` は action_spec の `input`。 */
function optionsArgs(inputs: readonly string[]): ScreenRunArgs {
  const domainWithRef = specModel({
    aggregates: [
      aggregate({
        name: 'workshop',
        entity: entitySpec('workshop', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('venue_id', { kind: 'ref', entity: 'venue' }),
        ]),
        access: accessSpec('workshop', { writes: [writeRule('staff', ['venue_id'])] }),
      }),
      aggregate({
        name: 'venue',
        entity: entitySpec('venue', [field('id', { kind: 'uuid' }, { auto: true }), field('name', { kind: 'string' })]),
      }),
    ],
  });
  const screenModel = screenInput({
    domain: domainWithRef,
    queries: [querySpec({ name: 'venue_options', source: 'venue', for: ['member'], scopeUsed: 'all', projection: ['id', 'name'] })],
    screens: [
      screenSpec({
        name: 'workshop_manage',
        reads: ['query-venue-options'],
        actions: ['workshop.update'],
        slots: [
          {
            slot: 'body.center',
            components: [{ name: 'workshop_form', kind: 'form', action: 'workshop.update', reads: 'query-venue-options' }],
          },
        ],
      }),
    ],
  });
  const actions: ActionSpecModel = {
    actions: [actionSpec({ handles: 'workshop.update', input: inputs })],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
  return {
    model: screenModel.domain,
    queries: screenModel.queries,
    screens: screenModel.screens,
    app: screenModel.app,
    registry: screenModel.registry,
    tests: screenModel.tests,
    auth: screenModel.auth,
    usecases: screenModel.usecases,
    actions,
    reachabilityGaps: [],
    blockedInputs: [],
  };
}

/** S18 の指摘だけを取り出す。 */
function s18(runArgs: ScreenRunArgs) {
  return runScreens(runArgs, SCREEN_CTX.guards, TEST_ROOTS, TEST_LAYOUT, () => undefined).filter((finding) => finding.verifier === 'S18');
}

describe('runScreens: action_spec の input が S18 (d) に結線されている', () => {
  it('操作の入力に会場への ref の欄があれば、選択肢の読みは通る', () => {
    expect(s18(optionsArgs(['workshop.id', 'workshop.venue_id']))).toEqual([]);
  });

  it('操作の入力に ref の欄が無いと、パイプライン経由でも S18 の error が出る(上の緑が結線の結果であることの対照)', () => {
    const findings = s18(optionsArgs(['workshop.id']));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'S18', severity: 'error' });
    expect(findings[0]?.message).toContain('どの ref の欄の選択肢にもなりません');
  });

  it('action_spec が読めていない(null)環境でも壊れず、(d) は何も言わない', () => {
    expect(s18({ ...optionsArgs(['workshop.id']), actions: null })).toEqual([]);
  });
});

/** 削除できる標本を表の行のボタンに載せた画面(確認の重ね表示は無い)。`ux` は削除の方針の導出の上書き。 */
function confirmArgs(ux: { confirm: 'none' | 'required'; reason: string } | undefined): ScreenRunArgs {
  const input = screenInput({
    domain: specModel({
      aggregates: [
        aggregate({
          name: 'sample',
          entity: entitySpec('sample', [field('id', { kind: 'uuid' }, { auto: true }), field('name', { kind: 'string' })]),
          access: accessSpec('sample', { deletes: [deleteRule('staff')] }),
        }),
      ],
    }),
    queries: [querySpec({ name: 'sample_list', source: 'sample', for: ['staff'], scopeUsed: 'all', projection: ['id', 'name'] })],
    screens: [
      screenSpec({
        name: 'sample_admin',
        reads: ['query-sample-list'],
        actions: ['sample.delete'],
        requires: ['empty'],
        slots: [
          {
            slot: 'body.center',
            components: [{ name: 'sample_table', kind: 'table', reads: 'query-sample-list', buttons: ['sample.delete'] }],
          },
        ],
      }),
    ],
  });
  const actions: ActionSpecModel = {
    actions: [actionSpec({ handles: 'sample.delete', input: ['sample.id'], ...(ux === undefined ? {} : { ux }) })],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
  return {
    model: input.domain,
    queries: input.queries,
    screens: input.screens,
    app: input.app,
    registry: input.registry,
    tests: input.tests,
    auth: input.auth,
    usecases: input.usecases,
    actions,
    reachabilityGaps: [],
    blockedInputs: [],
  };
}

/** S19 の指摘だけを取り出す。 */
function s19(runArgs: ScreenRunArgs) {
  return runScreens(runArgs, SCREEN_CTX.guards, TEST_ROOTS, TEST_LAYOUT, () => undefined).filter((finding) => finding.verifier === 'S19');
}

describe('runScreens: 操作の方針の導出(confirm_required)が S19 (c) に結線されている', () => {
  it('削除は確認が要る操作なので、重ね表示の無い行のボタンはパイプライン経由でも S19 の error が出る', () => {
    const findings = s19(confirmArgs(undefined));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'S19', severity: 'error' });
    expect(findings[0]?.message).toContain('確認が要る操作');
  });

  it('action_spec の ux で確認なしに上書きした操作は、導出の結果に従って確認の器を求めない', () => {
    expect(s19(confirmArgs({ confirm: 'none', reason: '何度でも作り直せるため' }))).toEqual([]);
  });

  it('action_spec が読めていない(null)環境でも壊れず、(c) は何も言わない', () => {
    expect(s19({ ...confirmArgs(undefined), actions: null })).toEqual([]);
  });
});
