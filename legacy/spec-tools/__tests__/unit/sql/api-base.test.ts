/**
 * api スキーマの土台(`api-base.ts`)のユニットテスト。
 *
 * 規約網羅(ARCH-SP-BE-0001 §テーブル仕様 §api スキーマの土台 / migrations.md §生成 migration):
 *   - 生成物であることの目印と、正の在りかが先頭に出る
 *   - スキーマは `if not exists`・関数は `create or replace`(**冪等**であること)
 *   - 呼び出し主体を解決する関数が 2 本・ログインセッションの生死を答える関数が 1 本あり、権限が付く
 *   - アプリの語彙を 1 語も持たない(どのアプリでも同じ 1 枚である)
 */

import { FOREIGN_PLATFORM, leaksSupabaseSpelling, TEST_PLATFORM } from '../../helpers/platform.js';
import { describe, expect, it } from 'vitest';
import { apiBaseFunctions, buildApiBaseMigration } from '../../../lib/sql/api-base.js';

const sql = buildApiBaseMigration(TEST_PLATFORM);

describe('api スキーマの土台', () => {
  it('生成物であることの目印が先頭に出る', () => {
    expect(sql.startsWith('-- AUTO-GENERATED')).toBe(true);
    expect(sql).toContain('api_base_migration');
  });

  it('スキーマは if not exists で作り、使用権を 3 つの DB ロールに与える', () => {
    expect(sql).toContain('create schema if not exists api;');
    expect(sql).toContain('grant usage on schema api to anon, authenticated, service_role;');
  });

  it('呼び出し主体を解決する 2 本が create or replace で出る(何度流しても同じ)', () => {
    expect(sql).toContain('create or replace function api.actor_id() returns uuid');
    expect(sql).toContain('select auth.uid();');
    expect(sql).toContain('create or replace function api.is_end_user() returns boolean');
    expect(sql).toContain("select current_user in ('anon', 'authenticated');");
    expect(sql).not.toContain('create function');
  });

  it('ログインセッションの生死を答える関数が、持ち主の権限・空の search_path で出る(呼び出し主体が読めない表を読むため)', () => {
    const block = sql.slice(sql.indexOf('create or replace function api.session_alive()'));
    expect(block.split('$$;')[0]).toBe(
      [
        'create or replace function api.session_alive() returns boolean',
        'language sql',
        'stable',
        'security definer',
        "set search_path = ''",
        'as $$',
        `    select ${TEST_PLATFORM.sessionAliveExpr};`,
        '',
      ].join('\n'),
    );
  });

  it('生死の式は識別子の無い呼び出しを偽にする(欠けたら閉じる)', () => {
    // Supabase の式: 識別子が null なら比較は偽になり、行は 1 本も見つからない。
    expect(TEST_PLATFORM.sessionAliveExpr).toContain("nullif(auth.jwt() ->> 'session_id', '')");
    expect(TEST_PLATFORM.sessionAliveExpr).toMatch(/^exists \(select 1 from auth\.sessions /);
    expect(TEST_PLATFORM.sessionAliveExpr).toContain('s.not_after is null or s.not_after > now()');
  });

  it('持ち主の権限で実行するのは生死の関数だけで、実行者の解決の 2 本は呼び出し主体の権限のまま', () => {
    expect(apiBaseFunctions(TEST_PLATFORM).map((fn) => [fn.name, fn.definer])).toEqual([
      ['actor_id', false],
      ['is_end_user', false],
      ['session_alive', true],
    ]);
    expect(sql.match(/security definer/g)).toHaveLength(1);
  });

  it('関数の権限は public から剥がして 3 つの DB ロールに与える', () => {
    for (const name of ['actor_id', 'is_end_user', 'session_alive']) {
      expect(sql).toContain(`revoke all on function api.${name}() from public;`);
      expect(sql).toContain(`grant execute on function api.${name}() to anon, authenticated, service_role;`);
    }
  });

  it('説明が付く(制約でも列でもない関数の由来を残す)', () => {
    expect(sql).toContain('comment on function api.actor_id() is ');
    expect(sql).toContain('comment on function api.is_end_user() is ');
    expect(sql).toContain('comment on function api.session_alive() is ');
  });
});

describe('別のプラットフォームの設定を渡すと(SQL を書く側は設定の中身を知らない)', () => {
  const foreign = buildApiBaseMigration(FOREIGN_PLATFORM);

  it('スキーマ・ロール名・現在の実行者の式が全部設定から引かれる', () => {
    expect(foreign).toContain('create schema if not exists edge;');
    expect(foreign).toContain('grant usage on schema edge to visitor, signed_in, worker;');
    expect(foreign).toContain('create or replace function edge.actor_id() returns uuid');
    expect(foreign).toContain('select ctx.actor_id();');
    expect(foreign).toContain("select current_user in ('visitor', 'signed_in');");
    expect(foreign).toContain('grant execute on function edge.is_end_user() to visitor, signed_in, worker;');
    expect(foreign).toContain('create or replace function edge.session_alive() returns boolean');
    expect(foreign).toContain('select ctx.session_valid();');
    expect(foreign).toContain("set search_path = ''");
  });

  it('Supabase の綴りが 1 つも残らない', () => {
    expect(leaksSupabaseSpelling(foreign)).toBe(false);
    expect(leaksSupabaseSpelling(sql)).toBe(true);
  });
});

