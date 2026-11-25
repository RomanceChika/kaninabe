/**
 * 画面の部品の表・詳細(`kind: table` / `detail`)の生成のテスト(束 画面 3a)。
 *
 * 確かめるのは「列・項目は `shows`(省略時は id と ref を除く全欄)から宣言の順に出る」「見出しは
 * `{entity}FieldLabels`(併読の欄は併読先の表)」「セルの整形は日時・真偽値・enum・状態・値無しで決まっている」
 * 「行が 0 件のときの空の葉と既定の文」「行の遷移は画面自身の遷移がちょうど 1 本のときだけ」「葉の表」
 * 「生成物の期待木・既定のスタイル」である。アプリの語彙は 1 語も使わない(W1)。
 */

import { describe, expect, it } from 'vitest';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { screenDetailsGenerator } from '../../../../lib/generate/render/code-screen-details.js';
import { screenFormsGenerator } from '../../../../lib/generate/render/code-screen-forms.js';
import { screenRoutesGenerator } from '../../../../lib/generate/render/code-screens.js';
import { screenTablesGenerator } from '../../../../lib/generate/render/code-screen-tables.js';
import { screenPartOriginOf } from '../../../../lib/generate/render/screen-part-placement.js';
import { renderScreenDefaultCss } from '../../../../lib/generate/render/screen-default-css.js';
import { renderScreenDetailBody } from '../../../../lib/generate/render/screen-detail-body.js';
import { buildScreenReads, hasGeneratedParts } from '../../../../lib/generate/render/screen-read-plan.js';
import { renderScreenTableBody } from '../../../../lib/generate/render/screen-table-body.js';
import { screenExpectations } from '../../../../lib/generate/render/structure-screen-expectations.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { aggregate, entitySpec, field, machine, specModel } from '../../../helpers/model-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { FOREIGN_LAYOUT, FOREIGN_ROOTS, TEST_PLATFORM, TEST_LAYOUT, leaksNextjsEntrySpelling, TEST_BODY_MODULES } from '../../../helpers/platform.js';
import { EMPTY_LAYOUT } from '../../../../lib/model/product/layout.js';
import { GeneratorPreconditionError } from '../../../../lib/kernel/generator-precondition.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import type { ComponentInit } from '../../../helpers/screen-builder.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 催し(会場と世話役への ref・日時・真偽値・enum・状態・任意の数値)・会場・メンバーを持つ架空のドメイン。 */
const DOMAIN = specModel([
  aggregate('workshop', {
    entity: entitySpec('workshop', {
      fields: [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('title', { kind: 'string' }, { required: true, label: '題名' }),
        field('venue_id', { kind: 'ref', entity: 'venue' }, { label: '会場' }),
        field('starts_at', { kind: 'datetime' }, { required: true, label: '開演' }),
        field('children_allowed', { kind: 'boolean' }, { required: true, label: '子連れ' }),
        { ...field('kind', { kind: 'enum', values: ['full', 'sample'] }, { required: true, label: '種別' }), labels: { full: '実名', sample: '例' } },
        field('seats', { kind: 'integer' }, { label: '席数' }),
        field('note', { kind: 'string' }),
        field('state', { kind: 'state', machine: 'workshop' }, { label: '状態' }),
      ],
    }),
    stateMachines: [machine('workshop', { states: ['draft', 'open'], initial: 'draft', stateLabels: { draft: '下書き', open: '公開' } })],
  }),
  aggregate('venue', {
    entity: entitySpec('venue', {
      fields: [field('id', { kind: 'uuid' }, { auto: true }), field('name', { kind: 'string' }, { required: true, label: '会場名' })],
    }),
  }),
]);

/** 読み(一覧と詳細)。 */
const QUERIES = [
  querySpec({
    name: 'workshop_list',
    source: 'workshop',
    for: ['member'],
    scopeUsed: 'all',
    projection: ['id', 'title', 'venue_id', 'starts_at', 'children_allowed', 'kind', 'seats', 'note', 'state'],
    includes: [{ entity: 'venue', scopeUsed: 'all', projection: ['id', 'name'] }],
  }),
  querySpec({
    name: 'workshop_detail',
    source: 'workshop',
    for: ['member'],
    scopeUsed: 'all',
    returns: 'one',
    params: [{ name: 'workshop_id', ref: 'workshop.id' }],
    projection: ['id', 'title', 'starts_at', 'state'],
  }),
];

/** 生成の文脈(`components` を載せた画面 1 枚)。 */
function context(
  components: readonly ComponentInit[],
  extra: { navigations?: readonly { on: string; to: string }[]; viaChrome?: boolean } = {},
): GenerateContext {
  return {
    guards: createGuardServices(),
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    queries: { available: true, queries: QUERIES },
    screens: {
      available: true,
      screens: [
        screenSpec({
          name: 'workshop_list',
          reads: ['query-workshop-list', 'query-workshop-detail'],
          navigations: extra.navigations ?? [],
          slots: [{ slot: 'body.center', components }],
        }),
        // 行の遷移の行き先(動的セグメント 1 つ・0 個・2 個)。
        screenSpec({ name: 'x', route: '/x/:id' }),
        screenSpec({ name: 'flat', route: '/flat' }),
        screenSpec({ name: 'deep', route: '/deep/:a/:b' }),
      ],
      chromes: [],
      unexposed: [],
      unreachableStates: [],
      unseenStates: [],
    },
  };
}

/** 表 1 つの部品。 */
function table(rest: Partial<Extract<ComponentInit, { name: string }>> = {}): ComponentInit {
  return { name: 'workshop_table', kind: 'table', reads: 'query-workshop-list', label: '催し', ...rest };
}

/** 表の本体の文字列。 */
function tableSource(rest: Partial<Extract<ComponentInit, { name: string }>> = {}, extra: Parameters<typeof context>[1] = {}): string {
  const plan = buildScreenReads(DOMAIN, context([table(rest)], extra))[0];
  if (plan === undefined) throw new Error('計画が導かれませんでした');
  return renderScreenTableBody(plan, 'docs/specs/frontend/screens/workshop/workshop_list.md', TEST_BODY_MODULES).join('\n');
}

describe('生成の入力の導出', () => {
  it('shows を省略すると id と ref を除く全欄(併読は {併読名}.{欄})が宣言の順に列になる', () => {
    const plan = buildScreenReads(DOMAIN, context([table()]))[0];

    expect(plan?.columns.map((column) => column.path)).toEqual([
      'title',
      'starts_at',
      'children_allowed',
      'kind',
      'seats',
      'note',
      'state',
      'venue.name',
    ]);
    expect(plan).toMatchObject({
      part: 'table',
      file: 'workshop_list.workshop_table.tsx',
      exportName: 'WorkshopListWorkshopTable',
      path: 'body.center.workshop_table',
      label: '催し',
    });
  });

  it('shows を書けばその順(併読の欄も)・読みを引けない部品は計画を持たない(throw しない)', () => {
    const plan = buildScreenReads(DOMAIN, context([table({ shows: ['venue.name', 'title'] })]))[0];
    expect(plan?.columns.map((column) => column.path)).toEqual(['venue.name', 'title']);

    expect(buildScreenReads(DOMAIN, context([table({ reads: 'query-no-such' })]))).toEqual([]);
    expect(buildScreenReads(DOMAIN, { guards: createGuardServices(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES })).toEqual([]);
  });

  it('行の遷移は画面自身の遷移(ドット無し)がちょうど 1 本のときだけ', () => {
    const none = buildScreenReads(DOMAIN, context([table()]))[0];
    const one = buildScreenReads(DOMAIN, context([table()], { navigations: [{ on: 'workshop_selected', to: 'screen-x' }] }))[0];
    const two = buildScreenReads(
      DOMAIN,
      context([table()], { navigations: [{ on: 'a_link', to: 'screen-x' }, { on: 'b_link', to: 'screen-y' }] }),
    )[0];
    // 操作の結果の遷移(ドットあり)は行の遷移ではない。
    const dotted = buildScreenReads(DOMAIN, context([table()], { navigations: [{ on: 'workshop.update.success', to: 'screen-x' }] }))[0];

    expect(none?.rowNav).toBeUndefined();
    expect(one?.rowNav).toBe('nav.workshop_selected');
    expect(one?.rowNavTarget).toEqual({ screen: 'x', dynamic: true });
    expect(two?.rowNav).toBeUndefined();
    expect(dotted?.rowNav).toBeUndefined();
  });

  it('行の遷移先は route の動的セグメントが 1 つなら行の id で埋め・0 個なら route そのもの・2 個以上か実在しなければリンクを出さない(throw しない)', () => {
    const to = (target: string) =>
      buildScreenReads(DOMAIN, context([table()], { navigations: [{ on: 'workshop_selected', to: target }] }))[0];

    expect(to('screen-flat')?.rowNavTarget).toEqual({ screen: 'flat', dynamic: false });
    expect(to('screen-deep')?.rowNav).toBeUndefined();
    expect(to('screen-nowhere')?.rowNav).toBeUndefined();
  });

  it('生成物の部品が 1 つでもあれば置き場がある(フォームだけ・表だけ・無し)', () => {
    expect(hasGeneratedParts(DOMAIN, context([table()]))).toBe(true);
    expect(hasGeneratedParts(DOMAIN, context(['plain_part']))).toBe(false);
  });

  it('重ね表示の部品も拾い、キーに overlay.{id}. が前置きされる', () => {
    const ctx = context(['plain_part']);
    const screen = screenSpec({
      name: 'workshop_list',
      reads: ['query-workshop-list'],
      overlays: [
        { id: 'peek', slots: [{ slot: 'body.center', components: [table()] }] },
      ],
    });
    const plans = buildScreenReads(DOMAIN, { ...ctx, screens: { ...(ctx.screens as NonNullable<typeof ctx.screens>), screens: [screen] } });

    expect(plans[0]?.path).toBe('overlay.peek.body.center.workshop_table');
  });
});

describe('表の本体', () => {
  const text = tableSource({}, { navigations: [{ on: 'workshop_selected', to: 'screen-x' }] });

  it('見出しは {entity}FieldLabels(併読の欄は併読先の表)から引き、葉は部品の testid に column.{欄} を付ける', () => {
    expect(text).toContain('{workshopFieldLabels.title}');
    expect(text).toContain('{venueFieldLabels.name}');
    expect(text).toContain('data-testid={`${TESTID}.column.title`}');
    expect(text).toContain('data-testid={`${TESTID}.column.venue.name`}');
    expect(text).toContain("import { workshopEnumLabels, workshopFieldLabels, workshopStateLabels } from '@/domain/generated/workshop.labels';");
  });

  it('label が無い欄は欄の名前をそのまま出す(無い値を発明しない)', () => {
    expect(text).toContain("{'note'}");
  });

  it('セルの整形: 日時・真偽値・enum・状態・任意の値・併読の欄', () => {
    expect(text).toContain('formatDateTime(row.startsAt, timeZone)');
    expect(text).toContain('row.childrenAllowed ? YES : NO');
    expect(text).toContain('workshopEnumLabels.kind[row.kind]');
    expect(text).toContain('workshopStateLabels[row.state]');
    // 状態機械の全状態に label があるので直接引く。
    expect(text).not.toContain('as Readonly<Record');
    expect(text).toContain('row.seats ?? NONE');
    expect(text).toContain('row.venue?.name ?? NONE');
    expect(text).toContain("const NONE = '—';");
    expect(text).toContain("const YES = 'はい';");
    expect(text).toContain("const NO = 'いいえ';");
  });

  it('行の key は行の id(順序に依らない識別)。行の型は id を必須に持つ(shows に id が無くても足す)', () => {
    expect(text).toContain('<tr key={row.id} data-testid={`${TESTID}.row`}>');
    expect(text).not.toContain('key={index}');
    expect(text).toContain("readonly id: WorkshopRow['id'];");
    // shows に id を書いてあれば二重に足さない。
    const explicit = tableSource({ shows: ['id', 'title'] });
    expect(explicit.split("readonly id: WorkshopRow['id'];")).toHaveLength(2);
  });

  it('状態のセルは表示名の文字に加えて data-state に状態の値を出す(意味色は器の CSS が当てる。生成物は色を知らない)', () => {
    expect(text).toContain('<td data-state={row.state} className={styles.screenTableCell}>{workshopStateLabels[row.state]}</td>');
    // 状態の欄でないセルには付かない。
    expect(text.split('data-state=')).toHaveLength(2);
    // 併読の欄の状態(併読が無い行がありうる)は値が無いとき属性ごと出ない。
    const included = specModel([
      aggregate('workshop', {
        entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('venue_id', { kind: 'ref', entity: 'venue' })] }),
      }),
      aggregate('venue', {
        entity: entitySpec('venue', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'venue' })] }),
        stateMachines: [machine('venue', { states: ['open'], initial: 'open', stateLabels: { open: '開' } })],
      }),
    ]);
    const queries = [
      querySpec({
        name: 'workshop_list',
        source: 'workshop',
        for: ['member'],
        scopeUsed: 'all',
        projection: ['id', 'venue_id'],
        includes: [{ entity: 'venue', scopeUsed: 'all', projection: ['id', 'state'] }],
      }),
    ];
    const ctx = { ...context([table({ shows: ['venue.state'] })]), queries: { available: true, queries } };
    const plan = buildScreenReads(included, ctx)[0];
    const source = plan === undefined ? '' : renderScreenTableBody(plan, 'x.md', TEST_BODY_MODULES).join('\n');

    expect(source).toContain('data-state={row.venue?.state ?? undefined}');
  });

  it('数量の列は右寄せのセルにする', () => {
    expect(text).toContain('<td className={styles.screenTableCellNumeric}>{row.seats ?? NONE}</td>');
  });

  it('行の型は生成 zod の行の型から索引し、キーは camelCase(snake への切替は rowKeyOf 1 か所)', () => {
    expect(text).toContain("import type { WorkshopRow } from '@/domain/generated/workshop.schema';");
    expect(text).toContain("readonly startsAt: WorkshopRow['starts_at'];");
    expect(text).toContain("readonly name: VenueRow['name'];");
    expect(text).toContain('} | null;');
  });

  it('行が 0 件のときは空の葉と、部品の label から作る既定の文を出す', () => {
    expect(text).toContain('data-testid={`${TESTID}.empty`}');
    expect(text).toContain('const EMPTY_MESSAGE = `${workshopListLabels[KEY]}はまだありません`;');
    expect(text).toContain("data-testid={`${TESTID}.row`}");
  });

  it('label が無い部品の空の文は label を使わない既定の語', () => {
    const bare = tableSource({ label: undefined as unknown as string });

    expect(bare).toContain("const EMPTY_MESSAGE = 'まだありません';");
    expect(bare).not.toContain('workshopListLabels');
  });

  it('日時を出す表だけが timeZone を受ける(生成物は env を読まない)', () => {
    expect(text).toContain('readonly timeZone: string;');
    const plain = tableSource({ shows: ['title'] });

    expect(plain).not.toContain('timeZone');
    expect(plain).not.toContain('formatDateTime');
  });

  it('行の遷移がある表は、生成物が screenRoutes と行の id から href を組み(関数の props を持たない)、先頭の列がリンクになる(testid は nav.{on})', () => {
    expect(text).toContain("const NAV_TESTID = workshopListTestIds['nav.workshop_selected'];");
    expect(text).toContain('const NAV_ROUTE = screenRoutes.x.route;');
    expect(text).toContain('const href = screenPath(NAV_ROUTE, row.id);');
    expect(text).toContain("import { screenPath } from '@/components/screen-path';");
    expect(text).toContain("import { screenRoutes } from '@/domain/generated/screens';");
    expect(text).not.toContain('rowHref');
    expect(text).toContain('export function WorkshopListWorkshopTable<R extends WorkshopListWorkshopTableRow>');
    expect(text).toContain('<Link data-testid={NAV_TESTID} href={href} className={styles.screenTableLink}>');
    // 先頭の列だけがリンクで、他の列は文字だけ。
    expect(text.split('<Link ')).toHaveLength(2);
    expect(tableSource()).not.toContain('screenRoutes');
    expect(tableSource()).not.toContain("from 'next/link'");
    // 動的セグメントが無い遷移先は route そのもの(screenPath を使わない)。
    const flat = tableSource({}, { navigations: [{ on: 'workshop_selected', to: 'screen-flat' }] });
    expect(flat).toContain('const href = NAV_ROUTE;');
    expect(flat).not.toContain('screenPath');
  });

  it('行ごとの差し込み口 rowExtras は全ての表が持ち(関数ではなく行の id を鍵にした node・見出しは文字列)、渡したときだけ末尾に列(葉は付けない)が出る', () => {
    for (const source of [text, tableSource(), tableSource({ shows: ['title'] })]) {
      expect(source).toContain("import type { ReactNode } from 'react';");
      expect(source).toContain('readonly rowExtras?: Readonly<Record<string, ReactNode>> | undefined;');
      expect(source).toContain('readonly rowExtraHeader?: string | undefined;');
      expect(source).toContain('{rowExtras === undefined ? null : <td className={styles.screenTableCell}>{rowExtras[row.id] ?? null}</td>}');
      expect(source).toContain('<th className={styles.screenTableHead}>{rowExtraHeader ?? null}</th>');
      expect(source).not.toContain('rowExtra(');
      // 差し込む列の見出しは shows の欄の葉(column.{欄})に混ぜない。
      expect(source).not.toContain('column.extra');
    }
    // 差し込む列は shows の列より後ろ(見出し・セルとも)。
    expect(text.indexOf('{rowExtraHeader ?? null}')).toBeGreaterThan(text.indexOf('column.venue.name'));
    expect(text.indexOf('{rowExtras[row.id]')).toBeGreaterThan(text.indexOf('row.venue?.name'));
  });

  it('値が無い列が無い表は NONE も when も出さない・状態の表示名に欠けがあれば既定を添える', () => {
    const required = tableSource({ shows: ['title', 'starts_at'] });
    expect(required).not.toContain('NONE');
    expect(required).not.toContain('function when');

    const incomplete = specModel([
      aggregate('workshop', {
        entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'workshop' })] }),
        stateMachines: [machine('workshop', { states: ['draft', 'open'], initial: 'draft', stateLabels: { draft: '下書き' } })],
      }),
    ]);
    const queries = [querySpec({ name: 'workshop_list', source: 'workshop', for: ['member'], scopeUsed: 'all', projection: ['id', 'state'] })];
    const ctx = { ...context([table({ shows: ['state'] })]), queries: { available: true, queries } };
    const plan = buildScreenReads(incomplete, ctx)[0];
    const source = plan === undefined ? '' : renderScreenTableBody(plan, 'x.md', TEST_BODY_MODULES).join('\n');

    expect(source).toContain('(workshopStateLabels as Readonly<Record<string, string | undefined>>)[row.state] ?? row.state');
  });

  it('nullable な真偽値・enum・日時は when で値無しを NONE にする', () => {
    const nullable = specModel([
      aggregate('workshop', {
        entity: entitySpec('workshop', {
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('flag', { kind: 'boolean' }),
            field('at', { kind: 'datetime' }),
            { ...field('kind', { kind: 'enum', values: ['a'] }), labels: { a: 'A' } },
          ],
        }),
      }),
    ]);
    const queries = [querySpec({ name: 'workshop_list', source: 'workshop', for: ['member'], scopeUsed: 'all', projection: ['id', 'flag', 'at', 'kind'] })];
    const ctx = { ...context([table({ shows: ['flag', 'at', 'kind'] })]), queries: { available: true, queries } };
    const plan = buildScreenReads(nullable, ctx)[0];
    const source = plan === undefined ? '' : renderScreenTableBody(plan, 'x.md', TEST_BODY_MODULES).join('\n');

    expect(source).toContain('when(row.flag, (present) => present ? YES : NO)');
    expect(source).toContain('when(row.at, (present) => formatDateTime(present, timeZone))');
    expect(source).toContain('when(row.kind, (present) => workshopEnumLabels.kind[present])');
    expect(source).toContain('function when<T>');
  });
});

describe('詳細の本体', () => {
  /** 詳細の部品。 */
  function detailSource(shows?: readonly string[]): string {
    const component: ComponentInit = {
      name: 'workshop_summary',
      kind: 'detail',
      reads: 'query-workshop-detail',
      ...(shows === undefined ? {} : { shows }),
    };
    const plan = buildScreenReads(DOMAIN, context([component]))[0];
    if (plan === undefined) throw new Error('計画が導かれませんでした');
    return renderScreenDetailBody(plan, 'docs/specs/frontend/screens/workshop/workshop_detail.md', TEST_BODY_MODULES).join('\n');
  }

  it('shows の順に <dt>見出し</dt><dd>値</dd> を並べ、値の葉は部品の testid に {欄} を付ける', () => {
    const text = detailSource(['title', 'starts_at', 'state']);

    expect(text).toContain('<dl data-testid={TESTID} className={skin?.[KEY] ?? styles.screenDetail}>');
    expect(text.indexOf('workshopFieldLabels.title')).toBeLessThan(text.indexOf('workshopFieldLabels.starts_at'));
    expect(text).toContain('data-testid={`${TESTID}.starts_at`}');
    expect(text).toContain('formatDateTime(row.startsAt, timeZone)');
    expect(text).toContain('workshopStateLabels[row.state]');
    expect(text).toContain('readonly row: WorkshopListWorkshopSummaryRow;');
    expect(text).not.toContain('rows');
  });

  it('状態の項目は値の <dd> に data-state を出す(表と同じ。他の項目には付かない)', () => {
    const text = detailSource(['title', 'state']);

    expect(text).toContain('data-testid={`${TESTID}.state`} data-state={row.state} className={styles.screenDetailValue}');
    expect(text.split('data-state=')).toHaveLength(2);
  });

  it('省略すると id と ref を除く全欄・別クエリ由来の項目は出さない', () => {
    const text = detailSource();

    expect(text).toContain('workshopFieldLabels.title');
    expect(text).not.toContain('.id`');
  });
});

describe('葉の表・期待木・既定のスタイル', () => {
  const ctx = context(
    [table(), { name: 'workshop_summary', kind: 'detail', reads: 'query-workshop-detail', shows: ['title', 'state'] }],
    { navigations: [{ on: 'workshop_selected', to: 'screen-x' }] },
  );

  it('表の葉は empty / row / columns(column.{欄})・詳細の葉は項目(操作もフォームの欄も持たない)', () => {
    const text = screenRoutesGenerator.generate(DOMAIN, ctx)[0]?.content ?? '';

    expect(text).toContain("empty: 'empty'");
    expect(text).toContain("row: 'row'");
    expect(text).toContain("'column.title'");
    expect(text).toContain("'column.venue.name'");
    expect(text).toContain("fields: ['title', 'state']");
    expect(text).not.toContain("error: '");
  });

  it('生成物の期待木に表・詳細が載り、既定のスタイルと競合の表示の部品は 1 枚ずつだけ', () => {
    const { generated } = screenExpectations(DOMAIN, ctx);

    expect(generated.map((entry) => entry.file)).toEqual([
      'src/app/_screens/generated/workshop_list.workshop_table.tsx',
      'src/app/_screens/generated/workshop_list.workshop_summary.tsx',
      'src/app/_screens/generated/default.module.css',
      'src/app/_screens/generated/form-conflict.tsx',
    ]);
  });

  it('生成器は表だけ・詳細だけを書き、既定のスタイルと競合の表示の部品はフォームの生成器が 1 枚ずつだけ書く(表・詳細だけの画面でも)', () => {
    expect(screenTablesGenerator.generate(DOMAIN, ctx).map((section) => section.file)).toEqual([
      'app/src/app/_screens/generated/workshop_list.workshop_table.tsx',
    ]);
    expect(screenDetailsGenerator.generate(DOMAIN, ctx).map((section) => section.file)).toEqual([
      'app/src/app/_screens/generated/workshop_list.workshop_summary.tsx',
    ]);
    expect(screenFormsGenerator.generate(DOMAIN, ctx).map((section) => section.file)).toEqual([
      'app/src/app/_screens/generated/default.module.css',
      'app/src/app/_screens/generated/form-conflict.tsx',
    ]);
  });

  it('部品が 1 つも無ければ何も書かない(置き場そのものが存在しないのが基準線)', () => {
    const empty = context(['plain_part']);

    expect(screenTablesGenerator.generate(DOMAIN, empty)).toEqual([]);
    expect(screenDetailsGenerator.generate(DOMAIN, empty)).toEqual([]);
    expect(screenFormsGenerator.generate(DOMAIN, empty)).toEqual([]);
    expect(screenTablesGenerator.generate(DOMAIN, { guards: createGuardServices(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES })).toEqual([]);
  });

  it('既定のスタイルは表・詳細のクラスを持ち、値はトークンだけを引く', () => {
    const css = renderScreenDefaultCss();

    for (const name of ['screenTableWrap', 'screenTable', 'screenTableHead', 'screenTableCell', 'screenTableCellNumeric', 'screenTableLink', 'screenTableEmpty', 'screenDetail', 'screenDetailRow', 'screenDetailTerm', 'screenDetailValue']) {
      expect(css).toContain(`.${name} {`);
    }
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b\d+px\b/);
  });
});

describe('画面の部品の生成物の置き場は置き場の配置から引く(Next.js と綴りの重ならない架空の配置)', () => {
  const base = context(
    [
      { name: 'workshop_table', kind: 'table', reads: 'query-workshop-list', shows: ['title', 'state'] },
      { name: 'workshop_summary', kind: 'detail', reads: 'query-workshop-detail', shows: ['title', 'state'] },
    ],
    { navigations: [{ on: 'workshop_selected', to: 'screen-x' }] },
  );
  const foreign: GenerateContext = { ...base, layout: FOREIGN_LAYOUT, roots: { ...FOREIGN_ROOTS, app: 'app' } };

  it('表・詳細・フォームの生成器の書き先と、期待の木は、配置の画面の部品の役割(製品の根からの相対 / リポジトリルート相対)になる', () => {
    expect(screenTablesGenerator.generate(DOMAIN, foreign).map((section) => section.file)).toEqual(['app/server_code/ui/parts/workshop_list.workshop_table.tsx']);
    expect(screenDetailsGenerator.generate(DOMAIN, foreign).map((section) => section.file)).toEqual(['app/server_code/ui/parts/workshop_list.workshop_summary.tsx']);
    expect(screenFormsGenerator.generate(DOMAIN, foreign).map((section) => section.file)).toEqual([
      'app/server_code/ui/parts/default.module.css',
      'app/server_code/ui/parts/form-conflict.tsx',
    ]);
    expect(screenExpectations(DOMAIN, foreign).generated.map((entry) => entry.file)).toEqual([
      'server_code/ui/parts/workshop_list.workshop_table.tsx',
      'server_code/ui/parts/workshop_list.workshop_summary.tsx',
      'server_code/ui/parts/default.module.css',
      'server_code/ui/parts/form-conflict.tsx',
    ]);
  });

  it('書き先にも期待の木にも、Next.js の画面の部品の綴り(src/app・_screens)が 1 つも出ない', () => {
    const paths = [
      ...screenTablesGenerator.generate(DOMAIN, foreign),
      ...screenDetailsGenerator.generate(DOMAIN, foreign),
      ...screenFormsGenerator.generate(DOMAIN, foreign),
    ].map((section) => section.file);
    paths.push(...screenExpectations(DOMAIN, foreign).generated.map((entry) => entry.file));

    expect(paths.filter((path) => leaksNextjsEntrySpelling(path))).toEqual([]);
  });

  it('実装の木を持たない製品は置き場が無いので何も出さない(期待の木の生成物も空。生成器と同じ線)', () => {
    const noApp: GenerateContext = { ...base, roots: { ...TEST_ROOTS, app: null } };

    expect(screenTablesGenerator.generate(DOMAIN, noApp)).toEqual([]);
    expect(screenDetailsGenerator.generate(DOMAIN, noApp)).toEqual([]);
    expect(screenFormsGenerator.generate(DOMAIN, noApp)).toEqual([]);
    expect(screenExpectations(DOMAIN, noApp).generated).toEqual([]);
  });

  it('実装の木があるのに配置が画面の部品を決められなければ、黙って 0 本にせず、実際に止める検査(配置の定義の検査)を名指して止める(S7 は screen-part を読まない)', () => {
    const undecided: GenerateContext = { ...base, layout: EMPTY_LAYOUT };

    for (const generate of [
      () => screenTablesGenerator.generate(DOMAIN, undecided),
      () => screenDetailsGenerator.generate(DOMAIN, undecided),
      () => screenFormsGenerator.generate(DOMAIN, undecided),
      () => screenExpectations(DOMAIN, undecided),
    ]) {
      try {
        generate();
        throw new Error('止まるはず');
      } catch (error) {
        expect(error).toBeInstanceOf(GeneratorPreconditionError);
        const findings = error instanceof GeneratorPreconditionError ? error.findings : [];
        expect(findings[0]?.verifier).toBe('配置の定義の検査');
        expect(findings[0]?.message).toContain('役割 screen-part');
        expect(findings[0]?.suggestion).toContain('配置の定義の検査(`layoutDefinitionProblems`。役割ごとの下限・基準・キーの形。選ぶ根の 1 回)が、配置に無い役割・基準が辿れない配置を先に止める');
        expect(findings[0]?.suggestion).not.toContain('S7');
      }
    }
  });
  it('画面の部品の出どころは画面の仕様の位置。計画の画面が仕様に無ければ、画面名をファイル扱いの位置に置き換えず前提の失敗で止める', () => {
    const screens = new Map([['workshop_list', { location: { file: 'docs/specs/frontend/screens/x/workshop_list.md' } }]]);

    expect(screenPartOriginOf(base, screens, { screen: 'workshop_list', file: 'workshop_list.workshop_table.tsx' }, '部品', 'S18')).toEqual({
      what: '画面 workshop_list の部品 workshop_list.workshop_table.tsx',
      location: { file: 'docs/specs/frontend/screens/x/workshop_list.md' },
    });
    try {
      screenPartOriginOf(base, screens, { screen: 'ghost', file: 'ghost.t.tsx' }, 'フォーム', 'S17');
      throw new Error('止まるはず');
    } catch (error) {
      expect(error).toBeInstanceOf(GeneratorPreconditionError);
      const findings = error instanceof GeneratorPreconditionError ? error.findings : [];
      expect(findings[0]?.verifier).toBe('S17');
      expect(findings[0]?.message).toContain('画面 ghost のフォーム ghost.t.tsx の計画があるのに');
      expect(findings[0]?.location).toEqual({ file: 'docs/specs/frontend/screens' });
    }
  });
});
