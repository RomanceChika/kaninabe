/**
 * 書く参照の列の新しい親と先掴みの順の照合(`rpc-fk-check-order.ts`。点検 fix26 3 回目 D26c-1・D26c-2)のユニットテスト。
 *
 * - 照合はデータ(掴みの計画の行の決まり方・表・強さ・順番)の上: 引数が違う・言えない行・順が逆・同じ表の別の文・同じ表の別の行は覆いにならない
 * - 自分の表を指す参照に掴みの宣言(`locks: { nodes: update }`)を足しても断る(点検 fix26 4 回目 D26d-2 の self-lock の形)。断りの文言は locks を勧めない
 * - 点検の台本の宣言(round3/p/gen.mts の遷移 T・自分の表への参照 N)と、d79cbf7bc が先掴みを足していた編集の形は**生成を断る**
 *   (T6 も同じ宣言を名指す)
 * - 題材の生成 RPC の組は閉じた表(製品の 6 組は dev-repo/ の側): 覆いのある 1 組・覆いの無い組 0
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fkCheckPairs, fkCheckOrderProblems, type WrittenRef } from '../../../lib/sql/rpc-fk-check-order.js';
import type { LockTarget } from '../../../lib/sql/rpc-body-lock.js';
import { writtenRow, type RowId } from '../../../lib/sql/rpc-row-id.js';
import { buildRpcBody } from '../../../lib/sql/rpc-body.js';
import { collectRpcFacts, type RpcFactsInput } from '../../../lib/sql/rpc-facts.js';
import { verifyRpcMigration } from '../../../lib/data/verifiers/t6-rpc-migration.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import { TEST_PLATFORM } from '../../helpers/platform.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { accessSpec, aggregate, entitySpec, event, field, machine, role, roleSpec, specModel, write } from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import { fkCheckCoveredOf, fkCheckRefusalsOf, multiTableLockPlansOf, outOfOrder, outOfOrderLocksOf, sameTableStatementsOf } from '../../helpers/fk-check-order-pairs.js';

/** 計画の 1 行(照合が読む欄だけを意味のある値にする)。 */
function lock(table: string, alias: string, mode: 'share' | 'update', ids: readonly RowId[], createKey = false): LockTarget {
  return { table, key: alias, alias, from: [], where: [], order: null, mode, ids, ...(createKey ? { createKey: true as const } : {}) };
}

const REF: WrittenRef = { column: 'parent_id', parent: 'parents', value: writtenRow('parent_id') };

describe('fkCheckPairs(データの照合)', () => {
  it('排他の行より前に同じ値の行を共有で掴んでいれば覆い(別の表)', () => {
    const plan = [lock('parents', 'c0', 'share', [writtenRow('parent_id')]), lock('things', 't', 'update', [])];
    expect(fkCheckPairs([REF], plan)).toEqual([{ exclusive: 'things', exclusiveAlias: 't', column: 'parent_id', parent: 'parents', coveredBy: 'c0' }]);
  });

  it('排他の行そのものが同じ値の親の行なら覆い(同じ表)', () => {
    const plan = [lock('parents', 'g0', 'update', [writtenRow('parent_id')])];
    expect(fkCheckPairs([REF], plan).map((pair) => pair.coveredBy)).toEqual(['g0']);
  });

  it.each<[string, readonly LockTarget[]]>([
    ['引数が違う(親の表を別の参照列の値で掴む)', [lock('parents', 'c0', 'share', [writtenRow('other_id')]), lock('things', 't', 'update', [])]],
    ['決まり方の言えない行(書く前の値・実行者の行・副問い合わせ。字面が同じでも数えない)', [lock('parents', 'l0', 'share', []), lock('things', 't', 'update', [])]],
    ['順が逆(同じ表で、同じ値の行を排他の後ろの別の文で掴む)', [lock('parents', 't', 'update', []), lock('parents', 'c0', 'share', [writtenRow('parent_id')])]],
    ['同じ表の別の文の排他(同じ値の行を排他で先に掴んでも、対象の行は別の文。点検 fix26 4 回目 D26d-2)', [lock('parents', 'c0', 'update', [writtenRow('parent_id')]), lock('parents', 't', 'update', [])]],
    ['同じ表の別の行(対象の行だけを掴む)', [lock('parents', 't', 'update', [])]],
  ])('覆いにならない: %s', (_name, plan) => {
    expect(fkCheckPairs([REF], plan).filter((pair) => pair.coveredBy === null).length).toBeGreaterThan(0);
  });

  it('作成の冪等キーの行だけの排他・名前の順で後ろの親は組にしない', () => {
    expect(fkCheckPairs([REF], [lock('things', 't', 'update', [], true)])).toEqual([]);
    expect(fkCheckPairs([{ ...REF, parent: 'zz_parents' }], [lock('things', 't', 'update', [])])).toEqual([]);
  });
});

/** 点検の台本 round3/p/gen.mts と同じ宣言(staffs = 実行者の集約・tickets の遷移・nodes の自己参照)。 */
const ROLES = roleSpec([role('member'), role('anonymous'), role('system'), { ...role('admin', undefined, ['member']), claim: 'staff.is_admin' }]);
const STAFF = aggregate('staff', {
  entity: entitySpec('staff', {
    fields: [
      field('id', { kind: 'uuid' }),
      field('name', { kind: 'string' }, { required: true, session: true }),
      field('is_admin', { kind: 'boolean' }, { session: true }),
      field('shop_id', { kind: 'ref', entity: 'shop' }),
    ],
  }),
  access: accessSpec('staff', { writes: [write('admin', ['name', 'shop_id'])] }),
});
const SHOP = aggregate('shop', { entity: entitySpec('shop', { fields: [field('id', { kind: 'uuid' }), field('name', { kind: 'string' })] }) });
const TICKET = aggregate('ticket', {
  entity: entitySpec('ticket', { context: { ticket: 'ticket.id' }, fields: [field('id', { kind: 'uuid' }), field('state', { kind: 'state', machine: 'ticket' }), field('handler_id', { kind: 'ref', entity: 'staff' })] }),
  access: accessSpec('ticket', { transitionWrites: [] }),
  stateMachines: [
    machine('ticket', {
      states: ['open', 'held'],
      initial: 'open',
      events: [event('take', { from: ['open'], to: 'held', by: ['admin'], recordsActor: ['handler_id'] }), event('assign', { from: ['open'], to: 'held', by: ['admin'] })],
    }),
  ],
});
const NODE = aggregate('node', {
  entity: entitySpec('node', { fields: [field('id', { kind: 'uuid' }), field('label', { kind: 'string' }), field('parent_id', { kind: 'ref', entity: 'node' })] }),
  access: accessSpec('node', { writes: [write('admin', ['label', 'parent_id'])] }),
});
const DOMAIN = specModel([STAFF, SHOP, TICKET, NODE], ROLES);
const TABLES: Readonly<Record<string, string>> = { staff: 'staffs', shop: 'shops', ticket: 'tickets', node: 'nodes' };
const EDIT = { args: ['uuid', 'jsonb', 'uuid', 'text[]', 'text[]'] } as const;
const TRANSITION = {
  params: ['p_ticket_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_actor_roles', 'p_handler_id'],
  args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]', 'uuid'],
} as const;

/** 1 本の宣言(関数・表・action_spec)。 */
interface Declared {
  readonly name: string;
  readonly shape: 'update' | 'transition';
  readonly entity: string;
  readonly params: readonly string[];
  readonly args: readonly string[];
  readonly foreignKeys: DataTableSpec['foreignKeys'];
  readonly actions: readonly ReturnType<typeof actionSpec>[];
  /** 表のトリガ(掴みの宣言 `locks` を足す形だけ)。 */
  readonly triggers?: DataTableSpec['triggers'];
}

const T_ASSIGN: Declared = {
  name: 'apply_ticket_transition',
  shape: 'transition',
  entity: 'ticket',
  ...TRANSITION,
  foreignKeys: [{ column: 'handler_id', references: 'staffs', onDelete: 'no_action' }],
  actions: [actionSpec({ handles: 'ticket.assign', input: ['ticket.handler_id'] }), actionSpec({ handles: 'ticket.take', input: [] })],
};
const N_SELF: Declared = {
  name: 'update_node',
  shape: 'update',
  entity: 'node',
  params: ['p_node_id', 'p_changes', 'p_actor_id', 'p_actor_roles', 'p_effects'],
  ...EDIT,
  foreignKeys: [{ column: 'parent_id', references: 'nodes', onDelete: 'no_action' }],
  actions: [actionSpec({ handles: 'node.update', input: ['node.label', 'node.parent_id'] })],
};
const STAFF_SHOP: Declared = {
  name: 'update_staff',
  shape: 'update',
  entity: 'staff',
  params: ['p_staff_id', 'p_changes', 'p_actor_id', 'p_actor_roles', 'p_effects'],
  ...EDIT,
  foreignKeys: [{ column: 'shop_id', references: 'shops', onDelete: 'no_action' }],
  actions: [actionSpec({ handles: 'staff.update', input: ['staff.name', 'staff.shop_id'] })],
};

/** 宣言を生成器と T6 の入力にする。 */
function inputOf(spec: Declared): { readonly input: RpcFactsInput & Parameters<typeof buildRpcBody>[0]; readonly table: DataTableSpec } {
  const fn = { name: spec.name, args: spec.args, params: spec.params, kind: 'rpc', shape: spec.shape, alsoWrites: [], migration: `20260101000001_rpc_${spec.name}.sql` } as const;
  const table = dataTable(TABLES[spec.entity] ?? '', {
    entity: spec.entity,
    foreignKeys: spec.foreignKeys,
    ...(spec.triggers === undefined ? {} : { triggers: spec.triggers }),
    resend: { returnsExisting: false, location: { file: 'x.md', pointer: 'resend' } },
    functions: [fn as unknown as DataTableSpec['functions'][number]],
  });
  const actions = { actions: [...spec.actions], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] };
  return {
    table,
    input: { name: spec.name, params: spec.params, args: spec.args, shape: spec.shape, table, tables: [table], domain: DOMAIN, tableOf: (entity: string) => TABLES[entity] ?? null, actions, specFiles: ['x.md'], entityLabel: spec.entity, platform: TEST_PLATFORM },
  };
}

describe('生成を断る宣言(点検の台本の T・N と、先掴みを足していた編集の形)', () => {
  it.each<[string, Declared, string, string]>([
    ['遷移: records_actor の引数の枝で別の実行者を書く(D26c-1 の T)', T_ASSIGN, 'tickets.handler_id', 'staffs'],
    ['編集: 自分の表を指す参照の列を書く(D26c-2 の N)', N_SELF, 'nodes.parent_id', 'nodes'],
    ['編集: 実行者の表の別の行の参照の列を書く(d79cbf7bc の形)', STAFF_SHOP, 'staffs.shop_id', 'shops'],
  ])('%s', (_name, spec, column, parent) => {
    const { input } = inputOf(spec);
    const built = buildRpcBody(input);
    expect(built.ok).toBe(false);
    const messages = built.ok ? [] : built.problems.map((problem) => problem.message);
    expect(messages.some((message) => message.includes(column) && message.includes(`親 ${parent}`))).toBe(true);
  });

  it('T6 が同じ宣言を宣言の時点で名指す', () => {
    for (const spec of [T_ASSIGN, N_SELF, STAFF_SHOP]) {
      const { table } = inputOf(spec);
      const others = Object.entries(TABLES).filter(([entity]) => entity !== spec.entity).map(([entity, name]) => dataTable(name, { entity }));
      const findings = verifyRpcMigration(DOMAIN, dataTableModel([table, ...others]), { actions: [...spec.actions], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] });
      expect(findings.filter((finding) => finding.message.includes('先掴みが同じ値で先に掴んでいません')).map((finding) => finding.location.pointer)).toEqual([`functions.${spec.name}`]);
    }
  });

  it('遷移の records_actor が実行者しか入れない形も断る(値が実行者の行だと言う語を持たない = 言えない側。製品と題材に該当 0。点検 fix26 4 回目の観点 3)', () => {
    const actorOnly: Declared = { ...T_ASSIGN, actions: [actionSpec({ handles: 'ticket.assign', input: [] }), actionSpec({ handles: 'ticket.take', input: [] })] };
    expect(buildRpcBody(inputOf(actorOnly).input).ok).toBe(false);
  });

  it('自分の表を指す参照: 掴みの宣言が無ければ断り、文言は locks の宣言(同じ表なら 1 文に畳まれる)か手書きを勧める(点検 fix26 6 回目 D26f-4)', () => {
    const built = buildRpcBody(inputOf(N_SELF).input);
    expect(built.ok ? [] : built.problems.map((problem) => problem.suggestion.includes('locks') && problem.suggestion.includes('1 文に id の順で畳まれる'))).toEqual([true]);
  });

  it.each(['share', 'update'] as const)('自分の表を指す参照に掴みの宣言 locks: { nodes: %s } を足すと、対象の行と新しい親の行が 1 文に id の順で畳まれて通る(点検 fix26 5 回目 D26e-1。4 回目の self-lock の形の文の順の輪は閉じる)', (mode) => {
    const trigger = { name: 'check_node', functionName: 'check_node', fires: 'before update of parent_id', deferred: false, supplies: [], params: {}, locks: { nodes: mode } };
    const built = buildRpcBody(inputOf({ ...N_SELF, triggers: [trigger] }).input);
    expect(built.ok).toBe(true);
    const sql = built.ok ? built.sql : '';
    expect([...sql.matchAll(/ {4}perform 1\n {4}from public\.nodes (\w+)\n/gu)].map((match) => match[1])).toEqual(['lm0']); // 先掴みの文(perform 1)だけを数える
    expect(sql).toMatch(/ {4}from public\.nodes lm0\n {4}where lm0\.id in \(select [^\n]+ union select [^\n]+\)\n {4}order by lm0\.id\n {4}for update of lm0;/u);
  });

  it('遷移の断りの文言は locks を勧めない(遷移が書く参照の列は書いた後の値の掴みの語を持たない。点検 fix26 5 回目 D26e-2)', () => {
    const built = buildRpcBody(inputOf(T_ASSIGN).input);
    expect(built.ok ? [] : built.problems.map((problem) => problem.suggestion.includes('locks'))).toEqual([false]);
  });

  it('対照: 親の名前が排他で掴む表より後ろなら断らない(確かめの key share が表名の順のとおりに来る)', () => {
    const control: Declared = { ...STAFF_SHOP, foreignKeys: [{ column: 'shop_id', references: 'zz_shops', onDelete: 'no_action' }] };
    expect(buildRpcBody(inputOf(control).input).ok).toBe(true);
  });

  it('書き換えてよい列は action_spec が受けなくても書く参照の列に数える(編集の代入は書き換えてよい列の全部に掛かる)', () => {
    const narrowed: Declared = { ...STAFF_SHOP, actions: [actionSpec({ handles: 'staff.update', input: ['staff.name'] })] };
    const { input } = inputOf(narrowed);
    const facts = collectRpcFacts(input);
    expect(facts.ok ? fkCheckOrderProblems(input, facts.facts).map((problem) => problem.counterexample.column) : ['事実が集まらない']).toEqual(['shop_id']);
  });
});

const SAMPLES_DIR = fileURLToPath(new URL('../../fixtures/samples/', import.meta.url));
const SAMPLES = ['archive', 'expenses', 'stores', 'dual_actors', 'library', 'rooms'];

describe('題材の生成 RPC(閉じた表。製品の表は dev-repo/unit/sql/rpc-fk-check-order-product.test.ts)', () => {
  it('覆いの無い組は 0(断りが 1 つも無い)', () => {
    for (const name of SAMPLES) expect(fkCheckRefusalsOf(path.join(SAMPLES_DIR, name)), name).toEqual([]);
  });

  it('どの表も、先掴みの計画の中で 1 文まで(強さを問わず。点検 fix26 5 回目 D26e-1・6 回目 D26f-1)', () => {
    for (const name of SAMPLES) expect(sameTableStatementsOf(path.join(SAMPLES_DIR, name)), name).toEqual([]);
  });

  it('先掴みの計画は表名のバイト順(生成器の性質。点検 27 回目の決め: 生成物はこの順で掴み、手書きはやり直しに頼る)', () => {
    for (const name of SAMPLES) expect(outOfOrderLocksOf(path.join(SAMPLES_DIR, name)), name).toEqual([]);
    // 照らす相手が無いまま緑にしない(表が 2 つ以上の計画を持つ題材が 1 つはある)。
    expect(SAMPLES.reduce((sum, name) => sum + multiTableLockPlansOf(path.join(SAMPLES_DIR, name)), 0)).toBeGreaterThan(0);
  });

  it('順の照らしそのものが効く(逆順を作れば名指す・同じ表の続きと昇順は名指さない)', () => {
    expect(outOfOrder(['staff_members', 'shops'])).toEqual(['staff_members → shops']);
    expect(outOfOrder(['books', 'loans', 'loans', 'shelves'])).toEqual([]);
    // バイト順: 'loans' < 'loans_log'('_' は文字の後ろではなく、続きが無い方が前)。
    expect(outOfOrder(['loans_log', 'loans'])).toEqual(['loans_log → loans']);
  });

  it('名前の順で前か同じ表の親の組は、覆いのある 1 組だけ(既存の閉包の掴みが書いた後の値で先に掴む。実行者の行と同じ表なので 1 文 lm0 に畳まれる)', () => {
    expect(SAMPLES.flatMap((name) => fkCheckCoveredOf(path.join(SAMPLES_DIR, name)))).toEqual(['update_store stores←manager_id:staff_members by lm0']);
  });
});
