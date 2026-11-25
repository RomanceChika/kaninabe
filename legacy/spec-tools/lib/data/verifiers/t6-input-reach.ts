/**
 * T6 の続き: **action_spec の `input` の欄が、生成する RPC の本文に届く**ことの検査。
 *
 * 作成の RPC は、`input` に宣言された欄を 2 つの口のどちらかで受ける —— 1 欄ずつの引数(`p_{欄}`)か、
 * jsonb の袋(`p_values`)の鍵である。編集の RPC は、`access_spec` の `writes` に載った欄だけを
 * 変更集合(`p_changes`)から書き、`computes` が決める欄は `p_{欄}` で受ける。**どの口にも当たらない欄は、
 * 呼び手が値を渡しても本文のどこにも現れない** —— 生成された SQL は正しく組み立てられ、
 * 本文の組み立ての検査(`checkBuildable`)も、引数の型の検査(T14)も、何も言わずに通る。
 *
 * 判定は本文を作るのと同じ写像(`collectRpcFacts`)が返した**入れる列・書き換える列**に当てる。
 * 判定を書き写さないので、ここが緑なら宣言した欄はすべて本文に現れる。
 * **他の集約の欄**(`{他の集約}.{欄}`)も同じ静かな脱落で、届く口が無いので error にする(作成 / 編集の RPC が書くのは
 * その集約の行だけ。実仕様と 5 題材に現れる形は 0 件)。
 * **遷移**(`{機械}.{イベント}`)の RPC も同じである。遷移の RPC が `input` の値を受けるのは、
 * 対象の行の `id`(`p_{集約}_id`)と、1 欄ずつの引数(`p_{欄}`)の 2 つの口だけで、`p_changes` / `p_values` の袋は持たない。
 * どの口にも当たらない欄は、実行計画(`input_field` の供給元)にも本文にも現れない。
 * 遷移の RPC は機械の全イベントで共用なので、見るのは**そのイベントを呼ぶ操作**の `input` である
 * (呼ぶ RPC は実行計画と同じ引き当て `findStepRpc` で決める)。
 * 本文を生成しない関数(手書き・`composite`)の欄は、本文の側が正なのでここでは見ない。
 * **手書きの遷移(`runner: manual`)の `input` は見ない**(専用の RPC を自分で呼ぶのに、共用の遷移の RPC に照らすと偽の error になる)。
 * 作成 / 編集は予約 ID(`{集約}.create` / `{集約}.update`)で RPC が 1 本に決まるので、手書きの操作の `input` も見る(届かない欄を捨てる真の検出を捨てない)。
 */

import type { Finding } from '../../kernel/finding.js';
import type { RpcBodyFacts } from '../../sql/rpc-facts.js';
import type { DataFunctionDecl, DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import type { ActionSpec, ActionSpecModel, InputFieldRef } from '../../model/trace/types.js';
import type { SpecModel } from '../../model/types.js';
import { entityNameOfAggregate } from '../../semantics/domain-index.js';
import { groundOperation } from '../../semantics/operation-ground.js';
import { findStepRpc } from '../../usecase/step-plan-rpc.js';

/** この検査の ID(T6 の続き)。 */
const VERIFIER_ID = 'T6';

/** 欄の口を見る対象の形(作成・編集・遷移。削除は欄を受けない)。 */
type ReachShape = 'create' | 'update' | 'transition';

/** この RPC を呼ぶ操作を引くのに要る文脈(遷移は機械の全イベントが 1 本の RPC を共用するため)。 */
export interface ReachContext {
  readonly domain: SpecModel;
  readonly dataTables: DataTableSpecModel;
}

/**
 * その操作の `input` の欄のうち、本文が書かない欄を指摘する。
 *
 * @param fn 関数の宣言(本文を生成するもの)
 * @param table その関数の持ち場
 * @param shape 関数の形(作成か編集)
 * @param facts 本文に要る事実(`actions` を渡して集めたもの)
 * @param actions action_spec
 * @param context ドメイン仕様と全 data_table(遷移の RPC を呼ぶ操作を引く)
 * @returns 違反のリスト
 */
export function checkInputsReach(
  fn: DataFunctionDecl,
  table: DataTableSpec,
  shape: ReachShape,
  facts: RpcBodyFacts,
  actions: ActionSpecModel,
  context: ReachContext,
): Finding[] {
  const reached = reachedFields(shape, facts);
  const findings: Finding[] = [];
  for (const action of actions.actions) {
    if (!servedBy(action, fn, shape, facts.entity, context)) continue;
    const handled = action.handles.raw;
    for (const ref of action.input) {
      if (ref.entity !== facts.entity) {
        findings.push(foreignEntityFinding(fn, facts.entity, handled, ref));
        continue;
      }
      if (reached.has(ref.field)) continue;
      findings.push({
        verifier: VERIFIER_ID,
        severity: 'error',
        message: `${handled} の input の ${ref.raw} は、生成する ${fn.name} の本文のどこにも現れません(呼び手が値を渡しても捨てられます)`,
        location: ref.location,
        suggestion: suggestionOf(shape, fn, table, ref.field),
        counterexample: {
          operation: handled,
          input: ref.raw,
          function: fn.name,
          reachable: [...reached].join(', ') || '(なし)',
        },
      });
    }
  }
  return findings;
}

/** その形の RPC の本文に届く欄(入れる列・書き換える列・引数で受ける列)。 */
function reachedFields(shape: ReachShape, facts: RpcBodyFacts): Set<string> {
  const reached = new Set(columnsOf(shape, facts));
  // 対象の行を指す `id` は、書く欄ではなく**どの行か**を決める値で、`p_{集約}_id` が受ける。
  if (facts.params.some((param) => param.role.kind === 'target_id')) reached.add('id');
  return reached;
}

/** 形ごとの、値が列に届く口。 */
function columnsOf(shape: ReachShape, facts: RpcBodyFacts): readonly string[] {
  if (shape === 'create') return facts.insertColumns.map((column) => column.name);
  if (shape === 'update') return [...facts.writeColumns.map((field) => field.name), ...facts.updateColumns.map((column) => column.name)];
  // 遷移: 袋(`p_changes` / `p_values`)を持たない。1 欄ずつの引数だけが値を運ぶ。
  return facts.params.flatMap((param) => (param.role.kind === 'column' ? [param.role.field.name] : []));
}

/**
 * その操作の `input` を、この関数が受けるか。
 *
 * 作成 / 編集は予約 ID(`{集約}.{create|update}`)で RPC が 1 本に決まる。**手書き(`runner: manual`)の作成 / 編集も対象にする**(届かない欄を捨てる真の検出を捨てない)。
 * 意図して許す構成: 手書きの作成 / 編集が専用の RPC を呼ぶのに、その `input` が共用の(予約 ID の)RPC の本文に照らされる形。
 * この形は偽の error ではなく許容する(予約 ID の関数が生成されるなら、その本文が受けない欄を `input` に宣言した時点で、呼び手が渡しても捨てられる宣言になっている)。
 * 専用の RPC を呼ぶ手書きの作成 / 編集が実際に現れ、この判定が偽の error になる題材が出たら、遷移と同じ除外を**再訪**する。
 *
 * 遷移は共用の RPC なので、実行計画が呼ぶ RPC を引くのと**同じ引き当て**(`groundOperation` → `findStepRpc`)で、その操作が呼ぶ RPC がこの関数かを見る。
 * **手書きの遷移は対象外**(専用の RPC を自分で呼ぶので、引き当てが共用の RPC に落ちても、その本文に照らして偽の error を出さない。
 * 実行計画も求めない = A15 の「`runner: manual` は計画を求めない」と同じ趣旨)。
 */
function servedBy(action: ActionSpec, fn: DataFunctionDecl, shape: ReachShape, entity: string, context: ReachContext): boolean {
  if (shape !== 'transition') return action.handles.raw === `${entity}.${shape}`;
  // 手書きの遷移は専用の RPC を自分で呼ぶ(共用の遷移の RPC の本文に照らさない)。
  if (action.runner !== undefined) return false;
  const grounding = groundOperation(context.domain, action.handles.raw);
  if (grounding.kind !== 'transition') return false;
  const target = entityNameOfAggregate(context.domain, grounding.entry.aggregate);
  return findStepRpc(context.dataTables, 'transition', target, grounding.entry.machine.machine, context.domain)?.name === fn.name;
}

/**
 * 他の集約の欄が `input` にある指摘。
 *
 * 作成 / 編集の RPC が書くのは**その集約の行だけ**なので、他の集約の欄には届く口が無い
 * (自集約の欄が落ちるのと同じ静かな脱落である)。文脈から引く値は `reads`(計算の材料)で運び、
 * `input` には書かない。
 */
function foreignEntityFinding(
  fn: DataFunctionDecl,
  entity: string,
  handled: string,
  ref: InputFieldRef,
): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message: `${handled} の input の ${ref.raw} は、${entity} の欄ではありません(${fn.name} が書くのは ${entity} の行だけで、他の集約の欄は本文のどこにも現れず、呼び手が値を渡しても捨てられます)`,
    location: ref.location,
    suggestion:
      `この欄を input から外す。${ref.entity} の行を動かしたいなら ${ref.entity} を書く別の操作にする(1 アクション 1 操作)。` +
      `${entity} がその行を指すだけなら、${entity} の参照欄(${entity}.…_id)で受ける`,
    counterexample: { operation: handled, input: ref.raw, function: fn.name, writes: entity },
  };
}

/** 直し方(形ごとに口が違う)。 */
function suggestionOf(shape: ReachShape, fn: DataFunctionDecl, table: DataTableSpec, field: string): string {
  const where = `${table.location.file} の functions.${fn.name}`;
  if (shape === 'create') {
    return (
      `${where} の params / args に p_${field} を足すか(1 欄ずつ受ける)、p_values(jsonb)を受けて欄を袋で運ぶか、` +
      'この欄を input から外す(DB が決める欄なら supplied_by: db にする)'
    );
  }
  if (shape === 'transition') {
    return (
      `${where} の params / args に p_${field} を足して 1 欄ずつ受ける(遷移の RPC は袋を持たず、` +
      '対象の行の id と p_{欄} の引数しか値を運べない)か、この欄を input から外す'
    );
  }
  return (
    `access_spec の writes にこの欄を足して p_changes で書けるようにするか、` +
    `action_spec の computes が決める欄なら ${where} に p_${field} を足すか、この欄を input から外す`
  );
}
