/**
 * surface の migration(`lib/sql/api-migration.ts`)の隠し列の述語の字面(点検 3 回目 A3-5)。
 *
 * 述語は面のロールから直接呼べる(ビューは security_invoker なので、述語の実行権限を外すとビューが読めない)。定義者の権限で
 * 評価すると、親の状態を読む述語が RLS で見えない行の状態を探る口になる —— だから**呼び出した人の権限**で評価する。
 */

import { describe, expect, it } from 'vitest';
import { buildApiViewMigration } from '../../../lib/sql/api-migration.js';
import type { ApiMaskPlan, ApiViewPlan } from '../../../lib/sql/api-views.js';
import { TEST_PLATFORM } from '../../helpers/platform.js';

const MASK: ApiMaskPlan = {
  name: 'can_see_notes_body',
  column: 'body',
  visibleTo: ['owner'],
  predicate: "coalesce((((select r1.state from public.parents r1 where r1.id = rec.parent_id)) = 'open'), false)",
};

const PLAN: ApiViewPlan = {
  table: 'notes',
  entity: 'note',
  columns: [
    { name: 'id', mask: null },
    { name: 'body', mask: MASK },
  ],
  masks: [MASK],
};

/** 述語 1 本の定義(create から $$; まで)。 */
function maskDefinition(sql: string): string {
  const start = sql.indexOf('create or replace function api.can_see_notes_body');
  return sql.slice(start, sql.indexOf('$$;', start));
}

describe('隠し列の述語', () => {
  const sql = buildApiViewMigration({ plan: PLAN, internal: false, specFiles: [], platform: TEST_PLATFORM });

  it('呼び出した人の権限で評価する(security invoker)—— 定義者の権限では評価しない', () => {
    const definition = maskDefinition(sql);
    expect(definition).toContain('security invoker');
    expect(definition).not.toContain('security definer');
  });

  it('ビューから呼べるよう、面のロールの実行権限は残す(外すとビューを読めない)', () => {
    expect(sql).toContain('grant execute on function api.can_see_notes_body(public.notes) to anon, authenticated, service_role;');
  });

  it('ビューは security_invoker のまま、述語でマスクする', () => {
    expect(sql).toContain('create view api.notes with (security_invoker = true) as');
    expect(sql).toContain('case when not api.is_end_user() or api.can_see_notes_body(t) then t.body else null end as body');
  });
});
