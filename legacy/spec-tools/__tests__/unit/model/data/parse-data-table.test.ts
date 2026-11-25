/**
 * parse-data-table(T0 = data_table のスキーマ適合)のユニットテスト。
 *
 * 規約網羅(ARCH-SP-BE-0001 §テーブル仕様):
 *   - 正しい宣言が構造ごと読めること
 *   - id は table から導かれる形(table-{table})と一致すること
 *   - ファイル名は {table}.md と一致すること
 *   - entity と internal: true は排他で、どちらかが必須であること
 *   - on_delete / kind / security は値域であること(`security` はトリガ関数だけが書ける)
 *   - `actor_field`(境界の補助関数が返す実行者の欄)は helper だけが書け、`role` と排他であること
 *   - インデックス名・関数名の重複は落ちること
 *   - `functions[].lookup`(本文が引く自表の列の並び)は空でない・スネークケース・重複なしで読めること
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseDataTableSpec } from '../../../../lib/model/data/parse-data-table.js';

/** テスト用の最小フロントマター(entries 相当)。 */
function baseData(): Record<string, unknown> {
  return {
    doc_type: 'data_table',
    scope: 'backend',
    id: 'table-entries',
    table: 'entries',
    entity: 'entry',
    indexes: [
      { name: 'entries_workshop_id_idx', on: ['workshop_id'] },
      {
        name: 'entries_active_unique',
        on: ['workshop_id', 'performer_id'],
        unique: true,
        where: "state not in ('rejected', 'withdrawn')",
        invariant: 'INV-ENTRY-001',
      },
    ],
    foreign_keys: [{ column: 'workshop_id', references: 'workshops', on_delete: 'cascade' }],
    triggers: [{ name: 'check_entry_capacity', function: 'check_entry_capacity' }],
    functions: [
      { name: 'update_entry', args: ['uuid', 'text', 'jsonb', 'uuid'], kind: 'rpc', shape: 'update' },
      { name: 'check_entry_capacity', args: [], kind: 'trigger' },
    ],
    checks: [{ name: 'entries_extra_check', rule: 'x > 0' }],
    test_cases: [
      {
        id: 'TC-TABLE-ENTRIES-001',
        type: 'integration',
        covers: ['success'],
        spec_ids: ['table-entries'],
        implementation:
          'app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::entries の突合',
      },
    ],
  };
}

/** パースして (spec, findings) を返す短縮形。 */
function parse(data: Record<string, unknown>, relPath = 'entries.md') {
  const reporter = new SpecReporter('docs/specs/backend/data/tables/entries.md');
  return parseDataTableSpec(data, relPath, reporter);
}

describe('parseDataTableSpec(T0)', () => {
  it('正しい宣言を構造ごと読める', () => {
    const { value, findings } = parse(baseData());

    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(value).not.toBeNull();
    expect(value?.table).toBe('entries');
    expect(value?.entity).toBe('entry');
    expect(value?.internal).toBe(false);
    expect(value?.indexes).toHaveLength(2);
    expect(value?.indexes[1]).toMatchObject({ unique: true, invariant: 'INV-ENTRY-001' });
    expect(value?.foreignKeys[0]).toEqual({
      column: 'workshop_id',
      references: 'workshops',
      onDelete: 'cascade',
    });
    expect(value?.functions.map((fn) => fn.kind)).toEqual(['rpc', 'trigger']);
    expect(value?.testCases).toHaveLength(1);
  });

  it('surface_migration(SQL の公開面のビューの書き出し先)を読む。旧いキー api_view_migration は書き直し先を名指して error にする(二重には受けない)', () => {
    const declared = parse({ ...baseData(), surface_migration: '20260923000338_api_view_entries.sql' });
    expect(declared.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(declared.value?.surfaceMigration).toBe('20260923000338_api_view_entries.sql');

    const retired = parse({ ...baseData(), api_view_migration: '20260923000338_api_view_entries.sql' });
    const errors = retired.findings.filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('api_view_migration は廃止されました');
    expect(errors[0]?.suggestion).toContain('surface_migration に書き直す');
    // 旧いキーの値は読まない(新しい欄に黙って写さない)。
    expect(retired.value?.surfaceMigration).toBeUndefined();
    expect(retired.value?.retiredSurfaceKey).toBe(true);
    expect(declared.value?.retiredSurfaceKey).toBeUndefined();
  });

  it('索引の global_key を鍵の列と理由で読む(点検 13 回目 A13-1 / A13-4)', () => {
    const row = { name: 'x_unique', on: ['code'], unique: true };
    const accepted = parse({ ...baseData(), indexes: [{ ...row, global_key: { keys: ['code'], reason: '公開の識別子' } }] });
    expect(accepted.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(accepted.value?.indexes[0]?.globalKey).toEqual({ keys: ['code'], reason: '公開の識別子' });
    const blank = parse({ ...baseData(), indexes: [{ ...row, global_key: '公開の識別子' }] });
    expect(blank.findings.some((f) => f.message.includes('global_key の形が違います'))).toBe(true);
    expect(blank.value?.indexes[0]).not.toHaveProperty('globalKey');
  });

  it('erasure_addressee と personal_columns を読む(点検 16 回目)', () => {
    const row = { column: 'note', via: 'members.invited_via', reason: '宛先の名前' };
    expect(parse({ ...baseData(), erasure_addressee: [row] }).value?.erasureAddressees).toEqual([row]);
    expect(parse({ ...baseData(), internal: true, entity: undefined, personal_columns: ['name_copy'] }).value?.personalColumns).toEqual(['name_copy']);
    expect(parse({ ...baseData(), internal: true, entity: undefined, personal_columns: [] }).value?.personalColumns).toEqual([]);
  });

  it.each([
    ['via が 表.列 でない', { column: 'note', via: 'invited_via', reason: 'x' }],
    ['理由が空', { column: 'note', via: 'members.invited_via', reason: ' ' }],
    ['知らない鍵', { column: 'note', via: 'members.invited_via', reason: 'x', extra: 1 }],
  ])('erasure_addressee の崩れは T0: %s', (_name, row) => {
    expect(parse({ ...baseData(), erasure_addressee: [row] }).findings.length).toBeGreaterThan(0);
  });

  it('personal_columns は内部テーブルだけが書ける', () => {
    expect(parse({ ...baseData(), personal_columns: ['x'] }).findings.length).toBeGreaterThan(0);
  });

  it('scrub_via を読み、形が崩れていれば T0', () => {
    const fn = { name: 'erase_it', args: [], params: [], kind: 'rpc', shape: 'composite', returns: 'rows', also_writes: {}, self_writes: [], handwritten: 'x' };
    const read = (scrub_via: unknown) => parse({ ...baseData(), functions: [{ ...fn, scrub_via }] });
    expect(read({ entries: ['owner_id'] }).value?.functions[0]?.scrubVia).toEqual({ entries: ['owner_id'] });
    expect(read(['entries']).findings.length).toBeGreaterThan(0);
    expect(read({ entries: [] }).findings.length).toBeGreaterThan(0);
  });

  it('erasure_accept を参照の列・個人列・理由の単位で読む(点検 14 回目 A14-2)', () => {
    const accept = { via: 'handled_by', columns: ['sender_name'], reason: '持ち主は送信者' };
    const declared = parse({ ...baseData(), erasure_accept: [accept] });
    expect(declared.findings).toEqual([]);
    expect(declared.value?.erasureAccepts).toEqual([accept]);
    expect(parse(baseData()).value?.erasureAccepts).toBeUndefined();
  });

  it.each([
    ['via が無い', { columns: ['a'], reason: 'x' }],
    ['columns が無い', { via: 'a', reason: 'x' }],
    ['columns が空', { via: 'a', columns: [], reason: 'x' }],
    ['理由が空', { via: 'a', columns: ['b'], reason: ' ' }],
    ['余分なキー', { via: 'a', columns: ['b'], reason: 'x', table: 'y' }],
  ])('erasure_accept の崩れは T0: %s', (_name, accept) => {
    expect(parse({ ...baseData(), erasure_accept: [accept] }).findings.length).toBeGreaterThan(0);
  });

  it('トリガの copy_accept を列 × 約束の単位で読む(点検 12 回目 A12-2)', () => {
    const accept = [{ column: 'name', on: 'hidden', role: 'member', reader: 'guest', reason: '理由' }];
    const declared = parse({ ...baseData(), triggers: [{ name: 't', function: 't', copy_accept: accept }] });
    expect(declared.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(declared.value?.triggers[0]?.accept).toMatchObject(accept);
    expect(parse(baseData()).value?.triggers[0]).not.toHaveProperty('accept');
  });

  it.each([
    { name: '列が無い', row: { copy_accept: [{ on: 'personal', reason: 'r' }] }, message: 'column がありません' },
    { name: '知らないキー', row: { copy_accept: [{ column: 'c', on: 'personal', reason: 'r', extra: 1 }] }, message: 'extra' },
    { name: 'トリガの綴り違い', row: { copy_acept: [] }, message: 'copy_acept' },
  ])('トリガの読めない形は違反にする: $name', ({ row, message }) => {
    const found = parse({ ...baseData(), triggers: [{ name: 't', function: 't', ...row }] });
    expect(found.findings.some((finding) => finding.message.includes(message)), found.findings.map((finding) => finding.message).join('\n')).toBe(true);
  });

  it('トリガの deferred は既定 false で、書けばそのまま読める(突合される宣言)', () => {
    const withoutDeclaration = parse(baseData());
    const declared = parse({
      ...baseData(),
      triggers: [{ name: 'check_entry_capacity', function: 'check_entry_capacity', deferred: true }],
    });

    expect(withoutDeclaration.value?.triggers[0]?.deferred).toBe(false);
    expect(declared.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(declared.value?.triggers[0]?.deferred).toBe(true);
  });

  it('triggers[].derives は列ごとの {from, offset, mode} を宣言順に字面のまま読む(書かなければ宣言なし)', () => {
    const declared = parse({
      ...baseData(),
      triggers: [
        {
          name: 'fill_times',
          function: 'fill_times',
          fires: 'before insert',
          supplies: ['a_at', 'b_at'],
          derives: {
            a_at: { from: 'start_at', offset: '-14 days', mode: 'initial' },
            b_at: { from: 'end_at', offset: '3 days', mode: 'follow' },
          },
        },
        { name: 'plain', function: 'plain' },
      ],
    });

    expect(declared.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(declared.value?.triggers[0]?.derives).toEqual([
      { column: 'a_at', from: 'start_at', offset: '-14 days', mode: 'initial' },
      { column: 'b_at', from: 'end_at', offset: '3 days', mode: 'follow' },
    ]);
    expect(declared.value?.triggers[1]?.derives).toBeUndefined();
  });

  it('triggers[].derives の末尾の番号の形は {append_within, mode} を読み、幅の形のキーとは混ぜられない(点検 24 回目 B24-1)', () => {
    const trigger = (derives: unknown) =>
      parse({ ...baseData(), triggers: [{ name: 'number_rows', function: 'number_rows', fires: 'before insert', supplies: ['position'], derives }] });
    const errors = (derives: unknown) =>
      trigger(derives).findings.filter((f) => f.severity === 'error').map((f) => f.location.pointer);

    expect(errors({ position: { append_within: 'room_id', mode: 'initial' } })).toEqual([]);
    expect(trigger({ position: { append_within: 'room_id', mode: 'initial' } }).value?.triggers[0]?.derives).toEqual([
      { column: 'position', within: 'room_id', mode: 'initial' },
    ]);
    expect(errors({ position: { append_within: 'room_id', from: 'start_at', mode: 'initial' } })).toEqual(['triggers[0].derives.position.from']);
    expect(errors({ position: { append_within: 'room_id' } })).toEqual(['triggers[0].derives.position.mode']);
    expect(errors({ position: { append_within: "room_id; drop table x; --", mode: 'initial' } }).length).toBeGreaterThan(0);
  });

  it('derives の形の誤り(マッピングでない・3 つのキーが揃わない・知らないキー)は T0 で落ちる', () => {
    const trigger = (derives: unknown) =>
      parse({ ...baseData(), triggers: [{ name: 'fill_times', function: 'fill_times', derives }] });
    const errors = (derives: unknown) =>
      trigger(derives).findings.filter((f) => f.severity === 'error').map((f) => f.location.pointer);

    expect(errors(['a_at'])).toEqual(['triggers[0].derives']);
    expect(errors({ a_at: 'start_at' })).toEqual(['triggers[0].derives.a_at']);
    expect(errors({ a_at: { from: 'start_at', offset: '1 day' } })).toEqual(['triggers[0].derives.a_at.mode']);
    expect(errors({ a_at: { from: 'start_at', offset: '1 day', mode: 'initial', note: 'x' } })).toEqual([
      'triggers[0].derives.a_at.note',
    ]);
    expect(trigger({ a_at: { from: 'start_at', offset: '1 day' } }).value?.triggers[0]?.derives).toEqual([]);
  });

  it('derives / derives.<列> が null なら error だけ出し、落とした行としては数えない(値が無いのは読み飛ばした宣言ではない)。型違いは数える', () => {
    const run = (derives: unknown) => {
      const reporter = new SpecReporter('docs/specs/backend/data/tables/entries.md');
      const result = parseDataTableSpec({ ...baseData(), triggers: [{ name: 'fill_times', function: 'fill_times', derives }] }, 'entries.md', reporter);
      return { errors: result.findings.filter((f) => f.severity === 'error').length, dropped: reporter.droppedCount(), derives: result.value?.triggers[0]?.derives };
    };

    expect(run(null)).toEqual({ errors: 1, dropped: 0, derives: undefined });
    expect(run({ a_at: null })).toEqual({ errors: 1, dropped: 0, derives: [] });
    expect(run(['a_at'])).toMatchObject({ errors: 1, dropped: 1 });
    expect(run({ a_at: 'start_at' })).toMatchObject({ errors: 1, dropped: 1 });
  });

  it('internal: true の内部テーブルは entity 無しで読める', () => {
    const data: Record<string, unknown> = {
      ...baseData(),
      id: 'table-jobs',
      table: 'jobs',
      internal: true,
    };
    delete data['entity'];

    const { value, findings } = parse(data, 'jobs.md');

    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(value?.internal).toBe(true);
  });

  it('id が table-{table} と一致しないとエラー', () => {
    const { findings } = parse({ ...baseData(), id: 'table-entry' });

    expect(findings.some((f) => f.message.includes('table-entries'))).toBe(true);
  });

  it('ファイル名が {table}.md と一致しないとエラー', () => {
    const { findings } = parse(baseData(), 'entry.md');

    expect(findings.some((f) => f.message.includes('一致しません'))).toBe(true);
  });

  it('entity と internal: true の同時宣言はエラー', () => {
    const { findings } = parse({ ...baseData(), internal: true });

    expect(findings.some((f) => f.message.includes('同時に宣言'))).toBe(true);
  });

  it('entity も internal も無いとエラー', () => {
    const data = baseData();
    delete data['entity'];

    const { findings } = parse(data);

    expect(findings.some((f) => f.message.includes('entity も internal'))).toBe(true);
  });

  it('on_delete が値域の外だとその外部キーは落ちる', () => {
    const data = {
      ...baseData(),
      foreign_keys: [{ column: 'workshop_id', references: 'workshops', on_delete: 'delete_all' }],
    };

    const { value, findings } = parse(data);

    expect(findings.some((f) => f.message.includes('値域'))).toBe(true);
    expect(value?.foreignKeys).toEqual([]);
  });

  it('kind が値域の外だとその関数は落ちる', () => {
    const data = {
      ...baseData(),
      functions: [{ name: 'update_entry', args: [], kind: 'procedure' }],
    };

    const { value, findings } = parse(data);

    expect(findings.some((f) => f.message.includes('値域'))).toBe(true);
    expect(value?.functions).toEqual([]);
  });

  it('kind: rpc に shape が無ければエラーになる', () => {
    const data = {
      ...baseData(),
      functions: [{ name: 'update_entry', args: [], kind: 'rpc' }],
    };

    const { findings } = parse(data);

    expect(findings.some((f) => f.message.includes('shape の宣言がありません'))).toBe(true);
  });

  it('shape が値域の外だとエラーになる', () => {
    const data = {
      ...baseData(),
      functions: [{ name: 'update_entry', args: [], kind: 'rpc', shape: 'upsert' }],
    };

    const { value, findings } = parse(data);

    expect(findings.some((f) => f.message.includes('値域'))).toBe(true);
    expect(value?.functions[0]?.shape).toBeUndefined();
  });

  it('kind: rpc でない関数に shape を書くとエラーになる', () => {
    const data = {
      ...baseData(),
      functions: [{ name: 'check_entry_capacity', args: [], kind: 'trigger', shape: 'update' }],
    };

    const { findings } = parse(data);

    expect(findings.some((f) => f.message.includes('shape を宣言できません'))).toBe(true);
  });

  it('composite の RPC は returns を宣言しなければエラーになる(省略を rows とみなして署名の表に書かない)', () => {
    const { findings } = parse({
      ...baseData(),
      functions: [{ name: 'revoke_sessions', args: ['uuid'], kind: 'rpc', shape: 'composite' }],
    });

    expect(findings.some((f) => f.message.includes('returns の宣言がありません'))).toBe(true);
  });

  it('composite の RPC の returns は rows / scalar として読め、値域の外はエラーになる', () => {
    const declared = parse({
      ...baseData(),
      functions: [
        { name: 'claim_entries', args: [], kind: 'rpc', shape: 'composite', returns: 'rows', also_writes: {}, self_writes: ['update'] },
        { name: 'revoke_sessions', args: ['uuid'], kind: 'rpc', shape: 'composite', returns: 'scalar', also_writes: {}, self_writes: [] },
      ],
    });
    expect(declared.findings).toEqual([]);
    expect(declared.value?.functions.map((fn) => fn.returns)).toEqual(['rows', 'scalar']);

    const outside = parse({
      ...baseData(),
      functions: [{ name: 'claim_entries', args: [], kind: 'rpc', shape: 'composite', returns: 'document' }],
    });
    expect(outside.findings.some((f) => f.message.includes('値域'))).toBe(true);
    expect(outside.value?.functions[0]?.returns).toBeUndefined();
  });

  it('定型の RPC とトリガ関数には returns を書けない(定型は常に行の列を返す)', () => {
    for (const fn of [
      { name: 'update_entry', args: [], kind: 'rpc', shape: 'update', returns: 'rows' },
      { name: 'check_entry_capacity', args: [], kind: 'trigger', returns: 'rows' },
    ]) {
      const { findings } = parse({ ...baseData(), functions: [fn] });
      expect(findings.some((f) => f.message.includes('returns を宣言できません')), fn.name).toBe(true);
    }
  });

  it('security はトリガ関数だけが値域の値で宣言でき、省略は宣言なし(= invoker)である', () => {
    const declared = parse({
      ...baseData(),
      functions: [{ name: 'check_entry_capacity', args: [], kind: 'trigger', security: 'definer' }],
    });
    expect(declared.findings).toEqual([]);
    expect(declared.value?.functions[0]?.security).toBe('definer');

    // 省略は「宣言が無い」であり、既定の invoker という意味は期待表の側が与える。
    const omitted = parse({
      ...baseData(),
      functions: [{ name: 'check_entry_capacity', args: [], kind: 'trigger' }],
    });
    expect(omitted.value?.functions[0]?.security).toBeUndefined();

    // 値域の外
    const unknown = parse({
      ...baseData(),
      functions: [{ name: 'check_entry_capacity', args: [], kind: 'trigger', security: 'owner' }],
    });
    expect(unknown.findings.some((f) => f.message.includes('値域'))).toBe(true);
    expect(unknown.value?.functions[0]?.security).toBeUndefined();

    // rpc / helper は必ず definer なので宣言する余地が無い
    const onRpc = parse({
      ...baseData(),
      functions: [{ name: 'update_entry', args: [], kind: 'rpc', shape: 'update', security: 'definer' }],
    });
    expect(onRpc.findings.some((f) => f.message.includes('security を宣言できません'))).toBe(true);
  });

  it('actor_field は helper だけが書け、role とは同時に書けない(境界の補助関数の宣言)', () => {
    const declared = parse({
      ...baseData(),
      functions: [{ name: 'actor_company_id', args: [], kind: 'helper', actor_field: 'company_id' }],
    });
    expect(declared.findings).toEqual([]);
    expect(declared.value?.functions[0]?.actorField).toBe('company_id');
    expect(declared.value?.functions[0]?.role).toBeUndefined();

    const onRpc = parse({
      ...baseData(),
      functions: [{ name: 'update_entry', args: [], kind: 'rpc', shape: 'update', actor_field: 'company_id' }],
    });
    expect(onRpc.findings.some((f) => f.message.includes('actor_field を宣言できません'))).toBe(true);
    expect(onRpc.value?.functions[0]?.actorField).toBeUndefined();

    // 1 本の補助関数が「役が立つか」と「実行者の欄の値」の両方を答えると、本文の正が 2 つになる。
    const both = parse({
      ...baseData(),
      functions: [{ name: 'is_member', args: [], kind: 'helper', role: 'member', actor_field: 'company_id' }],
    });
    expect(both.findings.some((f) => f.message.includes('role と actor_field を両方宣言しています'))).toBe(true);
    expect(both.value?.functions[0]?.actorField).toBeUndefined();
  });

  it('handwritten が空文字だとエラーになり、宣言としては載らない(理由の無い免除を作らない)', () => {
    const data = {
      ...baseData(),
      functions: [{ name: 'update_entry', args: [], kind: 'rpc', shape: 'update', handwritten: '   ' }],
    };

    const { value, findings } = parse(data);

    expect(findings.some((f) => f.message.includes('handwritten が空です'))).toBe(true);
    expect(value?.functions[0]?.handwritten).toBeUndefined();
  });

  it('lookup はどの種別の関数にも書け、宣言順の列の並びとして読める(無ければ宣言なし)', () => {
    const declared = parse({
      ...baseData(),
      functions: [
        { name: 'check_entry_capacity', args: [], kind: 'trigger', lookup: ['workshop_id', 'created_at'] },
        { name: 'claim_entries', args: [], kind: 'rpc', shape: 'composite', returns: 'rows', lookup: ['state'], also_writes: {}, self_writes: ['update'] },
        { name: 'plain', args: [], kind: 'trigger' },
      ],
    });

    expect(declared.findings).toEqual([]);
    expect(declared.value?.functions.map((fn) => fn.lookup)).toEqual([['workshop_id', 'created_at'], ['state'], undefined]);
  });

  it('lookup が空・列名がスネークケースでない・重複していればエラーで、宣言としては載らない', () => {
    const cases: readonly [unknown, string][] = [
      [[], 'lookup が空です'],
      [['Bad Column'], 'スネークケースではありません'],
      [['a', 'b', 'a'], '重複しています'],
    ];
    for (const [lookup, message] of cases) {
      const { value, findings } = parse({
        ...baseData(),
        functions: [{ name: 'check_entry_capacity', args: [], kind: 'trigger', lookup }],
      });

      expect(findings.some((f) => f.message.includes(message))).toBe(true);
      expect(value?.functions[0]?.lookup).toBeUndefined();
    }
  });

  it('lookup がリストでなければ読めない旨だけを言う(空の二重報告をしない)', () => {
    const { value, findings } = parse({
      ...baseData(),
      functions: [{ name: 'check_entry_capacity', args: [], kind: 'trigger', lookup: 'a' }],
    });

    expect(findings.some((f) => f.message.includes('lookup が空です'))).toBe(false);
    expect(findings.length).toBeGreaterThan(0);
    expect(value?.functions[0]?.lookup).toBeUndefined();
  });

  it('インデックス名の重複はエラーになり後勝ちしない', () => {
    const data = {
      ...baseData(),
      indexes: [
        { name: 'dup_idx', on: ['a'] },
        { name: 'dup_idx', on: ['b'] },
      ],
    };

    const { value, findings } = parse(data);

    expect(findings.some((f) => f.message.includes('重複'))).toBe(true);
    expect(value?.indexes).toHaveLength(1);
  });

  it('sequences の increment は無くなった欄として名指しで落ちる(刻みは常に 1)', () => {
    const data = {
      ...baseData(),
      sequences: [{ name: 'entries_no_seq', start: 10, increment: 2 }],
    };

    const { value, findings } = parse(data);

    const hit = findings.find((f) => f.message.includes('increment は書けません'));
    expect(hit?.severity).toBe('error');
    expect(hit?.location.pointer).toBe('sequences[0].increment');
    expect(hit?.message).toContain('刻みは常に 1');
    expect(value?.sequences).toEqual([{ name: 'entries_no_seq', start: 10 }]);
  });

  it('test_cases が無いと落ちるが宣言自体は構築される(欠落は 1 か所ずつ指摘)', () => {
    const data = baseData();
    delete data['test_cases'];

    const { value, findings } = parse(data);

    expect(findings.some((f) => f.location.pointer === 'test_cases')).toBe(true);
    expect(value).not.toBeNull();
    expect(value?.testCases).toEqual([]);
  });
});

describe('retention_hours(保持の時間。点検 21 回目 A21-1)', () => {
  const digests = (extra: Record<string, unknown>): Record<string, unknown> => ({
    doc_type: 'data_table',
    id: 'table-resend_digests',
    table: 'resend_digests',
    internal: true,
    framework: 'resend_digests',
    ...extra,
  });

  it.each([
    ['正の整数', digests({ retention_hours: 24 }), 24, 0],
    ['書かない(要るかは Y12 が見る)', digests({}), undefined, 0],
    ['0', digests({ retention_hours: 0 }), undefined, 1],
    ['小数', digests({ retention_hours: 1.5 }), undefined, 1],
    ['負', digests({ retention_hours: -1 }), undefined, 1],
    ['文字列', digests({ retention_hours: '24 hours' }), undefined, 1],
    ['ほかの設計図の表', digests({ framework: 'jobs', table: 'jobs', id: 'table-jobs', retention_hours: 24 }), undefined, 1],
    ['設計図の無い表', { ...baseData(), retention_hours: 24 }, undefined, 1],
  ] as const)('%s', (_label, data, hours, errors) => {
    const { value, findings } = parse({ ...data }, `${String((data as { table?: string }).table ?? 'entries')}.md`);
    expect(findings.filter((finding) => finding.severity === 'error' && finding.location.pointer === 'retention_hours')).toHaveLength(errors);
    expect(value?.retentionHours).toBe(hours);
  });
});
