/**
 * 保存点の複合 RPC を「data_table の関数宣言」と同じ形に写す(束 ⑯c 設計 §3-6「閉世界」)。
 *
 * 複合 RPC は生成物なので data_table に手で宣言しない。しかし DB には実在するため、
 * 関数の閉世界を見る突合(data-table-parity / api-parity)からは見えていなければならない。
 * そこで**生成器の側で宣言を作る** —— 帰属表は最初の手順の表、形は `composite`、
 * 併せて書く表は各手順の RPC が触る表の和から帰属表を除いたもの。
 *
 * これを 1 か所に置くことで、期待表(data-table-expectations)・署名表(rpc-signatures)・
 * API スキーマの閉世界(api-expectations)の 3 つが同じ導出を共有する(手書きの重複を持たない)。
 */

import type { SpecModel } from '../model/types.js';
import type { DataFunctionDecl, DataTableSpecModel } from '../model/data/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import { planSave, usecaseRpcName } from './step-plan.js';

/** 複合 RPC の固定の引数名(全保存点で同じ形)。 */
export const COMPOSITE_PARAMS: readonly string[] = ['p_id', 'p_actor_id', 'p_actor_roles', 'p_expected', 'p_input'];

/** 複合 RPC の固定の引数型(`COMPOSITE_PARAMS` と同じ順)。 */
export const COMPOSITE_ARGS: readonly string[] = ['uuid', 'uuid', 'text[]', 'jsonb', 'jsonb'];

/** 生成した複合 RPC 1 本の帰属つき宣言。 */
export interface CompositeFunction {
  /** 帰属する表(最初の手順の表)。 */
  readonly table: string;
  readonly fn: DataFunctionDecl;
}

/** 複合 RPC を導くのに要る入力(ドメイン + action_spec + data_table + usecase_spec)。 */
export interface CompositeInput {
  readonly domain: SpecModel;
  readonly actions: ActionSpecModel | null;
  readonly dataTables: DataTableSpecModel | undefined;
  readonly usecases: UsecaseSpecModel | undefined;
}

/**
 * 全ユースケースの全保存点から、複合 RPC の関数宣言を作る。
 *
 * 接地できない保存点(呼ぶ RPC が見つからない等)は**黙って飛ばす** —— 同じ接地を
 * 検査 Y8 と生成器 code-usecase-rpc が見ており、そちらが反例つきで止める。ここで二重に
 * 落とすと、同じ 1 つの誤りが 3 か所から違う言葉で報告されることになる。
 *
 * @param input ドメイン・action_spec・data_table・usecase_spec
 * @returns 関数名順に並べた複合 RPC の宣言(usecase_spec が無ければ空)
 */
export function usecaseCompositeFunctions(input: CompositeInput): readonly CompositeFunction[] {
  const model = input.usecases;
  if (model === undefined || !model.available) return [];
  const composites: CompositeFunction[] = [];
  for (const usecase of model.usecases) {
    for (const save of usecase.saves) {
      const planned = planSave(usecase, save, {
        domain: input.domain,
        actions: input.actions,
        dataTables: input.dataTables,
      });
      if (!planned.ok) continue;
      const steps = planned.plan.steps;
      const owner = steps[0];
      if (owner === undefined) continue;
      const touched = new Set(steps.flatMap((step) => [step.table, ...step.fn.alsoWrites]));
      touched.delete(owner.table);
      composites.push({
        table: owner.table,
        fn: {
          name: usecaseRpcName(usecase.name, save.id),
          args: [...COMPOSITE_ARGS],
          params: [...COMPOSITE_PARAMS],
          kind: 'rpc',
          shape: 'composite',
          alsoWrites: [...touched].sort((a, b) => a.localeCompare(b)),
        },
      });
    }
  }
  return composites.sort((a, b) => a.fn.name.localeCompare(b.fn.name));
}
