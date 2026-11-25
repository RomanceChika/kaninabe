/**
 * 枠を消費する RPC(`meter`)の本文の走査(`meter-body.ts`)のテスト。
 *
 * 本文は migration を名前順に読み、その関数を最後に定義した版を採る。役の述語(実行者の行の欄の条件)・実行者の行を読む表・最初の書き込みより前の
 * `raise exception`・消費が 1 文の原子的な更新、を表で固定する(正例は実物の本文と同じ形、負例は 1 つずつ壊した形)。
 */

import { describe, expect, it } from 'vitest';
import { latestFunctionBody, meterBodyProblems, normalizeSql } from '../../../lib/external/meter-body.js';
import type { ClaimParts } from '../../../lib/model/role-claim.js';

/** 役の述語: 有効メンバー(実行者の行の `state` が `active`)。 */
const MEMBER: ClaimParts = { entity: 'member', field: 'state', values: ['active'] };

/** boolean の欄の述語。 */
const STAFF: ClaimParts = { entity: 'member', field: 'is_staff', values: null };

/** 実行者の行を読む表。 */
const TABLE = (condition: ClaimParts): string | null => (condition.entity === 'member' ? 'members' : null);

/** 健全な本文(役の述語 → raise → 1 文の upsert)。 */
const GOOD = `
begin
    if not exists (
        select 1 from public.members a where a.id = p_member_id and a.state in ('active')   -- 有効メンバーだけ
    ) then
        raise exception using errcode = 'UC403', message = 'usecase_forbidden:ai.consume';
    end if;

    return query
    insert into public.ai_usage (member_id, used_on, used_count)
    values (p_member_id, current_date, 1)
    on conflict (member_id, used_on) do update
        set used_count = public.ai_usage.used_count + 1
        where public.ai_usage.used_count < p_limit
    returning *;
end;
`;

/** 関数の定義 1 本を組む。 */
function define(name: string, body: string, schema = 'api.', tag = '$$'): string {
  return `create or replace function ${schema}${name}(p_member_id uuid, p_limit integer) returns setof public.ai_usage language plpgsql as ${tag}${body}${tag};`;
}

describe('latestFunctionBody', () => {
  it('migration を名前順に読み、その関数を最後に定義した版の本文を返す(後の版が上書きする)', () => {
    const body = latestFunctionBody(
      [
        { name: '001.sql', text: define('consume_quota', 'old body') },
        { name: '002.sql', text: `${define('other_fn', 'unrelated')}\n${define('consume_quota', 'new body')}` },
      ],
      'consume_quota',
    );

    expect(body).toBe('new body');
  });

  it('スキーマなし・引用符つき・`create function`・タグつきの本文(`$fn$`)も読む', () => {
    expect(latestFunctionBody([{ name: 'a.sql', text: define('q', 'plain', '') }], 'q')).toBe('plain');
    expect(latestFunctionBody([{ name: 'a.sql', text: define('q', 'quoted', 'api."').replace('"q', '"q').replace('q(', 'q"(') }], 'q')).toBe('quoted');
    expect(latestFunctionBody([{ name: 'a.sql', text: define('q', 'tagged', 'public.', '$fn$').replace('create or replace', 'create') }], 'q')).toBe('tagged');
  });

  it('定義が無い・名前が前方一致するだけ・本文が閉じていない・本文の開きが無いときは null', () => {
    expect(latestFunctionBody([], 'q')).toBeNull();
    expect(latestFunctionBody([{ name: 'a.sql', text: define('consume_quota_v2', 'x') }], 'consume_quota')).toBeNull();
    expect(latestFunctionBody([{ name: 'a.sql', text: 'create function api.q() returns void as $$ begin' }], 'q')).toBeNull();
    expect(latestFunctionBody([{ name: 'a.sql', text: 'create function api.q() returns void language sql;' }], 'q')).toBeNull();
  });

  it('後の版の本文が読めないとき、読めた前の版を残す(読めない版で上書きしない)', () => {
    const body = latestFunctionBody(
      [
        { name: '1.sql', text: define('q', 'first') },
        { name: '2.sql', text: 'create or replace function api.q() returns void language sql;' },
      ],
      'q',
    );

    expect(body).toBe('first');
  });
});

describe('normalizeSql', () => {
  it('-- コメントを除き、小文字にして、空白を 1 つにつめる', () => {
    expect(normalizeSql("SELECT  1\n  FROM   T -- comment 'x'\n WHERE A = 1")).toBe('select 1 from t where a = 1');
  });
});

describe('meterBodyProblems', () => {
  it('正例: 役の述語・実行者の行を読む表・raise exception・1 文の upsert が揃っていれば指摘なし(別名は何でもよい)', () => {
    expect(meterBodyProblems(GOOD, [MEMBER], TABLE)).toEqual([]);
    expect(meterBodyProblems(GOOD.replaceAll(' a.', ' m.').replace('members a', 'members m'), [MEMBER], TABLE)).toEqual([]);
  });

  it('正例: `update … set … where … returning` の消費もよい', () => {
    const body = GOOD.replace(/return query[\s\S]*returning \*;/u, 'update public.ai_usage set used_count = used_count + 1 where member_id = p_member_id and used_count < p_limit returning *;');
    expect(meterBodyProblems(body, [MEMBER], TABLE)).toEqual([]);
  });

  it('正例: boolean の欄の述語(`a.is_staff`)と、含意の先の述語を複数並べる', () => {
    const body = GOOD.replace("a.state in ('active')", "a.state in ('active') and a.is_staff");
    expect(meterBodyProblems(body, [MEMBER, STAFF], TABLE)).toEqual([]);
  });

  it('正例: 実行者の表が引けない役は表の字面を見ない', () => {
    expect(meterBodyProblems(GOOD.replaceAll('members', 'accounts'), [MEMBER], () => null)).toEqual([]);
  });

  // 負例の表: [題, 壊した本文, 指摘に載る断片]
  const BAD: readonly (readonly [string, string, string])[] = [
    ['役の述語が無い', GOOD.replace("and a.state in ('active')", ''), "役の述語 `a.state in ('active')` が本文にありません"],
    ['役の述語の値が違う(休会も通す)', GOOD.replace("('active')", "('active', 'suspended')"), '本文にありません'],
    ['役の述語がコメントにだけある', GOOD.replace("and a.state in ('active')   -- 有効メンバーだけ", "-- a.state in ('active')"), '本文にありません'],
    [
      '役の述語が最初の書き込みより後にある',
      `begin insert into public.ai_usage values (1) on conflict (id) do update set n = 1 where n < 2; if not exists (select 1 from public.members a where a.state in ('active')) then raise exception 'x'; end if; end;`,
      '最初の書き込みより後にあります',
    ],
    ['実行者の行を読む表が違う', GOOD.replaceAll('public.members', 'public.profiles'), '実行者の行(members)を読んでいません'],
    ['役を持たない実行者を落とさない', GOOD.replace(/raise exception[^;]*;/u, 'return;'), '`raise exception` で落としていません'],
    [
      '読んでから足す(原子的でない)',
      GOOD.replace(/return query[\s\S]*returning \*;/u, 'select used_count into v from public.ai_usage where member_id = p_member_id; update public.ai_usage set used_count = v + 1 where member_id = p_member_id;'),
      '1 文の原子的な更新ではありません',
    ],
    ['上限の条件が無い upsert', GOOD.replace('where public.ai_usage.used_count < p_limit', ''), '1 文の原子的な更新ではありません'],
  ];

  it.each(BAD)('負例: %s', (_title, body, fragment) => {
    const problems = meterBodyProblems(body, [MEMBER], TABLE);

    expect(problems.some((problem) => problem.includes(fragment)), problems.join(' / ')).toBe(true);
  });

  it('含意の先の述語が欠けていれば、その述語だけを名指す', () => {
    const problems = meterBodyProblems(GOOD, [MEMBER, STAFF], TABLE);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('`a.is_staff`');
  });
});
