/**
 * 結果表の**元データ**(保存点)—— 手順の順に `permit` を立て、**最初に落ちた手順**を記録する
 * (束 ⑳-5b)。
 *
 * 単発の操作(`cases.ts`)との違いは 1 つだけで、判定の単位が**手順の並び**であることである。
 * 実行器の契約(`run-plan.ts`)は「手順の順に `permit` を立て、1 つでも立たなければそこで止める」
 * なので、結果表も手順ごとの列を持ち、**落ちた手順より後ろは「判定に届かない」**と書く ——
 * 後ろの手順の可否を並べると、実行時にはありえない主張になる(⑳-5a2 の申し送り 2)。
 *
 * **判定も、手順の回し方も app の実行器そのものである**(束 ⑳-5b-b)。ここに for ループは
 * あるが、それは「表の列を手順の並びに合わせる」ためのものであり、可否を決める回し方は
 * `decidePlanWith`(実行器の契約)の 1 本である —— 一致の証明(`@kaninabe/runtime/testing/save/oracle`)が
 * 呼ぶのとまったく同じ関数に、まったく同じ引数を渡す。
 *
 * **編集(`update`)の手順は欄ごとに判定される** —— 実行器の `decideUpdate` が
 * `changedFields` を回して 1 欄でも落ちれば全体を拒否するので、その判定がそのまま表に出る。
 * 製品と 4 題材には `update` の手順を持つ保存点が今のところ 1 つも無い(保存点の手順は
 * 作成と遷移だけである)。これは検査の穴ではなく**仕様の現状**であり、
 * `__tests__/unit/results/results-save-update.test.ts` が合成した計画でその判定を固定している。
 *
 * 実行する軸は判定の grid だけである。書き込み経路の grid(繰り返しの件数・任意欄・再送)は
 * 「許可された組み合わせが実際に全部の行を作るか」を見るものであり、**判定を 1 つも増やさない**
 * (`eq-save-cases.ts` が分けた理由そのもの)。
 *
 * **組み合わせ 1 点と複合 RPC への入力(`p_input`)もここにある。** 実行器は `p_input` から手順ごとの
 * 入力を引く(`stepInput`)ので、docs が組むのは「軸が選んだ 1 点」から作るこの 1 つの値だけでよい。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 *
 * @oversize 超える理由: 保存点の結果表は「軸が選んだ 1 点 → 複合 RPC への入力 → 手順ごとの判定」という
 *   1 本の写像で、型・入力の組み立て・判定の回し方を上から下へ 1 か所で追える形にしてある。
 * @split-review 割る案と結果: 「軸が選んだ 1 点から複合 RPC の入力 `p_input` を組む側」(`SaveSelection` ・`saveInputOf` ・`rowOf`。
 *   以前の `save-input.ts`)を別のファイルに割る案を検討した。`saveInputOf` を読むのは `save-cases.ts` の
 *   `caseOf` だけで、ほかのファイルは直接読まない(一方向の依存で、使い手が 1 人)。組み合わせ 1 件の判定
 *   (`caseOf`)を読むたびに入力の組み立てが要るので、独立して使われる部品にならず、割っても読み手が
 *   2 枚を開くだけになる。
 */

import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import {
  type EqAxisValue,
  type EqFoldedGuard,
  type EqSaveCases,
  type EqSaveCaller,
  type EqSaveStep,
  type EqSaveInput,
  eqSaveCatalog,
  type EqSaveCatalogEntry,
  type EqSaveActor,
  type EqSaveWorld,
} from '../world/index.js';
import { SCENARIO_NOW } from '../usecase/plan-scenario-values.js';
import type { RunPlan } from '@kaninabe/runtime/plan';
import type { RoleTables } from '@kaninabe/runtime/template/actor-roles';
import { NOT_REACHED, asResultDecision, engineTablesOf, roleTablesOf } from './decide.js';
import type { EngineTables, ResultDecision } from './decide.js';
import { appRunner } from './engine-bridge.js';
import { resultResolutionOf, resultRunPlan } from './run-plan.js';
import { simulatedSubjectOf, simulatedRowId } from './simulated-world.js';
import type { SimulatedValue } from './simulated-world.js';
import type { ResultAxisValue } from './cases.js';

/** 手順 1 つの結末(判定に届かなかった手順は `reached: false`)。 */
export interface SaveStepResult {
  readonly op: string;
  readonly label: string;
  /** その手順の定型 RPC が拒否をどこまで返すか。 */
  readonly enforcement: EqSaveStep['enforcement'];
  readonly reached: boolean;
  readonly decision: ResultDecision;
}

/** 組み合わせ 1 つと、手順ごとの結末。 */
export interface SaveResultCase {
  /** world の実行者の名前。 */
  readonly actor: string;
  /** 呼び出し元の文脈の名前(ロール配列の 3 通りと 1 対 1)。 */
  readonly caller: string;
  /** 繰り返しの手順に渡した件数。 */
  readonly repeat: number;
  /** 入力の形(全部載せる / 任意欄を落とす)。 */
  readonly input: string;
  readonly axis: readonly ResultAxisValue[];
  readonly steps: readonly SaveStepResult[];
  /** 最初に落ちた手順の番号(全部立てば null)。 */
  readonly blockedAt: number | null;
}

/** 保存点 1 つぶんの結果。 */
export interface SaveResult {
  /** 保存点の鍵(`{ユースケース名}.{保存点 ID}`)。 */
  readonly key: string;
  readonly usecase: string;
  readonly save: string;
  readonly label: string;
  /** 設計図が宣言した判定の grid の大きさ。 */
  readonly count: number;
  readonly folded: readonly string[];
  readonly foldedGuards: readonly EqFoldedGuard[];
  /** world の実行者(表の行の並び)。 */
  readonly actors: readonly EqSaveActor[];
  readonly steps: readonly { readonly op: string; readonly label: string }[];
  readonly cases: readonly SaveResultCase[];
  /** world を宣言から作れない理由(作れたときは空)。 */
  readonly problems: readonly string[];
}

/** 結果を組み立てるのに要る入力(目録と同じもの)。 */
export interface SaveResultInput {
  readonly domain: SpecModel;
  readonly guards: GuardServices;
  readonly actions: ActionSpecModel | undefined;
  readonly dataTables: DataTableSpecModel | undefined;
  readonly usecases: UsecaseSpecModel | undefined;
}

/**
 * 実行計画が導出できた全保存点について、判定の grid の全組み合わせの結果を組み立てる。
 *
 * @param input ドメイン仕様・ガード解析・action_spec・data_table・usecase_spec
 * @returns 保存点の鍵の順の結果
 */
export function saveResults(input: SaveResultInput): readonly SaveResult[] {
  const tables = engineTablesOf(input.domain, input.guards, input.actions ?? null);
  const roles = roleTablesOf(input.domain);
  return eqSaveCatalog(input).map((entry) => saveOf(entry, tables, roles));
}

/** 保存点 1 つぶんの結果。 */
function saveOf(entry: EqSaveCatalogEntry, tables: EngineTables, roles: RoleTables): SaveResult {
  const base = {
    key: entry.key,
    usecase: entry.usecase.name,
    save: entry.save,
    label: entry.built.plan.save.label,
  };
  if (!entry.result.ok) {
    return {
      ...base,
      count: 0,
      folded: [],
      foldedGuards: [],
      actors: [],
      steps: [],
      cases: [],
      problems: entry.result.problems.map((problem) => problem.message),
    };
  }
  const { world, cases } = entry.result;
  const plan = resultRunPlan({
    usecase: entry.usecase.name,
    save: entry.built.plan.save.id,
    rpc: entry.built.plan.rpcName,
    composite: true,
    steps: entry.built.plan.steps,
    facts: entry.built.facts,
    tables,
  });
  return {
    ...base,
    count: cases.decisionCount,
    folded: cases.folded,
    foldedGuards: cases.foldedGuards,
    actors: world.actors,
    steps: cases.steps.map((step) => ({ op: step.op, label: step.label })),
    cases: enumerateSaveCases(cases, world).map((selection) => caseOf(plan, roles, world, cases, selection)),
    problems: [],
  };
}

/**
 * 判定の grid の直積(実行者 × 呼び出し元 × 状態とガードの軸 × 件数 × 入力の形)。
 *
 * 並べる順は**証明の期待を組む側**(`@kaninabe/runtime/testing/save/expect` の
 * `enumerateDecisions`)と同じである —— 同じ軸を同じ順で掛けるので、n 番目の組み合わせが両者で
 * 同じものを指す(束 ⑳-5b の JSDoc は参照先も順も誤っていた。独立レビュー ⑳-5b 観点 2)。
 * world に居ない実行者を飛ばすのも同じで、飛ばした人は表の行にも並ばない。
 */
function enumerateSaveCases(cases: EqSaveCases, world: EqSaveWorld): readonly SaveSelection[] {
  const selections: SaveSelection[] = [];
  for (const actor of cases.actors) {
    if (!world.actors.some((candidate) => candidate.key === actor)) continue;
    for (const caller of cases.callers) {
      for (const placements of axisCombinations(cases)) {
        for (const repeat of cases.decisionRepeats) {
          for (const input of cases.decisionInputs) {
            selections.push({ actor, caller, repeat, input, placements });
          }
        }
      }
    }
  }
  return selections;
}

/** 軸の直積(軸が無ければ 1 通り)。 */
function axisCombinations(cases: EqSaveCases): readonly (readonly EqAxisValue[])[] {
  let rows: EqAxisValue[][] = [[]];
  for (const axis of cases.axes) {
    const next: EqAxisValue[][] = [];
    for (const row of rows) {
      for (const value of axis.values) next.push([...row, value]);
    }
    rows = next;
  }
  return rows;
}

/**
 * 組み合わせ 1 つの、手順ごとの結末。
 *
 * 判定は **1 回の `decidePlanWith`** で採る —— 実行器は手順の順に `permit` を立て、最初に落ちた
 * ところで止めるので、返ってこなかった手順が「判定に届かない」列になる。
 */
function caseOf(
  plan: RunPlan,
  roles: RoleTables,
  world: EqSaveWorld,
  cases: EqSaveCases,
  selection: SaveSelection,
): SaveResultCase {
  const actor = world.actors.find((candidate) => candidate.key === selection.actor);
  const subject = simulatedSubjectOf({
    rows: world.rows,
    branches: Object.values(actor?.targets ?? {}),
    actorRow: actor?.row ?? null,
    actorKey: selection.actor,
    placements: selection.placements.flatMap((value) => value.placements),
    state: null,
    inputs: [],
    now: SCENARIO_NOW,
  });
  const resolution = resultResolutionOf({
    plan,
    subject,
    // プロフィールが載るのは人の入口から来た実行者だけであり、その根拠は実行者の集約の行で
    // ある(一致の証明 `@kaninabe/runtime/testing/save/oracle` の `sessionOf` と同じ 2 条件)。
    session: selection.caller.session && actor?.row != null,
    input: saveInputOf(cases, selection, actor),
  });
  const outcomes = appRunner().decidePlanWith(roles, plan, {
    resolution,
    system: selection.caller.system,
  });
  const blocked = outcomes.find((outcome) => !outcome.decision.allowed);
  return {
    actor: selection.actor,
    caller: selection.caller.name,
    repeat: selection.repeat,
    input: selection.input,
    axis: cases.axes.map((axis, index) => ({
      key: axis.key,
      label: selection.placements[index]?.label ?? '',
    })),
    steps: cases.steps.map((step, index) => {
      const outcome = outcomes[index];
      return {
        op: step.op,
        label: step.label,
        enforcement: step.enforcement,
        reached: outcome !== undefined,
        decision: outcome === undefined ? NOT_REACHED : asResultDecision(outcome.decision),
      };
    }),
    blockedAt: blocked?.index ?? null,
  };
}

/** 判定の grid の 1 点(判定の前の姿)。 */
export interface SaveSelection {
  readonly actor: string;
  readonly caller: EqSaveCaller;
  readonly repeat: number;
  readonly input: string;
  readonly placements: readonly EqAxisValue[];
}

/**
 * 複合 RPC の `p_input`(手順の別名が鍵。繰り返す手順は配列)。
 *
 * 実行器はここから手順ごとの入力を引く(`stepInput`)—— 一致の証明
 * (`@kaninabe/runtime/testing/save/world` の `inputOf`)と同じ形である。
 */
function saveInputOf(
  cases: EqSaveCases,
  selection: SaveSelection,
  actor: EqSaveActor | undefined,
): Readonly<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  for (const step of cases.steps) {
    input[step.alias] = step.repeat
      ? step.elements.slice(0, selection.repeat).map((element) => rowOf(step, element, selection, actor))
      : rowOf(step, step.input, selection, actor);
  }
  return input;
}

/** 手順 1 つに渡す 1 行(任意欄は入力の軸が決め、参照の欄は world の行を指す)。 */
function rowOf(
  step: EqSaveStep,
  source: EqSaveInput | undefined,
  selection: SaveSelection,
  actor: EqSaveActor | undefined,
): Readonly<Record<string, SimulatedValue>> {
  if (source === undefined) return {};
  const row: Record<string, SimulatedValue> = {};
  for (const [column, value] of Object.entries(source.values)) {
    if (selection.input === MINIMAL_INPUT && step.optional.includes(column)) continue;
    row[column] = value;
  }
  for (const [column, entity] of Object.entries(source.refs)) {
    const key = actor?.targets[entity];
    row[column] = key === undefined ? null : simulatedRowId(key);
  }
  return row;
}

/** 任意欄を落とす入力の形(設計図の `decisionInputs` の値)。 */
const MINIMAL_INPUT = 'minimal';
