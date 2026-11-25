/**
 * 送信の上限の migration の生成(`sql/send-limit.ts`。ARCH-SP-BE-0001 §送信の上限)のテスト。
 *
 * 出力の字面(本文の順序・鍵の順・数え方・拒否・積む payload)を固定し、宣言を 1 か所ずつ変えると本文のその場所が変わること、
 * 本文を壊すと突合(data-table-parity の md5・宣言から導いた署名・掴む鍵の順)が別の値を出すこと(変異)を見る。
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSendLimitMigration, sendLimitBody, sendLimitLockKeys, sendLimitSignature, sendLimitUnitExpression, sendLimitWords } from '../../../lib/sql/send-limit.js';
import type { DataFunctionDecl, SendLimitDecl } from '../../../lib/model/data/types.js';

/** 実行者ごとの上限。 */
const ACTOR_DAILY = { word: 'actor_daily', key: 'actor_id', max: 10, per: '24 hours' } as const;

/** 題材の宣言(鍵の宣言の順はバイト順の逆 = 掴む順は並べ替わる)。 */
const DECL: SendLimitDecl = {
  event: 'thing.update',
  types: ['notify_a', 'notify_b'],
  keys: [{ name: 'parent_id', blocked: { table: 'parents', column: 'state', values: ['draft', 'held'], word: 'from_draft' } }, { name: 'actor_id' }],
  payload: ['text'],
  limits: [
    ACTOR_DAILY,
    { word: 'parent_daily', key: 'parent_id', max: 5, per: '24 hours' },
    { word: 'parent_interval', key: 'parent_id', max: 1, per: '10 minutes' },
  ],
};

const FN: DataFunctionDecl = { name: 'send_limit_thing', args: [], params: [], kind: 'send_limit', alsoWrites: [], migration: '20261105100038_send_limit_thing.sql', sendLimit: DECL };

/** 本文の md5(data-table-parity の期待と同じ作り方)。 */
function md5(body: string): string {
  return createHash('md5').update(body).digest('hex');
}

describe('送信の上限の本文', () => {
  it('署名は 種別・鍵の宣言の順・payload の順', () => {
    expect(sendLimitSignature(DECL)).toEqual({ args: ['text', 'uuid', 'uuid', 'text'], params: ['p_type', 'p_parent_id', 'p_actor_id', 'p_text'] });
  });

  it('掴む鍵は字面のバイト順(宣言の順に依らない)', () => {
    expect(sendLimitLockKeys('send_limit_thing', DECL)).toEqual([
      { prefix: 'send_limit_thing:actor_id=', key: 'actor_id' },
      { prefix: 'send_limit_thing:parent_id=', key: 'parent_id' },
    ]);
    expect(sendLimitLockKeys('send_limit_thing', { ...DECL, keys: [...DECL.keys].reverse() })).toEqual(sendLimitLockKeys('send_limit_thing', DECL));
  });

  it('拒否の語は 送れない状態 → 上限の宣言の順(送れない状態だけが時刻を持たない)', () => {
    expect(sendLimitWords(DECL)).toEqual([
      { word: 'from_draft', timed: false },
      { word: 'actor_daily', timed: true },
      { word: 'parent_daily', timed: true },
      { word: 'parent_interval', timed: true },
    ]);
  });

  it('本文の字面(順序: 種別 → 送れない状態 → advisory lock → 数え → 拒否 → 積む)', () => {
    expect(sendLimitBody('send_limit_thing', DECL)).toBe(`
declare
    v_types constant text[] := array['notify_a', 'notify_b'];
    v_count integer;
    v_nth timestamptz;
    v_word text;
    v_retry timestamptz;
    v_job_id uuid;
begin
    if p_type is null or p_type <> all (v_types) then
        raise exception 'send_limit_thing: 種別 % は送信の上限の宣言(types)の外です', p_type;
    end if;
    if exists (select 1 from public.parents b where b.id = p_parent_id and b.state in ('draft', 'held')) then
        raise exception using errcode = 'UC412', message = 'usecase_guard:thing.update', detail = 'from_draft';
    end if;
    perform pg_advisory_xact_lock(hashtext('send_limit_thing:actor_id=' || p_actor_id::text));
    perform pg_advisory_xact_lock(hashtext('send_limit_thing:parent_id=' || p_parent_id::text));
    -- actor_daily: actor_id ごとに 10 本 / 24 hours
    select count(*), (array_agg(j.created_at order by j.created_at desc))[10]
    into v_count, v_nth
    from public.jobs j
    where j.type = any (v_types)
      and j.payload ->> 'actor_id' = p_actor_id::text
      and j.created_at > now() - interval '24 hours';
    if v_count >= 10 then
        v_word := coalesce(v_word, 'actor_daily');
        v_retry := greatest(v_retry, v_nth + interval '24 hours');
    end if;
    -- parent_daily: parent_id ごとに 5 本 / 24 hours
    select count(*), (array_agg(j.created_at order by j.created_at desc))[5]
    into v_count, v_nth
    from public.jobs j
    where j.type = any (v_types)
      and j.payload ->> 'parent_id' = p_parent_id::text
      and j.created_at > now() - interval '24 hours';
    if v_count >= 5 then
        v_word := coalesce(v_word, 'parent_daily');
        v_retry := greatest(v_retry, v_nth + interval '24 hours');
    end if;
    -- parent_interval: parent_id ごとに 1 本 / 10 minutes
    select count(*), (array_agg(j.created_at order by j.created_at desc))[1]
    into v_count, v_nth
    from public.jobs j
    where j.type = any (v_types)
      and j.payload ->> 'parent_id' = p_parent_id::text
      and j.created_at > now() - interval '10 minutes';
    if v_count >= 1 then
        v_word := coalesce(v_word, 'parent_interval');
        v_retry := greatest(v_retry, v_nth + interval '10 minutes');
    end if;
    if v_word is not null then
        raise exception using errcode = 'UC412', message = 'usecase_guard:thing.update', detail = v_word,
            hint = to_char(to_timestamp(ceil(extract(epoch from v_retry))) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    end if;
    v_job_id := gen_random_uuid();
    insert into public.jobs (id, type, payload, idempotency_key)
    values (v_job_id, p_type, jsonb_build_object('parent_id', p_parent_id, 'actor_id', p_actor_id, 'text', p_text), p_type || ':' || v_job_id::text);
    return v_job_id;
end;
`);
  });

  it('migration は宣言から導いた署名で作り、定義者の権限・search_path の固定・面への付与なし', () => {
    const sql = buildSendLimitMigration({ fn: FN, decl: DECL, specFiles: ['docs/specs/backend/data/tables/jobs.md'] });
    expect(sql).toContain('create or replace function public.send_limit_thing(\n    p_type text,\n    p_parent_id uuid,\n    p_actor_id uuid,\n    p_text text\n) returns uuid');
    expect(sql).toContain('security definer\nset search_path = public\n');
    expect(sql).toContain(`as $$${sendLimitBody('send_limit_thing', DECL)}$$;`);
    expect(sql).toContain('revoke all on function public.send_limit_thing(text, uuid, uuid, text) from public;');
    expect(sql).not.toMatch(/\bgrant\b/);
    expect(sql).toContain('--   - docs/specs/backend/data/tables/jobs.md');
  });

  it('送れない状態も payload の欄も無い宣言は、その段を出さない', () => {
    const body = sendLimitBody('send_limit_thing', { ...DECL, keys: [{ name: 'actor_id' }], payload: [], limits: [ACTOR_DAILY] });
    expect(body).not.toContain('if exists');
    expect(body).toContain("jsonb_build_object('actor_id', p_actor_id)");
    expect(body.match(/pg_advisory_xact_lock/g)).toHaveLength(1);
  });

  it.each<[string, SendLimitDecl, RegExp]>([
    ['本数を変えると数えの位置と閾値が変わる', { ...DECL, limits: [{ ...ACTOR_DAILY, max: 11 }] }, /\)\)\[11\][\s\S]*if v_count >= 11 then/],
    ['幅を変えると範囲と時刻が変わる', { ...DECL, limits: [{ ...ACTOR_DAILY, per: '2 days' }] }, /now\(\) - interval '2 days';[\s\S]*v_nth \+ interval '2 days'/],
    ['上限の順を変えると拒否の理由の順が変わる', { ...DECL, limits: [...DECL.limits].reverse() }, /coalesce\(v_word, 'parent_interval'\)[\s\S]*coalesce\(v_word, 'actor_daily'\)/],
    ['種別を足すと数える側と積む側の 1 つの並びが変わる', { ...DECL, types: [...DECL.types, 'notify_c'] }, /array\['notify_a', 'notify_b', 'notify_c'\]/],
  ])('宣言の変異: %s', (_name, decl, expected) => {
    const body = sendLimitBody('send_limit_thing', decl);
    expect(body).toMatch(expected);
    expect(md5(body)).not.toBe(md5(sendLimitBody('send_limit_thing', DECL)));
  });

  it.each<[string, (body: string) => string]>([
    ['advisory lock を外す', (body) => body.replace(/ {4}perform pg_advisory_xact_lock\(hashtext\('send_limit_thing:actor_id='[^\n]*\n/, '')],
    ['実行者の数えを外す', (body) => body.replace(/and j\.payload ->> 'actor_id' = p_actor_id::text/, 'and true')],
    ['上限を 1 つ増やす', (body) => body.replace('if v_count >= 10 then', 'if v_count >= 11 then')],
    ['範囲を無視する', (body) => body.replace("and j.created_at > now() - interval '24 hours';", 'and true;')],
    ['payload から鍵を外す', (body) => body.replace("'actor_id', p_actor_id, ", '')],
    ['種別の閉じた並びを外す', (body) => body.replace('if p_type is null or p_type <> all (v_types) then', 'if false then')],
    ['送れない状態を外す', (body) => body.replace("b.state in ('draft', 'held')", 'false')],
  ])('本文の変異は md5 の突合(data-table-parity)で赤: %s', (_name, mutate) => {
    const body = sendLimitBody('send_limit_thing', DECL);
    const mutated = mutate(body);
    expect(mutated).not.toBe(body);
    expect(md5(mutated)).not.toBe(md5(body));
  });
});

describe('数える単位(unit)', () => {
  /** 招いたメンバーを単位にする辿り方。 */
  const CHAIN = {
    via: [
      { table: 'members', column: 'invited_via', to: 'invitations' },
      { table: 'invitations', column: 'issued_by', to: 'members' },
    ],
  };
  /** 実行者の鍵だけを持つ宣言(単位の既定 / 辿り方)。 */
  const actorOnly = (unit?: typeof CHAIN): SendLimitDecl => ({
    ...DECL,
    keys: [unit === undefined ? { name: 'actor_id' } : { name: 'actor_id', unit }],
    payload: [],
    limits: [ACTOR_DAILY],
  });

  it('単位の式は参照の列を順に辿り、辿れなければ鍵の値そのもの', () => {
    expect(sendLimitUnitExpression(CHAIN, 'p_actor_id')).toBe(
      'coalesce((select h2.issued_by from public.members h1 join public.invitations h2 on h2.id = h1.invited_via where h1.id = p_actor_id), p_actor_id)',
    );
  });

  it('既定(実行者ごと)は鍵の値で数え、鍵の値で掴む', () => {
    const body = sendLimitBody('send_limit_thing', actorOnly());
    expect(body).toContain("and j.payload ->> 'actor_id' = p_actor_id::text");
    expect(body).toContain("hashtext('send_limit_thing:actor_id=' || p_actor_id::text)");
    expect(body).not.toContain('v_unit_');
  });

  it('辿り方を宣言すると、単位を先に引いて単位で掴み、ジョブの payload の値も同じ辿り方で単位に直して比べる', () => {
    const body = sendLimitBody('send_limit_thing', actorOnly(CHAIN));
    const unit = sendLimitUnitExpression(CHAIN, 'p_actor_id');
    expect(body).toContain('    v_unit_actor_id uuid;\n');
    expect(body).toContain(`    v_unit_actor_id := ${unit};\n    perform pg_advisory_xact_lock(hashtext('send_limit_thing:actor_id=' || v_unit_actor_id::text));`);
    const jobValue = "(case when j.payload ->> 'actor_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (j.payload ->> 'actor_id')::uuid end)";
    expect(body).toContain(`  and ${sendLimitUnitExpression(CHAIN, jobValue)} = v_unit_actor_id\n`);
    expect(body).not.toContain("and j.payload ->> 'actor_id' = p_actor_id::text");
    // 積む payload は鍵の値(実行者)のまま。単位は数えるときに引き直す。
    expect(body).toContain("jsonb_build_object('actor_id', p_actor_id)");
  });

  it.each<[string, (body: string) => string]>([
    ['単位を引かずに鍵の値で掴む', (body) => body.replace("|| v_unit_actor_id::text", '|| p_actor_id::text')],
    ['数えで単位に直さない', (body) => body.replace(/and coalesce\(\(select h2\.issued_by[^\n]*= v_unit_actor_id/, "and j.payload ->> 'actor_id' = p_actor_id::text")],
    ['辿る列を変える', (body) => body.replace('h1.invited_via', 'h1.id')],
  ])('辿り方の本文の変異は md5 の突合で赤: %s', (_name, mutate) => {
    const body = sendLimitBody('send_limit_thing', actorOnly(CHAIN));
    const mutated = mutate(body);
    expect(mutated).not.toBe(body);
    expect(md5(mutated)).not.toBe(md5(body));
  });
});
