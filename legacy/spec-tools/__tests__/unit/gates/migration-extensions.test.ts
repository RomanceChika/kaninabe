/**
 * migration の拡張の置き場(C23 の 3 つめの判定。点検 7 回目 A7-3)のテスト。
 *
 * 表: `create extension` / `alter extension … set schema` の綴りの揺れ(大文字・引用・注釈・複数行・`if not exists`・`version`・
 * `cascade`・`execute` の文字列)と、置き場(`extensions` / 省略 / `public` / `api`)と、置き場を固定する拡張(`pg_cron`)の組で、
 * 違反の種類を固定する。生成器の DDL(排他制約の `btree_gist`)がこの判定を通ることも見る(生成器と規則が食い違わない)。
 */

import { describe, expect, it } from 'vitest';
import { extensionViolations, formatExtensionViolations, stripComments } from '../../../lib/gates/migration-extensions.js';
import { buildDdlMigration } from '../../../lib/sql/ddl-migration.js';
import type { TableDdlPlan } from '../../../lib/sql/ddl-plan.js';

/** 違反の種類だけを並べる。 */
function kinds(sql: string): string[] {
  return extensionViolations('supabase/migrations/x.sql', sql).map((violation) => violation.kind);
}

describe('拡張の置き場は extensions だけ(許可表)', () => {
  it.each([
    // 正例
    ['with schema extensions → 通る', 'create extension if not exists btree_gist with schema extensions;', []],
    ['schema extensions(with を省く)→ 通る', 'create extension pgcrypto schema extensions;', []],
    ['大文字・複数行・引用した名前・version・cascade → 通る', 'CREATE EXTENSION IF NOT EXISTS\n  "uuid-ossp"\n  WITH SCHEMA "extensions" VERSION \'1.1\' CASCADE;', []],
    ['pg_cron は置き場を自分で決めるので省いてよい', 'create extension if not exists pg_cron;', []],
    ['pg_cron が自分の置き場を名指すのも通る', 'create extension pg_cron with schema pg_catalog;', []],
    ['alter extension の版上げ(置き場を動かさない)→ 通る', 'alter extension pgcrypto update to \'1.4\';', []],
    ['alter extension … set schema extensions → 通る', 'alter extension btree_gist set schema extensions;', []],
    ['注釈の中の create extension は数えない', '-- create extension http with schema api;\n/* create extension dblink; */\nselect 1;', []],
    ['拡張を作らない migration → 通る', 'create table public.t (id int);', []],
    // 負例(A7-3 の反例)
    ['api に置く → 赤', 'create extension if not exists http with schema api;', ['許可外のスキーマ']],
    ['public に置く → 赤', 'create extension dblink with schema public;', ['許可外のスキーマ']],
    ['スキーマを省く → 赤(search_path で public に入る。A7-4 の生成の旧い形)', 'create extension if not exists btree_gist;', ['スキーマ指定なし']],
    ['pg_net もスキーマを省けない(置き場を固定しない)', 'create extension if not exists pg_net;', ['スキーマ指定なし']],
    ['pg_cron でも api を名指すのは赤', 'create extension pg_cron with schema api;', ['許可外のスキーマ']],
    ['大文字の SCHEMA API → 赤', 'CREATE EXTENSION http WITH SCHEMA API;', ['許可外のスキーマ']],
    ['引用した "api" → 赤', 'create extension http with schema "api";', ['許可外のスキーマ']],
    ['alter extension … set schema api → 赤(作った後で動かす)', 'alter extension pgcrypto set schema api;', ['許可外のスキーマ']],
    ['execute の文字列で組み立てる → 赤(読めない文)', "do $$ begin execute 'create extension http with schema api'; end $$;", ['読めない文']],
    ['名前の無い文 → 赤(読めない文)', 'create extension ;', ['読めない文']],
    ['知らない句 → 赤(読めない文)', 'create extension http from unpackaged;', ['読めない文']],
    ['1 本に 2 文 → 両方を見る', 'create extension pgcrypto with schema extensions;\ncreate extension http with schema api;', ['許可外のスキーマ']],
    ['境界: 末尾の ; が無くても読む', 'create extension http with schema api', ['許可外のスキーマ']],
    // 文字列・ドル引用の中の注釈の記号(A8-3 の反例。以前は正規表現の剥がしで同じ行・同じ塊の文が消えて緑だった)
    ["文字列の中の -- で同じ行の文が消えない → 赤", "comment on schema api is 'x -- y'; create extension http with schema api;", ['許可外のスキーマ']],
    ["文字列の中の /* を後ろの注釈の */ で閉じても文が消えない → 赤", "select '/*';\ncreate extension http with schema api;\n-- */", ['許可外のスキーマ']],
    ["'' のエスケープの後の -- も文字列の中 → 赤", "select 'it''s -- not a comment'; create extension dblink with schema public;", ['許可外のスキーマ']],
    ["E'…' の \\' の後の -- も文字列の中 → 赤", "select E'a\\' -- b'; create extension http with schema api;", ['許可外のスキーマ']],
    ['引用した識別子の中の -- も注釈ではない → 赤', 'create table "a--b" (id int); create extension http with schema api;', ['許可外のスキーマ']],
    ['ドル引用の中の文字列の -- も注釈ではない → 赤(読めない文)', "do $f$ begin perform 'x -- y'; execute 'create extension http with schema api'; end $f$;", ['読めない文']],
    ['ドル引用(関数の本文)の中の注釈は剥がす → 通る', 'create function f() returns void language plpgsql as $$ begin -- create extension http with schema api;\n null; end $$;', []],
    ['入れ子の塊の注釈は外側の */ まで → 通る', '/* outer /* inner */ create extension http with schema api; */ select 1;', []],
    ['境界: $1 は位置引数でドル引用ではない', "select $1 -- x\n; create extension http with schema api;", ['許可外のスキーマ']],
  ] as const)('%s', (_title, sql, expected) => {
    expect(kinds(sql)).toEqual(expected);
  });

  it.each([
    ['行注釈は空白 1 つ(改行は残る)', 'a -- x\nb', 'a  \nb'],
    ['塊の注釈は空白 1 つ', 'a/* x */b', 'a b'],
    ['文字列の中身は残す', "a 'x -- y' b", "a 'x -- y' b"],
    ['閉じない文字列は末尾まで中身(読み落とさない側)', "a 'x -- y", "a 'x -- y"],
    ['閉じない塊の注釈は末尾まで剥がす', 'a /* x', 'a  '],
    ['ドル引用の中の注釈は剥がし、タグは残す', '$t$ a -- x\n b $t$', '$t$ a  \n b $t$'],
  ] as const)('stripComments: %s', (_title, sql, expected) => {
    expect(stripComments(sql)).toBe(expected);
  });

  it('報告文は種類・ファイル・文と直し方の 2 行', () => {
    const lines = formatExtensionViolations(extensionViolations('supabase/migrations/a.sql', 'create extension http with schema api;'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('C23 拡張の置き場(許可外のスキーマ): supabase/migrations/a.sql: create extension http with schema api');
    expect(lines[1]).toContain('`extensions` に置く');
  });

  it('生成器の DDL(排他制約の btree_gist)はこの判定を通る(生成器と規則が食い違わない。A7-4)', () => {
    const plan: TableDdlPlan = {
      table: 'bookings',
      entity: 'booking',
      primaryKey: ['id'],
      columns: [{ name: 'id', type: 'uuid', notNull: true, default: 'gen_random_uuid()', identity: false, comment: null }],
      derivedChecks: [],
      declaredChecks: [],
      foreignKeys: [],
      indexes: [],
      exclusions: [{ name: 'bookings_room_slot_exclude', keys: ['room_id'], range: ['starts_at', 'ends_at'], where: null, invariant: 'INV-BOOKING-001' }],
      sequences: [],
      triggers: [],
      specFiles: ['docs/specs/domain/booking/entity.md'],
    };
    const sql = buildDdlMigration(plan);
    expect(sql).toContain('create extension');
    expect(extensionViolations('supabase/migrations/20990101000001_ddl_bookings.sql', sql)).toEqual([]);
  });
});
