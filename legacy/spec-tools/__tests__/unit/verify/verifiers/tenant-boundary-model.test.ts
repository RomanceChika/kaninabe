/**
 * テナントの境界のモデルの取りこぼし 2 つ(点検 7 回目 A7-5)のユニットテスト。
 *
 * 表 1(`boundaryFields`): `actor.{欄}` がどこに現れたら境界の欄になるか —— `reads[].filters`・`reads[].when`(A7-5 で足した)・
 * 作成 / 編集 / 削除の `when`・遷移の `guard`・`session: true` の参照の欄。`actor.id` は境界にしない。
 * 表 2(`rawReach`): 生の参照の鎖の長さで「届く」が切り替わらないこと —— 上限(`MAX_RAW_DEPTH`)を超える鎖は「届かない」でなく
 * 「届く」に倒す(fail-closed)。循環は届かない(境界の列の無い輪)。
 */

import { describe, expect, it } from 'vitest';
import {
  boundaryFields,
  MAX_RAW_DEPTH,
  rawReach,
} from '../../../../lib/verify/verifiers/tenant-boundary-model.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
  entitySpec,
  event,
  field,
  machine,
  readRule,
  role,
  specModel,
  stubContext,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import type { EntitySpec, ReadRule, SpecModel } from '../../../../lib/model/types.js';

/** 境界の欄の使われ方 1 つ(どの口に `actor.region` を書くか)。 */
type Site = 'none' | 'filters' | 'reads_when' | 'create_when' | 'write_when' | 'delete_when' | 'guard' | 'actor_id_only';

/** 実行者の集約(staff)と、`actor.region` をどこかで使う store の 2 集約。region は session でない欄。 */
function boundaryModel(site: Site): SpecModel {
  const read: ReadRule =
    site === 'filters'
      ? { ...readRule('staff', { kind: 'all' }), filters: [{ field: 'region', actorField: 'region' }] }
      : site === 'reads_when'
        ? readRule('staff', { kind: 'all' }, 'store.region == actor.region')
        : site === 'actor_id_only'
          ? readRule('staff', { kind: 'all' }, 'store.owner_id == actor.id')
          : readRule('staff', { kind: 'all' });
  const when = 'store.region == actor.region';
  return specModel({
    roles: [role('anonymous'), role('system'), role('staff')],
    aggregates: [
      aggregate({
        name: 'staff',
        entity: entitySpec('staff', [
          field('display_name', { kind: 'string' }, { session: true }),
          field('region', { kind: 'string' }),
        ]),
        access: accessSpec('staff', { reads: [readRule('staff', { kind: 'own' })] }),
      }),
      aggregate({
        name: 'store',
        entity: entitySpec('store', [field('region', { kind: 'string' }), field('owner_id', { kind: 'ref', entity: 'staff' })]),
        access: accessSpec('store', {
          reads: [read],
          creates: [createRule('staff', site === 'create_when' ? when : undefined)],
          writes: [writeRule('staff', ['region'], site === 'write_when' ? when : undefined)],
          deletes: [deleteRule('staff', site === 'delete_when' ? when : undefined)],
        }),
        stateMachines:
          site === 'guard'
            ? [machine({ machine: 'store_state', states: ['open', 'closed'], events: [event({ id: 'close', from: ['open'], to: 'closed', guard: when })] })]
            : [],
      }),
    ],
  });
}

describe('boundaryFields: actor.{欄} の現れる口(A7-5 で reads[].when を足した)', () => {
  it.each([
    ['どこにも書かない → 境界でない', 'none', []],
    ['reads の filters の右辺 → 境界', 'filters', ['region']],
    // A7-5 の反例: 可視性の条件(RLS の using に入る)にだけ現れる欄が、以前は「境界でない」だった。
    ['reads の when(可視性の条件)だけ → 境界', 'reads_when', ['region']],
    ['作成の when → 境界', 'create_when', ['region']],
    ['編集の when → 境界', 'write_when', ['region']],
    ['削除の when → 境界', 'delete_when', ['region']],
    ['遷移の guard → 境界', 'guard', ['region']],
    ['境界: reads の when でも actor.id は境界にしない(同一性)', 'actor_id_only', []],
  ] as const)('%s', (_title, site, expected) => {
    const { ctx } = stubContext({});
    expect(boundaryFields(boundaryModel(site), ctx).map((boundary) => boundary.name)).toEqual(expected);
  });
});

/**
 * 鎖 `e0 → e1 → … → e{length}` を作る(各段は次を指す参照の欄 `next_id` だけを持つ)。
 * 末端 `e{length}` だけが境界の列 `company_id`(`ref(company)`)を持つ。`cycle` なら末端は境界の列でなく `e0` を指す。
 */
function chain(length: number, cycle = false): { model: SpecModel; start: EntitySpec } {
  const names = Array.from({ length: length + 1 }, (_, index) => `e${String(index)}`);
  const entities = names.map((name, index) => {
    const last = index === length;
    const fields = last
      ? [cycle ? field('next_id', { kind: 'ref', entity: 'e0' }) : field('company_id', { kind: 'ref', entity: 'company' })]
      : [field('next_id', { kind: 'ref', entity: names[index + 1] ?? '' })];
    return entitySpec(name, fields);
  });
  const model = specModel({
    roles: [role('anonymous'), role('system'), role('staff')],
    aggregates: entities.map((entity) => aggregate({ name: entity.entity, entity })),
  });
  const start = entities[0];
  if (start === undefined) throw new Error('鎖が空です');
  return { model, start };
}

const COMPANY = { name: 'company_id', refEntity: 'company' } as const;

describe('rawReach: 鎖の長さで「届く」が開く側に寄らない(A7-5)', () => {
  it.each([
    ['1 段で境界の表 → 届く', 1, false, ['next_id']],
    ['上限ちょうど → 届く', MAX_RAW_DEPTH, false, ['next_id']],
    // A7-5 の反例: 上限 + 1 段以上の鎖は以前「届かない」(= 境界の要求が無い)に倒れ、V20 / V26 の名指しから外れた。
    ['上限 + 1 段 → 判定できないので届くとみなす(fail-closed)', MAX_RAW_DEPTH + 1, false, ['next_id']],
    ['上限の倍 → 届くとみなす', MAX_RAW_DEPTH * 2, false, ['next_id']],
    ['短い循環(境界の列の無い輪)→ 届かない', 3, true, []],
  ] as const)('%s', (_title, length, cycle, expected) => {
    const { model, start } = chain(length, cycle);
    expect(rawReach(model, start, COMPANY)).toEqual(expected);
  });
});
