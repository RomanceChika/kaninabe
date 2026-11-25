/**
 * data_table の生の SQL 断片・識別子に敵対的な値を書いた宣言が、読み込みで落ちる(T0 の error)ことの単体テスト。
 * 独立レビューが実測した迂回: `indexes[].where` / `checks[].rule` に `true) ; drop table public.users ; --`、`defaults` の式、
 * `triggers[].fires`、`derives.offset`(読めない幅は字面のまま SQL に出ていた)。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../lib/model/parse-common.js';
import { parseDataTableSpec } from '../../../lib/model/data/parse-data-table.js';

const BASE = { doc_type: 'data_table', scope: 'backend', id: 'table-rooms', table: 'rooms', entity: 'room' };
const DROP = 'true) ; drop table public.users ; --';

/** 宣言を読み、error の message を集める(落とした宣言の数も)。 */
function load(extra: Record<string, unknown>): { readonly messages: readonly string[]; readonly dropped: number; readonly spec: ReturnType<typeof parseDataTableSpec>['value'] } {
  const reporter = new SpecReporter('rooms.md');
  const result = parseDataTableSpec({ ...BASE, ...extra }, 'rooms.md', reporter);
  return { messages: reporter.findings().filter((finding) => finding.severity === 'error').map((finding) => finding.message), dropped: reporter.droppedCount(), spec: result.value };
}

describe('生の SQL 断片', () => {
  it.each([
    ['indexes[].where', { indexes: [{ name: 'a_idx', on: ['name'], where: DROP }] }, 'where が書ける形ではありません'],
    ['exclusions[].where', { exclusions: [{ name: 'a_excl', keys: ['room_id'], range: ['starts_at', 'ends_at'], where: DROP }] }, 'where が書ける形ではありません'],
    ['checks[].rule', { checks: [{ name: 'a_chk', rule: DROP }] }, 'rule が書ける形ではありません'],
    ['defaults の値', { defaults: { name: "'x'); drop table t; --" } }, 'defaults が書ける形ではありません'],
    ['where の関数(空白つき)', { indexes: [{ name: 'a_idx', on: ['name'], where: 'pg_sleep (10) is null' }] }, 'where が書ける形ではありません'],
    ['rule の修飾した関数', { checks: [{ name: 'a_chk', rule: 'pg_catalog.pg_sleep(10) is null' }] }, 'rule が書ける形ではありません'],
    ['defaults の自作関数', { defaults: { name: 'public.evil()' } }, 'defaults が書ける形ではありません'],
    ['rule の reg 変換', { checks: [{ name: 'a_chk', rule: 'x::regprocedure is null' }] }, 'rule が書ける形ではありません'],
    ['defaults の nextval(宣言していない器)', { defaults: { name: "nextval('other_seq'::regclass)" } }, 'defaults が書ける形ではありません'],
    ['defaults の列名', { defaults: { 'name; drop': "'x'" } }, 'defaults の列名 が書ける形ではありません'],
    ['triggers[].fires', { triggers: [{ name: 't1', function: 'f1', fires: 'before insert on t; drop table x; --' }] }, 'fires が書ける形ではありません'],
    ['derives の offset', { triggers: [{ name: 't1', function: 'f1', derives: { due_at: { from: 'starts_at', offset: "1 day'; drop table x; --", mode: 'initial' } } }] }, 'offset が書ける形ではありません'],
    ['foreign_keys の参照先', { foreign_keys: [{ column: 'department_id', references: 'departments; drop table x', on_delete: 'no_action' }] }, 'references が書ける形ではありません'],
    ['インデックス名', { indexes: [{ name: 'a; drop table x', on: ['name'] }] }, 'name が書ける形ではありません'],
    ['インデックスの列', { indexes: [{ name: 'a_idx', on: ['name) ; drop'] }] }, 'on が書ける形ではありません'],
    ['制約名', { checks: [{ name: 'a"b', rule: 'x > 0' }] }, 'name が書ける形ではありません'],
    ['トリガ名', { triggers: [{ name: 'a b', function: 'f1' }] }, 'name が書ける形ではありません'],
    ['関数の引数の型', { functions: [{ name: 'f1', args: ['uuid); drop table x; --'], kind: 'rpc' }] }, 'args が書ける形ではありません'],
  ])('%s', (_name, extra, message) => {
    const { messages, dropped } = load(extra);

    expect(messages.join('\n')).toContain(message);
    expect(dropped).toBeGreaterThan(0);
  });

  it('現行の書き方(部分インデックス・CHECK・defaults・fires・offset)は通る', () => {
    const { messages } = load({
      indexes: [{ name: 'a_idx', on: ['name'], where: "(state <> ALL (ARRAY['collected'::text, 'cancelled'::text]))" }],
      checks: [{ name: 'a_chk', rule: 'char_length(title) <= 200' }],
      sequences: [{ name: 'bookings_reference_seq', start: 1 }],
      defaults: { reference: "('BK-'::text || lpad((nextval('bookings_reference_seq'::regclass))::text, 8, '0'::text))" },
      triggers: [{ name: 't1', function: 'f1', fires: 'before insert or update of state, item_id', derives: { due_at: { from: 'starts_at', offset: '-14 days', mode: 'initial' } } }],
      foreign_keys: [{ column: 'user_id', references: 'auth.users', on_delete: 'no_action' }],
    });

    expect(messages.filter((message) => message.includes('書ける形ではありません'))).toEqual([]);
  });
});
