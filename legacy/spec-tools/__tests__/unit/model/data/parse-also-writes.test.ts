/**
 * 書き込み RPC の書き込みの宣言(`also_writes` / `self_writes` / `event_writes` / `calls` / `dynamic_sql`)の
 * パーサー(T0 = 形)のテスト。
 *
 * 種類は必須で、表の名前だけの並び(旧い書き方)・空の種類・値域外・重複は、黙った既定を作らず名指しで error にする。
 * composite では also_writes / self_writes のキーそのものが必須(省略を「書かない」と読まない)。
 */

import { describe, expect, it } from 'vitest';
import { parseDataTableSpec } from '../../../../lib/model/data/parse-data-table.js';
import { SpecReporter } from '../../../../lib/model/parse-common.js';

/** 関数 1 本の表(架空の題材)。 */
function data(fn: Record<string, unknown>): Record<string, unknown> {
  return {
    doc_type: 'data_table',
    scope: 'backend',
    id: 'table-slots',
    table: 'slots',
    entity: 'slot',
    functions: [{ name: 'reorder_slots', args: ['uuid[]'], params: ['p_ids'], kind: 'rpc', ...fn }],
    test_cases: [],
  };
}

/** composite の関数(self_writes は既定で [update])。 */
function composite(extra: Record<string, unknown>): Record<string, unknown> {
  return { shape: 'composite', returns: 'rows', self_writes: ['update'], ...extra };
}

function parseFn(fn: Record<string, unknown>) {
  const reporter = new SpecReporter('slots.md');
  const result = parseDataTableSpec(data(fn), 'slots.md', reporter);
  return {
    fn: result.value?.functions[0],
    messages: result.findings.map((finding) => finding.message).filter((message) => !message.includes('test_cases')),
  };
}

function parse(alsoWrites: unknown) {
  return parseFn(composite(alsoWrites === undefined ? {} : { also_writes: alsoWrites }));
}

describe('also_writes の書き込みの種類', () => {
  it('表ごとの種類を読める（alsoWrites は表の名前の並び、alsoWriteKinds は種類）', () => {
    const { fn, messages } = parse({ entries: ['update', 'delete'], domain_events: ['insert'], members: ['scrub'] });

    expect(messages).toEqual([]);
    expect(fn?.alsoWrites).toEqual(['entries', 'domain_events', 'members']);
    expect(fn?.alsoWriteKinds).toEqual({ entries: ['update', 'delete'], domain_events: ['insert'], members: ['scrub'] });
  });

  it('composite で書かなければ error(省略を「他の表に書かない」と読まない)、{} は書き込み先なしの明示', () => {
    expect(parse(undefined).messages.some((message) => message.includes('reorder_slots は shape: composite なのに also_writes がありません'))).toBe(true);
    const empty = parse({});
    expect(empty.messages).toEqual([]);
    expect(empty.fn?.alsoWrites).toEqual([]);
    expect(empty.fn).not.toHaveProperty('alsoWriteKinds');
  });

  it('定型の形では省略できる(書き込み先なし)', () => {
    const { fn, messages } = parseFn({ shape: 'delete', migration: '20260101000001_rpc_reorder_slots.sql' });

    expect(messages).toEqual([]);
    expect(fn?.alsoWrites).toEqual([]);
  });

  it('表の名前だけの並び（旧い書き方）は、種類が分からないと名指しで error', () => {
    const { messages } = parse(['entries', 'domain_events']);

    expect(messages.some((message) => message.includes('reorder_slots の also_writes が書き込みの種類つきの写像ではありません'))).toBe(true);
  });

  it('種類の無い表・空の種類は error（黙った既定を作らない）', () => {
    for (const bad of [{ entries: [] }, { entries: null }, { entries: 'update' }]) {
      const { messages } = parse(bad);
      expect(messages.some((message) => message.includes('also_writes の entries に書き込みの種類がありません')), JSON.stringify(bad)).toBe(true);
    }
  });

  it('値域の外・重複・スネークケースでない表名は error', () => {
    expect(parse({ entries: ['upsert'] }).messages.some((message) => message.includes('種類が不正です(upsert)'))).toBe(true);
    expect(parse({ entries: ['insert', 'insert'] }).messages.some((message) => message.includes('種類が不正です(insert)'))).toBe(true);
    expect(parse({ Entries: ['insert'] }).messages.some((message) => message.includes('スネークケースではありません'))).toBe(true);
  });
});

describe('self_writes(帰属表への書き込み)', () => {
  it('composite では必須。[] は「書かない」の明示', () => {
    const missing = parseFn({ shape: 'composite', returns: 'rows', also_writes: {} });
    expect(missing.messages.some((message) => message.includes('self_writes(帰属表への書き込みの種類)がありません'))).toBe(true);

    const empty = parseFn(composite({ also_writes: {}, self_writes: [] }));
    expect(empty.messages).toEqual([]);
    expect(empty.fn?.selfWriteKinds).toEqual([]);
  });

  it('定型で本文が生成物なら書けない(形が決める)、手書きなら書ける', () => {
    const generated = parseFn({ shape: 'delete', migration: '20260101000001_rpc_reorder_slots.sql', self_writes: ['delete'] });
    expect(generated.messages.some((message) => message.includes('reorder_slots には self_writes を宣言できません'))).toBe(true);

    const handwritten = parseFn({ shape: 'transition', handwritten: '後始末の連鎖を本文が持つ', self_writes: ['update', 'scrub'] });
    expect(handwritten.messages).toEqual([]);
    expect(handwritten.fn?.selfWriteKinds).toEqual(['update', 'scrub']);
  });

  it('値域の外は error', () => {
    expect(parseFn(composite({ also_writes: {}, self_writes: ['upsert'] })).messages.some((message) => message.includes('self_writes の種類が不正です'))).toBe(true);
  });
});

describe('event_writes / calls / dynamic_sql', () => {
  it('イベントごとの書き込みを読める({} は書かないの明示)', () => {
    const { fn, messages } = parseFn(
      composite({ also_writes: { entries: ['delete'] }, event_writes: { 'slot_state.close': { entries: ['delete'] }, 'slot_state.open': {} } }),
    );

    expect(messages).toEqual([]);
    expect(fn?.eventWrites).toEqual({ 'slot_state.close': { entries: ['delete'] }, 'slot_state.open': {} });
  });

  it('イベント ID の形でないキー・写像でない値は error', () => {
    expect(parseFn(composite({ also_writes: {}, event_writes: { close: {} } })).messages.some((message) => message.includes('イベント ID'))).toBe(true);
    expect(parseFn(composite({ also_writes: {}, event_writes: ['a.b'] })).messages.some((message) => message.includes('event_writes が写像ではありません'))).toBe(true);
  });

  it('calls は関数名の並び(重複・空は error)、dynamic_sql は理由 1 行', () => {
    const ok = parseFn(composite({ also_writes: {}, calls: ['end_sessions'], dynamic_sql: '表名を引数で受けるため' }));
    expect(ok.messages).toEqual([]);
    expect(ok.fn?.calls).toEqual(['end_sessions']);
    expect(ok.fn?.dynamicSql).toBe('表名を引数で受けるため');

    expect(parseFn(composite({ also_writes: {}, calls: [] })).messages.some((message) => message.includes('calls が関数名'))).toBe(true);
    expect(parseFn(composite({ also_writes: {}, calls: ['a', 'a'] })).messages.some((message) => message.includes('重複'))).toBe(true);
  });

  it('書き込み RPC でない関数には書けない', () => {
    const reporter = new SpecReporter('slots.md');
    const result = parseDataTableSpec(
      {
        ...data({}),
        functions: [{ name: 'fill_slot', args: [], kind: 'trigger', handwritten: { migration: '20260101000001_x.sql', reason: '手書き' }, calls: ['x'] }],
      },
      'slots.md',
      reporter,
    );
    expect(result.findings.some((finding) => finding.message.includes('fill_slot には calls を宣言できません'))).toBe(true);
  });

  it('知らないキー(綴り違い)は error(書いたつもりの宣言が黙って無視されない)', () => {
    expect(parseFn(composite({ also_writes: {}, event_write: {} })).messages.some((message) => message.includes('event_write'))).toBe(true);
  });
});

describe('mirror_of', () => {
  function messagesOf(extra: Record<string, unknown>): readonly string[] {
    const reporter = new SpecReporter('keys.md');
    const { entity: _entity, functions: _functions, ...rest } = data({});
    return parseDataTableSpec({ ...rest, ...extra }, 'keys.md', reporter).findings.map((finding) => finding.message).filter((message) => message.includes('mirror_of'));
  }

  it('内部テーブルだけが宣言できる', () => {
    expect(messagesOf({ internal: true, mirror_of: 'public_slots' })).toEqual([]);
    expect(messagesOf({ entity: 'slot', mirror_of: 'public_slots' })).toEqual(['mirror_of は internal: true の表だけが宣言できます']);
  });
});
