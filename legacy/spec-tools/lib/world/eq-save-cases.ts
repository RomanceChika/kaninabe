/**
 * 保存点 1 つを実行する**組み合わせの組み方**(束 ⑳-5a2。どの軸を掛け合わせ、どの軸を掛けないか)。
 * 軸 1 本ずつの値の候補は `eq-save-axes.ts` が導き、ここはそれらを 2 つの grid に分けて掛ける。
 *
 * 単発の操作(`eq-cases.ts`)と同じ考えだが、軸は**2 つの grid に分かれる**。分けるのは
 * 費用のためではなく、**掛け合わせても新しい判定が 1 つも増えないから**である。
 *
 * | grid | 軸 | 何を見るか |
 * |---|---|---|
 * | 判定 | 外部集約の状態 × 実行者 × 呼び出し元の文脈 × ガード変数の境界 | `decideStep` の判定と複合 RPC の errcode(+ 落ちた手順の操作 ID) |
 * | 書き込み経路 | `repeat` の件数(0 / 1 / 2)× 任意欄の有無 × 再送(1 / 2 回) | 許可された組み合わせが**実際に全部の行を作る**こと |
 *
 * 実行器(`run-plan.ts`)は `plan.steps` の全手順に対して `decideStep` を回す —— 繰り返しの
 * 要素が 0 件でも、任意欄を送らなくても、同じ引数で同じ判定が出る(判定が入力を見るのは
 * `source.kind: 'input'` の事実だけである)。だから書き込み経路の軸を判定の軸に掛けると、
 * **同じ判定を何倍も実行する**ことになる。逆に書き込み経路は「許可された組み合わせ」の上でしか
 * 走らないので、拒否される組み合わせに掛けても 1 つも新しい経路を踏まない。
 *
 * **入力を見る事実がある保存点では分けない。** そのときは件数と任意欄が判定を変えうるので、
 * 2 つの軸は判定の grid に入る(機械で見分ける。`inputSensitive`)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import type { BuiltSave } from '../usecase/plan-build.js';
import type { UsecaseFactSource } from '../usecase/plan-facts-types.js';
import type { EqAxis, EqFoldedAxis, EqFoldedGuard } from './eq-cases.js';
import { foldAxes } from './eq-fold.js';
import { foldSaveGrid } from './eq-save-fold.js';
import { envOf, guardExpressions, guardValueAxes, stateAxesOf } from './eq-save-axes.js';
import type { EqResendOutcome } from './eq-save-shape.js';
import { anchorOf, resendOutcomeOf, resultStateColumnOf } from './eq-save-shape.js';
import type { EqSaveCleanup, EqSaveStep } from './eq-save-inputs.js';
import { MAX_ELEMENTS, saveCleanupOf, saveStepsOf } from './eq-save-inputs.js';
import type { EqSaveWorld } from './eq-save-world.js';
import { ROLE_ARRAY_NAMES } from './eq-world-types.js';

/**
 * 判定の grid が繰り返しの手順に渡す件数。
 *
 * 1 件である —— 0 件だと**その手順を実行しない入力**になり、拒否を返す相手が DB 側に無い
 * (実行器は件数に関わらず判定を下す)。件数そのものは書き込み経路の grid が 0 / 1 / 2 で回す。
 */
const DEFAULT_REPEAT = 1;

/** 入力の軸の値(全部載せる / 任意欄を落とす)。 */
export const INPUT_MODES = ['full', 'minimal'] as const;

/** 再送の軸の値(1 回 / 同じ `p_id` で 2 回)。 */
export const RESEND_COUNTS = [1, 2] as const;

/**
 * 呼び出し元の文脈 1 通り(= 実行器が `p_actor_roles` に何を渡すかを決めるもの)。
 *
 * 単発の操作は配列そのものを軸にしていた(`ROLE_ARRAY_NAMES`)。保存点は**文脈**を軸にする ——
 * 配列を作るのは実行器の `planActorRoles` であり、テストがそこを飛ばして別の配列を渡すと、
 * 期待(`decideStep` は文脈からロールを解決する)と DB(配列を見る)が**実行時にありえない
 * 組み合わせ**で比べられることになる。3 つの値は配列の 3 通りと 1 対 1 である。
 */
export interface EqSaveCaller {
  /** ロール配列の名前(テスト名に出る)。`ROLE_ARRAY_NAMES` の 1 つ。 */
  readonly name: string;
  /**
   * 実行者の id を渡すか。
   *
   * **人の入口だけが渡す。** システム起点の経路は実行者 id を持たず、未ログインの経路も
   * 持たない(`operation/_template/actor.ts` の `globalRole` の JSDoc)—— 3 つの値は
   * 「その保存点を実行できる入口」の全数であり、入口が増えればこの軸も増える。
   */
  readonly actor: boolean;
  /** 実行者自身の行をセッションのプロフィールとして渡すか(既定のログインロールの根拠)。 */
  readonly session: boolean;
  /** システム起点の呼び出しか(Cron / Webhook)。 */
  readonly system: boolean;
}

/**
 * 呼び出し元の文脈の 3 通り(ロール配列の名前と 1 対 1)。
 *
 * `from_session` は**人の入口**(実行者 id とセッションのプロフィールを持つ)、`from_runtime` は
 * **システム起点**(Cron / Webhook。実行者 id を持たない)、`empty` は**未ログイン**である。
 * これが入口の全数であり、実行時にありえない組み合わせ(**システム起点なのに実行者 id を渡す**、
 * など)はここに無い —— 期待も DB もその状態の判定を持たないのではなく、**入口がそれを作らない**。
 *
 * **「id はあるがプロフィールが無い」は逆に、実行する相手である。** 人の入口 ×「実行者の集約に行が
 * 無い人」がその形であり、実在する(認証はできるが、まだ行が無い人)—— 既定のログインロールの
 * 根拠は行の実在なので、その人のセッションはプロフィールを運ばない。行が無い人の拒否がどこから
 * 来るかは、この交差が答える(独立レビュー ⑳-5a2 の直す 2)。
 */
const CALLERS: readonly EqSaveCaller[] = ROLE_ARRAY_NAMES.map((name) => ({
  name,
  actor: name === 'from_session',
  session: name === 'from_session',
  system: name === 'from_runtime',
}));

/** 保存点 1 つぶんの軸。 */
export interface EqSaveCases {
  readonly usecase: string;
  readonly save: string;
  readonly label: string;
  readonly rpc: string;
  readonly steps: readonly EqSaveStep[];
  /** 1 つ実行するたびに片付ける表(作る集約の表 + 手順の `also_writes`)。 */
  readonly cleanup: EqSaveCleanup;
  /** `p_expected` に載せる鍵(`{集約}.{欄}`)。 */
  readonly expectedKeys: readonly string[];
  /** 判定の軸(状態とガード変数)。 */
  readonly axes: readonly EqAxis[];
  /** 実行する実行者の並び(world の実行者の名前)。 */
  readonly actors: readonly string[];
  /** 呼び出し元の文脈の並び(ロール配列の 3 通りと 1 対 1)。 */
  readonly callers: readonly EqSaveCaller[];
  /** 判定の grid が回す繰り返しの件数(入力を見ない保存点では 1 件だけ)。 */
  readonly decisionRepeats: readonly number[];
  /** 判定の grid が回す入力の形(入力を見ない保存点では全部載せるだけ)。 */
  readonly decisionInputs: readonly string[];
  /** 判定の grid の大きさ。 */
  readonly decisionCount: number;
  /** 書き込み経路の grid が回す繰り返しの件数。 */
  readonly writeRepeats: readonly number[];
  /** 書き込み経路の grid が回す入力の形。 */
  readonly writeInputs: readonly string[];
  /** 再送の軸。 */
  readonly resends: readonly number[];
  /** 書き込み経路の grid の大きさ。 */
  readonly writeCount: number;
  /** 結末の集約の物理テーブル名。 */
  readonly resultTable: string;
  /** 結末の状態が載る列(状態を持たない集約なら null)。 */
  readonly resultStateColumn: string | null;
  /** 保存点を通った後の予測状態(状態を持たない集約なら null)。 */
  readonly resultState: string | null;
  /** 結末の id が入力から決まるなら、その手順と欄(冪等キーなら null)。 */
  readonly resultIdFrom: { readonly step: number; readonly field: string } | null;
  readonly resend: EqResendOutcome;
  /** 再送が競合になるとき、その競合を返す手順の操作 ID。 */
  readonly resendOp: string | null;
  readonly folded: readonly EqFoldedAxis[];
  readonly foldedGuards: readonly EqFoldedGuard[];
}

/** 軸を組み立てるのに要る入力。 */
export interface EqSaveCasesInput {
  readonly domain: SpecModel;
  readonly tables: readonly DataTableSpec[];
  readonly built: BuiltSave;
}

/**
 * 保存点 1 つぶんの軸を組み立てる。
 *
 * @param input ドメイン仕様・全 data_table・組み立て済みの保存点
 * @param world その保存点の world(実行者の並び)
 * @returns 軸と 2 つの grid の大きさ
 */
export function eqSaveCasesOf(input: EqSaveCasesInput, world: EqSaveWorld): EqSaveCases {
  const steps = saveStepsOf(input);
  const sensitive = inputSensitive(input.built);
  const guards = guardExpressions(input);
  const stateAxes = stateAxesOf(input);
  const valueAxes = guardValueAxes(input, stateAxes, guards);
  const callers: readonly EqSaveCaller[] = CALLERS;
  const actors = actorNamesOf(input, world);
  const repeats = steps.some((step) => step.repeat) ? countsUpTo(MAX_ELEMENTS) : [1];
  const inputs = steps.some((step) => step.optional.length > 0) ? [...INPUT_MODES] : [INPUT_MODES[0]];
  const resend = resendOutcomeOf(input);
  const resends = resend === 'unknown' ? [1] : [...RESEND_COUNTS];
  const writeOnly = !sensitive;
  // 畳みは二段(`eq-save-fold.ts`)。入力を見ない保存点では件数と任意欄が判定の grid に
  // 入らないので、代表値 1 つを渡す(そこを畳む余地は初めから無い)。
  const grid = foldSaveGrid({
    actors: actors.length,
    callers,
    stateAxes,
    valueAxes,
    repeats: writeOnly ? [DEFAULT_REPEAT] : repeats,
    inputs: writeOnly ? [INPUT_MODES[0]] : inputs,
    foldGuards: (axes) => foldAxes(guards, envOf(input), axes),
  });
  const axes = [...grid.stateAxes, ...grid.valueAxes];
  return {
    usecase: input.built.plan.usecase.name,
    save: input.built.plan.save.id,
    label: input.built.plan.save.label,
    rpc: input.built.plan.rpcName,
    steps,
    cleanup: saveCleanupOf(input.tables, steps),
    expectedKeys: input.built.facts.expectedKeys,
    axes,
    actors,
    callers: grid.callers,
    decisionRepeats: grid.repeats,
    decisionInputs: grid.inputs,
    decisionCount: grid.count,
    writeRepeats: writeOnly ? repeats : [DEFAULT_REPEAT],
    writeInputs: writeOnly ? inputs : [INPUT_MODES[0]],
    resends,
    writeCount:
      (writeOnly ? repeats.length * inputs.length : 1) * resends.length,
    resultTable: tableOf(input.tables, input.built.facts.result.entity),
    resultStateColumn: resultStateColumnOf(input),
    resultState: input.built.facts.result.state,
    resultIdFrom:
      input.built.facts.result.idFrom.kind === 'input'
        ? { step: input.built.facts.result.idFrom.step, field: input.built.facts.result.idFrom.field }
        : null,
    resend,
    // 競合を返すのは錨(返さない宣言の表の同じ鍵)か、錨が無ければ最初の遷移である。
    resendOp: resend === 'conflict' ? ((anchorOf(input) ?? input.built.plan.steps[0])?.op ?? null) : null,
    folded: grid.folded,
    foldedGuards: grid.foldedGuards,
  };
}

/** 0 から上限までの件数。 */
function countsUpTo(limit: number): readonly number[] {
  return Array.from({ length: limit + 1 }, (_, index) => index);
}

/** 集約 → 物理テーブル名(無ければ集約名そのまま)。 */
function tableOf(tables: readonly DataTableSpec[], entity: string): string {
  return tables.find((candidate) => candidate.entity === entity)?.table ?? entity;
}

/**
 * 判定が**入力を見る**保存点か(件数と任意欄を判定の grid に入れるかの判定)。
 *
 * 見るのは事実の供給元だけである —— `input` を供給元に持つガード変数・文脈ロールがあれば、
 * 送る欄と繰り返しの件数(`stepInput` は先頭の要素を見る)が判定を変えうる。
 */
function inputSensitive(built: BuiltSave): boolean {
  const sources = built.facts.steps.flatMap((step) => [
    ...step.guardFacts.map((fact) => fact.source),
    ...step.roleFacts.map((fact) => fact.source),
    ...(step.stateFrom === null ? [] : [step.stateFrom]),
  ]);
  return sources.some((source: UsecaseFactSource) => source.kind === 'input');
}

/**
 * 実行する実行者の並び。
 *
 * **実行者自身の行を判断材料として読む保存点からは、行が無い人を外す** —— その人には
 * 判定そのものが無い(実行器は読み取りの段で止まり、複合 RPC までたどり着かない)。
 * 外したことは軸が示す(黙って飛ばしてはいない)。
 */
function actorNamesOf(input: EqSaveCasesInput, world: EqSaveWorld): readonly string[] {
  const readsActor = input.built.facts.reads.some((read) => read.idFrom.kind === 'actor');
  return world.actors.filter((actor) => !readsActor || actor.row !== null).map((actor) => actor.key);
}
