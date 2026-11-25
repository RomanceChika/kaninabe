/**
 * S19(操作を載せる部品の宣言)の規約網羅テスト。
 *
 * 対象の要求: screen-spec-writing.md「`kind: table` の `edit` / `actions`・`kind: actions`」(ADR-0015 の改訂 2)。
 *   (a) 操作が画面の `actions` に居る (b) `edit` は reads の source の編集で、確認も `runner: manual` も要らない
 *   (c) 確認が要る操作は、その部品を opened_by に持つ重ね表示の確認の器(body.center の confirm_bar)を持つ
 *   (d) `kind: actions` の reads は画面の reads の要素で returns: one (e) `actions` は source の遷移か削除
 */

import { describe, expect, it } from 'vitest';
import { operationComponentVerifier } from '../../../../lib/screen/verifiers/s19-operation-component.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
  entitySpec,
  event,
  field,
  machine,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { SCREEN_CTX, chromeSpec, screenInput, screenSpec } from '../../../helpers/screen-builder.js';
import type { ComponentInit, OverlayInit } from '../../../helpers/screen-builder.js';

/** 標本(状態機械・作成・編集・削除を持つ)と、別のエンティティ(別の状態機械・編集・削除)を持つドメイン。 */
function domain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'sample',
        entity: entitySpec('sample', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('name', { kind: 'string' }, { required: true }),
          field('state', { kind: 'state', machine: 'sample' }),
        ]),
        stateMachines: [
          machine({
            machine: 'sample',
            states: ['draft', 'open'],
            events: [
              event({ id: 'open', from: ['draft'], to: 'open', by: ['staff'] }),
              event({ id: 'close', from: ['open'], to: 'draft', by: ['staff'] }),
            ],
          }),
        ],
        access: accessSpec('sample', {
          creates: [createRule('staff')],
          writes: [writeRule('staff', ['name'])],
          deletes: [deleteRule('staff')],
        }),
      }),
      aggregate({
        name: 'other',
        entity: entitySpec('other', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('label', { kind: 'string' }, { required: true }),
          field('state', { kind: 'state', machine: 'other' }),
        ]),
        stateMachines: [
          machine({
            machine: 'other',
            states: ['a', 'b'],
            events: [event({ id: 'ping', from: ['a'], to: 'b', by: ['staff'] })],
          }),
        ],
        access: accessSpec('other', { writes: [writeRule('staff', ['label'])], deletes: [deleteRule('staff')] }),
      }),
    ],
  });
}

/** 読み(標本の一覧・標本の詳細・別のエンティティの一覧)。 */
const QUERIES = [
  querySpec({ name: 'sample_list', source: 'sample', for: ['staff'], scopeUsed: 'all', projection: ['id', 'name', 'state'] }),
  querySpec({
    name: 'sample_detail',
    source: 'sample',
    for: ['staff'],
    scopeUsed: 'all',
    returns: 'one',
    params: [{ name: 'sample_id', ref: 'sample.id' }],
    projection: ['id', 'name', 'state'],
  }),
  querySpec({ name: 'other_list', source: 'other', for: ['staff'], scopeUsed: 'all', projection: ['id', 'label', 'state'] }),
];

/** 確認が要る操作の集合を渡して検査器を回す。 */
function run(
  screens: readonly ReturnType<typeof screenSpec>[],
  confirm: readonly string[] = [],
  chromes: readonly ReturnType<typeof chromeSpec>[] = [],
) {
  return operationComponentVerifier.verify(screenInput({ domain: domain(), queries: QUERIES, screens, chromes }), {
    ...SCREEN_CTX,
    confirmRequiredOperations: new Set(confirm),
  });
}

/** 表(`kind: table`)を 1 つ置いた画面。 */
function tableScreen(
  rest: Omit<Extract<ComponentInit, { name: string }>, 'name' | 'kind'>,
  extra: { actions?: readonly string[]; overlays?: readonly OverlayInit[]; read?: string } = {},
) {
  return screenSpec({
    name: 'sample_admin',
    reads: ['query-sample-list', 'query-sample-detail', 'query-other-list'],
    actions: extra.actions ?? ['sample.update', 'sample.open', 'sample.close'],
    overlays: extra.overlays ?? [],
    slots: [
      { slot: 'body.center', components: [{ name: 'sample_table', kind: 'table', reads: extra.read ?? 'query-sample-list', ...rest }] },
    ],
  });
}

/** `kind: actions` を 1 つ置いた画面。 */
function barScreen(read: string, buttons: readonly string[] = ['sample.open']) {
  return screenSpec({
    name: 'sample_detail',
    reads: ['query-sample-list', 'query-sample-detail'],
    actions: ['sample.open'],
    slots: [{ slot: 'body.center', components: [{ name: 'sample_bar', kind: 'actions', reads: read, buttons }] }],
  });
}

/** 確認の重ね表示(`confirm_bar` を `body.center` に置く)。 */
const CONFIRM_OVERLAY: OverlayInit = {
  id: 'delete_confirm',
  openedBy: 'sample_table',
  actions: ['sample.delete'],
  slots: [{ slot: 'body.center', components: ['confirm_bar'] }],
};

describe('S19 操作を載せる部品の宣言', () => {
  it('編集・遷移・確認つきの削除を載せた表が正しく書かれていれば通る', () => {
    const findings = run(
      [
        tableScreen(
          { edit: 'sample.update', buttons: ['sample.open', 'sample.delete'] },
          { actions: ['sample.update', 'sample.open'], overlays: [CONFIRM_OVERLAY] },
        ),
      ],
      ['sample.delete'],
    );

    expect(findings).toEqual([]);
  });

  it('操作を載せない部品(手書き・読むだけの表)は何も見ない', () => {
    const findings = run([
      screenSpec({ name: 'sample_admin', slots: [{ slot: 'body.center', components: ['sample_table'] }] }),
      tableScreen({}),
    ]);

    expect(findings).toEqual([]);
  });

  it('(a) 画面の actions に無い操作は edit でも actions でもエラー(宣言した操作の一覧を示す)', () => {
    const findings = run([
      tableScreen({ edit: 'sample.update', buttons: ['sample.close'] }, { actions: ['sample.open'] }),
    ]);

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('edit の sample.update が、この画面の actions にありません'),
      expect.stringContaining('actions の sample.close が、この画面の actions にありません'),
    ]);
    expect(findings[0]).toMatchObject({ verifier: 'S19', severity: 'error' });
    expect(findings[0]?.suggestion).toContain('sample.open');
  });

  it('(a) 重ね表示の actions に居る操作は画面の母集合に入る', () => {
    const findings = run([
      tableScreen({ buttons: ['sample.delete'] }, { actions: [], overlays: [CONFIRM_OVERLAY] }),
    ]);

    expect(findings).toEqual([]);
  });

  it('(b) edit は編集でなければならない(遷移・削除・作成はエラー)', () => {
    for (const edit of ['sample.open', 'sample.delete', 'sample.create']) {
      const findings = run([tableScreen({ edit }, { actions: [edit] })]);

      expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('は編集(update)ではありません')]);
    }
  });

  it('(b) edit が reads の source と別のエンティティの編集ならエラー', () => {
    const findings = run([tableScreen({ edit: 'other.update' }, { actions: ['other.update'] })]);

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('edit other.update は other の編集ですが、reads の source は sample です'),
    ]);
  });

  it('(b) 確認が要る編集は載せられない(行の保存に確認の器が無い)', () => {
    const findings = run([tableScreen({ edit: 'sample.update' }, { actions: ['sample.update'] })], ['sample.update']);

    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('行の保存に確認の器はありません')]);
  });

  it('(b) runner: manual の編集は載せられない(行の入力欄の集合を計画から導けず、宣言したのに何も起きなくなる)', () => {
    const findings = operationComponentVerifier.verify(
      screenInput({ domain: domain(), queries: QUERIES, screens: [tableScreen({ edit: 'sample.update' }, { actions: ['sample.update'] })] }),
      { ...SCREEN_CTX, manualOperations: new Set(['sample.update']) },
    );

    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('runner: manual の操作で、編集する表を生成できません')]);
  });

  it('(e) actions の作成・編集はエラー(作成はフォーム・編集は edit)', () => {
    const findings = run([
      tableScreen({ buttons: ['sample.create', 'sample.update'] }, { actions: ['sample.create', 'sample.update'] }),
    ]);

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('actions の sample.create は作成で、行のボタンにできません'),
      expect.stringContaining('actions の sample.update は編集で、行のボタンにできません'),
    ]);
  });

  it('(e) 別の状態機械の遷移・別のエンティティの削除は reads の source の操作でなくエラー', () => {
    const findings = run([
      tableScreen({ buttons: ['other.ping', 'other.delete'] }, { actions: ['other.ping', 'other.delete'] }),
    ]);

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('other.ping は、reads の source(sample)の遷移でも削除でもありません'),
      expect.stringContaining('other.delete は、reads の source(sample)の遷移でも削除でもありません'),
    ]);
  });

  it('(c) 確認が要る操作に、その部品を opened_by に持つ重ね表示が無いとエラー', () => {
    const findings = run([tableScreen({ buttons: ['sample.delete'] }, { actions: ['sample.delete'] })], ['sample.delete']);

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('sample.delete は確認が要る操作ですが、確認の重ね表示がありません'),
    ]);
    expect(findings[0]?.suggestion).toContain('opened_by: sample_table');
  });

  it('(c) 別の部品を opened_by にした重ね表示・別の操作を載せた重ね表示は確認の器にならない', () => {
    const otherOpener = run(
      [tableScreen({ buttons: ['sample.delete'] }, { actions: ['sample.delete'], overlays: [{ ...CONFIRM_OVERLAY, openedBy: 'something_else' }] })],
      ['sample.delete'],
    );
    const otherAction = run(
      [tableScreen({ buttons: ['sample.delete'] }, { actions: ['sample.delete'], overlays: [{ ...CONFIRM_OVERLAY, actions: ['sample.open'] }] })],
      ['sample.delete'],
    );

    expect(otherOpener).toHaveLength(1);
    expect(otherAction).toHaveLength(1);
  });

  it('(c) 確認の重ね表示が body.center の confirm_bar を持たなければエラー', () => {
    const findings = run(
      [
        tableScreen(
          { buttons: ['sample.delete'] },
          { overlays: [{ ...CONFIRM_OVERLAY, slots: [{ slot: 'footer', components: ['confirm_bar'] }] }] },
        ),
      ],
      ['sample.delete'],
    );

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('確認の器 body.center の confirm_bar がありません'),
    ]);
  });

  it('(c) 確認が要るフォームの action にも掛かる(重ね表示が無ければエラー・あれば通る)', () => {
    const form = (overlays: readonly OverlayInit[]) =>
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.create'],
        overlays,
        slots: [{ slot: 'body.center', components: [{ name: 'sample_form', kind: 'form', action: 'sample.create' }] }],
      });
    const dialog: OverlayInit = {
      id: 'create_confirm',
      openedBy: 'sample_form',
      actions: ['sample.create'],
      slots: [{ slot: 'body.center', components: ['confirm_bar'] }],
    };

    expect(run([form([])], ['sample.create']).map((finding) => finding.message)).toEqual([
      expect.stringContaining('sample.create は確認が要る操作ですが、確認の重ね表示がありません'),
    ]);
    expect(run([form([dialog])], ['sample.create'])).toEqual([]);
    expect(run([form([])])).toEqual([]);
  });

  it('(f) 行のボタンの操作が id のほかの入力を要るとエラー(id だけなら通る・入力を読めていなければ黙る)', () => {
    const screen = tableScreen({ buttons: ['sample.open'] });
    const runWith = (inputs: ReadonlyMap<string, readonly { entity: string; field: string }[]>) =>
      operationComponentVerifier.verify(screenInput({ domain: domain(), queries: QUERIES, screens: [screen] }), {
        ...SCREEN_CTX,
        operationInputs: inputs,
      });

    expect(runWith(new Map([['sample.open', [{ entity: 'sample', field: 'id' }]]]))).toEqual([]);
    expect(runWith(new Map())).toEqual([]);
    const findings = runWith(new Map([['sample.open', [{ entity: 'sample', field: 'id' }, { entity: 'sample', field: 'name' }]]]));
    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('sample.open は sample.name の入力を要り、行のボタンにできません'),
    ]);
    expect(findings[0]?.suggestion).toContain('kind: form');
  });

  it('(g) 1 つの確認の重ね表示に確認が要る操作を 2 つ以上まとめるとエラー(操作ごとに分ければ通る・同じ操作の重複は数えない)', () => {
    const shared: OverlayInit = { ...CONFIRM_OVERLAY, actions: ['sample.delete', 'sample.close'] };
    const split: readonly OverlayInit[] = [
      CONFIRM_OVERLAY,
      { ...CONFIRM_OVERLAY, id: 'close_confirm', actions: ['sample.close'] },
    ];
    const both = ['sample.delete', 'sample.close'];

    const findings = run([tableScreen({ buttons: ['sample.delete', 'sample.close'] }, { overlays: [shared] })], both);
    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('重ね表示 delete_confirm が、sample_table の確認が要る操作 sample.delete / sample.close を 1 つにまとめています'),
    ]);
    expect(findings[0]?.suggestion).toContain('操作ごとに overlay を分け');
    expect(run([tableScreen({ buttons: ['sample.delete', 'sample.close'] }, { overlays: split })], both)).toEqual([]);
    // 重ね表示が 2 本の操作を持っていても、部品が載せるのが 1 本なら重複しない。
    expect(run([tableScreen({ buttons: ['sample.delete'] }, { overlays: [shared] })], both)).toEqual([]);
    expect(run([tableScreen({ buttons: ['sample.delete', 'sample.delete'] }, { overlays: [CONFIRM_OVERLAY] })], ['sample.delete'])).toEqual([]);
  });

  it('(d) kind: actions の reads が詳細の読み(returns: one)で、画面の reads に居れば通る', () => {
    expect(run([barScreen('query-sample-detail')])).toEqual([]);
  });

  it('(d) kind: actions の reads が returns: many・画面の reads に無いときはエラー', () => {
    const many = run([barScreen('query-sample-list')]);
    const missing = run([
      screenSpec({
        name: 'sample_detail',
        reads: ['query-sample-list'],
        actions: ['sample.open'],
        slots: [{ slot: 'body.center', components: [{ name: 'sample_bar', kind: 'actions', reads: 'query-sample-detail', buttons: ['sample.open'] }] }],
      }),
    ]);

    expect(many.map((finding) => finding.message)).toEqual([expect.stringContaining('returns: many で、kind: actions には使えません')]);
    expect(missing.map((finding) => finding.message)).toEqual([
      expect.stringContaining('reads query-sample-detail が、この画面の reads にありません'),
    ]);
  });

  it('(d) 画面の reads に居るが実在しない読みは S2 の領分で、S19 は読みの形を言わない', () => {
    const findings = run([
      screenSpec({
        name: 'sample_detail',
        reads: ['query-nothing'],
        actions: ['sample.open'],
        slots: [{ slot: 'body.center', components: [{ name: 'sample_bar', kind: 'actions', reads: 'query-nothing', buttons: ['sample.open'] }] }],
      }),
    ]);

    expect(findings).toEqual([]);
  });

  it('ドメインに接地しない操作は S2 の領分で、S19 は黙る', () => {
    const findings = run([tableScreen({ edit: 'nothing.update', buttons: ['nothing.go'] }, { actions: [] })]);

    expect(findings).toEqual([]);
  });

  it('chrome の部品には kind: actions を書けない', () => {
    const findings = run(
      [],
      [],
      [
        chromeSpec({
          name: 'member',
          slots: [{ slot: 'header', components: [{ name: 'app_bar', kind: 'actions', reads: 'query-sample-detail', buttons: ['sample.open'] }] }],
        }),
      ],
    );

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('chrome member の部品 app_bar に kind: actions は書けません'),
    ]);
  });

  it('読み(query_spec)を読めていないときは source の突合を言わない', () => {
    const findings = operationComponentVerifier.verify(
      screenInput({
        domain: domain(),
        queriesUnavailable: true,
        screens: [tableScreen({ edit: 'other.update', buttons: ['other.ping'] }, { actions: ['other.update', 'other.ping'] })],
      }),
      SCREEN_CTX,
    );

    expect(findings).toEqual([]);
  });
});

describe('S19 読み取りクエリ(query_spec)が阻害のとき(入力の状態の保留)', () => {
  it('読めていれば edit の source の食い違いを言い、阻害なら言わない(欠けた読みの source を引かない)', () => {
    const input = screenInput({ domain: domain(), queries: QUERIES, screens: [tableScreen({ edit: 'other.update' }, { actions: ['other.update'] })] });

    expect(operationComponentVerifier.verify(input, SCREEN_CTX)).toHaveLength(1);
    expect(operationComponentVerifier.verify(input, { ...SCREEN_CTX, blockedInputs: ['queries'] })).toEqual([]);
  });
});
