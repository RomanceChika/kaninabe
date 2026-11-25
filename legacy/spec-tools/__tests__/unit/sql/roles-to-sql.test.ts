/**
 * ロール(`by`)→ SQL 述語の翻訳(lib/sql/roles-to-sql.ts)。
 *
 * 3 種の根拠(セッション / 実行者自身の行の欄 / 対象の行との関係)がそれぞれどの字面に
 * 落ちるかを固定する。実 DB との一致は差分テスト
 * (`legacy/spec-tools/__tests__/guarantees/guard-sql-parity.integration.test.ts`)が見る。
 */

import { describe, expect, it } from 'vitest';
import type { RoleDef } from '../../../lib/model/types.js';
import type { ValueKind } from '../../../lib/model/field-values.js';
import { rolesToSql, type RoleSqlBindings } from '../../../lib/sql/roles-to-sql.js';

const location = { file: 'docs/specs/domain/roles.md' };

const roles: readonly RoleDef[] = [
  { id: 'anonymous', kind: 'anonymous', location },
  { id: 'member', kind: 'authenticated_default', location },
  { id: 'staff', claim: 'member.is_staff', implies: ['member'], location },
  { id: 'entry_owner', binding: 'entry.owner_id == actor.id', location },
  { id: 'organizer', binding: 'workshop.organizer_id == actor.id', location },
  { id: 'host', binding: 'workshop.organizer_ids contains actor.id', location },
  { id: 'nowhere', binding: 'ghost.owner_id == actor.id', location },
];

/** binding に現れる欄の種別(呼び側が宣言する)。 */
const KINDS: Readonly<Record<string, ValueKind>> = {
  'entry.owner_id': 'opaque',
  'workshop.organizer_id': 'opaque',
  'workshop.organizer_ids': 'opaque',
};

const bindings: RoleSqlBindings = {
  actorId: 'p_actor_id',
  actorRoles: 'p_actor_roles',
  reach: (entity) => {
    if (entity === 'entry') return { kind: 'row', alias: 'entries' };
    if (entity === 'workshop') {
      return { kind: 'join', table: 'public.workshops', alias: 'c', on: 'c.id = entries.workshop_id' };
    }
    return null;
  },
  actorRow: (entity) => (entity === 'member' ? { table: 'public.members' } : null),
  valueKind: (path) => KINDS[path.segments.join('.')] ?? null,
};

/** 訳せた前提で SQL を取り出す。 */
function translate(by: readonly string[]): string {
  const result = rolesToSql(by, roles, bindings);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error([...result.unresolved, ...result.rejected].join(', '));
  return result.sql;
}

describe('rolesToSql — 3 種の根拠', () => {
  it('セッションから立つロールは実行者が渡すロール配列の中を見る', () => {
    expect(translate(['member'])).toBe("coalesce('member' = any(p_actor_roles), false)");
  });

  it('claim は実行者自身の行の欄を EXISTS で見る', () => {
    expect(translate(['staff'])).toBe(
      'exists (select 1 from public.members a where a.id = p_actor_id and a.is_staff)',
    );
  });

  it('1 段の束縛は対象の行の列と実行者 id の比較になる', () => {
    expect(translate(['entry_owner'])).toBe('coalesce(((entries.owner_id) = (p_actor_id)), false)');
  });

  it('2 段の束縛は EXISTS で辿る(既存の手書き RLS と同じ形。字面は coalesce のぶん違う)', () => {
    expect(translate(['organizer'])).toBe(
      'exists (select 1 from public.workshops c where c.id = entries.workshop_id ' +
        'and coalesce(((c.organizer_id) = (p_actor_id)), false))',
    );
  });

  it('contains の束縛は配列メンバーシップになる(呼び側に口を開けない 1 形)', () => {
    expect(translate(['host'])).toBe(
      'exists (select 1 from public.workshops c where c.id = entries.workshop_id ' +
        'and coalesce((p_actor_id = any(c.organizer_ids)), false))',
    );
  });

  it('複数のロールは宣言順の論理和になる', () => {
    expect(translate(['staff', 'entry_owner'])).toBe(
      '(exists (select 1 from public.members a where a.id = p_actor_id and a.is_staff)' +
        ' or coalesce(((entries.owner_id) = (p_actor_id)), false))',
    );
  });
});

describe('rolesToSql — 写せないとき', () => {
  it('空の by は誰も通さない', () => {
    expect(rolesToSql([], roles, bindings)).toEqual({ ok: true, sql: 'false' });
  });

  it('知らないロールは throw せず名前で返る', () => {
    expect(rolesToSql(['ghost'], roles, bindings)).toEqual({
      ok: false,
      unresolved: ['role:ghost'],
      rejected: [],
    });
  });

  it('届き方が分からないエンティティの束縛は写せない', () => {
    expect(rolesToSql(['nowhere'], roles, bindings)).toEqual({
      ok: false,
      unresolved: ['binding:nowhere'],
      rejected: [],
    });
  });

  it('claim の相手の表が分からなければ写せない', () => {
    const orphan: readonly RoleDef[] = [{ id: 'x', claim: 'ghost.flag', location }];
    expect(rolesToSql(['x'], orphan, bindings)).toEqual({
      ok: false,
      unresolved: ['claim:x'],
      rejected: [],
    });
  });

  it('実行者の属性(actor.{id 以外})を対象の行の列に化けさせない', () => {
    const tenant: readonly RoleDef[] = [
      { id: 'tenant', binding: 'store.company_id == actor.company_id', location },
    ];
    const result = rolesToSql(['tenant'], tenant, {
      ...bindings,
      reach: () => ({ kind: 'row', alias: 'stores' }),
      valueKind: () => 'opaque',
    });
    expect(result).toEqual({
      ok: false,
      unresolved: ['binding:tenant:actor.company_id'],
      rejected: [],
    });
  });
});
