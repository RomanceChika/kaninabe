/**
 * 画面の部品の操作を載せる表・ボタン列(`kind: table` の `edit` / `actions`・`kind: actions`)の生成のテスト(束 画面 4a)。
 *
 * 確かめるのは「編集する表の列は編集してよい欄(`writable`)で決まり、各セルが入力欄になる」「行のボタンは遷移(機械の宣言順)→
 * 削除の順で、遷移は行の状態と実行者のロールの交差で出る」「確認が要る操作は重ね表示の器(testid・見出し)を渡す」
 * 「ボタン列は 1 行に対するボタンだけを持つ」「葉の表・期待木・既定のスタイル」である。アプリの語彙は 1 語も使わない(W1)。
 */

import { describe, expect, it } from 'vitest';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { screenFormsGenerator } from '../../../../lib/generate/render/code-screen-forms.js';
import { screenRoutesGenerator } from '../../../../lib/generate/render/code-screens.js';
import { screenTablesGenerator } from '../../../../lib/generate/render/code-screen-tables.js';
import { renderScreenDefaultCss } from '../../../../lib/generate/render/screen-default-css.js';
import { renderScreenActionsBody } from '../../../../lib/generate/render/screen-actions-body.js';
import { buildScreenReads } from '../../../../lib/generate/render/screen-read-plan.js';
import { renderScreenTableBody } from '../../../../lib/generate/render/screen-table-body.js';
import { renderScreenTableOpsBody } from '../../../../lib/generate/render/screen-table-ops-body.js';
import { screenExpectations } from '../../../../lib/generate/render/structure-screen-expectations.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import {
  accessSpec,
  aggregate,
  deleteRule,
  entitySpec,
  event,
  field,
  machine,
  role,
  specModel,
  stubContext,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT, TEST_BODY_MODULES } from '../../../helpers/platform.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import type { ComponentInit, OverlayInit } from '../../../helpers/screen-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 部品(状態機械・編集・削除を持つ)と、別の集約の状態機械を持つ架空のドメイン。 */
const DOMAIN = specModel({
  roles: [role('anonymous'), role('member'), role('system')],
  aggregates: [
    aggregate({
      name: 'widget',
      entity: entitySpec('widget', [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('name', { kind: 'string' }, { required: true, label: '名前' }),
        field('note', { kind: 'text' }, { label: '備考' }),
        field('active', { kind: 'boolean' }, { required: true, label: '有効' }),
        { ...field('size', { kind: 'enum', values: ['s', 'l'] }, { required: true, label: '大きさ' }), labels: { s: '小', l: '大' } },
        field('state', { kind: 'state', machine: 'widget_flow' }, { label: '状態' }),
      ]),
      stateMachines: [
        machine({
          machine: 'widget_flow',
          states: ['draft', 'open', 'done'],
          events: [
            event({ id: 'open', from: ['draft'], to: 'open', by: ['member'] }),
            event({ id: 'finish', from: ['open'], to: 'done', by: ['member'] }),
          ],
        }),
      ],
      access: accessSpec('widget', { writes: [writeRule('member', ['name', 'note', 'active', 'size'])], deletes: [deleteRule('member')] }),
    }),
  ],
});

/** 読み(一覧と詳細)。 */
const QUERIES = [
  querySpec({
    name: 'widget_list',
    source: 'widget',
    for: ['member'],
    scopeUsed: 'all',
    projection: ['id', 'name', 'note', 'active', 'size', 'state'],
  }),
  querySpec({
    name: 'widget_detail',
    source: 'widget',
    for: ['member'],
    scopeUsed: 'all',
    returns: 'one',
    params: [{ name: 'widget_id', ref: 'widget.id' }],
    projection: ['id', 'name', 'state'],
  }),
];

/** 削除の確認の重ね表示(`widget_table` を `opened_by` に持つ)。 */
const DELETE_CONFIRM: OverlayInit = {
  id: 'delete_confirm',
  openedBy: 'widget_table',
  label: '部品を削除する',
  actions: ['widget.delete'],
  slots: [{ slot: 'body.center', components: ['confirm_bar'] }],
};

/** 生成の文脈(`components` を載せた画面 1 枚)。 */
function context(components: readonly ComponentInit[], overlays: readonly OverlayInit[] = [DELETE_CONFIRM]): GenerateContext {
  const { guards } = stubContext();
  return {
    guards,
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    queries: { available: true, queries: QUERIES },
    actions: {
      actions: [
        actionSpec({ handles: 'widget.update', input: ['widget.id', 'widget.name', 'widget.note', 'widget.active', 'widget.size'] }),
        actionSpec({ handles: 'widget.delete', input: ['widget.id'] }),
      ],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
    dataTables: dataTableModel([
      dataTable('widgets', {
        entity: 'widget',
        functions: [
          {
            name: 'update_widget',
            args: ['text', 'text', 'text', 'boolean', 'text'],
            params: ['p_widget_id', 'p_name', 'p_note', 'p_active', 'p_size'],
            kind: 'rpc',
            shape: 'update',
            alsoWrites: [],
          },
          { name: 'delete_widget', args: ['text'], params: ['p_widget_id'], kind: 'rpc', shape: 'delete', alsoWrites: [] },
        ],
      }),
    ]),
    screens: {
      available: true,
      screens: [
        screenSpec({
          name: 'widget_admin',
          reads: ['query-widget-list', 'query-widget-detail'],
          actions: ['widget.update', 'widget_flow.open', 'widget_flow.finish'],
          requires: ['empty'],
          overlays,
          slots: [{ slot: 'body.center', components }],
        }),
      ],
      chromes: [],
      unexposed: [],
      unreachableStates: [],
      unseenStates: [],
    },
  };
}

/** 編集する表(行のボタン: 遷移 2 + 削除)。 */
const EDITABLE: ComponentInit = {
  name: 'widget_table',
  kind: 'table',
  reads: 'query-widget-list',
  label: '部品',
  edit: 'widget.update',
  buttons: ['widget.delete', 'widget_flow.finish', 'widget_flow.open'],
};

/** 操作つきの表の計画 1 つ。 */
function plan(components: readonly ComponentInit[], overlays?: readonly OverlayInit[]) {
  const found = buildScreenReads(DOMAIN, context(components, overlays))[0];
  if (found === undefined) throw new Error('計画が導かれませんでした');
  return found;
}

/** 操作つきの表の本体の文字列。 */
function opsSource(components: readonly ComponentInit[], overlays?: readonly OverlayInit[]): string {
  return renderScreenTableOpsBody(plan(components, overlays), 'docs/specs/frontend/screens/admin/widget_admin.md', TEST_BODY_MODULES).join('\n');
}

describe('操作を載せる表の計画', () => {
  it('編集する表: 列は shows でなく編集の操作の入力(宣言の順)から出る。識別子は行から initial に写す欄', () => {
    const found = plan([EDITABLE]);

    expect(found.columns).toEqual([]);
    expect(found.edit).toMatchObject({ action: 'widget.update', entity: 'widget', supplied: ['id'], hasEnumLabels: true });
    expect(found.edit?.controls.map((control) => `${control.field}:${control.kind}`)).toEqual([
      'name:text',
      'note:multiline',
      'active:checkbox',
      'size:select',
    ]);
  });

  it('行のボタンは遷移(状態機械の宣言順)→ 削除の順に並び、宣言の並びには従わない', () => {
    const found = plan([EDITABLE]);

    expect(found.buttons?.operations.map((operation) => operation.op)).toEqual([
      'widget_flow.open',
      'widget_flow.finish',
      'widget.delete',
    ]);
    expect(found.buttons?.needsRole).toBe(true);
    expect(found.buttons?.operations[0]).toMatchObject({ kind: 'transition', machine: 'widget_flow', event: 'open', stateField: 'state' });
  });

  it('確認が要る削除だけが確認の器(その部品を opened_by に持つ重ね表示)を持つ。遷移は確認が要らない', () => {
    const operations = plan([EDITABLE]).buttons?.operations ?? [];

    expect(operations.find((operation) => operation.op === 'widget.delete')?.overlay).toEqual({
      id: 'delete_confirm',
      dialog: 'overlay.delete_confirm.body.center',
      bar: 'overlay.delete_confirm.body.center.confirm_bar',
      labelKey: 'overlay.delete_confirm',
    });
    expect(operations.filter((operation) => operation.overlay !== undefined)).toHaveLength(1);
  });

  it('重ね表示が無ければ確認の器を持たない(検査 S19 が先に止める。生成器は throw しない)', () => {
    const operations = plan([EDITABLE], []).buttons?.operations ?? [];

    expect(operations.every((operation) => operation.overlay === undefined)).toBe(true);
  });

  it('行の型に足す欄: 編集の入力欄・識別子・遷移のボタンの状態の欄', () => {
    expect([...plan([EDITABLE]).extraFields].sort()).toEqual(['active', 'id', 'name', 'note', 'size', 'state']);
    expect(plan([{ name: 'widget_table', kind: 'table', reads: 'query-widget-list', buttons: ['widget.delete'] }]).extraFields).toEqual([]);
  });

  it('source でない操作・作成・編集はボタンに載せない(S19 が先に止める。生成器は黙って落とす)', () => {
    const found = plan([{ name: 'widget_table', kind: 'table', reads: 'query-widget-list', buttons: ['widget.update', 'widget.create', 'nothing.go'] }]);

    expect(found.buttons).toBeUndefined();
  });

  it('編集の操作が source のエンティティの編集でなければ編集を持たない', () => {
    const found = plan([{ name: 'widget_table', kind: 'table', reads: 'query-widget-list', edit: 'widget.delete' }]);

    expect(found.edit).toBeUndefined();
  });

  it('ボタン列(kind: actions)は列を持たず、行の識別子と状態の欄だけが行の型に要る', () => {
    const found = plan([{ name: 'widget_bar', kind: 'actions', reads: 'query-widget-detail', buttons: ['widget_flow.open'] }], []);

    expect(found.part).toBe('actions');
    expect(found.columns).toEqual([]);
    expect(found.extraFields).toEqual(['state']);
  });
});

/** `widget` が行の名前の欄(`display_field`)を宣言したドメイン(確認の本文に行の名前を出す入力)。 */
function domainNamed(displayField: string) {
  const widget = DOMAIN.aggregates.get('widget');
  if (widget?.entity === undefined) throw new Error('widget がありません');
  return specModel({
    roles: [role('anonymous'), role('member'), role('system')],
    aggregates: [aggregate({ ...widget, name: 'widget', entity: { ...widget.entity, displayField } })],
  });
}

describe('確認の本文の行の名前(display_field)と注記の口(confirmNotes)', () => {
  const named = (components: readonly ComponentInit[], displayField = 'name', overlays?: readonly OverlayInit[]) => {
    const found = buildScreenReads(domainNamed(displayField), context(components, overlays))[0];
    if (found === undefined) throw new Error('計画が導かれませんでした');
    return found;
  };

  it('確認の器を持つボタンがあり、集約が display_field を宣言し、読みがその欄を返すなら、行の名前の欄を計画に持つ(行の型にも足す)', () => {
    const found = named([EDITABLE]);

    expect(found.buttons?.subjectField).toBe('name');
    expect(found.extraFields).toContain('name');
  });

  it('宣言が無い集約・読みがその欄を返さない・確認の器が無いときは持たない(要求すると器の行の型が満たせない)', () => {
    expect(plan([EDITABLE]).buttons?.subjectField).toBeUndefined();
    // widget_detail の projection は id / name / state で note を返さない。
    const detail = { name: 'widget_bar', kind: 'actions' as const, reads: 'query-widget-detail', buttons: ['widget.delete'] };
    expect(named([detail], 'note').buttons?.subjectField).toBeUndefined();
    expect(named([EDITABLE], 'name', []).buttons?.subjectField).toBeUndefined();
  });

  it('生成物は client 側で行から名前を引いて確認の文に渡す(関数 props は無い)・confirmNotes は確認の器を持つ操作だけが鍵', () => {
    const text = renderScreenTableOpsBody(named([EDITABLE]), 'docs/specs/frontend/screens/admin/widget_admin.md', TEST_BODY_MODULES).join('\n');

    expect(text).toContain('subject: (target) => target.name,');
    expect(text).toContain('    confirmNotes,');
    expect(text).toContain("readonly confirmNotes?: Readonly<Partial<Record<'widget.delete', ReactNode>>> | undefined;");
    expect(text).toContain('rowExtras, rowExtraHeader }');
    expect(text).toContain(' confirmNotes, skin,');
  });

  it('名前の欄を持たないときは subject を出さない・確認の器が無ければ confirmNotes も出さない', () => {
    const text = opsSource([EDITABLE], []);

    expect(text).not.toContain('subject:');
    expect(text).not.toContain('confirmNotes');
  });

  it('ボタン列も同じ(名前の引き方・注記の口)', () => {
    const bar = { name: 'widget_bar', kind: 'actions' as const, reads: 'query-widget-detail', buttons: ['widget.delete'] };
    const overlay: OverlayInit = { ...DELETE_CONFIRM, openedBy: 'widget_bar' };
    const text = renderScreenActionsBody(named([bar], 'name', [overlay]), 'docs/specs/frontend/screens/admin/widget_admin.md', TEST_BODY_MODULES).join('\n');

    expect(text).toContain("import type { ReactNode } from 'react';");
    expect(text).toContain('subject: (target) => target.name,');
    expect(text).toContain("readonly confirmNotes?: Readonly<Partial<Record<'widget.delete', ReactNode>>> | undefined;");
  });
});

describe('ボタン列の「いまできる操作はありません」', () => {
  const bar = { name: 'widget_bar', kind: 'actions' as const, reads: 'query-widget-detail', buttons: ['widget_flow.open'] };
  const text = renderScreenActionsBody(plan([bar], []), 'docs/specs/frontend/screens/admin/widget_admin.md', TEST_BODY_MODULES).join('\n');

  it('出せる操作が 0 個のときは案内の葉(.empty)を出し、あるときはボタンを出す', () => {
    expect(text).toContain('{rowActions.visibleCount(row) === 0 ? (');
    expect(text).toContain('<p data-testid={`${TESTID}.empty`} className={styles.screenActionsEmpty}>');
    expect(text).toContain("const EMPTY_MESSAGE = 'いまできる操作はありません';");
    expect(text).toContain('<div className={styles.screenRowActions}>{rowActions.buttons(row)}</div>');
  });

  it('既定のスタイルに案内のクラスがある(トークンだけを引く)', () => {
    const css = renderScreenDefaultCss();

    expect(css).toContain('.screenActionsEmpty {');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('編集する表の字面', () => {
  const text = opsSource([EDITABLE]);

  it('生成物は 1 つの client 部品で、行・Server Action(操作 ID が鍵)・writable・選択肢・実行者のロールを器から受ける', () => {
    expect(text.startsWith("'use client';")).toBe(true);
    expect(text).toContain("readonly 'widget.update': (input: Inputs['widget.update']) => Promise<ActionResult<unknown>>;");
    expect(text).toContain("readonly 'widget.delete': (input: Inputs['widget.delete']) => Promise<ActionResult<unknown>>;");
    expect(text).toContain('readonly role: string;');
    expect(text).toContain('readonly writable: readonly string[];');
    expect(text).toContain('readonly choices?: Readonly<Record<string, readonly FormChoice[]>> | undefined;');
    // 生成物は `_actions` を import しない(Server Action は器が渡す)。
    expect(text).not.toMatch(/from '[^']*_actions/);
  });

  it('見出し・入力欄は編集してよい欄(writable)に入っているときだけ描き、見出しの葉は column.{欄}・入力欄の葉は {欄}', () => {
    expect(text).toContain("{shown('name') ? (");
    expect(text).toContain('data-testid={`${TESTID}.column.name`}');
    expect(text).toContain('testId={`${TESTID}.name`}');
    expect(text).toContain('{widgetFieldLabels.name}');
    // 真偽値の欄はチェックボックス・選択欄は表示名の表を引く。
    expect(text).toContain('type="checkbox"');
    expect(text).toContain('optionLabels={widgetEnumLabels.size}');
    expect(text).toContain("choices={choices?.['note']}");
  });

  it('行は行ごとの実行器を持ち、変わった欄だけを送る(保存は変更が無いと押せない)・拒否は行の中に出す', () => {
    expect(text).toContain('const runner = useActionRunner(update, {');
    expect(text).toContain("event: 'widget.update',");
    expect(text).toContain('const changed = changedFields(view.draft.baseline, values, EDIT_FIELDS.filter(shown));');
    // 最新の props との差で決めない(旧い判定。他の人の更新が届くと触っていない欄を再送する)
    expect(text).not.toContain('values[field] !== start[field]');
    expect(text).toContain('disabled={busy || changed.length === 0 || view.conflicts.length > 0}');
    expect(text).toContain('data-testid={`${TESTID}.save`}');
    expect(text).toContain('testId={`${TESTID}.row_error`}');
    expect(text).toContain('fieldLabels={widgetFieldLabels}');
    expect(text).toContain('const SCHEMA = operationInputSchemas[\'widget.update\'];');
    expect(text).toContain("const SUPPLIED = ['id'] as const;");
  });

  it('行は testid と並べて行の識別子を持つ(`data-row-id`。実ブラウザの検査がボタンの属する行を引く口。型の鍵は行の識別子)', () => {
    expect(text).toContain('<tr data-testid={`${TESTID}.row`} data-row-id={item.id}>');
  });

  it('行の入力は 2 層(baseline / values)で、最新の行は毎レンダー導出して取り込み、成功のあとは送った値を保存済みとして覚える', () => {
    expect(text).toContain('const start = startValues(initialOf(item));');
    expect(text).toContain('const [draft, setDraft] = useState<FormDraft<string>>(() => ({ baseline: start, values: start }));');
    expect(text).toContain('const view = reconcileFormDraft(draft, start, EDIT_FIELDS);');
    expect(text).toContain('const values = view.draft.values;');
    expect(text).toContain("import { acceptSaved, editField, reconcileFormDraft, resolveConflict } from '@kaninabe/runtime/form-refresh';");
    expect(text).toContain("import { changedFields, formOf, toFieldIssues } from '@kaninabe/runtime/form';");
    expect(text).not.toContain('useEffect');
    expect(text).not.toContain('setValues');
    // 成功のあとは onSuccess → refresh の順(runner-core)。自分の保存が「他の人の変更」に見えない
    // 保存した時点の最新(start)を held に覚えさせる(refresh が届くまでの再描画で旧値に戻らない)
    expect(text).toContain('onSuccess: (_, sent) => setDraft((current) => acceptSaved(current, sentValues(sent), start)),');
    // 入力は view を土台に積む
    expect(text).toContain("onChange={(next) => edit('name', next)}");
    expect(text).toContain("{conflictView('name', busy)}");
  });

  it('競合は共有の部品 FormConflict で欄のセルの中に出す(競合が残る行は保存できない)', () => {
    expect(text).toContain("import { FormConflict } from './form-conflict';");
    expect(text).toContain(
      '<FormConflict testId={`${TESTID}.${field}`} pending={pending} onResolve={(choice) => resolveField(field, choice)} />',
    );
    expect(text).toContain("setDraft(resolveConflict(view.draft, start, field, choice));");
    expect(text).not.toContain('CONFLICT_MESSAGE');
    expect(text).not.toContain('screenConflict');
  });

  it('行の値は操作の入力と同じ型の initial に写す(入力欄の文字列への写しはフォームの口 toInputValue に任せる)', () => {
    expect(text).toContain('function initialOf(item: WidgetAdminWidgetTableRow): Readonly<Partial<Input>> {');
    expect(text).toContain('id: item.id, name: item.name, note: item.note, active: item.active, size: item.size');
    expect(text).toContain('FORM.toInputValue(');
  });

  it('行のボタンは共有フックに操作の配列を渡す(遷移は遷移表の交差・削除は常に・確認の器の testid と見出しを渡す)', () => {
    expect(text).toContain("import { transitionAllows, useActionRunner, useRowActions } from '@/components/action-runner';");
    expect(text).toContain("import { widgetFlowMachine } from '@/domain/generated/widget_flow.transitions';");
    expect(text).toContain('const rowActions = useRowActions<R>({');
    expect(text).toContain("available: (target) => transitionAllows(widgetFlowMachine, 'open', target.state, role),");
    expect(text).toContain("run: (target) => actions['widget.delete']({ id: target.id }),");
    expect(text).toContain("dialogTestId: widgetAdminTestIds['overlay.delete_confirm.body.center'],");
    expect(text).toContain("confirmBarTestId: widgetAdminTestIds['overlay.delete_confirm.body.center.confirm_bar'],");
    expect(text).toContain("label: widgetAdminLabels['overlay.delete_confirm'],");
    expect(text).toContain('{rowActions.buttons(item)}');
    expect(text).toContain('{rowActions.footer}');
  });

  it('日本語の既定の語は lib/messages から(削除・保存・操作の列の見出し)・遷移は label を持たないのでイベントの名前', () => {
    expect(text).toContain("const DELETE_LABEL = '削除';");
    expect(text).toContain("const SAVE_LABEL = '保存';");
    expect(text).toContain("const OPERATIONS_HEADER = '操作';");
    expect(text).toContain("label: 'open',");
  });

  it('見出しを持たない重ね表示の label は引かない(ボタンの文言が確認の見出しになる)', () => {
    const noLabel = opsSource([EDITABLE], [{ id: 'delete_confirm', openedBy: 'widget_table', actions: ['widget.delete'], slots: DELETE_CONFIRM.slots ?? [] }]);

    expect(noLabel).toContain('label: DELETE_LABEL,');
    expect(noLabel).not.toContain("widgetAdminLabels['overlay");
  });

  it('編集だけ(行のボタン無し)の表は共有フックを使わない。保存のセルがあるので操作の列の見出しは出す(列ずれを作らない)', () => {
    const only = opsSource([{ name: 'widget_table', kind: 'table', reads: 'query-widget-list', edit: 'widget.update' }]);

    expect(only).not.toContain('useRowActions');
    expect(only).toContain('<th className={styles.screenTableHead}>{OPERATIONS_HEADER}</th>');
    expect(only).toContain('data-testid={`${TESTID}.save`}');
    expect(only).not.toContain('role');
  });

  it('見出しの th の数と行の td の数が揃う(編集だけでも・ボタンもあっても。差し込みの列を除く)', () => {
    const count = (source: string, needle: RegExp): number => (source.match(needle) ?? []).length;
    const only = opsSource([{ name: 'widget_table', kind: 'table', reads: 'query-widget-list', edit: 'widget.update' }]);

    // 見出し: 編集してよい欄 4 + 操作 1(差し込みの th は別枠)。行: 入力欄のセル 4 + 保存のセル 1(差し込みの td は別枠)。
    expect(count(only, /<th data-testid=/g) + count(only, /OPERATIONS_HEADER}<\/th>/g)).toBe(5);
    expect(count(only, /<td className=\{styles\.screenTableCell\}>\n/g)).toBe(5);
  });
});

describe('runner: manual の操作のボタンの入力の型', () => {
  /** 遷移 `finish` が `runner: manual` の文脈(計画の外にあり、生成 zod の入力の型を持たない)。 */
  function manualContext(): GenerateContext {
    const base = context([{ name: 'widget_table', kind: 'table', reads: 'query-widget-list', buttons: ['widget_flow.finish', 'widget.delete'] }]);
    return {
      ...base,
      actions: {
        actions: [
          ...(base.actions?.actions ?? []),
          actionSpec({ handles: 'widget_flow.finish', input: ['widget.id'], runner: { reason: '定型に乗らない' } }),
        ],
        unhandled: [],
        scans: [],
        unscanned: [],
        testTagBaseline: [],
      },
    };
  }

  it('計画の外の操作は対象の識別子だけの型になり、計画で走る操作は生成 zod から導く', () => {
    const found = buildScreenReads(DOMAIN, manualContext())[0];
    if (found === undefined) throw new Error('計画が導かれませんでした');
    const text = renderScreenTableOpsBody(found, 'x.md', TEST_BODY_MODULES).join('\n');

    expect(found.buttons?.operations.map((operation) => `${operation.op}:${operation.typed}`)).toEqual([
      'widget_flow.finish:false',
      'widget.delete:true',
    ]);
    expect(text).toContain("readonly 'widget_flow.finish': { readonly id: string };");
    expect(text).toContain("readonly 'widget.delete': z.infer<(typeof operationInputSchemas)['widget.delete']>;");
  });

  it('ボタンが全部 manual なら生成 zod の import を持たない(使わない import を残さない)', () => {
    const base = manualContext();
    const only = buildScreenReads(DOMAIN, {
      ...base,
      screens: {
        available: true,
        screens: [
          screenSpec({
            name: 'widget_admin',
            reads: ['query-widget-list'],
            actions: ['widget_flow.finish'],
            requires: ['empty'],
            slots: [{ slot: 'body.center', components: [{ name: 'widget_table', kind: 'table', reads: 'query-widget-list', buttons: ['widget_flow.finish'] }] }],
          }),
        ],
        chromes: [],
        unexposed: [],
        unreachableStates: [],
        unseenStates: [],
      },
    })[0];
    if (only === undefined) throw new Error('計画が導かれませんでした');
    const text = renderScreenTableOpsBody(only, 'x.md', TEST_BODY_MODULES).join('\n');

    expect(text).not.toContain('operationInputSchemas');
    expect(text).not.toContain("from 'zod'");
    expect(text).toContain("readonly 'widget_flow.finish': { readonly id: string };");
  });
});

describe('読むだけの表に行のボタンだけを載せる字面', () => {
  const text = opsSource([
    { name: 'widget_table', kind: 'table', reads: 'query-widget-list', shows: ['name', 'state'], buttons: ['widget_flow.open', 'widget.delete'] },
  ]);

  it('読む列(shows)に操作の列が加わり、行は読む列のセルと操作の列を持つ(編集の道具は import しない)', () => {
    expect(text).toContain('data-testid={`${TESTID}.column.name`}');
    expect(text).toContain('<th className={styles.screenTableHead}>{OPERATIONS_HEADER}</th>');
    expect(text).toContain('<div className={styles.screenRowActions}>{rowActions.buttons(row)}</div>');
    expect(text).not.toContain('useActionRunner');
    expect(text).not.toContain('writable');
    // フックを呼ぶ生成物は編集の有無によらず client component(server の器から使うと落ちるので、器が渡すのは node と文字列と Server Action だけ)。
    expect(text.startsWith("'use client';")).toBe(true);
    expect(text).toContain('readonly rowExtras?: Readonly<Record<string, ReactNode>> | undefined;');
    expect(text).not.toContain('rowExtra?:');
    expect(text).not.toContain('rowHref');
  });

  it('行のボタンを持つ行も行の識別子を持つ(`data-row-id`。編集する行と同じ口)', () => {
    expect(text).toContain('<tr key={row.id} data-testid={`${TESTID}.row`} data-row-id={row.id}>');
  });

  it('操作を載せない表は従来の生成物のまま(操作の字面を 1 つも持たない)', () => {
    const readOnly = renderScreenTableBody(plan([{ name: 'widget_table', kind: 'table', reads: 'query-widget-list' }]), 'x.md', TEST_BODY_MODULES).join('\n');

    expect(readOnly).not.toContain('rowActions');
    expect(readOnly).not.toContain('actions');
  });
});

describe('行のリンクを持つ・差し込みを受ける、行のボタンの表', () => {
  /** 行から別の画面へ遷移する宣言(`on` にドット無し・1 本)を足した文脈。 */
  function linkedSource(components: readonly ComponentInit[]): string {
    const base = context(components);
    const screens = base.screens;
    if (screens === undefined || !screens.available) throw new Error('screens が無い');
    const [self] = screens.screens;
    if (self === undefined) throw new Error('画面が無い');
    const ctx: GenerateContext = {
      ...base,
      screens: {
        ...screens,
        screens: [{ ...self, navigations: [{ on: 'widget_selected', to: 'screen-widget-detail', location: { file: 'x', pointer: 'navigations[0]' } }] }, screenSpec({ name: 'widget_detail', route: '/widgets/:id' })],
      },
    };
    const found = buildScreenReads(DOMAIN, ctx)[0];
    if (found === undefined) throw new Error('計画が導かれませんでした');
    return renderScreenTableOpsBody(found, 'x.md', TEST_BODY_MODULES).join('\n');
  }

  it('ボタンだけの表は行のリンクを自分で組む(関数の props を持たない = client component でも server の器から使える)', () => {
    const text = linkedSource([{ name: 'widget_table', kind: 'table', reads: 'query-widget-list', shows: ['name', 'state'], buttons: ['widget_flow.open'] }]);

    expect(text.startsWith("'use client';")).toBe(true);
    expect(text).toContain('const NAV_ROUTE = screenRoutes.widget_detail.route;');
    expect(text).toContain('const href = screenPath(NAV_ROUTE, row.id);');
    expect(text).toContain('<Link data-testid={NAV_TESTID} href={href} className={styles.screenTableLink}>');
    expect(text).not.toContain('rowHref');
  });

  it('編集する表の行は入力欄の行なので、行のリンクを持たない(リンクの import も残さない)', () => {
    const text = linkedSource([EDITABLE]);

    expect(text).not.toContain('NAV_ROUTE');
    expect(text).not.toContain("from 'next/link'");
    expect(text).not.toContain('screenRoutes');
  });

  it('差し込みは行の id を鍵にした node で受ける(編集する行へは undefined = 列なし / null = 空のセルを渡す)', () => {
    const text = opsSource([EDITABLE]);

    expect(text).toContain('extra={rowExtras === undefined ? undefined : (rowExtras[row.id] ?? null)}');
    expect(text).toContain('{extra === undefined ? null : <td className={styles.screenTableCell}>{extra}</td>}');
    expect(text).toContain('readonly rowExtraHeader?: string | undefined;');
  });
});

describe('ボタン列(kind: actions)の字面', () => {
  const bar: ComponentInit = { name: 'widget_bar', kind: 'actions', reads: 'query-widget-detail', buttons: ['widget_flow.open', 'widget_flow.finish'] };
  const text = renderScreenActionsBody(plan([bar], []), 'docs/specs/frontend/screens/admin/widget_admin.md', TEST_BODY_MODULES).join('\n');

  it('1 行(row)と Server Action と実行者のロールを受け、押せる操作のボタンと拒否の表示を出す', () => {
    expect(text.startsWith("'use client';")).toBe(true);
    expect(text).toContain('readonly row: R;');
    expect(text).toContain('readonly role: string;');
    expect(text).toContain('<div className={styles.screenRowActions}>{rowActions.buttons(row)}</div>');
    expect(text).toContain('{rowActions.footer}');
    expect(text).toContain("available: (target) => transitionAllows(widgetFlowMachine, 'finish', target.state, role),");
  });

  it('列も入力欄も持たない(表の道具を import しない)', () => {
    expect(text).not.toContain('<table');
    expect(text).not.toContain('FormControl');
    expect(text).not.toContain('useActionRunner');
  });
});

describe('葉の表・期待木・既定のスタイル・生成器の入口', () => {
  const sections = (components: readonly ComponentInit[], overlays?: readonly OverlayInit[]): string =>
    screenRoutesGenerator
      .generate(DOMAIN, context(components, overlays))
      .map((section) => section.content)
      .join('\n');

  it('編集する表の葉: 入力欄と見出しは writable のときだけ・保存は必ず・行のボタンは出ることがある・拒否の葉', () => {
    const text = sections([EDITABLE]);

    expect(text).toContain("fieldsIfWritable: ['name', 'note', 'active', 'size']");
    expect(text).toContain("columnsIfWritable: ['column.name', 'column.note', 'column.active', 'column.size']");
    // 競合の葉は欄ごと(`{欄}.{葉}`)。実行時に競合が起きたときだけ描かれる
    expect(text).toContain("conflictLeaves: ['conflict', 'take_theirs', 'keep_mine']");
    expect(text).toContain("rowActions: ['save']");
    expect(text).toContain("rowButtons: ['open', 'finish', 'delete']");
    expect(text).toContain("rowError: 'row_error'");
    expect(text).toContain("buttonError: 'error'");
    expect(text).toContain('columns: []');
  });

  it('ボタン列の葉: 行のボタンと拒否の葉と、出せる操作が無いときの案内の葉(列・行の葉は無い)', () => {
    const text = sections([{ name: 'widget_bar', kind: 'actions', reads: 'query-widget-detail', buttons: ['widget_flow.open'] }], []);

    expect(text).toContain("rowButtons: ['open']");
    expect(text).toContain("buttonError: 'error'");
    expect(text).toContain("empty: 'empty'");
    expect(text).not.toContain("row: 'row'");
    expect(text).not.toContain('columns:');
  });

  it('操作を載せない読むだけの表の葉は従来のまま(行のボタンの葉を持たない)', () => {
    const text = sections([{ name: 'widget_table', kind: 'table', reads: 'query-widget-list' }]);

    expect(text).toContain("empty: 'empty'");
    expect(text).not.toContain('rowButtons: [');
    expect(text).not.toContain('rowActions: [');
  });

  it('期待木: ボタン列も生成物 1 本として数える', () => {
    const expectations = screenExpectations(DOMAIN, context([EDITABLE, { name: 'widget_bar', kind: 'actions', reads: 'query-widget-detail', buttons: ['widget_flow.open'] }]));

    expect(expectations.generated.map((entry) => entry.file)).toEqual([
      'src/app/_screens/generated/widget_admin.widget_table.tsx',
      'src/app/_screens/generated/widget_admin.widget_bar.tsx',
      'src/app/_screens/generated/default.module.css',
      'src/app/_screens/generated/form-conflict.tsx',
    ]);
  });

  it('表の生成器は編集する表とボタン列も出し、フォームの生成器は既定のスタイルに行のボタンの形を含める', () => {
    const generated = screenTablesGenerator.generate(DOMAIN, context([EDITABLE, { name: 'widget_bar', kind: 'actions', reads: 'query-widget-detail', buttons: ['widget_flow.open'] }]));
    const css = screenFormsGenerator.generate(DOMAIN, context([EDITABLE]));

    expect(generated.map((section) => section.file.split('/').pop())).toEqual(['widget_admin.widget_table.tsx', 'widget_admin.widget_bar.tsx']);
    expect(css.some((section) => section.content.includes('.screenRowActions'))).toBe(true);
    expect(renderScreenDefaultCss()).toContain('.screenRowActions {');
    expect(renderScreenDefaultCss()).toContain('.screenActions {');
  });
});
