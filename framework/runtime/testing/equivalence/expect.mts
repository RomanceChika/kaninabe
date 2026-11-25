import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { RunPlan } from '@kaninabe/runtime/plan';
import type { HarnessPorts } from '../harness/ports.mjs';
import type { EqActor, EqAxisValue, EqOperation, EqWorld } from './types.mjs';
import type { BuiltEqWorld, EqSelection } from './world.mjs';
import { subjectOf } from './world.mjs';
import { clearCreated, placeCase } from './place.mjs';
import { eqArgs } from './args.mjs';
import { oracleDecision } from './oracle.mjs';

/**
 * 表明が使う 2 つの宣言(製品が渡す)。
 *
 * 実行計画は**製品の生成物**(`operation-plans`)であり、口は実 DB に触る手である。
 * どちらも仕組み側は持たない(ADR-0013 の裏返し)。
 */
export interface EqHarness {
  readonly ports: HarnessPorts;
  readonly plans: Readonly<Record<string, RunPlan | undefined>>;
}

/**
 * engine ⇔ RPC の一致の証明の**表明**(束 ⑳-5a)。生成物ではなく、仕組み側に 1 回だけ手で書く。
 *
 * 生成テストが書くのは「どの集約のどの操作を実行するか」だけであり、何と比べるかはここが決める ——
 * 期待は engine(`equivalence/oracle.mts`)、実測は実 DB の errcode である。掛け算(軸の直積)もここが
 * 行う:設計図は軸と**直積の大きさ**だけを運び、組み合わせを何千行も並べたりはしない。
 *
 * **食い違いは全部集めてから 1 度に表明する。** 最初の 1 件で落とすと、直しては実行し直す
 * 往復が組み合わせの数だけ要る —— このテストの値打ちは「どこが食い違っているかの全体像」に
 * ある。組み合わせが 0 件になった日に黙って緑になる形は、**ループの外で件数を確かめる**ことで
 * 塞ぐ(A16)。
 *
 * **アプリの語彙は 1 語も持たない。**
 */

/** 行が 1 つも返らなかった(エラー無し)ことの合図。 */
const EMPTY = '(0 行)';

/**
 * 不変条件の執行点(制約違反)の SQLSTATE クラス。
 *
 * **許可されたうえで別の執行点が働いた**結末である。engine は不変条件を予測しない
 * (`ActionError` が `invariant_violated` を別の分類として持つのはそのためである)ので、
 * ここが見る「権限の判定」としては**一致**である —— engine が拒否したのに制約で落ちた、
 * という組み合わせは食い違いのままである(権限の判定が通ってしまっている)。
 */
const INTEGRITY_CLASS = '23';

/**
 * その操作の全組み合わせで、engine の判定と RPC の結末が一致することを確かめる。
 *
 * @param world 集約 1 つぶんの設計図(生成物)
 * @param built 実 DB に作った world
 * @param op 操作 ID
 * @param harness 製品が渡す口と実行計画
 */
export async function expectSameDecisions(
  world: EqWorld,
  built: BuiltEqWorld,
  op: string,
  harness: EqHarness,
): Promise<void> {
  const operation = world.operations.find((candidate) => candidate.op === op);
  expect(operation, `${op}: 設計図にこの操作がありません`).toBeDefined();
  if (operation === undefined) return;
  const plan: RunPlan | undefined = harness.plans[op];
  expect(plan, `${op}: 実行計画がありません`).toBeDefined();
  if (plan === undefined) return;

  const selections = enumerate(world, operation);
  // ループの外の表明 —— 軸が空になって「0 件を全部確かめた」になる形を塞ぐ。
  expect(selections.length, `${op}: 実行する組み合わせの数が設計図と違う`).toBe(operation.count);
  expect(selections.length, `${op}: 実行する組み合わせが 1 つもない`).toBeGreaterThan(0);

  const source = harness.ports.rpcSource();
  const mismatches: string[] = [];
  for (const selection of selections) {
    const subject = subjectOf(world, built, selection);
    await placeCase(world, built, selection, subject, harness.ports);
    const { data, error } = await source.rpc(plan.rpc, eqArgs(plan, selection, subject));
    await clearCreated(world, selection, harness.ports);
    const expected = oracleDecision(plan, selection, subject);
    const actual = actualOf(data, error);
    if (selection.branch !== null && (expected.allowed || actual === '' || actual.startsWith(INTEGRITY_CLASS))) {
      // 他の系統(= 他のテナント)の行に届いた —— 一致していても境界は破れている。
      mismatches.push(
        `${selection.label}: 他のテナントの行への操作が通りました(engine=${expected.allowed ? '許可' : expected.reason} / DB=${actual === '' ? '成功' : actual})`,
      );
      continue;
    }
    if (agrees(operation.enforcement, expected, actual)) continue;
    mismatches.push(
      `${selection.label}: engine=${expected.allowed ? '許可' : expected.reason} ` +
        `(期待 ${expected.code === '' ? '成功' : expected.code}) / DB=${actual === '' ? '成功' : actual}` +
        `${error === null || error === undefined ? '' : ` ${error.message}`}`,
    );
  }
  expect(mismatches, `${op}: engine と RPC の判定が食い違う組み合わせがある`).toEqual([]);
}

/**
 * world が設計図どおりに作られたことを確かめる(検査そのものが空振りしていないことの検算)。
 *
 * @param world 集約 1 つぶんの設計図
 * @param built 実 DB に作った world
 */
export function expectWorldBuilt(world: EqWorld, built: BuiltEqWorld): void {
  expect([...built.rows.keys()].sort()).toEqual(world.rows.map((row) => row.key).sort());
  expect(world.operations.length, `${world.aggregate}: 実行する操作が無い`).toBeGreaterThan(0);
  for (const actor of world.actors) {
    expect(built.actorIds.get(actor.key), `${world.aggregate}: 実行者 ${actor.key} が作られていない`).toBeDefined();
  }
  for (const operation of world.operations) {
    expect(
      enumerate(world, operation).length,
      `${operation.op}: 軸の直積の大きさが設計図と違う`,
    ).toBe(operation.count);
  }
}

/**
 * 権限の判定として一致しているか。
 *
 * 許可の側はどの宣言でも同じ —— 成功のほか、不変条件の執行点で落ちた結末も「権限は通った」
 * である(engine は不変条件を予測しない)。**拒否の側だけが宣言で変わる。**
 *
 * | 宣言 | 拒否に求めるもの |
 * |---|---|
 * | `named`(本文が生成物) | errcode がちょうど一致する(理由まで同じ) |
 * | `unnamed`(`handwritten:`) | 理由を返さないので、0 行で返ること(errcode で返せばそれも可) |
 * | `none`(`shape: composite`) | RPC は判定しない —— 何を返してもよい(守っているのは engine だけ) |
 *
 * これは免除リストではない。どれも data_table の宣言そのものであり、宣言を外せば `named` に
 * 戻って理由まで見られる(guarantees.md `rpc_enforces_spec` が名指ししている範囲と同じ)。
 */
function agrees(
  enforcement: EqOperation['enforcement'],
  expected: { readonly code: string },
  actual: string,
): boolean {
  if (expected.code === '') return actual === '' || actual.startsWith(INTEGRITY_CLASS);
  if (enforcement === 'none') return true;
  if (enforcement === 'unnamed') return actual === EMPTY || actual === expected.code;
  return actual === expected.code;
}

/** RPC の結末(エラーの符号 / 0 行 / 成功)。 */
function actualOf(data: unknown, error: { readonly code: string } | null | undefined): string {
  if (error !== null && error !== undefined) return error.code;
  return Array.isArray(data) && data.length === 0 ? EMPTY : '';
}

/**
 * 軸の直積(状態 × 実行者 × ロール配列 × 編集の欄 × ガード変数)。
 *
 * 閉世界の見張りテスト(`__tests__/schema/equivalence-coverage.test.ts`)も同じ関数から数える ——
 * 「実行する組み合わせ」の作り方が 2 つあると、数えた側と実行した側が別のものになる。
 *
 * 境界を結んだ操作(`crossTenant`)では、基本の直積の**後ろに**、行を持つ実行者ごとの「他の系統の対象の行」の直積を並べる
 * (前半の n 番目は結果表の n 番目と同じものを指したまま)。
 */
export function enumerate(world: EqWorld, operation: EqOperation): readonly EqSelection[] {
  const selections: EqSelection[] = [];
  const passes: readonly boolean[] = operation.crossTenant === true ? [false, true] : [false];
  for (const foreign of passes) {
    for (const state of operation.states) {
      for (const key of operation.actors) {
        const actor = world.actors.find((candidate) => candidate.key === key);
        if (actor === undefined) continue;
        const branch = foreign ? foreignBranch(world, actor) : null;
        if (foreign && branch === null) continue;
        selections.push(...actorSelections(operation, actor, state, branch));
      }
    }
  }
  return selections;
}

/** 実行者 1 人 × 状態 1 つぶんの組み合わせ(ロール配列 × 編集の欄 × ガード変数)。 */
function actorSelections(operation: EqOperation, actor: EqActor, state: string | null, branch: string | null): readonly EqSelection[] {
  const selections: EqSelection[] = [];
  for (const name of operation.arrays) {
    const array = actor.arrays.find((candidate) => candidate.name === name);
    if (array === undefined) continue;
    for (const field of operation.fields) {
      selections.push(
        ...axisCombinations(operation).map((axis) => ({
          operation,
          actor,
          array,
          state,
          field,
          axis,
          label: labelOf(operation, { actor: actor.key, array: name, state, field, axis, branch }),
          newId: randomUUID(),
          branch,
        })),
      );
    }
  }
  return selections;
}

/**
 * その実行者から見た**他の系統**の対象の行(world の実行者の宣言順で最初の、自分と違う系統。行が無い人・相手がいなければ null)。
 *
 * 生成器(`eq-cases.ts` の件数)と同じ規則でなければならない —— 件数が設計図とずれると、ループの外の表明が落ちる。
 */
export function foreignBranch(world: EqWorld, actor: EqActor): string | null {
  if (actor.target === null) return null;
  return world.actors.find((candidate) => candidate.target !== null && candidate.target !== actor.target)?.target ?? null;
}

/** ガード変数の軸の直積(軸が無ければ 1 通り)。 */
function axisCombinations(operation: EqOperation): readonly (readonly EqAxisValue[])[] {
  let rows: EqAxisValue[][] = [[]];
  for (const axis of operation.axes) {
    const next: EqAxisValue[][] = [];
    for (const row of rows) {
      for (const value of axis.values) next.push([...row, value]);
    }
    rows = next;
  }
  return rows;
}

/** 組み合わせ 1 つの名前(食い違いの報告に出る)。 */
function labelOf(
  operation: EqOperation,
  parts: {
    readonly actor: string;
    readonly array: string;
    readonly state: string | null;
    readonly field: string | null;
    readonly axis: readonly EqAxisValue[];
    readonly branch: string | null;
  },
): string {
  const values = operation.axes.map((axis, index) => `${axis.key}=${parts.axis[index]?.label ?? ''}`);
  return [
    operation.op,
    parts.state === null ? '' : ` / 状態 ${parts.state}`,
    ` / 実行者 ${parts.actor}`,
    parts.branch === null ? '' : ` / 他のテナントの行 ${parts.branch}`,
    ` / ロール配列 ${parts.array}`,
    parts.field === null ? '' : ` / 欄 ${parts.field}`,
    values.length === 0 ? '' : ` / ${values.join(' ')}`,
  ].join('');
}
