/**
 * 画面の部品のフォーム(`kind: form`)の**葉の表**(`screens.ts` の `leaves`)の形(束 画面 2b)。
 *
 * 確かめるのは、作成のフォームは欄が「必ず描かれる」(`fields`)に載り、**編集のフォームは欄が
 * 「編集してよいときだけ」(`fieldsIfWritable`)に載る**こと —— どの欄が出るかは実行時に器が渡す `writable`
 * (書き込みの規則 × 対象の状態)で決まるので、静的に決まらない欄を「必ず描かれる」に載せない。
 *
 * アプリの語彙は 1 語も使わない(W1)。
 */

import { describe, expect, it } from 'vitest';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { screenRoutesGenerator } from '../../../../lib/generate/render/code-screens.js';
import { buildScreenForms } from '../../../../lib/generate/render/screen-form-plan.js';
import {
  accessSpec,
  aggregate,
  createRule,
  entitySpec,
  field,
  role,
  specModel,
  stubContext,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 作成と編集を持つ 1 集約の架空のドメイン。 */
const DOMAIN = specModel({
  roles: [role('anonymous'), role('member'), role('system')],
  aggregates: [
    aggregate({
      name: 'widget',
      entity: entitySpec('widget', [
        field('id', { kind: 'uuid' }),
        field('name', { kind: 'string' }, { required: true }),
        field('note', { kind: 'string' }),
      ]),
      access: accessSpec('widget', {
        creates: [createRule('member')],
        writes: [writeRule('member', ['name', 'note'])],
      }),
    }),
  ],
});

/** 生成の文脈(`op` のフォームを `kind: form` で載せた画面 1 枚)。 */
function context(op: 'widget.create' | 'widget.update'): GenerateContext {
  const { guards } = stubContext();
  const input = op === 'widget.create' ? ['widget.name', 'widget.note'] : ['widget.id', 'widget.name', 'widget.note'];
  return {
    guards,
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    actions: {
      actions: [actionSpec({ handles: op, input })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
    dataTables: dataTableModel([
      dataTable('widgets', {
        entity: 'widget',
        functions: [
          { name: 'insert_widget', args: ['text', 'text'], params: ['p_name', 'p_note'], kind: 'rpc', shape: 'create', alsoWrites: [] },
          {
            name: 'update_widget',
            args: ['text', 'text', 'text'],
            params: ['p_widget_id', 'p_name', 'p_note'],
            kind: 'rpc',
            shape: 'update',
            alsoWrites: [],
          },
        ],
      }),
    ]),
    screens: {
      available: true,
      screens: [
        screenSpec({
          name: 'widget_admin',
          actions: [op],
          slots: [{ slot: 'body.center', components: [{ name: 'widget_form', kind: 'form', action: op }] }],
        }),
      ],
      chromes: [],
      unexposed: [],
      unreachableStates: [],
      unseenStates: [],
    },
  };
}

/** 葉の表を含む部分だけを取り出す。 */
function leavesSource(op: 'widget.create' | 'widget.update'): string {
  const sections = screenRoutesGenerator.generate(DOMAIN, context(op));
  return sections.map((section) => section.content).join('\n');
}

describe('葉の表 — 欄の載せ先', () => {
  it('計画: 作成は shape create、編集は update(識別子は欄ではなく initial で受ける)', () => {
    const create = buildScreenForms(DOMAIN, context('widget.create'));
    const update = buildScreenForms(DOMAIN, context('widget.update'));

    expect(create[0]).toMatchObject({ shape: 'create', supplied: [] });
    expect(update[0]).toMatchObject({ shape: 'update', supplied: ['id'] });
  });

  it('作成のフォームの欄は「必ず描かれる」(fields)に載る', () => {
    const text = leavesSource('widget.create');

    expect(text).toContain("fields: ['name', 'note']");
    // 型の宣言(fieldsIfWritable?: …)は出るので、表の値としては出ないことを見る。
    expect(text).not.toContain('fieldsIfWritable: [');
    // 競合(他の人が先に変えた)は編集にしか起きない
    expect(text).not.toContain("conflictLeaves: [");
  });

  it('編集のフォームの欄は「編集してよいときだけ」(fieldsIfWritable)に載り、必ず描かれる欄は無い', () => {
    const text = leavesSource('widget.update');

    expect(text).toContain('fields: []');
    expect(text).toContain("fieldsIfWritable: ['name', 'note']");
    expect(text).toContain("conflictLeaves: ['conflict', 'take_theirs', 'keep_mine']");
  });
});

describe('計画 — 参照の欄の選択肢(kind: form の reads)', () => {
  /** 催し(会場への ref を持つ)・会場。 */
  const DOMAIN_WITH_REF = specModel({
    roles: [role('anonymous'), role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'widget',
        entity: entitySpec('widget', [
          field('id', { kind: 'uuid' }),
          field('name', { kind: 'string' }, { required: true }),
          field('place_id', { kind: 'ref', entity: 'place' }),
          field('spare_place_id', { kind: 'ref', entity: 'place' }),
        ]),
        access: accessSpec('widget', { creates: [createRule('member')], writes: [writeRule('member', ['name', 'place_id', 'spare_place_id'])] }),
      }),
      aggregate({
        name: 'place',
        entity: entitySpec('place', [field('id', { kind: 'uuid' }), field('title', { kind: 'string' }, { required: true })]),
      }),
    ],
  });

  /** 選択肢の読み(`projection` の欄を引数で変えられる)。 */
  function options(projection: readonly string[], source = 'place') {
    return querySpec({ name: 'place_options', source, for: ['member'], scopeUsed: 'all', projection });
  }

  /** `reads` つきの編集フォームの文脈。 */
  function ctxWith(inputs: readonly string[], query: ReturnType<typeof options>, reads: string | null = 'query-place-options') {
    const base = context('widget.update');
    return {
      ...base,
      actions: { ...(base.actions as NonNullable<typeof base.actions>), actions: [actionSpec({ handles: 'widget.update', input: inputs })] },
      dataTables: dataTableModel([
        dataTable('widgets', {
          entity: 'widget',
          functions: [
            {
              name: 'update_widget',
              args: inputs.map(() => 'text'),
              params: inputs.map((input) => `p_${input.split('.')[1] === 'id' ? 'widget_id' : (input.split('.')[1] ?? '')}`),
              kind: 'rpc',
              shape: 'update',
              alsoWrites: [],
            },
          ],
        }),
      ]),
      queries: { available: true, queries: [query] },
      screens: {
        ...(base.screens as NonNullable<typeof base.screens>),
        screens: [
          screenSpec({
            name: 'widget_admin',
            actions: ['widget.update'],
            reads: ['query-place-options'],
            slots: [
              {
                slot: 'body.center',
                components: [
                  { name: 'widget_form', kind: 'form', action: 'widget.update', ...(reads === null ? {} : { reads }) },
                ],
              },
            ],
          }),
        ],
      },
    };
  }

  it('読みの source を指す ref の欄はちょうど 1 つなら supplied から controls の select に移り、表示名は projection の id 以外の欄', () => {
    const [plan] = buildScreenForms(DOMAIN_WITH_REF, ctxWith(['widget.id', 'widget.name', 'widget.place_id'], options(['id', 'title'])));

    expect(plan?.supplied).toEqual(['id']);
    expect(plan?.controls).toEqual([
      { field: 'name', kind: 'text' },
      { field: 'place_id', kind: 'select', ref: { entity: 'place', labelField: 'title', required: false } },
    ]);
    // 参照の選択欄は enum の表示名の表を引かない。
    expect(plan?.hasEnumLabels).toBe(false);
  });

  it('reads が無い・読みが選択肢の形でない・source を指す ref が 0 つか 2 つ以上なら効かせない(検査 S18 が先に赤にする。生成器は throw しない)', () => {
    const withRef = ['widget.id', 'widget.name', 'widget.place_id'];

    expect(buildScreenForms(DOMAIN_WITH_REF, ctxWith(withRef, options(['id', 'title']), null))[0]?.supplied).toEqual(['id', 'place_id']);
    expect(buildScreenForms(DOMAIN_WITH_REF, ctxWith(withRef, options(['id', 'title', 'id'])))[0]?.supplied).toEqual(['id', 'place_id']);
    expect(buildScreenForms(DOMAIN_WITH_REF, ctxWith(withRef, options(['id'])))[0]?.supplied).toEqual(['id', 'place_id']);
    expect(buildScreenForms(DOMAIN_WITH_REF, ctxWith(['widget.id', 'widget.name'], options(['id', 'title'])))[0]?.controls).toEqual([
      { field: 'name', kind: 'text' },
    ]);
    expect(
      buildScreenForms(DOMAIN_WITH_REF, ctxWith([...withRef, 'widget.spare_place_id'], options(['id', 'title'])))[0]?.supplied,
    ).toEqual(['id', 'place_id', 'spare_place_id']);
    expect(buildScreenForms(DOMAIN_WITH_REF, ctxWith(withRef, options(['id', 'title'], 'widget')))[0]?.supplied).toEqual(['id', 'place_id']);
  });
});

