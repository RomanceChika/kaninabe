import { expect } from 'vitest';
import type { HarnessPorts } from '../harness/ports.mjs';
import type { RlsWorld, RlsWorldRole } from './types.mjs';
import type { BuiltRlsWorld } from './world.mjs';
import { readAsActor } from './world.mjs';
import { oracleVisibility, sameValue } from './oracle.mjs';
import { actorFieldValue, boundaryValue } from './boundary.mjs';
import type { RlsWorldFilter } from './types.mjs';

/**
 * 表明が使う 2 つの宣言(製品が渡す)。
 *
 * 口は実 DB を読むため、ロールの根拠はオラクルが期待を計算するために要る。**どちらも製品の
 * 生成物**であり、仕組み側は 1 語も持たない。
 */
export interface RlsHarness {
  readonly ports: HarnessPorts;
  readonly roles: readonly RlsWorldRole[];
}

/**
 * RLS の挙動テストの**表明**(束 ⑳-4b)。生成物ではなく、仕組み側に 1 回だけ手で書く。
 *
 * 生成テストが書くのは「どの表のどの実行者を実行するか」だけであり、何と比べるかはここが決める ——
 * 期待はオラクル(`rls/oracle.mts`。仕様からの別写像)、実測は実 DB(`rls/world.mts`)である。
 * world の作り方(`rls/world.mts`)とは別に、ここは「何と比べるか」の表明だけを持つ。
 *
 * **アプリの語彙は 1 語も持たない。**
 */

/**
 * その実行者に「宣言どおりの行だけ」が返ることを確かめる。
 *
 * 期待はオラクル(仕様からの別写像)が出し、実測は実 DB が出す。食い違えばどちらかがバグである。
 *
 * @param world 設計図
 * @param built 実 DB の world
 * @param actorKey 実行者の名前
 * @param harness 製品が渡す口とロールの根拠
 */
export async function expectVisibleRows(
  world: RlsWorld,
  built: BuiltRlsWorld,
  actorKey: string,
  harness: RlsHarness,
): Promise<void> {
  const expected = oracleVisibility(world, built, actorKey, harness.roles);
  const actual = await readAsActor(world, built, actorKey, harness.ports);
  expect(actual.denied, `${world.table} / ${actorKey}: 権限(grant select)の有無が宣言と違う`).toBe(
    expected.denied,
  );
  if (expected.denied) return;
  expect([...actual.ids].sort(), `${world.table} / ${actorKey}: 返る行が宣言と違う`).toEqual(
    [...expected.ids].sort(),
  );
}

/**
 * 実行者の属性で狭める境界(テナント)を越えた行が返らないことを確かめる。
 *
 * 境界の列の値が実行者と違う行が返ってよいのは、**その欄で狭めない読み取り規則**でその実行者が
 * その行を読めるときだけである(全件読めるロールは境界を越える —— それは宣言どおりである)。
 *
 * @param world 設計図
 * @param built 実 DB の world
 * @param actorField 境界に使う実行者の欄(`filters` の右辺 `actor.{欄}`)
 * @param harness 製品が渡す口とロールの根拠
 */
export async function expectTenantBoundary(
  world: RlsWorld,
  built: BuiltRlsWorld,
  actorField: string,
  harness: RlsHarness,
): Promise<void> {
  const filters = boundaryFilters(world, actorField);
  // 境界の値が 2 通り以上ある = 「他のテナントの行」が world にある。1 通りしか無い world では、
  // 境界の条件を落としたポリシーでもこの検査が通ってしまう(T4 が塞ぎたかった形そのもの)。
  expect(
    differingRows(world, built, filters).length,
    `${world.table}: 境界の値が 1 通りしか無い(他のテナントの行が world に無い)`,
  ).toBeGreaterThan(1);
  for (const actor of world.actors) {
    const own = actorFieldValue(world, built, actor.key, actorField);
    const actual = await readAsActor(world, built, actor.key, harness.ports);
    const expected = oracleVisibility(world, built, actor.key, harness.roles);
    for (const id of actual.ids) {
      const row = [...built.rows.values()].find((candidate) => candidate.id === id);
      if (row === undefined || filters.every((filter) => sameValue(boundaryValue(built, row, filter), own))) continue;
      const unbounded = (expected.admittedBy.get(id) ?? []).some(
        (rule) => !rule.filters.some((filter) => filter.actorField === actorField),
      );
      expect(unbounded, `${world.table} / ${actor.key}: 境界(${actorField})の違う行が返った`).toBe(true);
    }
  }
}

/** その欄で狭めている境界(宣言順・同じ列と同じ鎖は 1 つに畳む)。 */
function boundaryFilters(world: RlsWorld, actorField: string): readonly RlsWorldFilter[] {
  const found: RlsWorldFilter[] = [];
  const seen = new Set<string>();
  for (const rule of world.reads) {
    for (const filter of rule.filters) {
      const key = [...filter.via, filter.field].join('.');
      if (filter.actorField !== actorField || seen.has(key)) continue;
      seen.add(key);
      found.push(filter);
    }
  }
  return found;
}

/** 境界の値が系統ごとに違っている的の行(1 つ以上あって初めて検査になる)。 */
function differingRows(
  world: RlsWorld,
  built: BuiltRlsWorld,
  filters: readonly RlsWorldFilter[],
): readonly string[] {
  const values = new Set<string>();
  for (const key of world.targets) {
    const row = built.rows.get(key);
    if (row === undefined) continue;
    values.add(filters.map((filter) => JSON.stringify(boundaryValue(built, row, filter))).join('/'));
  }
  return [...values];
}

/**
 * world が設計図どおりに作られたことを確かめる(検査そのものが空振りしていないことの検算)。
 *
 * @param world 設計図
 * @param built 実 DB の world
 */
export function expectWorldBuilt(world: RlsWorld, built: BuiltRlsWorld): void {
  expect([...built.rows.keys()].sort()).toEqual(world.rows.map((row) => row.key).sort());
  expect(world.targets.length, `${world.table}: 的になる行が無い`).toBeGreaterThan(0);
  for (const actor of world.actors) {
    const built_ = built.actors.get(actor.key);
    expect(built_, `${world.table}: 実行者 ${actor.key} が作られていない`).toBeDefined();
    expect(built_?.token === null, `${world.table}: 実行者 ${actor.key} のログイン状態が宣言と違う`).toBe(
      actor.anonymous,
    );
  }
}
