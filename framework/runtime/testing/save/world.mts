import type { GuardValue } from '@kaninabe/runtime/engine';
import type { RunPlan } from '@kaninabe/runtime/plan';
import { eqSubjectValues } from '@kaninabe/runtime/sql/eq-subject';
import type { EqAxisValue } from '../equivalence/types.mjs';
import type { BuiltEqWorld } from '../equivalence/world.mjs';
import type { EqSaveActor, EqSaveCaller, EqSaveInput, EqSaveStep, EqSaveWorld } from './types.mjs';

export type { BuiltEqWorld } from '../equivalence/world.mjs';
export { createEqWorld, resetEqWorld } from '../equivalence/world.mjs';

/**
 * 保存点の一致の証明の**world の使い方**(束 ⑳-5a2)。生成物ではなく、仕組み側に 1 回だけ手で書く。
 *
 * 仕様: docs/rules/decisions/common/ADR-0011-usecase-layer-two-origins.md §4
 *       docs/specs/backend/guarantees.md(`rpc_enforces_spec`)
 *
 * 置き場が配線の層なのは**層境界の帰結**である —— 期待は実行器(`operation/_template`)が出し、
 * 実測は実 DB(`infrastructure`)を実行する。その 2 つを同じテストの中で使えるのは配線の層だけで
 * あり、`infrastructure` から `operation` の関数本体は呼べない(ARCH-BE-0001 の依存方向)。
 * world を作る口はそのまま再輸出する —— 生成テストが 2 つの置き場を知らずに済むようにする。
 *
 * world を**作る**のは単発の操作と同じ 1 本(`equivalence/world.mts` の `createEqWorld`)である —— 違うのは
 * 実行する前後の始末だけで、それが 2 つある。
 *
 * - **的が複数ある。** 保存点は「読む集約」と「作る行が指す集約」を同時に要求するので、実行する
 *   組み合わせの置き直しは系統の**全部の的**に当たる。
 * - **保存点は行を作る。** 組み合わせを 1 つ実行するたびに、作られた行を消して設計図の姿に戻す ——
 *   残すと次の組み合わせが一意の宣言に当たり、「規則で拒否された」と区別が付かなくなる。
 *
 * 「設計図 → 置き直したあとの行の値」は**仕様側と同じ 1 本**(`@kaninabe/runtime/sql/eq-subject`)
 * である —— 単発の操作(`equivalence/world.mts`)とも、ハンドブックの結果表とも同じ関数を通る(束 ⑳-5b-b)。
 *
 * **アプリの語彙は 1 語も持たない。**
 */

/** 実行する組み合わせ 1 つ(判定の grid と書き込み経路の grid に共通の形)。 */
export interface EqSaveSelection {
  readonly actor: EqSaveActor;
  readonly caller: EqSaveCaller;
  /** 軸ごとに選んだ値(宣言順)。 */
  readonly axis: readonly EqAxisValue[];
  /** 繰り返しの手順に渡す件数。 */
  readonly repeat: number;
  /** 入力の形(`full` = 任意欄も載せる / `minimal` = 落とす)。 */
  readonly input: string;
  /** 同じ `p_id` で実行する回数。 */
  readonly resend: number;
  /** 食い違いの報告に出る名前。 */
  readonly label: string;
  /** 冪等キー(`p_id`)。 */
  readonly id: string;
}

/** その組み合わせで実行する相手(world の行の id と、置き直したあとの値)。 */
export interface EqSaveSubject {
  /**
   * 実行者の id(渡さない入口では `null`)。
   *
   * 渡すのは人の入口だけである —— システム起点の経路も未ログインの経路も実行者 id を持たない
   * (設計図の `callers` がその全数を運ぶ)。
   */
  readonly actorId: string | null;
  /** 集約 → world の行の id。 */
  readonly ids: ReadonlyMap<string, string>;
  /** 集約 → 置き直したあとの列の値。 */
  readonly values: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** 実行者自身の行の値(`claim` とセッションの欄の根拠)。行が無い人では空。 */
  readonly actorRow: Readonly<Record<string, unknown>>;
  /** 複合 RPC の `p_input`(手順の別名が鍵)。 */
  readonly input: Readonly<Record<string, unknown>>;
  /** 複合 RPC の `p_expected`。 */
  readonly expected: Readonly<Record<string, string | null>>;
  /**
   * 判断材料として読んだ事実(`{集約}.{欄}` → 値)。
   *
   * 実行器が実 DB から読むところ(`loadFacts`)を、置き直したあとの world から取る —— 同じ行・
   * 同じ列であり、読み方だけが違う。読む列を決めるのは実行計画の `reads` である。
   */
  readonly facts: Readonly<Record<string, GuardValue>>;
}

/**
 * その組み合わせで実行する相手を決める(実 DB は読まない)。
 *
 * 行が無い人は系統を持たないので、**最初に系統を持つ人の的**を実行する相手にする —— 「ログインは
 * できるが自分の行が無い人が、他人の行に向けて保存点を実行する」という実在の形である。
 *
 * @param world その保存点の設計図(生成物)
 * @param built 実 DB に作った world
 * @param selection 実行する組み合わせ
 * @param plan その保存点の実行計画(読む列の宣言をここから引く)
 * @returns 実行する相手
 */
export function subjectOfSave(
  world: EqSaveWorld,
  built: BuiltEqWorld,
  selection: EqSaveSelection,
  plan: RunPlan,
): EqSaveSubject {
  const targets = targetsOf(world, selection.actor);
  const subject = eqSubjectValues({
    targets,
    rowOf: (key) => built.rows.get(key),
    actorRow: selection.actor.row,
    placements: selection.axis.flatMap((value) => value.placements),
    state: null,
  });
  const values = subject.values;
  return {
    actorId: selection.caller.actor ? (built.actorIds.get(selection.actor.key) ?? null) : null,
    ids: subject.ids,
    values,
    actorRow: subject.actorRow,
    input: inputOf(world, selection, subject.ids),
    expected: expectedOf(world, values),
    facts: factsOf(plan, values),
  };
}

/** 実行計画の `reads` が指す列の値(置き直したあとの world から取る)。 */
function factsOf(
  plan: RunPlan,
  values: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): Readonly<Record<string, GuardValue>> {
  const facts: Record<string, GuardValue> = {};
  for (const read of plan.reads) {
    for (const field of read.fields) {
      facts[`${read.entity}.${field}`] = asGuardValue(values.get(read.entity)?.[field]);
    }
  }
  return facts;
}

/**
 * ガード式が読める値だけを渡す(読めない形は `null` = 不明)。
 *
 * 不明を偽に潰さないのは実行器と同じ規約である —— engine は `null` を「評価できなかった」
 * として扱い、SQL の側も原子ごとに `coalesce(…, false)` で不成立に畳む。
 */
function asGuardValue(value: unknown): GuardValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

/**
 * その人の系統の的(行が無い人は最初に系統を持つ人のものを借りる)。
 *
 * @param world その保存点の設計図
 * @param actor 実行する実行者
 * @returns 集約 → world の行の名前
 */
export function targetsOf(world: EqSaveWorld, actor: EqSaveActor): Readonly<Record<string, string>> {
  if (Object.keys(actor.targets).length > 0) return actor.targets;
  return world.actors.find((candidate) => Object.keys(candidate.targets).length > 0)?.targets ?? {};
}

/** 複合 RPC の `p_input`(手順の別名が鍵。繰り返す手順は配列)。 */
function inputOf(
  world: EqSaveWorld,
  selection: EqSaveSelection,
  ids: ReadonlyMap<string, string>,
): Readonly<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  for (const step of world.steps) {
    input[step.alias] = step.repeat
      ? step.elements.slice(0, selection.repeat).map((element) => rowOf(step, element, selection, ids))
      : rowOf(step, step.input, selection, ids);
  }
  return input;
}

/** 手順 1 つに渡す 1 行(任意欄は入力の軸が決め、参照の欄は world の行を指す)。 */
function rowOf(
  step: EqSaveStep,
  source: EqSaveInput,
  selection: EqSaveSelection,
  ids: ReadonlyMap<string, string>,
): Readonly<Record<string, unknown>> {
  const row: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(source.values)) {
    if (selection.input === MINIMAL_INPUT && step.optional.includes(column)) continue;
    row[column] = value;
  }
  for (const [column, entity] of Object.entries(source.refs)) row[column] = ids.get(entity) ?? null;
  return row;
}

/** 任意欄を落とす入力の形(設計図の `writeInputs` / `decisionInputs` の値)。 */
const MINIMAL_INPUT = 'minimal';

/** 複合 RPC の `p_expected`(置き直したあとの値。文字列でなければ空)。 */
function expectedOf(
  world: EqSaveWorld,
  values: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): Readonly<Record<string, string | null>> {
  const expected: Record<string, string | null> = {};
  for (const key of world.expectedKeys) {
    const dot = key.indexOf('.');
    if (dot < 0) continue;
    const value = values.get(key.slice(0, dot))?.[key.slice(dot + 1)];
    expected[key] = typeof value === 'string' ? value : null;
  }
  return expected;
}
