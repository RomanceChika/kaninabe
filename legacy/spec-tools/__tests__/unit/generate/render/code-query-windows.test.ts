/**
 * code-query-windows(query_spec + binding → スコープ条件の宣言表)のユニットテスト。
 *
 * 生成物はクエリの写像が唯一適用する条件表であり、間違えれば「宣言より広い集合が返る」に
 * 直結する。ここで固定するのは binding → 列パスの写し方 —— 自エンティティ・主キーへの
 * 畳み込み・context を辿る埋め込み・併読の接頭辞の 4 通りである。
 */

import { describe, expect, it } from 'vitest';
import { queryWindowsGenerator } from '../../../../lib/generate/render/code-query-windows.js';
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

/** roles.md 相当(スコープ条件を供給する関係ロール 3 種)。 */
const ROLES = roleSpec([
  role('member'),
  role('entry_owner', 'entry.owner_id == actor.id', ['member']),
  role('organizer', 'workshop.organizer_id == actor.id', ['member']),
  role('account_owner', 'member.id == actor.id', ['member']),
]);

/** entry / workshop / invitation の 3 集約(context の解決パスだけが要る)。 */
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
    aggregate('invitation', {
      entity: entitySpec('invitation', { context: { member: 'invitation.issued_by' } }),
      access: accessSpec('invitation'),
    }),
  ],
  ROLES,
);

/** 生成本文を 1 つだけ取り出す短縮形。 */
function render(queries: readonly QuerySpec[]): string {
  const sections = queryWindowsGenerator.generate(DOMAIN, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    guards: createGuardServices(),
    queries: { available: true, queries },
  });
  expect(sections).toHaveLength(1);
  return sections[0]?.content ?? '';
}

describe('code-query-windows', () => {
  it('自エンティティの binding はそのまま列になる', () => {
    const content = render([
      querySpec({ name: 'entry_own_list', source: 'entry', for: ['member'], scopeUsed: 'own', via: 'entry_owner' }),
    ]);

    expect(content).toContain("table: 'entries'");
    expect(content).toContain("window: ['owner_id']");
  });

  it('context を辿る binding は埋め込みのパスになる', () => {
    const content = render([
      querySpec({
        name: 'entry_organizer_list',
        source: 'entry',
        for: ['member'],
        scopeUsed: 'context(workshop)',
        via: 'organizer',
      }),
    ]);

    expect(content).toContain("window: ['workshops.organizer_id']");
  });

  it('相手の主キーに対する binding は手前の外部キー列に畳む', () => {
    const content = render([
      querySpec({
        name: 'invitation_self',
        source: 'invitation',
        for: ['member'],
        scopeUsed: 'own',
        via: 'account_owner',
      }),
    ]);

    // member.id == actor.id を辿らず、invitation.issued_by で同じ集合になる。
    expect(content).toContain("window: ['issued_by']");
  });

  it('併読のスコープ条件は併読先のテーブル名を接頭辞に持つ', () => {
    const content = render([
      querySpec({
        name: 'workshop_detail',
        source: 'workshop',
        for: ['member'],
        scopeUsed: 'all',
        includes: [
          { entity: 'entry', scopeUsed: 'own', via: 'entry_owner', projection: ['id'] },
          { entity: 'entry_participant', scopeUsed: 'own', via: 'entry_owner', projection: ['id'] },
        ],
      }),
    ]);

    expect(content).toContain("'entries.owner_id'");
    expect(content).toContain("'entry_participants.entries.owner_id'");
  });

  it('actor を参照する filters はスコープ条件と別の配列に出る', () => {
    const content = render([
      querySpec({
        name: 'entry_organizer_draft_list',
        source: 'entry',
        for: ['member'],
        scopeUsed: 'context(workshop)',
        via: 'organizer',
        filters: ['owner_id == actor.id', 'state == draft'],
      }),
    ]);

    expect(content).toContain("window: ['workshops.organizer_id']");
    // 「自分が用意した下書きだけ」は UX の取捨選択であってスコープ条件ではない(消しても可視性は変わらない)。
    expect(content).toContain("actorFilters: ['owner_id']");
  });

  it('via も actor 参照の filters も無いクエリは条件を持たない', () => {
    const content = render([
      querySpec({ name: 'workshop_list', source: 'workshop', for: ['member'], scopeUsed: 'all' }),
    ]);

    expect(content).toContain('window: []');
    expect(content).toContain('actorFilters: []');
    expect(content).toContain('paramConditions: []');
  });

  it('併読の filters が == param.{name} の形なら paramConditions に併読先の接頭辞つきで出る', () => {
    const content = render([
      querySpec({
        name: 'entry_organizer_list',
        source: 'entry',
        for: ['member'],
        scopeUsed: 'context(workshop)',
        via: 'organizer',
        params: [{ name: 'workshop_id', ref: 'entry.workshop_id' }],
        includes: [
          {
            entity: 'entry_participant',
            scopeUsed: 'context(workshop)',
            via: 'organizer',
            filters: ['workshop_id == param.workshop_id'],
            projection: ['id'],
          },
        ],
      }),
    ]);

    expect(content).toContain("column: 'entry_participants.workshop_id'");
    expect(content).toContain("param: 'workshop_id'");
    // param 条件はスコープ条件でも actor 参照の filters でもない(別の配列)。
    expect(content).toContain('actorFilters: []');
  });

  it('source 自身の == param.{name} は paramConditions に出さない(配線の主引数そのもの)', () => {
    const content = render([
      querySpec({
        name: 'entry_own_list',
        source: 'entry',
        for: ['member'],
        scopeUsed: 'own',
        via: 'entry_owner',
        params: [{ name: 'workshop_id', ref: 'entry.workshop_id' }],
        filters: ['workshop_id == param.workshop_id'],
      }),
    ]);

    expect(content).toContain('paramConditions: []');
  });

  it('query_spec が 1 件も無ければ何も生成しない', () => {
    expect(
      queryWindowsGenerator.generate(DOMAIN, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
        guards: createGuardServices(),
        queries: { available: true, queries: [] },
      }),
    ).toEqual([]);
  });
});
