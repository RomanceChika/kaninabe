/**
 * ユースケースから「数えた面倒」を導出する共有の純粋関数群(①手数・②画面・③概念・⑤前提)。
 *
 * Y5(予算検査)とハンドブックの章(book/usecases-page.ts)・生成物(code-usecases.ts)が、
 * この 1 つの導出を共有する(二重実装しない。PRIN-0007)。cognitive-load.md §2 の
 * 10 成分のうち、usecase_spec から機械的に数えられる 6 つ(①手数・②画面・③概念・
 * ⑤前提・⑥入力・⑦確認)と、参考情報としての⑨応答(非同期)を扱う。
 *
 * このファイルは①②③⑤(ユースケースの形から数えるもの)と、全部が読む土台(`UsecaseInput`・
 * `actionFor`・`flattenSteps`)を持つ。⑥入力・⑦確認・⑨応答とまとめ(`deriveUsecaseMetrics` /
 * `metricValue`)は derive-effort.ts がこの土台を読んで数える —— **向きは derive-effort.ts →
 * このファイルだけ**で、こちらは再輸出しない(再輸出の入口を持つと互いを読み合う循環になる)。
 *
 * **確認(⑦)は近似ではない**: 各手順の確認要否は意味解析の層(`semantics/operation-attributes.ts`)の
 * 導出の結果そのもので、画面の生成(`action-attributes.ts`)・ハンドブックの操作の章と同じものを
 * 読む。その入力になるカタログ(テーブル仕様・ジョブ・通知)は `UsecaseInput.catalogs` が運ぶ。
 */

import type { SpecModel } from '../model/types.js';
import type { ActionSpec, ActionSpecModel } from '../model/trace/types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import type { AuthGateDecl } from '../model/auth/types.js';
import { inputValue, type CatalogInput } from '../kernel/input-state.js';
import { groundOperation, type OperationGrounding } from '../semantics/operation-ground.js';
import type { OperationCatalogs } from '../semantics/operation-catalogs.js';
import { screenReachabilityOfModels } from '../relations/screen-reachability/index.js';
import { canonicalActionId } from '../semantics/action-ground.js';
import { requiredGuardsOf } from '../semantics/required-guards.js';
import type { UsecaseAcceptDecl, UsecaseBudgetMetric, UsecaseSaveDecl, UsecaseSpec, UsecaseSpecModel, UsecaseStepDecl } from '../model/usecase/types.js';
import { DEFAULT_USECASE_BUDGET } from '../model/usecase/types.js';

/** Y 群・導出への唯一の入力。 */
export interface UsecaseInput {
  readonly domain: SpecModel;
  readonly usecases: UsecaseSpecModel;
  /** action_spec が無い環境では null(入力・確認の数は 0 として扱う)。 */
  readonly actions: ActionSpecModel | null;
  readonly screens: ScreenSpecModel;
  /**
   * 認証フローの関門(`auth_spec` の `gates`)の**入力の状態**。到達(通る画面)と前提(start に入るのに要る関門)の導出が読む。
   * 未選択は「関門は無い」事実・阻害は「関門が分からない」(空の関門で探索せず、導出の読み手が「確かめていない」と言う)・読込済みは関門の一覧。
   * 任意の欄ではなく**必須**(省略を「読込済み」と読ませると、阻害の構成が黙って到達 0 を断定する)。
   */
  readonly gates: CatalogInput<readonly AuthGateDecl[]>;
  /**
   * 操作の属性(確認要否)の導出が読むカタログ(テーブル仕様・ジョブ・通知)。
   * 画面・文書の生成と同じものを渡す(省略できない: 見えない事実を近似で補わないため)。
   */
  readonly catalogs: OperationCatalogs;
  /**
   * `budget:` を書かないユースケースが比べられる既定の予算(UX 原則の台帳から引いたもの)。
   * 省略は台帳が無い環境で、`DEFAULT_USECASE_BUDGET`(定数)がそのまま既定になる。
   */
  readonly budgetDefaults?: Readonly<Record<UsecaseBudgetMetric, number>>;
}

/** 保存点をまたいで手順を通し番号で見るための組。 */
export interface FlatStep {
  readonly save: UsecaseSaveDecl;
  readonly step: UsecaseStepDecl;
  /** ユースケース全体での 0 始まりの通し番号(Y2 の順序判定に使う)。 */
  readonly index: number;
}

/** 保存点をまたいで手順を宣言順に平坦化する(Y2 / Y6 / 導出が共有する)。 */
export function flattenSteps(usecase: UsecaseSpec): readonly FlatStep[] {
  const flat: FlatStep[] = [];
  for (const save of usecase.saves) {
    for (const step of save.steps) flat.push({ save, step, index: flat.length });
  }
  return flat;
}

/** その action_spec を引く(無ければ undefined)。 */
export function actionFor(actions: ActionSpecModel | null, op: string): ActionSpec | undefined {
  return actions?.actions.find((action) => action.handles.raw === op);
}

/**
 * 有効な予算(既定 + 宣言による上書き)。
 *
 * @param usecase 対象のユースケース
 * @param defaults 既定の予算(UX 原則の台帳から引いたもの。省略は定数の既定値)
 */
export function effectiveBudget(
  usecase: UsecaseSpec,
  defaults: Readonly<Record<UsecaseBudgetMetric, number>> = DEFAULT_USECASE_BUDGET,
): Readonly<Record<UsecaseBudgetMetric, number>> {
  return { ...defaults, ...usecase.budget };
}

/** その指標の理由つき受け入れ(無ければ undefined)。 */
export function acceptedFor(usecase: UsecaseSpec, metric: UsecaseBudgetMetric): UsecaseAcceptDecl | undefined {
  return usecase.accept.find((decl) => decl.kind === 'budget' && decl.metric === metric);
}

/**
 * その不変条件を「この保存点では実行しない」と理由つきで受け入れているか(Y10 の warning)。
 *
 * @param usecase 対象のユースケース
 * @param invariant 不変条件の id
 * @returns 受け入れの宣言。無ければ undefined
 */
export function acceptedInvariant(usecase: UsecaseSpec, invariant: string): UsecaseAcceptDecl | undefined {
  return usecase.accept.find((decl) => decl.kind === 'invariant' && decl.invariant === invariant);
}

// ---------------------------------------------------------------------------
// ①手数
// ---------------------------------------------------------------------------

/**
 * 手数の導出結果。
 *
 * **手数は「人が押す保存の回数」= `saves` の長さである**(2026-09-09 に数え方を変えた)。
 * 保存点の内側の手順は 1 回の保存で機械が順に実行するので、人の手は増えない —— ADR-0011 §3 の
 * 2 段目(粒度を変える = 複数の操作を 1 つの保存点にまとめる)を使うほど手数が増える、という
 * 逆転を起こさないための定義である。内側の手順の数は面倒の実物として残るので、
 * 参考値(`stepTotal` / `hasRepeat`)として持ち回る。
 */
export interface StepCountResult {
  /** 手数 = 保存点の数(人が押す保存の回数)。Y5 が予算と比べるのはこれ。 */
  readonly base: number;
  /** 参考: 保存点の内側の手順の総数(手数ではない —— 1 回の保存で実行される)。 */
  readonly stepTotal: number;
  /** 参考: repeat: true の手順を 1 つでも含むか(繰り返しも同じ保存の内側で起こる)。 */
  readonly hasRepeat: boolean;
  /** 人向けの表記(内側の手順数を添える。例: "1(内側の手順 5+N)")。 */
  readonly label: string;
}

/** 手数(= 保存点の数)と、参考値としての内側の手順数を導出する。 */
export function deriveStepCount(usecase: UsecaseSpec): StepCountResult {
  const flat = flattenSteps(usecase);
  const hasRepeat = flat.some((entry) => entry.step.repeat);
  const base = usecase.saves.length;
  const stepTotal = flat.length;
  const inner = `${stepTotal}${hasRepeat ? '+N' : ''}`;
  return { base, stepTotal, hasRepeat, label: `${base}(内側の手順 ${inner})` };
}

// ---------------------------------------------------------------------------
// ②画面
// ---------------------------------------------------------------------------

/** 画面の導出結果。 */
export interface ScreenDerivation {
  /** start を含む、到達できた画面 id の集合(宣言順)。 */
  readonly screenIds: readonly string[];
  /** 届く画面が見つからなかった手順の op(Y3 が別途エラーにする対象と同じ)。 */
  readonly unresolvedOps: readonly string[];
  /** actor が start 自体に入れたか。false なら screenIds は空。 */
  readonly startReachable: boolean;
}

/** 手順ごとに届く画面を解決し、通る画面の集合を導出する(Y3 と同じ探索を共有する)。 */
export function deriveScreens(usecase: UsecaseSpec, input: UsecaseInput): ScreenDerivation {
  const reachability = screenReachabilityOfModels(input.domain, input.screens, input.gates);
  const reach = reachability.reach(usecase.actor, { kind: 'screen', id: usecase.start }).screenIds;
  if (reach.size === 0) return { screenIds: [], unresolvedOps: [], startReachable: false };

  const screenIds = new Set<string>([usecase.start]);
  const unresolvedOps: string[] = [];
  for (const { step } of flattenSteps(usecase)) {
    const canonical = canonicalActionId(input.domain, step.op) ?? step.op;
    const candidates = reachability.exposedBy.get(canonical) ?? [];
    const screen = candidates.find((candidate) => reach.has(candidate.id));
    if (screen === undefined) unresolvedOps.push(step.op);
    else screenIds.add(screen.id);
  }
  return { screenIds: [...screenIds], unresolvedOps, startReachable: true };
}

// ---------------------------------------------------------------------------
// ③概念
// ---------------------------------------------------------------------------

/** 概念負荷の導出結果。 */
export interface ConceptDerivation {
  /** タスクが触る集約名(宣言順・重複なし)。 */
  readonly aggregates: readonly string[];
  /** 通る状態(`{machine}.{state}` 形。宣言順・重複なし)。 */
  readonly states: readonly string[];
  /** 合計(cognitive-load.md 「概念負荷 = 集約 + 通る画面の状態名」)。 */
  readonly count: number;
}

/** タスクが触る集約 + 通る状態名(概念負荷)を導出する。 */
export function deriveConcepts(usecase: UsecaseSpec, domain: SpecModel): ConceptDerivation {
  const aggregates = new Set<string>();
  const states = new Set<string>();
  for (const { step } of flattenSteps(usecase)) {
    const grounding = groundOperation(domain, step.op);
    addConceptsOf(grounding, aggregates, states);
  }
  return { aggregates: [...aggregates], states: [...states], count: aggregates.size + states.size };
}

/** 1 手順分の接地結果から集約名・到達状態を集合へ足す。 */
function addConceptsOf(grounding: OperationGrounding, aggregates: Set<string>, states: Set<string>): void {
  switch (grounding.kind) {
    case 'transition':
      aggregates.add(grounding.entry.aggregate);
      states.add(`${grounding.entry.machine.machine}.${grounding.entry.event.to}`);
      return;
    case 'create':
    case 'delete':
    case 'update':
      aggregates.add(grounding.entry.aggregate);
      return;
    default:
      return; // 未接地(unknown)は Y1 が別途エラーにする。導出は黙って数えない。
  }
}

// ---------------------------------------------------------------------------
// ⑤前提
// ---------------------------------------------------------------------------

/** 前提の導出結果。 */
export interface PreconditionDerivation {
  /** start に入るのに要る関門の数(requires_auth / role_gate)。 */
  readonly count: number;
  readonly guards: readonly string[];
}

/** start 画面の前提(認証・関門)を導出する。 */
export function derivePreconditions(usecase: UsecaseSpec, input: UsecaseInput): PreconditionDerivation {
  if (!input.screens.available) return { count: 0, guards: [] };
  const start = input.screens.screens.find((screen) => screen.id === usecase.start);
  if (start === undefined) return { count: 0, guards: [] };
  const guards = requiredGuardsOf(start, inputValue(input.gates) ?? []);
  return { count: guards.length, guards };
}
