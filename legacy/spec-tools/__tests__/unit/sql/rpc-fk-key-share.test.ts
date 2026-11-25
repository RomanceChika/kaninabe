/**
 * 生成 RPC の先掴みと、書き込みの外部キーの確かめ(親に掛かる `for key share`)の順の**閉じた表**(点検 fix26 2 回目 D26b-1)。
 *
 * 外部キーの確かめは、子の行を入れる・参照の列を書き換えるときに親の行を `for key share` で掴む。`for key share` は
 * `for update` とだけ衝突する。先掴みが**排他(`for update`)で掴んだ表**より名前の順で前の親を、先掴みの外で
 * 書き込みの確かめが掴むと、「親を排他で掴んでから自分の表の行を掴む」別の生成 RPC と 40P01 の輪になる
 * (実測: 作る表 = 実行者の表の作成が実行者の行を排他で掴み、挿入の確かめが親 `shops` を待つ間に、
 * `shops` を排他で掴んで実行者の行を共有で掴む txn と詰まった。実 DB の見張りは `__tests__/sql/create-key-lock-actor-table.integration.test.ts`)。
 *
 * ここでは生成の形ごとに、その組(排他で掴む表 ← 名前の順で前の、先掴みに無い親)を本文から読み、**期待の組を閉じた表で**持つ。
 * 表の行は形ごとに理由を書く。表に無い組が現れたら赤(新しい輪の候補)、表の組が消えても赤(表を直す)。
 * 生成器が先掴みの照合で断る形(点検 fix26 3 回目 D26c-1・D26c-2。`rpc-fk-check-order.ts`)は、断りの名指しを見る。
 */

import { TEST_PLATFORM } from '../../helpers/platform.js';
import { describe, expect, it } from 'vitest';
import { buildRpcBody } from '../../../lib/sql/rpc-body.js';
import { dataTable } from '../../helpers/data-builder.js';
import { accessSpec, aggregate, create, entitySpec, field, role, roleSpec, specModel, write } from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import type { SpecModel } from '../../../lib/model/types.js';

/** 店(shops)・従業員(staffs。実行者の集約で店を指す)・区画(zones。店を指す)。名前の順は shops < staffs < zones。 */
function domain(): SpecModel {
  return specModel(
    [
      aggregate('shop', { entity: entitySpec('shop', { fields: [field('id', { kind: 'uuid' }), field('name', { kind: 'string' })] }) }),
      aggregate('staff', {
        entity: entitySpec('staff', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('name', { kind: 'string' }, { required: true, session: true }),
            field('is_admin', { kind: 'boolean' }, { session: true }),
            field('shop_id', { kind: 'ref', entity: 'shop' }),
          ],
        }),
        access: accessSpec('staff', { creates: [create('admin')], writes: [write('admin', ['shop_id'])] }),
      }),
      aggregate('zone', {
        entity: entitySpec('zone', { fields: [field('id', { kind: 'uuid' }), field('label', { kind: 'string' }), field('shop_id', { kind: 'ref', entity: 'shop' })] }),
        access: accessSpec('zone', { creates: [create('admin')] }),
      }),
    ],
    roleSpec([role('member'), role('anonymous'), role('system'), { ...role('admin', undefined, ['member']), claim: 'staff.is_admin' }]),
  );
}

const TABLES: Readonly<Record<string, string>> = { shop: 'shops', staff: 'staffs', zone: 'zones' };

/** 生成の形 1 つ。 */
interface Shape {
  readonly entity: 'staff' | 'zone';
  readonly shape: 'create' | 'update';
  readonly params: readonly string[];
  readonly args: readonly string[];
  /** 外部キーの参照先の表(既定は `shops`。名前の順で後ろの親の形を作るときだけ変える)。 */
  readonly parent?: string;
}

const CREATE = { params: ['p_id', 'p_values', 'p_actor_id', 'p_actor_roles'], args: ['uuid', 'jsonb', 'uuid', 'text[]'] } as const;
const UPDATE = {
  params: ['p_staff_id', 'p_changes', 'p_actor_id', 'p_actor_roles', 'p_effects'],
  args: ['uuid', 'jsonb', 'uuid', 'text[]', 'text[]'],
} as const;

/** 1 本の定型 RPC を組み立てる(断られたら理由を投げる)。 */
function build(spec: Shape): string {
  const result = buildOf(spec);
  if (!result.ok) throw new Error(result.problems.map((problem) => problem.message).join('\n'));
  return result.sql;
}

/** 1 本の定型 RPC の組み立ての結果(断りも返す)。 */
function buildOf(spec: Shape): ReturnType<typeof buildRpcBody> {
  const table = TABLES[spec.entity] ?? '';
  const verb = spec.shape === 'create' ? 'insert' : 'update';
  const fn = { name: `${verb}_${spec.entity}`, args: spec.args, params: spec.params, kind: 'rpc', shape: spec.shape, alsoWrites: [] } as const;
  const result = buildRpcBody({
    name: fn.name,
    params: spec.params,
    args: spec.args,
    shape: spec.shape,
    table: dataTable(table, {
      entity: spec.entity,
      foreignKeys: [{ column: 'shop_id', references: spec.parent ?? 'shops', onDelete: 'no_action' }],
      resend: { returnsExisting: false, location: { file: 'x.md', pointer: 'resend' } },
      functions: [fn as unknown as DataTableSpec['functions'][number]],
    }),
    domain: domain(),
    tableOf: (entity) => TABLES[entity] ?? null,
    actions: {
      actions: [actionSpec({ handles: `${spec.entity}.${spec.shape}`, input: spec.entity === 'staff' ? ['staff.name', 'staff.shop_id'] : ['zone.label', 'zone.shop_id'] })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
    specFiles: ['x.md'],
    entityLabel: spec.entity,
    platform: TEST_PLATFORM,
  });
  return result;
}

/** 本文の先掴み(`perform 1 from … for {強さ} of {別名};`)を、表と強さで読む。 */
function preLocks(sql: string): readonly { readonly table: string; readonly mode: string }[] {
  return [...sql.matchAll(/ {4}perform 1\n {4}from ([^\n]+)\n(?:[^\n]*\n)*? {4}for (share|update) of (\w+);/gu)].map((match) => {
    const found = new RegExp(`public\\.(\\w+) ${match[3] ?? ''}\\b`, 'u').exec(match[1] ?? '');
    return { table: found?.[1] ?? '?', mode: match[2] ?? '' };
  });
}

/** 本文が行を入れる・書き換える表(`insert into public.{表}` / `update public.{表}`。監査ログは親を持たないので数えない)。 */
function writtenTables(sql: string): readonly string[] {
  return [...new Set([...sql.matchAll(/\b(?:insert\s+into|update)\s+public\.(\w+)/gu)].map((match) => match[1] ?? '').filter((name) => name !== 'domain_events'))];
}

/** 表の外部キーの親(ドメインの ref の欄から)。 */
function parentsOf(table: string): readonly string[] {
  const entity = Object.entries(TABLES).find(([, name]) => name === table)?.[0];
  const spec = entity === undefined ? undefined : domain().aggregates.get(entity)?.entity;
  return (spec?.fields ?? []).flatMap((item) => (item.type.kind === 'ref' ? [TABLES[item.type.entity] ?? ''] : []));
}

/**
 * 組(排他で掴む表 ← 名前の順で前にあり、先掴みに無い親)。
 *
 * @param sql 生成した本文
 * @returns `{排他で掴む表}←{親}` の並び(重複なし・辞書順)
 */
function inversions(sql: string): readonly string[] {
  const locks = preLocks(sql);
  const held = new Set(locks.map((lock) => lock.table));
  const exclusive = locks.filter((lock) => lock.mode === 'update').map((lock) => lock.table);
  const parents = writtenTables(sql).flatMap(parentsOf).filter((parent) => !held.has(parent));
  return [...new Set(exclusive.flatMap((table) => parents.filter((parent) => parent < table).map((parent) => `${table}←${parent}`)))].sort();
}

describe('排他の先掴みと外部キーの確かめの順(閉じた表)', () => {
  it.each<[string, Shape, readonly string[], string]>([
    [
      '作成: 作る表 = 実行者の表(実行者の行と冪等キーの行を 1 文で掴む)',
      { entity: 'staff', shape: 'create', ...CREATE },
      [],
      '共有で掴む(冪等キーの行は消す txn を待てば足り、共有は削除の排他と衝突する)。排他で掴むと親 shops の key share と輪になる(D26b-1)',
    ],
    [
      '作成: 作る表 ≠ 実行者の表(冪等キーの行を作る表で排他に掴む)',
      { entity: 'zone', shape: 'create', ...CREATE },
      ['zones←shops'],
      '受け入れ: 冪等キーの行が既にあれば挿入の前の再送の枝で返り(外部キーの確かめに進まない)、無ければ掴みは 0 行で何も持たない',
    ],
  ])('%s', (_name, shape, expected) => {
    expect(inversions(build(shape))).toEqual(expected);
  });

  it('編集: 実行者の表の別の行の参照の列を書く形は生成を断る(書く値の親 shops を先掴みが同じ値で掴まない。照合は rpc-fk-check-order.ts)', () => {
    const result = buildOf({ entity: 'staff', shape: 'update', ...UPDATE });
    expect(result.ok ? [] : result.problems.map((problem) => problem.counterexample)).toEqual([
      { function: 'update_staff', table: 'staffs', column: 'shop_id', parent: 'shops', exclusive: 'staffs' },
    ]);
  });

  it('対照: 親の名前が排他で掴む表より後ろなら生成する(確かめの key share が表名の順のとおりに来る)', () => {
    expect(buildOf({ entity: 'staff', shape: 'update', ...UPDATE, parent: 'stores' }).ok).toBe(true);
  });

  it('作る表 = 実行者の表の作成は、実行者の行と冪等キーの行を 1 文で共有に掴む(排他で掴まない)', () => {
    const sql = build({ entity: 'staff', shape: 'create', ...CREATE });
    expect(sql).toContain('    from public.staffs la\n    where la.id in (p_actor_id, p_id)\n    order by la.id\n    for share of la;');
    expect(sql).not.toContain('for update of la;');
  });
});
