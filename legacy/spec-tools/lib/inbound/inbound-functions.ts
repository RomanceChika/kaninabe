/**
 * 受信の RPC を「data_table の関数宣言」と同じ形に写す(composite.ts と同じ理由)。
 *
 * 受信の RPC(`api.inbound_{連携}`)は生成物なので data_table に手で宣言しない。しかし DB には
 * 実在するため、関数の閉世界を見る突合(data-table-parity / api-parity / rpc-signatures-parity)
 * からは見えていなければならない。そこで**生成器の側で宣言を作る** —— 帰属表は記録先の表、
 * 形は `composite`(5 形の定型に乗らない)、併せて書く表は 2 本の RPC が触る表の和から
 * 帰属表を除いたものである。
 *
 * これを 1 か所に置くことで、期待表・署名表・API スキーマの閉世界の 3 つが同じ導出を共有する。
 */

import type { SpecModel } from '../model/types.js';
import type { DataFunctionDecl, DataTableSpecModel } from '../model/data/types.js';
import type { ExternalSpecModel } from '../model/external/types.js';
import { INBOUND_ARGS, INBOUND_PARAMS, planInbound } from './inbound-plan.js';
import type { ProductRoots } from '../model/product/types.js';

/** 生成した受信の RPC 1 本の帰属つき宣言。 */
export interface InboundFunction {
  /** 帰属する表(記録先 = `event_id_table`)。 */
  readonly table: string;
  readonly fn: DataFunctionDecl;
}

/** 受信の RPC を導くのに要る入力。 */
export interface InboundFunctionInput {
  readonly domain: SpecModel;
  readonly dataTables: DataTableSpecModel | undefined;
  readonly external: ExternalSpecModel | undefined;
  /** 製品が宣言した根(道案内のパスを組み立てる)。 */
  readonly roots: ProductRoots;
}

/**
 * 全 external_spec の受信の行から、受信の RPC の関数宣言を作る。
 *
 * 接地できない行は**黙って飛ばす** —— 同じ接地を X5 と生成器 code-inbound-rpc が見ており、
 * そちらが反例つきで止める(composite.ts と同じ流儀)。
 *
 * @param input ドメイン仕様・data_table・外部連携カタログ
 * @returns 関数名順に並べた受信の RPC の宣言(受信の行が無ければ空)
 */
export function inboundRpcFunctions(input: InboundFunctionInput): readonly InboundFunction[] {
  const catalog = input.external?.catalog;
  if (catalog === undefined || catalog === null) return [];
  const functions: InboundFunction[] = [];
  for (const integration of catalog.integrations) {
    if (integration.direction !== 'inbound') continue;
    const planned = planInbound(integration, { domain: input.domain, dataTables: input.dataTables, roots: input.roots });
    if (!planned.ok) continue;
    const plan = planned.plan;
    const touched = new Set([
      plan.transition.table,
      ...plan.record.fn.alsoWrites,
      ...plan.transition.fn.alsoWrites,
    ]);
    touched.delete(plan.record.table);
    functions.push({
      table: plan.record.table,
      fn: {
        name: plan.rpcName,
        args: [...INBOUND_ARGS],
        params: [...INBOUND_PARAMS],
        kind: 'rpc',
        shape: 'composite',
        alsoWrites: [...touched].sort((a, b) => a.localeCompare(b)),
      },
    });
  }
  return functions.sort((a, b) => a.fn.name.localeCompare(b.fn.name));
}
