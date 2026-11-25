/**
 * **単発の操作**(action_spec 1 本)の実行計画を組み立てる入口(束 ⑰ 設計 §1-1)。
 *
 * ## 1 操作 = 手順が 1 つの保存点
 *
 * 保存点の実行器(`_template/run-plan.ts`)は「事実を読む → 手順ごとに `permit` → hooks →
 * RPC を 1 回 → 拒否の写像」を汎用に行う。**単発の操作はその手順が 1 つの場合にすぎない**
 * (設計 §0)。したがってここは新しい導出器を作らず、保存点の導出器に**手順 1 つの保存点**を
 * 食わせる薄い層である。導出が 1 つなら、保存点と単発の操作が食い違うことが原理的に起こらない。
 *
 * 単発で変わるのは 2 点だけで、どちらも `SavePlan.single` が運ぶ —— 状態を**予測しない**
 * (先行手順が無い)ことと、呼ぶのが複合 RPC ではなくその手順の定型 RPC であることである。
 *
 * このファイルの責務は**計画の組み立て**である。「計画だけでは足りない」印の読み取り
 * (`operation-plan-marks.ts`)は、組み立てを要らず印だけを使う生成器(`generate/render/` の 2 本)も
 * 直接読むので別の部品になっている。
 *
 * ファイル I/O はしない純関数(scripts-code-quality.md)。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel, SourceLocation } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { ActionSpec, ActionSpecModel } from '../model/trace/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import { isInTransactionJob } from '../semantics/operation-catalogs.js';
import type { ResolvedParam } from './param-source.js';
import { resolveSaveParams } from './param-source.js';
import type { PlanProblem, SavePlan } from './step-plan.js';
import { planSave } from './step-plan.js';
import type { SaveFacts } from './plan-facts.js';
import { resolveSaveFacts } from './plan-facts.js';
import type { UsecaseSaveDecl, UsecaseSpec } from '../model/usecase/types.js';
import { crossAggregateHooks, hasExtraErrors } from './operation-plan-marks.js';

/** 組み立て済みの単発の操作 1 つ。 */
export interface BuiltOperation {
  /** 操作 ID(`{machine}.{event}` または予約 ID)。 */
  readonly op: string;
  readonly plan: SavePlan;
  /** 解決済み引数(手順は 1 つなので 1 要素)。 */
  readonly params: readonly ResolvedParam[];
  readonly facts: SaveFacts;
  /**
   * 組み立てはできたが、**計画だけでは足りない**と機械が言える理由(不変条件 ID)。
   *
   * 1 種類しかない —— 自集約の外を参照する application 執行の不変条件
   * (`crossAggregateHooks`)。空なら「この計画で走りきれる」ということであり、それでも
   * `runner: manual` が宣言されていれば A15 が逆向きに指摘する。
   *
   * もう 1 つの印は `hasExtraErrors`(実行器が返せない失敗を契約として宣言している)である。
   */
  readonly incomplete: readonly string[];
}

/** 組み立てられなかった操作 1 件(= `runner: manual` の候補)。 */
export interface OperationProblem {
  readonly op: string;
  /** どの段で止まったか。 */
  readonly stage: 'ground' | 'params' | 'facts' | 'effects';
  readonly problem: PlanProblem;
}

/** `runner: manual` を宣言した操作 1 件と、その宣言が本当に要るか。 */
export interface ManualOperation {
  readonly op: string;
  readonly reason: string;
  /**
   * **宣言が無くても計画が導出できたか**(束 ⑰-3)。
   *
   * true なら「手書きを残す口」として `runner` が使われている ——`runner: manual` は
   * 「定型では書けない」ことの宣言であって、書けるものを手書きに留める `permit` ではない
   * (action-spec-writing.md §runner)。A15 がこの向きを error にするので、宣言だけが
   * 増えて実質の免除リストになる道が塞がっている。
   */
  readonly derivable: boolean;
}

/**
 * ジョブカタログが阻害のために、**判定を出さなかった**操作 1 件。
 *
 * 副作用(`effects`)を持つ操作は、その副作用が「書き込みと同一トランザクションで実現される種別」のジョブかどうかで
 * 定型 RPC で組めるかが変わる。カタログを渡せないとき、これは**判定できない**。欠けたカタログを空として判定すると、
 * 「導出できる」「manual は要らない」といった結論が、見ていない事実から出てしまう。
 */
export interface UndecidedOperation {
  readonly op: string;
  /** `runner: manual` を宣言した操作か(その場合は逆向きの「manual が要らない」判定を出さない)。 */
  readonly manual: boolean;
  /** 判定の材料になるはずだった副作用(ジョブ ID)。 */
  readonly effects: readonly string[];
}

/** 組み立ての結果。 */
export interface OperationBuildResult {
  readonly operations: readonly BuiltOperation[];
  readonly problems: readonly OperationProblem[];
  /**
   * `runner: manual` を宣言した操作(理由と、導出の可否)。
   * 判定を出さなかった操作(`undecided`)は `derivable: false` で載るが、それは「導出できない」の意味ではない。
   */
  readonly manual: readonly ManualOperation[];
  /** ジョブカタログが阻害のため、副作用に依る判定を出さなかった操作(阻害でなければ常に空)。 */
  readonly undecided: readonly UndecidedOperation[];
}

/** 組み立てに要る入力。 */
export interface OperationBuildInput {
  readonly domain: SpecModel;
  readonly guards: GuardServices;
  readonly actions: ActionSpecModel | undefined;
  readonly dataTables: DataTableSpecModel | undefined;
  readonly jobs: JobSpecModel | undefined;
  /**
   * ジョブカタログを採っているのに渡せない(阻害)。true のとき、**副作用を持つ操作の判定は出さず** `undecided` に載せる
   * (`jobs` が undefined でも「ジョブが無い」とは読まない)。省略は false(カタログの有無を `jobs` どおりに読む)。
   */
  readonly jobsBlocked?: boolean;
}

/**
 * 全 action_spec から単発の操作の実行計画を組み立てる。
 *
 * @param input ドメイン仕様・ガード解析・action_spec・data_table・ジョブカタログ
 * @returns 組み立てられた計画と、組み立てられなかった理由と、宣言された例外
 */
export function buildOperationPlans(input: OperationBuildInput): OperationBuildResult {
  const actions = input.actions;
  if (actions === undefined || input.dataTables === undefined || !input.dataTables.available) {
    return { operations: [], problems: [], manual: [], undecided: [] };
  }
  const operations: BuiltOperation[] = [];
  const problems: OperationProblem[] = [];
  const manual: ManualOperation[] = [];
  const undecided: UndecidedOperation[] = [];
  for (const action of [...actions.actions].sort((a, b) => a.handles.raw.localeCompare(b.handles.raw))) {
    const op = action.handles.raw;
    if (action.runner !== undefined) {
      // **宣言した操作も導出を試みる**(束 ⑰-3)。試さないと「面倒だから manual と書く」が
      // 黙って通り、宣言された例外が実質の免除リストになる。導出の費用は全操作ぶん既に
      // 払っているので、ここで 1 本増えても変わらない。落ちた理由は捨てる(それが宣言の理由)。
      const pending: string[] = [];
      const attempted = buildOne(action, input, [], pending);
      if (pending.length > 0) undecided.push({ op, manual: true, effects: pending });
      manual.push({
        op,
        reason: action.runner.reason,
        derivable: attempted !== null && attempted.incomplete.length === 0 && !hasExtraErrors(action),
      });
      continue;
    }
    const pending: string[] = [];
    const built = buildOne(action, input, problems, pending);
    if (pending.length > 0) undecided.push({ op, manual: false, effects: pending });
    if (built !== null) operations.push(built);
  }
  return { operations, problems, manual, undecided };
}

/**
 * 1 操作ぶんの組み立て(接地 → 引数 → 事実 → 副作用の実現機構)。
 *
 * ジョブカタログが阻害のとき、最後の段(副作用の実現機構)だけが判定できない。そこまで届いた操作が
 * 副作用を持つなら、その ID を `undecided` へ積み、計画も問題も返さない(null)。前の段の問題は
 * カタログに依らないので従来どおり返す。
 */
function buildOne(
  action: ActionSpec,
  input: OperationBuildInput,
  problems: OperationProblem[],
  undecided: string[],
): BuiltOperation | null {
  const op = action.handles.raw;
  const { usecase, save } = syntheticSave(action);
  const planned = planSave(usecase, save, { domain: input.domain, actions: input.actions ?? null, dataTables: input.dataTables }, true);
  if (!planned.ok) {
    problems.push(...planned.problems.map((problem) => ({ op, stage: 'ground' as const, problem })));
    return null;
  }
  const resolved = resolveSaveParams(planned.plan, input.domain);
  if (!resolved.ok) {
    problems.push(...resolved.problems.map((problem) => ({ op, stage: 'params' as const, problem })));
    return null;
  }
  const facts = resolveSaveFacts({
    plan: planned.plan,
    params: resolved.steps,
    domain: input.domain,
    guards: input.guards,
  });
  if (!facts.ok) {
    problems.push(...facts.problems.map((problem) => ({ op, stage: 'facts' as const, problem })));
    return null;
  }
  if (input.jobsBlocked === true) {
    const effects = [...new Set(planned.plan.steps.flatMap((step) => step.effects))];
    if (effects.length > 0) {
      undecided.push(...effects);
      return null;
    }
  }
  const unrealized = transactionEffects(planned.plan, input.jobs);
  if (unrealized.length > 0) {
    problems.push({ op, stage: 'effects', problem: unrealizedEffects(op, planned.plan.rpcName, unrealized) });
    return null;
  }
  return {
    op,
    plan: planned.plan,
    params: resolved.steps[0] ?? [],
    facts: facts.facts,
    incomplete: crossAggregateHooks(planned.plan, facts.facts.invariantHooks, input.domain),
  };
}

/**
 * その操作の副作用のうち、**同一トランザクションで実現される**種別のもの。
 *
 * ジョブカタログの `kind` が「書き込みと同一トランザクションで実現済み」を意味する行は
 * キューに積まれない —— 実現するのは専用の RPC である。定型 RPC はそれを行わないので、この
 * 副作用を持つ操作の計画は**定型では組み立てられない**。
 */
function transactionEffects(plan: SavePlan, jobs: JobSpecModel | undefined): readonly string[] {
  const byId = new Map((jobs?.catalog?.jobs ?? []).map((job) => [job.id, job]));
  return plan.steps.flatMap((step) => step.effects.filter((id) => isInTransactionJob(byId.get(id))));
}

/** 定型 RPC では実現できない副作用を持つ。 */
function unrealizedEffects(op: string, rpcName: string, effects: readonly string[]): PlanProblem {
  return {
    message:
      `${op} の副作用 ${effects.join(' / ')} は同一トランザクションで実現される種別なので、` +
      `定型 RPC ${rpcName} では組み立てられません`,
    suggestion:
      'その副作用を実現する専用の RPC を呼ぶ操作なので、action_spec に ' +
      '"runner: { kind: manual, reason: ... }" を宣言して手書きのまま残す。あるいは副作用を' +
      'ジョブ(キューに積む形)に変えて、定型 RPC で書けるようにする',
    counterexample: { operation: op, function: rpcName, effects: effects.join(' / ') },
  };
}

/**
 * action_spec 1 本を「手順が 1 つの保存点」に写す。名前は反例の文面にだけ出る。
 * `migration` を空にするのは単発の操作が複合 RPC を持たない(= 生成 SQL が無い)ためである。
 */
function syntheticSave(action: ActionSpec): { readonly usecase: UsecaseSpec; readonly save: UsecaseSaveDecl } {
  const location: SourceLocation = action.location;
  const save: UsecaseSaveDecl = {
    id: action.handles.event,
    label: action.handles.raw,
    migration: '',
    steps: [
      {
        op: action.handles.raw,
        alias: null,
        label: null,
        repeat: false,
        defaultsSelf: false,
        location,
      },
    ],
    location,
  };
  return {
    usecase: {
      id: action.id,
      name: action.handles.machine,
      goal: action.handles.raw,
      actor: '',
      start: '',
      done: '',
      saves: [save],
      budget: {},
      accept: [],
      testCases: [],
      relPath: action.relPath,
      location,
    },
    save,
  };
}

/**
 * 組み立てられなかった理由を人が読む 1 本のテキストにする。
 *
 * @param problems 組み立てられなかった理由
 * @returns 反例つきのメッセージ
 */
export function operationProblemText(problems: readonly OperationProblem[]): string {
  const lines = problems.map(
    ({ op, stage, problem }) =>
      `  - [${op}/${stage}] ${problem.message}\n    対処: ${problem.suggestion}\n    反例: ` +
      Object.entries(problem.counterexample)
        .map(([key, value]) => `${key}=${value}`)
        .join(', '),
  );
  return `操作の実行計画を組み立てられません:\n${lines.join('\n')}`;
}
