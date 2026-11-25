/**
 * 仕様が書く生の SQL 断片と識別子の文法(`lib/model/sql-fragment.ts`)の単体テスト。
 *
 * 現行の製品と 6 題材が書いている形は全部通り、迂回(文の区切り・コメント・`$$`・副問い合わせ・危険な関数・文字列の接頭辞)は通らない。
 */

import { describe, expect, it } from 'vitest';
import { firesProblem, identifierProblem, offsetProblem, patternProblem, qualifiedIdentifierProblem, sqlFragmentProblem, typeNameProblem } from '../../../lib/model/sql-fragment.js';

describe('sqlFragmentProblem', () => {
  it.each([
    ["is_fee_bearer = true"],
    ["state = 'issued'"],
    ["(state <> ALL (ARRAY['collected'::text, 'cancelled'::text]))"],
    ["source_ref is not null"],
    ["char_length(title) <= 200"],
    ["((kind = 'receipt'::text) AND (quantity > 0)) OR ((kind = 'issue'::text) AND (quantity < 0)) OR (kind = 'count'::text)"],
    ["replace((gen_random_uuid())::text, '-'::text, ''::text)"],
    ["translate(encode(gen_random_bytes(32), 'base64'::text), '+/='::text, '-_'::text)"],
    ["(now() + '14 days'::interval)"],
    ["500"],
    ["x::uuid"],
    ["x::text[]"],
    ["x::varchar"],
    ["x::varchar(10)"],
    ["x::numeric(10, 2)"],
    ["(x)::timestamptz"],
    ["x in (1, 2)"],
    ["x = any (array[1, 2])"],
    ["false"],
  ])('%s は通す', (text) => {
    expect(sqlFragmentProblem(text)).toBeNull();
  });

  it.each([
    ['true) ; drop table public.users ; --'],
    ['true) -- comment'],
    ['x /* c */'],
    ["x = 'a$$b'"],
    ['x = $1'],
    ['x = $tag$y$tag$'],
    ['x = "col"'],
    ["E'\\x41' = x"],
    ["x in (select id from users)"],
    ["pg_sleep(10) is null"],
    ['pg_sleep (10) is null'],
    ['pg_sleep\t(10) is null'],
    ['pg_sleep\n(10) is null'],
    ['pg_catalog.pg_sleep(10) is null'],
    ['pg_catalog.pg_sleep (10) is null'],
    ['public.f() > 0'],
    ['x::regprocedure'],
    ['x::regproc'],
    ['x::regoper'],
    ["'a'::pg_catalog.text"],
    ['x::"text"'],
    ['x::'],
    ["lo_import('/etc/passwd') > 0"],
    ["set_config('a', 'b', true) = 'b'"],
    ["x = 1 union select 2"],
    ['(x = 1'],
    ['x = 1)'],
    ["x = 'unterminated"],
    ['x = 1 ; y = 2'],
    ['x\\y'],
    [''],
    ['a'.repeat(600)],
  ])('%j は拒む', (text) => {
    expect(sqlFragmentProblem(text)).not.toBeNull();
  });
});

describe('nextval と regclass', () => {
  const declared = new Set(['bookings_reference_seq']);
  const defaultValue = "('BK-'::text || lpad((nextval('bookings_reference_seq'::regclass))::text, 8, '0'::text))";

  it('defaults が宣言した採番の器を名指す形だけ通す', () => {
    expect(sqlFragmentProblem(defaultValue, declared)).toBeNull();
  });

  it.each([
    ["nextval('other_seq'::regclass)"],
    ["nextval('bookings_reference_seq')"],
    ["nextval('pg_catalog.pg_class'::regclass)"],
    ["nextval(x::regclass)"],
    ["'pg_sleep'::regclass"],
    ["x = 'a'::regclass"],
  ])('宣言した名前でなければ拒む: %s', (text) => {
    expect(sqlFragmentProblem(text, declared)).not.toBeNull();
  });

  it('where / rule(採番の器を渡さない書き方)には nextval も ::regclass も書けない', () => {
    expect(sqlFragmentProblem(defaultValue)).not.toBeNull();
    expect(sqlFragmentProblem("nextval('bookings_reference_seq'::regclass) > 0")).not.toBeNull();
  });
});

describe('識別子・参照先・型名・発火・幅・正規表現', () => {
  it('識別子は小文字・数字・_', () => {
    expect(identifierProblem('rooms_name_idx')).toBeNull();
    for (const bad of ['Rooms', 'a b', 'a;b', 'a-b', '1a', '', 'a"b']) expect(identifierProblem(bad), bad).not.toBeNull();
  });

  it('参照先は 名前 か スキーマ.名前', () => {
    for (const ok of ['departments', 'auth.users']) expect(qualifiedIdentifierProblem(ok), ok).toBeNull();
    for (const bad of ['departments; drop table x', 'a.b.c', 'a(b)']) expect(qualifiedIdentifierProblem(bad), bad).not.toBeNull();
  });

  it('型名', () => {
    for (const ok of ['uuid', 'text[]', 'timestamptz', 'numeric(10,2)']) expect(typeNameProblem(ok), ok).toBeNull();
    for (const bad of ['uuid); drop table x; --', 'text[];', 'a"b']) expect(typeNameProblem(bad), bad).not.toBeNull();
  });

  it.each([
    ['before insert or update of checked on item_checks'],
    ['before insert'],
    ['after insert or update (constraint trigger, deferrable initially deferred)'],
    ['after update of is_staff (constraint trigger, deferrable initially deferred)'],
  ])('fires %s は通す', (text) => {
    expect(firesProblem(text)).toBeNull();
  });

  // 点検 20 回目 C20-7: 条件(when (…))は書けるが、字は識別子・比較・括弧 1 段だけ(文字列・`;`・`$` は拒む)。生成器は条件を SQL に出さない。
  it.each([['after update of is_staff when (old.is_staff is true and new.is_staff is not true) (constraint trigger)'], ['before update when ((old.a <> new.a) or (old.b is null))'], ['before insert when (true)']])('fires %j は通す', (text) => {
    expect(firesProblem(text)).toBeNull();
  });

  it.each([['before insert on t; drop table x; --'], ["before insert when (new.a = 'x')"], ['before insert when (true); drop table x'], ['before insert when (((true)))'], ['before insert execute function evil()'], ['before insert or update (x$$)']])('fires %j は拒む', (text) => {
    expect(firesProblem(text)).not.toBeNull();
  });

  it('offset は {±n} {minute|hour|day}', () => {
    for (const ok of ['-14 days', '3 days', '-1 day', '1 hour']) expect(offsetProblem(ok), ok).toBeNull();
    for (const bad of ["1 day'; drop table x; --", '1 week', 'now()']) expect(offsetProblem(bad), bad).not.toBeNull();
  });

  it('正規表現は $$ だけを拒む(末尾の $ は通す)', () => {
    expect(patternProblem('^[a-z0-9-]+$')).toBeNull();
    expect(patternProblem('^x$$ ; do $$ begin null; end $$')).not.toBeNull();
  });
});
