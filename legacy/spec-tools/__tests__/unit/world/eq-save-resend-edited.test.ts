/**
 * 保存点の作成の**入力を 1 欄変えた押し直し**の性質(点検 21 回目 A21-1 / B21-1)の生成と選び方のテスト。
 *
 * ここで固定するのは 4 つである。
 *   1. 再送で既存の行を返す保存点(複合の作成)の生成テストには 4 本目「同じ鍵で入力を 1 欄変えた押し直しは断られる」が生え、
 *      そうでない保存点には生えない(import も要るときだけ)
 *   2. 再送の見立ては**錨(最初の作成)**の表の宣言で決まる(錨が最初の手順でなくても冪等。委任しない枝の保存点も対象にする)
 *   3. 変える欄の選び方(実行時パッケージ `testing/save/resend.mts` の `editedResendInput`): 子の手順が先・錨は最後、
 *      設計図が用意した宣言の範囲の中の別の値(`edits`)だけを使う、繰り返す手順は先頭の要素、変えられる欄が無ければ null
 *   4. 表明のアダプタ(生成物)が実行時パッケージの表明を渡す
 *   5. 別の値の決め方(生成器 `editedValueOf`): enum は別の要素・数は範囲の中・文字列は長さと書式の中・真偽と日時と参照は変えない
 *   6. 1 回目に試す入力(`firstInputs`): 設計図のままが先頭、その後に欄を 1 つだけ別の値にした入力・参照の欄を 1 つだけ同じ集約の別の行へ向けた入力
 *   (samples:db の赤 —— rooms の enum の範囲外・expenses の「自分を承認者にしない」の CHECK —— の再発防止)
 */

import { describe, expect, it } from 'vitest';
import { eqSaveTestSuites } from '../../../lib/generate/render/code-eq-save-tests.js';
import { eqSaveExpectAdapter } from '../../../lib/generate/render/harness-adapter-save.js';
import { EQ_TEST_WORDS } from '../../../lib/messages/messages-eq.js';
import { resendOutcomeOf, type EqSaveShapeInput } from '../../../lib/world/eq-save-shape.js';
import { createGuardServices } from '../../../lib/guard/services.js';
import { editedResendInput, firstInputs } from '../../../../../framework/runtime/testing/save/resend.mjs';
import { editedValueOf } from '../../../lib/world/eq-save-edits.js';
import { field } from '../../helpers/model-builder.js';
import type { EqSaveStep } from '../../../../../framework/runtime/testing/save/types.mjs';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../helpers/usecase-rpc-fixture.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import { GEN_CTX } from '../../helpers/generate-context.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';

/** 錨の表が再送で既存の行を返さない宣言。 */
const NONE: DataTableSpec['resend'] = { returnsExisting: false, location: { file: 'containers.md', pointer: 'resend' } };

/** container.create → item.create → item.submit の保存点の生成テストの宣言。 */
function suite(containerResend?: DataTableSpec['resend']) {
  const tables = containerResend === undefined ? rpcDataTables() : rpcDataTables(false, containerResend);
  const usecase = usecaseSpec({
    name: 'demo',
    saves: [
      usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')], {
        migration: '20260909000050_usecase_demo_register.sql',
        name: 'demo',
      }),
    ],
  });
  return eqSaveTestSuites(rpcDomain(), {
    ...GEN_CTX,
    guards: createGuardServices(),
    actions: rpcActions(),
    dataTables: dataTableModel([...tables.tables, dataTable('owners', { entity: 'owner', functions: [] })]),
    usecases: { available: true, usecases: [usecase] },
  });
}

/** 手順 1 つ(入力の宣言だけを持つ)。 */
function step(
  alias: string,
  values: Readonly<Record<string, string | number | boolean | null>>,
  options: { readonly repeat?: boolean; readonly refs?: Readonly<Record<string, string>>; readonly edits?: Readonly<Record<string, string | number | boolean>> } = {},
): EqSaveStep {
  const input = { values, refs: options.refs ?? {}, edits: options.edits ?? {} };
  return {
    op: alias,
    alias,
    label: alias,
    kind: 'create',
    aggregate: alias,
    table: alias,
    repeat: options.repeat === true,
    enforcement: 'named',
    input: options.repeat === true ? { values: {}, refs: {}, edits: {} } : input,
    elements: options.repeat === true ? [input] : [],
    optional: [],
    alsoWrites: [],
  };
}

describe('生成テストの 4 本目(入力を 1 欄変えた押し直し)', () => {
  it('再送で既存の行を返す保存点には 4 本目が生え、import にも表明が入る', () => {
    const [found] = suite();
    const cases = found?.sections[0]?.cases ?? [];
    expect(cases.map((entry) => entry.index)).toEqual([1, 2, 3, 4, 5]);
    expect(cases[3]?.title).toBe(EQ_TEST_WORDS.saveResendEditedTitle('demo.register'));
    expect(cases[3]?.body).toBe('await expectSaveResendEdited(WORLD, built);');
    expect(cases[3]?.sync).toBe(false);
    // 5 本目: 1 回目がコミットする前に届いた同じ鍵の押し直しの交錯(点検 22 回目 A22-1)。
    expect(cases[4]?.title).toBe(EQ_TEST_WORDS.saveResendRaceTitle('demo.register'));
    expect(cases[4]?.body).toBe('await expectSaveResendRace(WORLD, built);');
    expect(cases[4]?.sync).toBe(false);
  });

  it('再送で既存の行を返さない保存点(同じ鍵はいつも競合)には生えない', () => {
    const [found] = suite(NONE);
    const cases = found?.sections[0]?.cases ?? [];
    expect(cases.map((entry) => entry.body).join('\n')).not.toContain('expectSaveResendEdited');
    expect(cases.map((entry) => entry.body).join('\n')).not.toContain('expectSaveResendRace');
    expect(cases).toHaveLength(3);
  });

  it('表明のアダプタは実行時パッケージの表明を口と宣言つきで渡す', () => {
    const body = eqSaveExpectAdapter({ generated: (name: string) => `@/domain/generated/${name}` } as Parameters<typeof eqSaveExpectAdapter>[0]).join('\n');
    expect(body).toContain("import { expectSaveResendEdited as expectSaveResendEditedWith } from '@kaninabe/runtime/testing/save/resend';");
    expect(body).toContain('return expectSaveResendEditedWith(world, built, HARNESS);');
    expect(body).toContain("import { expectSaveResendRace as expectSaveResendRaceWith } from '@kaninabe/runtime/testing/save/resend-race';");
    expect(body).toContain('return expectSaveResendRaceWith(world, built, HARNESS);');
  });
});

describe('再送の見立ては錨(最初の作成)の表の宣言で決まる', () => {
  /** 手順の形だけを持つ組み立て済みの保存点(見立てが読むのは手順の種類と再送の宣言だけ)。 */
  function shape(steps: readonly { readonly kind: string; readonly resend?: { readonly returnsExisting: boolean } }[]): EqSaveShapeInput {
    return { domain: rpcDomain(), built: { plan: { steps }, facts: { steps: [] } } } as unknown as EqSaveShapeInput;
  }

  it('錨が最初の手順でなくても、錨の表が既存の行を返すなら冪等(再送の枝は手順を実行する前に錨の行を見る)', () => {
    expect(resendOutcomeOf(shape([{ kind: 'transition' }, { kind: 'create', resend: { returnsExisting: true } }]))).toBe('idempotent');
    expect(resendOutcomeOf(shape([{ kind: 'transition' }, { kind: 'create', resend: { returnsExisting: false } }]))).toBe('conflict');
  });

  it('錨の表に宣言が無ければ言わない・作成の無い保存点は従来どおり(遷移の見立て)', () => {
    expect(resendOutcomeOf(shape([{ kind: 'create' }]))).toBe('unknown');
    expect(resendOutcomeOf(shape([{ kind: 'transition' }]))).toBe('unknown');
    expect(resendOutcomeOf(shape([]))).toBe('unknown');
  });
});

describe('変える欄の選び方(editedResendInput)', () => {
  const anchor = step('a.create', { title: 't', count: 3 }, { refs: { parent_id: 'parent' }, edits: { count: 4 } });

  it('子の手順を先に探し、設計図が用意した別の値(edits)の最初の 1 欄だけを変える(錨と他の欄はそのまま)', () => {
    const world = { steps: [anchor, step('self', { name: 'n', flag: false, purpose: 'meeting' }, { edits: { purpose: 'interview', name: 'name-5001' } })] };
    const input = { 'a.create': { title: 't', count: 3, parent_id: 'P' }, self: { name: 'n', flag: false, purpose: 'meeting' } };
    expect(editedResendInput(world, input)).toEqual({
      input: { 'a.create': { title: 't', count: 3, parent_id: 'P' }, self: { name: 'n', flag: false, purpose: 'interview' } },
      at: 'self.purpose',
    });
  });

  it('範囲の外へは変えない —— edits に無い欄(真偽・宣言の外の欄)は値の型に関わらず変えない', () => {
    const world = { steps: [step('a.create', { flag: false, size: 2, name: 'n' })] };
    expect(editedResendInput(world, { 'a.create': { flag: false, size: 2, name: 'n' } })).toBeNull();
  });

  it('繰り返す手順は先頭の要素だけを変え、残りの要素は保つ', () => {
    const world = { steps: [anchor, step('items', { title: 'x' }, { repeat: true, edits: { title: 'title-5002' } })] };
    const input = { 'a.create': {}, items: [{ title: 'x' }, { title: 'y' }] };
    expect(editedResendInput(world, input)).toEqual({ input: { 'a.create': {}, items: [{ title: 'title-5002' }, { title: 'y' }] }, at: 'items.title' });
  });

  it('入力に載っていない欄(minimal で落とした任意欄)・空の欄・同じ値は飛ばし、子に無ければ錨の欄を変える', () => {
    const world = { steps: [anchor, step('child', { gone: null, same: 's' }, { refs: { parent_id: 'parent' }, edits: { gone: 'g', same: 's', dropped: 'd' } })] };
    const input = { 'a.create': { title: 't', count: 3, parent_id: 'P' }, child: { gone: null, same: 's', parent_id: 'P' } };
    expect(editedResendInput(world, input)?.at).toBe('a.create.count');
  });

  it('繰り返す手順の要素が 0 件・入力が無い手順は飛ばし、どこにも変えられる欄が無ければ null', () => {
    const world = { steps: [step('a.create', {}), step('items', { title: 'x' }, { repeat: true, edits: { title: 'y' } })] };
    expect(editedResendInput(world, { 'a.create': {}, items: [] })).toBeNull();
    expect(editedResendInput(world, {})).toBeNull();
  });
});

describe('別の値の決め方(editedValueOf)', () => {
  const at = (order: ReadonlyMap<string, number> = new Map()) => {
    let seq = 5_000;
    return { nextEdit: () => (seq += 1), order };
  };
  const enumField = (values: readonly string[]) => field('purpose', { kind: 'enum', values: [...values] });

  it.each([
    ['enum は今と違う最初の要素', enumField(['meeting', 'interview', 'other']), 'meeting', 'interview'],
    ['enum の今の値が先頭でなくても違う要素', enumField(['meeting', 'interview']), 'interview', 'meeting'],
    ['enum の要素が 1 つなら変えない', enumField(['only']), 'only', null],
    ['数は +1', field('size', { kind: 'integer' }), 2, 3],
    ['数が上限なら 1 つ下へ', { ...field('size', { kind: 'integer' }), min: 1, max: 3 }, 3, 2],
    ['範囲が 1 点の数は変えない', { ...field('size', { kind: 'integer' }), min: 3, max: 3 }, 3, null],
    ['文字列は押し直し用の連番', field('title', { kind: 'string' }), 'title-1001', 'title-5001'],
    ['文字列は長さの上限の中', { ...field('title', { kind: 'string' }), maxLength: 4 }, 'x', '5001'],
    ['書式に合わない文字列は変えない', { ...field('code', { kind: 'string' }), pattern: '^[A-Z]+$' }, 'AB', null],
    ['真偽は変えない(含意の宣言に当たりうる)', field('flag', { kind: 'boolean' }), false, null],
    ['日時は変えない(順序の宣言に当たりうる)', field('at', { kind: 'datetime' }), '2030-01-01T00:00:00.000Z', null],
    ['参照は変えない', field('parent_id', { kind: 'ref', entity: 'parent' }), 'P', null],
  ] as const)('%s', (_, def, current, wanted) => {
    expect(editedValueOf(def, current, at())).toBe(wanted);
  });

  it('順序の宣言に出る数の欄は変えない(行内比較の CHECK に当たりうる)', () => {
    expect(editedValueOf(field('low', { kind: 'integer' }), 1, at(new Map([['low', 0]])))).toBeNull();
  });
});

describe('1 回目に試す入力(firstInputs)', () => {
  const anchor = step('claim', { title: 't' }, { refs: { id: 'claim', approver_id: 'employee' } });
  const lines = step('lines', { amount: 1 }, { repeat: true, refs: { claim_id: 'claim', shelf_id: 'shelf' } });
  const rows = [
    { key: 'a:employee', entity: 'employee' },
    { key: 'b:employee', entity: 'employee' },
    { key: 'a:shelf', entity: 'shelf' },
    { key: 'b:shelf', entity: 'shelf' },
  ].map((row) => ({ ...row, table: `${row.entity}s`, values: {}, refs: {}, actor: null, ancestry: {} }));
  const built = { rows: new Map(rows.map((row) => [row.key, { id: `id-${row.key}`, table: row.table }])) } as unknown as Parameters<typeof firstInputs>[1];
  const input = {
    claim: { id: 'C', approver_id: 'id-a:employee' },
    lines: [
      { claim_id: 'C', shelf_id: 'id-a:shelf' },
      { claim_id: 'C', shelf_id: 'id-a:shelf' },
    ],
  };

  it('先頭は設計図のまま。その後に子 → 錨の順で、参照を同じ集約の別の行へ 1 つだけ向けた入力(id の欄と、今と同じ行は使わない)', () => {
    const found = firstInputs({ steps: [anchor, lines], rows }, built, input);
    expect(found.map((entry) => entry.at)).toEqual(['', 'lines.shelf_id=b:shelf', 'claim.approver_id=b:employee']);
    expect(found[0]?.input).toBe(input);
    expect(found[2]?.input).toEqual({ ...input, claim: { id: 'C', approver_id: 'id-b:employee' } });
  });

  it('繰り返す手順は全要素を同じ行へ向ける(要素ごとに違う行を指すと、要素どうしの一致を言う CHECK に当たる)', () => {
    const found = firstInputs({ steps: [anchor, lines], rows }, built, input);
    expect(found[1]?.input['lines']).toEqual([
      { claim_id: 'C', shelf_id: 'id-b:shelf' },
      { claim_id: 'C', shelf_id: 'id-b:shelf' },
    ]);
  });

  it('欄の別の値(edits)を 1 欄だけ当てた入力が参照の置き換えより先に並ぶ(繰り返す手順は全要素。形式定義の無い CHECK の向きと符号の組)', () => {
    const moves = step('moves', { kind: 'receipt', quantity: -5 }, { repeat: true, edits: { kind: 'issue', quantity: -4 } });
    const found = firstInputs({ steps: [step('receipt', {}), moves], rows: [] }, built, {
      receipt: {},
      moves: [
        { kind: 'receipt', quantity: -5 },
        { kind: 'receipt', quantity: -6 },
      ],
    });
    expect(found.map((entry) => entry.at)).toEqual(['', 'moves.kind=issue', 'moves.quantity=-4']);
    expect(found[1]?.input['moves']).toEqual([
      { kind: 'issue', quantity: -5 },
      { kind: 'issue', quantity: -6 },
    ]);
  });

  it('参照の欄が無ければ設計図のままの 1 つだけ', () => {
    expect(firstInputs({ steps: [step('only', { a: 1 })], rows }, built, { only: { a: 1 } })).toHaveLength(1);
  });
});
