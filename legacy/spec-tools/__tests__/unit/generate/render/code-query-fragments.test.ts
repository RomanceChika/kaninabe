/**
 * code-query-fragments(query_spec の projection・includes・sort・paging → select/order/limit)の
 * ユニットテスト。
 *
 * 生成物はクエリの写像が唯一使う select/order/limit の宣言表であり、間違えれば「宣言と違う列・
 * 並び・上限」に直結する。ここで固定するのは (1) 単純な projection → select の写し、
 * (2) via の binding が起点から 1 段先を指すときに足すスコープ条件サポートの内部結合(!inner)、
 * それが source 直下か includes の中かで足す位置が変わること、(3) includes の sort が
 * referencedTable つきで並ぶこと、(4) sort の nulls_first / nulls_last が nullsFirst に写ること、
 * (5) paging(limit / none)と returns: one(paging 無し)の扱いの 5 点である。
 */

import { describe, expect, it } from 'vitest';
import { queryFragmentsGenerator } from '../../../../lib/generate/render/code-query-fragments.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  role,
  roleSpec,
  specModel,
} from '../../../helpers/model-builder.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { querySpec } from '../../../helpers/query-builder.js';
import type { QuerySpec } from '../../../../lib/model/query/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** roles.md 相当(スコープ条件を供給する関係ロール 2 種)。code-query-windows.test.ts と同じ形。 */
const ROLES = roleSpec([
  role('member'),
  role('entry_owner', 'entry.owner_id == actor.id', ['member']),
  role('organizer', 'workshop.organizer_id == actor.id', ['member']),
]);

/** workshop / entry / entry_participant の 3 集約(context の解決パスだけが要る)。 */
const DOMAIN = specModel(
  [
    aggregate('workshop', {
      entity: entitySpec('workshop'),
      access: accessSpec('workshop'),
    }),
    aggregate('entry', {
      entity: entitySpec('entry', { context: { workshop: 'entry.workshop_id', entry: 'entry.id' } }),
      access: accessSpec('entry'),
    }),
    aggregate('entry_participant', {
      entity: entitySpec('entry_participant', {
        context: { entry: 'entry_participant.entry_id', workshop: 'entry_participant.workshop_id' },
      }),
      access: accessSpec('entry_participant'),
    }),
  ],
  ROLES,
);

/** 生成本文を 1 つだけ取り出す短縮形。 */
function render(queries: readonly QuerySpec[]): string {
  const sections = queryFragmentsGenerator.generate(DOMAIN, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    guards: createGuardServices(),
    queries: { available: true, queries },
  });
  expect(sections).toHaveLength(1);
  return sections[0]?.content ?? '';
}

describe('code-query-fragments', () => {
  it('projection と sort と paging(limit)をそのまま select/order/limit に写す', () => {
    const content = render([
      querySpec({
        name: 'workshop_list',
        source: 'workshop',
        for: ['member'],
        scopeUsed: 'all',
        sort: [{ field: 'starts_at', direction: 'desc' }],
        paging: { kind: 'limit', max: 50 },
        projection: ['id', 'title'],
      }),
    ]);

    expect(content).toContain("select: 'id, title'");
    expect(content).toContain("column: 'starts_at'");
    expect(content).toContain('ascending: false');
    expect(content).toContain('limit: 50');
  });

  it('paging: none は limit を持たない', () => {
    const content = render([
      querySpec({
        name: 'entry_organizer_draft_list',
        source: 'entry',
        for: ['member'],
        scopeUsed: 'context(workshop)',
        via: 'organizer',
        paging: { kind: 'none' },
        projection: ['id'],
      }),
    ]);

    expect(content).not.toContain('limit:');
  });

  it('returns: one(paging 無し)も limit を持たない', () => {
    const content = render([
      querySpec({
        name: 'member_self',
        source: 'workshop',
        for: ['member'],
        scopeUsed: 'all',
        returns: 'one',
        projection: ['id'],
      }),
    ]);

    expect(content).not.toContain('limit:');
  });

  it('via の binding が起点から 1 段先(context 越し)を指すとき、source 直下にスコープ条件サポートの内部結合を足す', () => {
    const content = render([
      querySpec({
        name: 'entry_organizer_draft_list',
        source: 'entry',
        for: ['member'],
        scopeUsed: 'context(workshop)',
        via: 'organizer',
        paging: { kind: 'none' },
        projection: ['id', 'owner_id'],
      }),
    ]);

    // workshop.organizer_id == actor.id は entry から見て 1 段先(workshops テーブル)なので、
    // 返すためではなく絞るための !inner が select に混ざる。
    expect(content).toContain("select: 'id, owner_id, workshops!inner(organizer_id)'");
  });

  it('via の binding が起点自身の列を指すとき(0 段)は select を変えない', () => {
    const content = render([
      querySpec({
        name: 'entry_own_list',
        source: 'entry',
        for: ['member'],
        scopeUsed: 'own',
        via: 'entry_owner',
        paging: { kind: 'none' },
        projection: ['id'],
      }),
    ]);

    expect(content).toContain("select: 'id'");
  });

  it('includes のスコープ条件サポートは、その includes の埋め込みの中に足す(source 直下ではない)', () => {
    const content = render([
      querySpec({
        name: 'entry_organizer_list',
        source: 'entry',
        for: ['member'],
        scopeUsed: 'context(workshop)',
        via: 'organizer',
        paging: { kind: 'none' },
        projection: ['id'],
        includes: [
          {
            entity: 'entry_participant',
            scopeUsed: 'context(workshop)',
            via: 'organizer',
            projection: ['id'],
          },
        ],
      }),
    ]);

    expect(content).toContain(
      "select: 'id, workshops!inner(organizer_id), entry_participants(id, workshops!inner(organizer_id))'",
    );
  });

  it('includes の sort は referencedTable つきで、source の sort の後ろに並ぶ', () => {
    const content = render([
      querySpec({
        name: 'entry_organizer_list',
        source: 'entry',
        for: ['member'],
        scopeUsed: 'context(workshop)',
        via: 'organizer',
        paging: { kind: 'none' },
        sort: [{ field: 'created_at', direction: 'asc' }],
        projection: ['id'],
        includes: [
          {
            entity: 'entry_participant',
            scopeUsed: 'context(workshop)',
            via: 'organizer',
            projection: ['id'],
            sort: [{ field: 'created_at', direction: 'asc' }],
          },
        ],
      }),
    ]);

    const orderStart = content.indexOf('order: [');
    const orderEnd = content.indexOf(']', orderStart);
    const orderBlock = content.slice(orderStart, orderEnd);
    // source の created_at(referencedTable 無し)が先、includes の created_at(あり)が後。
    expect(orderBlock.indexOf("column: 'created_at',\n        ascending: true,\n      }")).toBeLessThan(
      orderBlock.indexOf("referencedTable: 'entry_participants'"),
    );
  });

  it('sort の nulls_last / nulls_first が nullsFirst: false / true に写る', () => {
    const content = render([
      querySpec({
        name: 'workshop_list',
        source: 'workshop',
        for: ['member'],
        scopeUsed: 'all',
        sort: [
          { field: 'order_index', direction: 'asc', nulls: 'last' },
          { field: 'slug', direction: 'asc', nulls: 'first' },
        ],
        paging: { kind: 'none' },
        projection: ['id'],
      }),
    ]);

    expect(content).toMatch(/column: 'order_index',\s*\n\s*ascending: true,\s*\n\s*nullsFirst: false,/);
    expect(content).toMatch(/column: 'slug',\s*\n\s*ascending: true,\s*\n\s*nullsFirst: true,/);
  });

  it('nulls を書かなければ nullsFirst キー自体を持たない(PostgREST の既定に委ねる)', () => {
    const content = render([
      querySpec({
        name: 'workshop_list',
        source: 'workshop',
        for: ['member'],
        scopeUsed: 'all',
        sort: [{ field: 'starts_at', direction: 'desc' }],
        paging: { kind: 'none' },
        projection: ['id'],
      }),
    ]);

    // 型宣言そのもの(`readonly nullsFirst?: boolean;`)ではなく、データの側に出ていないことを見る。
    const dataStart = content.indexOf('export const queryFragments');
    expect(content.slice(dataStart)).not.toContain('nullsFirst');
  });

  it('query_spec が 1 件も無ければ何も生成しない', () => {
    expect(
      queryFragmentsGenerator.generate(DOMAIN, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
        guards: createGuardServices(),
        queries: { available: true, queries: [] },
      }),
    ).toEqual([]);
  });
});
