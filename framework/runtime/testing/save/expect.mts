import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { RunPlan } from '@kaninabe/runtime/plan';
import type { HarnessPorts } from '../harness/ports.mjs';
import type { EqAxis, EqAxisValue } from '../equivalence/types.mjs';
import type { EqSaveWorld } from './types.mjs';
import type { BuiltEqWorld, EqSaveSelection } from './world.mjs';
import { subjectOfSave } from './world.mjs';
import { clearSaveWrites } from './place.mjs';
import type { SaveOracleDeclarations } from './oracle.mjs';
import { saveOracle } from './oracle.mjs';
import type { EqSaveOutcome } from './fire.mjs';
import { fireSave, rowIdsOf, saveDisagreement, saveWriteProblems } from './fire.mjs';

/**
 * 表明が使う宣言の束(製品が渡す)。
 *
 * 4 つとも**製品の生成物**である —— 実行計画(`usecase-plans`)・ロール解決の表と
 * セッションの欄(`runtime-bindings` / `session-profile`)・不整合のメッセージの引き手
 * (`constraint-invariants`)。仕組み側は 1 語も持たない(ADR-0013 の裏返し)。
 */
export interface SaveHarness extends SaveOracleDeclarations {
  readonly ports: HarnessPorts;
  readonly plans: Readonly<Record<string, RunPlan | undefined>>;
  readonly invariantOfMessage: (haystack: string) => string | undefined;
}

/**
 * 保存点の一致の証明の**表明**(束 ⑳-5a2)。生成物ではなく、仕組み側に 1 回だけ手で書く。
 *
 * 生成テストが書くのは「どの保存点を実行するか」だけであり、何と比べるかはここが決める ——
 * 期待は実行器(`save/oracle.mts` の `decideStep`)、実測は複合 RPC の errcode と**落ちた
 * 手順の操作 ID** である。掛け算(軸の直積)もここが行う:設計図は軸と**直積の大きさ**だけを
 * 運ぶ。
 *
 * **食い違いは全部集めてから 1 度に表明する。** 最初の 1 件で落とすと、直しては実行し直す
 * 往復が組み合わせの数だけ要る。組み合わせが 0 件になった日に黙って緑になる形は、
 * **ループの外で件数を確かめる**ことで塞ぐ(A16)。
 *
 * **アプリの語彙は 1 語も持たない。**
 */

/**
 * その保存点の判定の全組み合わせで、実行器の判定と複合 RPC の結末が一致することを確かめる。
 *
 * @param world その保存点の設計図(生成物)
 * @param built 実 DB に作った world
 * @param harness 製品が渡す口と宣言
 */
export async function expectSaveDecisions(
  world: EqSaveWorld,
  built: BuiltEqWorld,
  harness: SaveHarness,
): Promise<void> {
  const plan = planOf(world, harness);
  if (plan === undefined) return;
  const selections = enumerateDecisions(world);
  // ループの外の表明 —— 軸が空になって「0 件を全部確かめた」になる形を塞ぐ。
  expect(selections.length, `${keyOf(world)}: 実行する組み合わせの数が設計図と違う`).toBe(world.grid.decisionCount);
  expect(selections.length, `${keyOf(world)}: 実行する組み合わせが 1 つもない`).toBeGreaterThan(0);
  await expectAgreement(world, plan, built, selections, harness);
}

/**
 * 許可される組み合わせの上で、書き込み経路の全組み合わせが宣言どおりの行を作ることを確かめる。
 *
 * 実行する相手は**実行器が許可する最初の組み合わせ**である —— 拒否される組み合わせでは行が 1 つも
 * できないので、繰り返しの件数も任意欄も再送も 1 つの経路を踏まない。許可される組み合わせが
 * 1 つも無ければそれ自体が反例である(畳みで成立側が落ちた形。⑳-5a の独立レビュー 2-b)。
 *
 * @param world その保存点の設計図(生成物)
 * @param built 実 DB に作った world
 * @param harness 製品が渡す口と宣言
 */
export async function expectSaveWrites(
  world: EqSaveWorld,
  built: BuiltEqWorld,
  harness: SaveHarness,
): Promise<void> {
  const plan = planOf(world, harness);
  if (plan === undefined) return;
  const base = enumerateDecisions(world).find(
    (selection) =>
      saveOracle(plan, world, selection, subjectOfSave(world, built, selection, plan), harness).allowed,
  );
  expect(base, `${keyOf(world)}: 実行器が許可する組み合わせが 1 つもない`).toBeDefined();
  if (base === undefined) return;
  const selections = enumerateWrites(world, base);
  expect(selections.length, `${keyOf(world)}: 書き込み経路の組み合わせの数が設計図と違う`).toBe(
    world.grid.writeCount,
  );
  await expectAgreement(world, plan, built, selections, harness);
}

/**
 * world が設計図どおりに作られたことを確かめる(検査そのものが空振りしていないことの検算)。
 *
 * @param world その保存点の設計図
 * @param built 実 DB に作った world
 * @param harness 製品が渡す口と宣言
 */
export function expectSaveWorldBuilt(
  world: EqSaveWorld,
  built: BuiltEqWorld,
  harness: SaveHarness,
): void {
  expect([...built.rows.keys()].sort()).toEqual(world.rows.map((row) => row.key).sort());
  expect(world.steps.length, `${keyOf(world)}: 実行する手順が無い`).toBeGreaterThan(0);
  for (const actor of world.actors) {
    expect(built.actorIds.get(actor.key), `${keyOf(world)}: 実行者 ${actor.key} が作られていない`).toBeDefined();
  }
  expect(planOf(world, harness), `${keyOf(world)}: 実行計画がありません`).toBeDefined();
  expect(enumerateDecisions(world).length, `${keyOf(world)}: 軸の直積の大きさが設計図と違う`).toBe(
    world.grid.decisionCount,
  );
}

/** 組み合わせの並びを実行し、食い違いを全部集めてから 1 度に表明する。 */
async function expectAgreement(
  world: EqSaveWorld,
  plan: RunPlan,
  built: BuiltEqWorld,
  selections: readonly EqSaveSelection[],
  harness: SaveHarness,
): Promise<void> {
  const mismatches: string[] = [];
  for (const selection of selections) {
    const subject = subjectOfSave(world, built, selection, plan);
    const expected = saveOracle(plan, world, selection, subject, harness);
    // 古いロール一覧を持つ実行者は、人の入口では実行器が解決した配列の代わりにそれを渡す(DB が配列を信じないことの見張り。
    // 期待は実行者の行の写しで決まるので拒否のまま)。
    const roles = selection.caller.session ? (selection.actor.staleRoles ?? expected.actorRoles) : expected.actorRoles;
    const outcomes = await fireSave(world, plan, built, selection, subject, roles, harness);
    const first = outcomes[0];
    if (first === undefined) {
      mismatches.push(`${selection.label}: 1 度も実行できていない`);
      continue;
    }
    const disagreement = saveDisagreement(expected, first);
    if (disagreement !== null) mismatches.push(`${selection.label}: ${disagreement}`);
    if (disagreement === null && expected.allowed && first.kind === 'saved') {
      const problems = await saveWriteProblems(world, selection, subject, first.data, harness.ports);
      mismatches.push(...problems.map((problem) => `${selection.label}: ${problem}`));
    }
    mismatches.push(...resendMismatches(world, selection, outcomes));
    // 作られた行を消すのは**結末を読み終えてから**である(残すと次の組み合わせが一意の宣言に
    // 当たり、「規則で拒否された」と区別が付かなくなる)。
    await clearSaveWrites(world, built, harness.ports);
  }
  expect(mismatches, `${keyOf(world)}: 実行器と複合 RPC が食い違う組み合わせがある`).toEqual([]);
}

/**
 * 再送(同じ `p_id` の 2 回目)の結末が宣言どおりか。
 *
 * 2 回目に何が起きるかは**計画の形から決まる**(設計図の `resend`)—— 最初の手順が作成で、その表が
 * 再送で既存の行を返す宣言(`resend.returns_existing: true`)なら冪等の錨があるので既存の行を読み直して
 * 同じ形を返し、返さない宣言なら同じ id の行があるので競合になる。最初の手順が外の集約の状態を条件にする
 * 遷移なら状態が動いているので競合になる。1 回目が書けていない組み合わせでは、2 回目は同じ
 * 拒否を繰り返すだけである(何も書いていないので前提が動かない)。
 */
function resendMismatches(
  world: EqSaveWorld,
  selection: EqSaveSelection,
  outcomes: readonly EqSaveOutcome[],
): readonly string[] {
  const first = outcomes[0];
  const second = outcomes[1];
  if (first === undefined || second === undefined) return [];
  const at = `${selection.label}: 再送`;
  if (first.kind !== 'saved') {
    if (second.kind === first.kind && second.op === first.op) return [];
    return [`${at} の 2 回目が 1 回目と違う(1 回目 ${first.kind} ${first.op} / 2 回目 ${second.kind} ${second.op})`];
  }
  if (world.resend === 'conflict') {
    if (second.kind === 'conflict' && second.op === world.resendOp) return [];
    return [`${at} が競合にならない(${second.kind} ${second.op} ${second.detail})`];
  }
  if (second.kind !== 'saved') return [`${at} の 2 回目が書けていない(${second.kind} ${second.detail})`];
  const before = rowIdsOf(first.data);
  const after = rowIdsOf(second.data);
  if (before.length > 0 && before.join(' ') === after.join(' ')) return [];
  return [`${at} で行が変わった(1 回目 ${before.length} 行 / 2 回目 ${after.length} 行)`];
}

/** その保存点の実行計画(生成物)。 */
function planOf(world: EqSaveWorld, harness: SaveHarness): RunPlan | undefined {
  const plan: RunPlan | undefined = harness.plans[keyOf(world)];
  expect(plan, `${keyOf(world)}: 実行計画がありません`).toBeDefined();
  return plan;
}

/** 保存点の鍵(実行計画の鍵と同じ)。 */
function keyOf(world: EqSaveWorld): string {
  return `${world.usecase}.${world.save}`;
}

/**
 * 判定の grid(実行者 × 呼び出し元の文脈 × 軸の値)。
 *
 * 閉世界の見張りテスト(`__tests__/schema/equivalence-coverage.test.ts`)も同じ関数から数える ——
 * 「実行する組み合わせ」の作り方が 2 つあると、数えた側と実行した側が別のものになる。
 *
 * @param world その保存点の設計図
 * @returns 実行する組み合わせ(宣言順)
 */
export function enumerateDecisions(world: EqSaveWorld): readonly EqSaveSelection[] {
  const points = world.grid.callers.flatMap((caller) =>
    axisCombinations(world.grid.axes).flatMap((axis) =>
      world.grid.decisionRepeats.flatMap((repeat) =>
        world.grid.decisionInputs.map((input) => ({ caller, axis, repeat, input, resend: 1 })),
      ),
    ),
  );
  const selections: EqSaveSelection[] = [];
  for (const key of world.grid.actors) {
    const actor = world.actors.find((candidate) => candidate.key === key);
    if (actor === undefined) continue;
    for (const point of points) selections.push(selectionOf(world, { actor, ...point }));
  }
  return selections;
}

/**
 * 書き込み経路の grid(繰り返しの件数 × 任意欄の有無 × 再送)。
 *
 * @param world その保存点の設計図
 * @param base 実行器が許可する組み合わせ(実行者・文脈・軸の値をここから借りる)
 * @returns 実行する組み合わせ(宣言順)
 */
export function enumerateWrites(world: EqSaveWorld, base: EqSaveSelection): readonly EqSaveSelection[] {
  const points = world.grid.writeRepeats.flatMap((repeat) =>
    world.grid.writeInputs.flatMap((input) => world.grid.resends.map((resend) => ({ repeat, input, resend }))),
  );
  return points.map((point) => selectionOf(world, { ...base, ...point }));
}

/** 組み合わせ 1 つ(名前と冪等キーを付ける)。 */
function selectionOf(
  world: EqSaveWorld,
  parts: Omit<EqSaveSelection, 'label' | 'id'>,
): EqSaveSelection {
  const values = world.grid.axes.map((axis, index) => `${axis.key}=${parts.axis[index]?.label ?? ''}`);
  const label = [
    `${world.usecase}.${world.save}`,
    ` / 実行者 ${parts.actor.key}`,
    ` / 呼び出し ${parts.caller.name}`,
    values.length === 0 ? '' : ` / ${values.join(' ')}`,
    ` / 件数 ${parts.repeat}`,
    ` / 入力 ${parts.input}`,
    parts.resend === 1 ? '' : ` / 再送 ${parts.resend} 回`,
  ].join('');
  return { ...parts, label, id: randomUUID() };
}

/** 軸の直積(軸が無ければ 1 通り)。 */
function axisCombinations(axes: readonly EqAxis[]): readonly (readonly EqAxisValue[])[] {
  let rows: EqAxisValue[][] = [[]];
  for (const axis of axes) {
    const next: EqAxisValue[][] = [];
    for (const row of rows) {
      for (const value of axis.values) next.push([...row, value]);
    }
    rows = next;
  }
  return rows;
}
