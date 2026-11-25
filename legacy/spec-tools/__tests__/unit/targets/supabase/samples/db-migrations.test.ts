/**
 * 題材の生成 SQL を**依存順に並べ直す**ところの単体テスト(`lib/targets/supabase/samples/db-migrations.ts`)。
 *
 * ここが見るのは 1 つだけである: **宣言の連番ではなく、当てられる順序に並ぶこと**。
 * 4 題材の宣言では表の DDL が一番後ろに来るので、宣言の番号どおりに当てるとポリシーが
 * 「まだ無い表」に掛かって落ちる —— 通し実行が落ちる理由がそれになると、見たかったもの
 * (生成 SQL が空の DB に通るか)が見えない。
 */

import { describe, expect, it } from 'vitest';
import { orderMigrations } from '../../../../../lib/targets/supabase/samples/db-migrations.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

/** 宣言の番号が「表の DDL が最後」になっている、4 題材と同じ形の生成物。 */
function generated(): ReadonlyMap<string, string> {
  return new Map([
    ['supabase/migrations/20260911000000_api_base.sql', '-- api'],
    ['supabase/migrations/20260911000001_usecase_book_room_reserve.sql', '-- usecase'],
    ['supabase/migrations/20260912000002_inbound_payment_notice_webhook.sql', '-- inbound'],
    ['supabase/migrations/20260912100001_rpc_insert_booking.sql', '-- rpc'],
    ['supabase/migrations/20260912110001_helper_is_user.sql', '-- helper'],
    ['supabase/migrations/20260912110101_policies_bookings.sql', '-- policies'],
    ['supabase/migrations/20260912120201_ddl_users.sql', '-- ddl users'],
    ['supabase/migrations/20260912120204_ddl_bookings.sql', '-- ddl bookings'],
    ['app/src/domain/generated/booking.schema.ts', '// 生成 TS(SQL ではない)'],
  ]);
}

describe('題材の生成 SQL の並べ直し', () => {
  it('土台 → 表 → 補助関数 → ポリシー → RPC → 保存点 → 受信口 の順になる', () => {
    expect(orderMigrations(generated(), TEST_ROOTS).map(([file]) => file)).toEqual([
      'supabase/migrations/20260911000000_api_base.sql',
      'supabase/migrations/20260912120201_ddl_users.sql',
      'supabase/migrations/20260912120204_ddl_bookings.sql',
      'supabase/migrations/20260912110001_helper_is_user.sql',
      'supabase/migrations/20260912110101_policies_bookings.sql',
      'supabase/migrations/20260912100001_rpc_insert_booking.sql',
      'supabase/migrations/20260911000001_usecase_book_room_reserve.sql',
      'supabase/migrations/20260912000002_inbound_payment_notice_webhook.sql',
    ]);
  });

  it('表どうしの順序は宣言の番号のまま(外部キーの向きが番号で決まっている)', () => {
    const ddl = orderMigrations(generated(), TEST_ROOTS)
      .map(([file]) => file)
      .filter((file) => file.includes('_ddl_'));
    expect(ddl).toEqual([
      'supabase/migrations/20260912120201_ddl_users.sql',
      'supabase/migrations/20260912120204_ddl_bookings.sql',
    ]);
  });

  it('SQL でない生成物は 1 つも混ざらない', () => {
    expect(orderMigrations(generated(), TEST_ROOTS).every(([file]) => file.endsWith('.sql'))).toBe(true);
  });
});
