/**
 * 生成する SQL の識別子の長さの検査(lib/sql/identifier-length.ts)のテスト。
 *
 * PostgreSQL は 63 バイトを超える識別子を**黙って切り詰める**。名前を与える文の種類ごとに、
 * 上限ちょうど(通る)と 1 バイト超え(止まる)を表で固定する。バイトは UTF-8 で数える。
 */

import { describe, expect, it } from 'vitest';
import {
  identifierProblems,
  longIdentifiers,
  MAX_IDENTIFIER_BYTES,
} from '../../../lib/sql/identifier-length.js';

/** n バイト(ASCII)の名前。 */
const name = (bytes: number): string => 'n'.repeat(bytes);

/** 名前を与える文の形(`{名前}` を差し込む)。 */
const STATEMENTS: readonly { readonly kind: string; readonly sql: (id: string) => string }[] = [
  { kind: 'policy', sql: (id) => `create policy ${id} on public.t for select to anon using (true);` },
  { kind: 'function', sql: (id) => `create or replace function public.${id}() returns boolean language sql as $$ select true $$;` },
  { kind: 'function', sql: (id) => `create function ${id}(a int) returns int language sql as $$ select a $$;` },
  { kind: 'trigger', sql: (id) => `create trigger ${id} before insert on public.t for each row execute function public.f();` },
  { kind: 'trigger', sql: (id) => `create constraint trigger ${id} after insert on public.t deferrable initially deferred for each row execute function public.f();` },
  { kind: 'index', sql: (id) => `create index ${id} on public.t (a);` },
  { kind: 'index', sql: (id) => `create unique index concurrently if not exists ${id} on public.t (a);` },
  { kind: 'table', sql: (id) => `create table public.${id} (id uuid primary key);` },
  { kind: 'table', sql: (id) => `create table if not exists ${id} (id uuid primary key);` },
  { kind: 'view', sql: (id) => `create or replace view api.${id} as select 1;` },
  { kind: 'type', sql: (id) => `create type public.${id} as enum ('a');` },
  { kind: 'sequence', sql: (id) => `create sequence if not exists public.${id};` },
  { kind: 'schema', sql: (id) => `create schema if not exists ${id};` },
  { kind: 'constraint', sql: (id) => `alter table public.t add constraint ${id} check (a > 0);` },
  { kind: 'function', sql: (id) => `create procedure public.${id}() language sql as $$ select 1 $$;` },
  { kind: 'domain', sql: (id) => `create domain public.${id} as text check (value <> '');` },
  { kind: 'role', sql: (id) => `create role ${id} nologin;` },
  { kind: 'table', sql: (id) => `create temp table ${id} (a int);` },
  { kind: 'table', sql: (id) => `create unlogged table if not exists public.${id} (a int);` },
  { kind: 'view', sql: (id) => `create or replace recursive view public.${id} (n) as select 1;` },
  { kind: 'view', sql: (id) => `create temporary view ${id} as select 1;` },
  { kind: 'column', sql: (id) => `alter table public.t add column ${id} int;` },
  { kind: 'column', sql: (id) => `alter table public.t add column if not exists ${id} int;` },
  { kind: 'column', sql: (id) => `alter table public.t add ${id} int;` },
  { kind: 'column', sql: (id) => `create table public.t (id uuid primary key, ${id} text not null, c numeric(10, 2));` },
  { kind: 'column', sql: (id) => `create table public.t (\n  ${id} text,\n  constraint ok_name check (${id.slice(0, 3)} in (1, 2))\n);` },
  { kind: 'rename', sql: (id) => `alter table public.t rename to ${id};` },
  { kind: 'rename', sql: (id) => `alter table public.t rename column a to ${id};` },
  { kind: 'rename', sql: (id) => `alter table public.t rename constraint a to ${id};` },
];

describe('longIdentifiers — 名前を与える文の種類ごとの境界(63 / 64 バイト)', () => {
  for (const { kind, sql } of STATEMENTS) {
    it(`${kind}: ちょうど 63 バイトは通り、64 バイトは止まる(${sql('N').slice(0, 40)}…)`, () => {
      expect(longIdentifiers(sql(name(MAX_IDENTIFIER_BYTES)))).toEqual([]);

      const found = longIdentifiers(sql(name(MAX_IDENTIFIER_BYTES + 1)));
      expect(found).toEqual([{ kind, name: name(64), bytes: 64 }]);
    });
  }

  it('列の定義の先頭の語が制約・複製のときは列の名前に数えない(長い制約名は constraint として数える)', () => {
    const sql = `create table public.t (id int, primary key (id), unique (id), check (id > 0), foreign key (id) references u (id), like v, constraint ${name(64)} check (id < 9));`;

    expect(longIdentifiers(sql)).toEqual([{ kind: 'constraint', name: name(64), bytes: 64 }]);
  });

  it('add の後ろが制約の語なら列の追加と読まない', () => {
    expect(longIdentifiers('alter table t add primary key (a); alter table t add unique (a); alter table t add check (a > 0);')).toEqual([]);
  });

  it('引用符つきの列名・\"\" の逃がしを数える(\"\" は引用符 1 文字 = 1 バイト)', () => {
    const inner = `${'q'.repeat(30)}""${'q'.repeat(31)}`; // 実体は 30 + 1 + 31 = 62 バイト
    expect(longIdentifiers(`alter table t add column "${inner}" int;`)).toEqual([]);

    const longer = `${'q'.repeat(30)}""${'q'.repeat(32)}`; // 63 バイト = 上限ちょうど
    expect(longIdentifiers(`alter table t add column "${longer}" int;`)).toEqual([]);

    const over = `${'q'.repeat(30)}""${'q'.repeat(33)}`; // 64 バイト
    expect(longIdentifiers(`alter table t add column "${over}" int;`)).toEqual([
      { kind: 'column', name: `${'q'.repeat(30)}"${'q'.repeat(33)}`, bytes: 64 },
    ]);
  });

  it('引用符つきの名前は引用符を外して数える', () => {
    expect(longIdentifiers(`create policy "${name(63)}" on t using (true);`)).toEqual([]);
    expect(longIdentifiers(`create policy "${name(64)}" on t using (true);`)).toHaveLength(1);
  });

  it('日本語の名前は 1 字 3 バイトで数える(21 字 = 63 バイトは通り、22 字は止まる)', () => {
    expect(longIdentifiers(`create policy "${'あ'.repeat(21)}" on t using (true);`)).toEqual([]);
    const found = longIdentifiers(`create policy "${'あ'.repeat(22)}" on t using (true);`);
    expect(found).toEqual([{ kind: 'policy', name: 'あ'.repeat(22), bytes: 66 }]);
  });

  it('スキーマ修飾は名前に数えない(修飾の部分が長くても、名前が 63 バイト以内なら通る)', () => {
    expect(longIdentifiers(`create function ${name(40)}.${name(63)}() returns int language sql as $$ select 1 $$;`)).toEqual([]);
  });

  it('コメント・文字列・ドル引用の本文の中の語は名前と読まない', () => {
    const sql = [
      `-- create policy ${name(80)} on t`,
      `/* create index ${name(80)} on t (a) */`,
      `comment on table t is 'create table ${name(80)} (a int)';`,
      `create function f() returns int language plpgsql as $body$ begin execute 'create policy ${name(80)} on t'; end $body$;`,
    ].join('\n');

    expect(longIdentifiers(sql)).toEqual([]);
  });

  it('文字列の中の -- や /* はコメントの始まりではない(その後ろの本物の定義を落とさない)', () => {
    const sql = `comment on table t is '-- not a comment /* nor this';\ncreate policy ${name(64)} on t using (true);`;

    expect(longIdentifiers(sql)).toEqual([{ kind: 'policy', name: name(64), bytes: 64 }]);
  });

  it('コメントの中の引用符・入れ子のブロックコメントを正しく読み飛ばす', () => {
    const sql = [
      `-- it's a comment with a quote and create policy ${name(70)} on t`,
      `/* outer /* nested create index ${name(70)} on t (a) */ still comment create table ${name(70)} (a int) */`,
      `create policy ${name(64)} on t using (true);`,
    ].join('\n');

    expect(longIdentifiers(sql)).toEqual([{ kind: 'policy', name: name(64), bytes: 64 }]);
  });

  it("文字列の中の '' の逃がし・E'' の逆スラッシュの逃がしを越えて読む", () => {
    const sql = `select 'it''s create policy ${name(70)} on t', E'x\\' create index ${name(70)} on t (a)';\ncreate index ${name(64)} on t (a);`;

    expect(longIdentifiers(sql)).toEqual([{ kind: 'index', name: name(64), bytes: 64 }]);
  });

  it('同じ種類の同じ名前は 1 件にまとめる(drop → create で 2 度出ても 1 件)', () => {
    const id = name(70);
    const sql = `create policy ${id} on t using (true);\ncreate policy ${id} on t using (true);`;

    expect(longIdentifiers(sql)).toHaveLength(1);
  });

  it('複数の超過は宣言順(種類の並び → 出現順)にすべて返す', () => {
    const sql = `create policy ${name(64)} on t using (true);\ncreate index ${name(65)} on t (a);`;

    expect(longIdentifiers(sql).map((entry) => [entry.kind, entry.bytes])).toEqual([
      ['policy', 64],
      ['index', 65],
    ]);
  });

  it('名前の無い文(大文字小文字の違い・空の本文)でも落ちない', () => {
    expect(longIdentifiers('')).toEqual([]);
    expect(longIdentifiers(`CREATE POLICY ${name(64)} ON T USING (TRUE);`)).toHaveLength(1);
  });
});

describe('identifierProblems — 指摘の 3 点セット', () => {
  it('何が・どう直すか・反例を返す', () => {
    const [problem] = identifierProblems(`create policy ${name(64)} on t using (true);`);

    expect(problem?.message).toContain('64 バイト');
    expect(problem?.message).toContain('黙って切り詰められ');
    expect(problem?.suggestion).toContain('短くする');
    expect(problem?.counterexample).toEqual({ kind: 'policy', name: name(64), bytes: '64' });
  });

  it('収まっていれば空', () => {
    expect(identifierProblems(`create policy ${name(63)} on t using (true);`)).toEqual([]);
  });
});
