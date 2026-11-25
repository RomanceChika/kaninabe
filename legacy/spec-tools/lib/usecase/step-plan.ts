/**
 * 保存点(`saves[]`)を「複合 RPC が呼び出す手順の列」に接地させる純粋関数(束 ⑯c)。
 *
 * usecase_spec は操作 ID しか宣言しない(ADR-0011 §2)。複合 RPC を生成するには、その 1 つ 1 つが
 * **どの RPC を・どんな引数名で**呼ぶのかを、ドメイン仕様・action_spec・data_table から
 * 導かなければならない。その接地だけをここで行い、引数 1 本ごとの供給元は param-source.ts、
 * SQL の組み立ては generate/render/code-usecase-rpc.ts が担う(検査と生成が同じ導出を共有する)。
 *
 * **アプリの語彙は 1 語も持たない。** 関数名は server-actions.md「5 形の定型」が定める命名規約
 * (作成 = `insert_{entity}` / 遷移 = `apply_{machine}_transition`)から組み立て、実在は
 * data_table の `functions` に問い合わせる。
 *
 * このファイルの責務は**保存点の手順の列への接地**である。RPC 名の引き当て(`step-plan-rpc.ts`)は、
 * 手順の列を組まない受信の導出(`inbound/inbound-plan.ts`)も直接読むので別の部品になっている。
 */

import type { EventDef, SpecModel, StateMachineSpec } from '../model/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { DataFunctionDecl, DataResendDecl, DataTableSpecModel } from '../model/data/types.js';
import { tableOf } from '../semantics/query-window-columns.js';
import { entityNameOfAggregate } from '../semantics/domain-index.js';
import { transitionComputedColumns } from '../semantics/computed-columns.js';
import { groundOperation } from '../semantics/operation-ground.js';
import { effectsOf, findStepRpc, operationLabel, rpcNameCandidates } from './step-plan-rpc.js';
import { declaredOwner } from './actor-bound.js';
import type { UsecaseSaveDecl, UsecaseSpec, UsecaseStepDecl } from '../model/usecase/types.js';
import { stepKey } from '../model/usecase/types.js';

/** 手順の形(5 形の定型のうち、計画に乗る 4 つ)。 */
export type StepKind = 'create' | 'transition' | 'delete' | 'update';

/** action_spec の `runner`(無ければ `auto`)。引数の出どころの許可表の 1 軸(param-source-fields.ts)。 */
export type StepRunner = 'auto' | 'manual';
/** 接地できなかった理由 1 件(Finding の 3 点セットに写せる形で返す)。 */
export interface PlanProblem {
  readonly message: string;
  readonly suggestion: string;
  readonly counterexample: Readonly<Record<string, string>>;
}

/** 保存点の 1 手順を、呼ぶ RPC まで接地させたもの。 */
export interface SaveStepPlan {
  /** 保存点内での 0 始まりの通し番号。 */
  readonly index: number;
  readonly op: string;
  /**
   * 入力・結果・フォームの節の鍵(`as` があればそれ、無ければ `op`)。
   * 同じ操作を 1 つの保存点で 2 回実行するときに、2 つの手順を区別する唯一の名前である。
   */
  readonly alias: string;
  /** フォームの節の見出し(`label` があればそれ、無ければ操作の label、それも無ければ `op`)。 */
  readonly label: string;
  readonly repeat: boolean;
  readonly defaultsSelf: boolean;
  /**
   * 5 形のどれか。
   *
   * **保存点(複数手順)に置けるのは作成と遷移だけである**(削除・編集の定型 RPC は複合 RPC の
   * 中から呼ぶ形になっていない)。単発の操作(`single: true`。1 操作 = 手順が 1 つの保存点。
   * 束 ⑰ 設計 §0)では 4 形すべてが来る。
   */
  readonly kind: StepKind;
  readonly runner: StepRunner;
  readonly aggregate: string;
  readonly entity: string;
  /** 物理テーブル名(entity_spec の `table:` 上書き込み)。 */
  readonly table: string;
  /** 呼ぶ RPC の宣言(data_table の `functions`)。 */
  readonly fn: DataFunctionDecl;
  /**
   * その表の作成の冪等な再送の宣言(data_table の `resend`。無ければ持たない)。
   * 保存点の最初の作成の錨になる表の宣言を、複合 RPC の先頭の再送の枝が読む(`save-readback.ts`)。
   */
  readonly resend?: DataResendDecl;
  /** その表の data_table のファイル(指摘の文言に使う。表が引けなければ `{表}.md`)。 */
  readonly tableSpecPath?: string;
  /** 遷移のときの状態機械(作成では null)。 */
  readonly machine: StateMachineSpec | null;
  /** 遷移のときのイベント定義(作成では null)。 */
  readonly event: EventDef | null;
  /** 遷移が積む副作用 ID(state_spec の `effects[].do`)。作成では空。 */
  readonly effects: readonly string[];
  /** action_spec の `input` のうち、この手順のエンティティのフィールド名(宣言順)。 */
  readonly inputFields: readonly string[];
  /** 作成の持ち主の欄(action_spec の `owner`。作成者で埋める欄の明示。無ければ持たない)。 */
  readonly owner?: string;
  /**
   * action_spec の `computes`(入力に無く、実行時に純関数が決める欄)→ 純関数名。引数 `p_{欄}` の供給元がここにあれば、実行器は hooks の計算結果を渡す(束 ⑰ 設計 §3-2)。
   */
  readonly computes: Readonly<Record<string, string>>;
  /**
   * `computes[].reads`(その純関数が読む事実)の `{entity}.{field}`(重複なし・宣言順)。`plan-facts.ts` が
   * `readExternal` に通して `reads` に積む(宣言が無かったあいだ計算の材料は 1 欄も積まれなかった。束 ㉒)。
   */
  readonly computeReads: readonly string[];
  /**
   * `access_spec` の `transition_writes` と、どれかの遷移の `computes` が書く列(= 人の操作としては現れず、
   * **遷移が書く**と宣言されている列。集約単位の近似)。
   *
   * どの遷移が書くかはイベント単位の `records_actor` が決める。ここはその母集合であり、
   * 「宣言に無いから空を渡す」を許してよい列かどうかの判定にだけ使う(param-source-fields.ts)。
   */
  readonly transitionWrittenFields: readonly string[];
}

/** 保存点 1 つぶんの接地結果。 */
export interface SavePlan {
  readonly usecase: UsecaseSpec;
  readonly save: UsecaseSaveDecl;
  /** 呼ぶ RPC の関数名(保存点は複合 RPC `usecase_{name}_{save}`、単発は手順の定型 RPC)。 */
  readonly rpcName: string;
  readonly steps: readonly SaveStepPlan[];
  /**
   * **単発の操作か**(1 操作 = 手順が 1 つの保存点。束 ⑰ 設計 §0)。
   *
   * true のとき変わるのは 2 点だけである。
   *   - 状態を**予測しない**(まだ書いていない手順が無いので、読んだ値が実際の状態そのもの)
   *   - 呼ぶのは複合 RPC ではなく、その手順の定型 RPC(引数は署名どおりの名前付き)
   */
  readonly single: boolean;
}

/** 接地に要る入力(ドメイン + action_spec + data_table)。 */
export interface PlanInput {
  readonly domain: SpecModel;
  readonly actions: ActionSpecModel | null;
  readonly dataTables: DataTableSpecModel | undefined;
}

/** 接地の結果。1 本でも接地できなければ `problems` を返し、部分的な計画は返さない。 */
export type SavePlanResult =
  | { readonly ok: true; readonly plan: SavePlan }
  | { readonly ok: false; readonly problems: readonly PlanProblem[] };

/**
 * 複合 RPC の関数名を組み立てる。
 *
 * @param usecaseName ユースケース名(snake_case)
 * @param saveId 保存点 ID(snake_case)
 * @returns `usecase_{name}_{save}`(api スキーマに置く関数の名前)
 */
export function usecaseRpcName(usecaseName: string, saveId: string): string {
  return `usecase_${usecaseName}_${saveId}`;
}

/**
 * 保存点を接地させる。
 *
 * @param usecase ユースケース仕様
 * @param save 保存点の宣言
 * @param input ドメイン・action_spec・data_table
 * @returns 接地できた計画、または理由つきの失敗
 */
export function planSave(
  usecase: UsecaseSpec,
  save: UsecaseSaveDecl,
  input: PlanInput,
  single = false,
): SavePlanResult {
  const problems: PlanProblem[] = [];
  const steps: SaveStepPlan[] = [];
  save.steps.forEach((step, index) => {
    const grounded = groundStep(usecase, save, step, index, input, problems, single);
    if (grounded === null) return;
    steps.push({ ...grounded, index });
  });
  if (problems.length > 0) return { ok: false, problems };
  // 単発の操作は複合 RPC を持たない —— 呼ぶのはその手順の定型 RPC そのものである。
  const rpcName = single ? (steps[0]?.fn.name ?? '') : usecaseRpcName(usecase.name, save.id);
  return { ok: true, plan: { usecase, save, rpcName, steps, single } };
}

/** 1 手順ぶんの接地(種別・エンティティ・呼ぶ RPC・入力欄)。 */
function groundStep(
  usecase: UsecaseSpec,
  save: UsecaseSaveDecl,
  step: UsecaseStepDecl,
  index: number,
  input: PlanInput,
  problems: PlanProblem[],
  single: boolean,
): Omit<SaveStepPlan, 'index'> | null {
  const op = step.op;
  const at = { usecase: usecase.name, save: save.id, step: op, position: String(index) };
  const grounding = groundOperation(input.domain, op);
  if (grounding.kind === 'unknown') {
    problems.push({
      message: `手順 ${op} の接地先がドメイン仕様に見つかりません`,
      suggestion:
        '操作 ID は state_spec のイベント(`{machine}.{event}`)か、access_spec の予約 ID ' +
        '(`{entity}.create` / `.delete` / `.update`)のどちらかでなければならない',
      counterexample: { ...at, kind: grounding.kind },
    });
    return null;
  }
  if (!single && grounding.kind !== 'create' && grounding.kind !== 'transition') {
    problems.push({
      message: `手順 ${op} は作成でも遷移でもないため複合 RPC を組み立てられません`,
      suggestion:
        '保存点に置けるのは作成(`{entity}.create`)と遷移(`{machine}.{event}`)だけである。' +
        '削除・編集を 1 保存にまとめたいなら、その形の定型 RPC を先に用意して規約に載せる',
      counterexample: { ...at, kind: grounding.kind },
    });
    return null;
  }
  const aggregate = grounding.entry.aggregate;
  const entity = entityNameOfAggregate(input.domain, aggregate);
  const table = tableOf(input.domain, entity);
  const machine = grounding.kind === 'transition' ? grounding.entry.machine : null;
  const event = grounding.kind === 'transition' ? grounding.entry.event : null;
  const fn = findStepRpc(input.dataTables, grounding.kind, entity, machine?.machine ?? null, input.domain);
  if (fn === null) {
    const names = rpcNameCandidates(grounding.kind, entity, machine?.machine ?? null, input.domain);
    problems.push({
      message: `手順 ${op} が呼ぶはずの RPC ${names.join(' / ')} が data_table の functions にありません`,
      suggestion:
        `${table}.md の functions に "- name: ${names[0] ?? ''}" を kind: rpc として宣言する` +
        '(名前は server-actions.md「5 形の定型」の命名規約から導かれる)。定型に乗らない RPC で' +
        '実現している操作なら、action_spec に runner: manual(理由つき)を宣言する',
      counterexample: { ...at, function: names.join(' / ') },
    });
    return null;
  }
  const tableSpec = input.dataTables?.tables.find((candidate) => candidate.table === table);
  const owner = grounding.kind === 'create' ? declaredOwner(input.actions, entity) : null;
  return {
    ...(tableSpec?.resend === undefined ? {} : { resend: tableSpec.resend }),
    ...(owner === null ? {} : { owner }),
    ...(tableSpec === undefined ? {} : { tableSpecPath: tableSpec.relPath }),
    op,
    alias: stepKey(step),
    label: step.label ?? operationLabel(input.domain, op, entity, event),
    repeat: step.repeat,
    defaultsSelf: step.defaultsSelf,
    kind: grounding.kind,
    runner: runnerOf(input.actions, op),
    aggregate,
    entity,
    table,
    fn,
    machine,
    event,
    effects: machine === null || event === null ? [] : effectsOf(machine, event),
    inputFields: inputFieldsOf(input.actions, op, entity),
    computes: computesOf(input.actions, op, entity),
    computeReads: computeReadsOf(input.actions, op, entity),
    transitionWrittenFields: transitionWrittenFieldsOf(input.domain, input.actions, aggregate, entity),
  };
}

/**
 * 遷移が書く列: `access_spec` の `transition_writes`(遷移だけが書く列)と、**どれかの遷移の `computes`** が書く列
 * (計算で決まる列。別の集約の遷移も含む)の和(重複なし・宣言順)。
 *
 * 以前は後者を `writes` の `by: system` の行で近似していたが、その行は内部実行が編集の RPC で計算値を直に書ける
 * 経路を作っていた。計算で決まる値は入力として受け付けないので(2026-10-20 の裁定。V18)、`computes` の宣言から導く。
 */
function transitionWrittenFieldsOf(domain: SpecModel, actions: ActionSpecModel | null, aggregate: string, entity: string): readonly string[] {
  const fields = new Set<string>(domain.aggregates.get(aggregate)?.access?.transitionWrites ?? []);
  for (const field of transitionComputedColumns(domain, actions?.actions ?? [], entity)) fields.add(field);
  return [...fields];
}

function runnerOf(actions: ActionSpecModel | null, op: string): StepRunner {
  return actions?.actions.find((candidate) => candidate.handles.raw === op)?.runner === undefined ? 'auto' : 'manual';
}

/** その操作の action_spec が宣言する入力のうち、このエンティティのフィールド名(宣言順)。 */
function inputFieldsOf(actions: ActionSpecModel | null, op: string, entity: string): readonly string[] {
  const action = actions?.actions.find((candidate) => candidate.handles.raw === op);
  if (action === undefined) return [];
  return action.input.filter((ref) => ref.entity === entity).map((ref) => ref.field);
}

/**
 * その操作の `computes` のうちこのエンティティの欄が宣言した `reads`(重複なし・宣言順)。
 *
 * 母集合を `computesOf` と同じ「この手順が書く欄の計算」に揃えてあるのは、材料を積む相手が
 * その計算を実行する手順だからである(1 つの保存点で別々の集約を書く計算が並んでも、材料は
 * それぞれの手順に付く)。
 */
function computeReadsOf(actions: ActionSpecModel | null, op: string, entity: string): readonly string[] {
  const action = actions?.actions.find((candidate) => candidate.handles.raw === op);
  const reads = new Set<string>();
  for (const decl of action?.computes ?? []) {
    if (decl.entity !== entity) continue;
    for (const read of decl.reads) reads.add(read.raw);
  }
  return [...reads];
}

/** その操作の action_spec が宣言する計算値(`computes`)のうち、このエンティティの欄 → 純関数名。 */
function computesOf(actions: ActionSpecModel | null, op: string, entity: string): Readonly<Record<string, string>> {
  const action = actions?.actions.find((candidate) => candidate.handles.raw === op);
  const computes: Record<string, string> = {};
  for (const decl of action?.computes ?? []) {
    if (decl.entity === entity) computes[decl.field] = decl.ref;
  }
  return computes;
}
