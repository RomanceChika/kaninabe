/**
 * 関数・トリガの本文が引く索引(`functions[].lookup`)を、索引の期待として読み出す純粋モジュール。
 *
 * 索引を要求するのは query_spec(アプリの読み取り)だけではない —— 書き込みの執行点のトリガ関数
 * (「同じ送信元の直近の件数」を数える)や、ジョブを取り出す関数(「実行時刻の来た待ちの行」)は、
 * 本文が自表を絞り込み・並べる。その要求を `functions[].lookup`(列の並び)として宣言させ、
 * query_spec から導く期待索引と**同じ導出**(`index-derivation.ts` の畳み込み・`exclusion.ts` の除外)に載せる。
 * 読み取りは query_spec が正なので、app のコードが引く索引はここに載らない(query_spec に書く)。
 *
 * 実 DB の関数の本文にその列が現れることは data-table-parity が見る(宣言だけで本文が引かない、を止める)。
 */

import type { DataTableSpecModel } from '../../model/data/types.js';
import type { SpecModel } from '../../model/types.js';
import { ceilingPlanOf } from '../../model/data/ceiling-plan.js';
import { crossShapeOf } from '../../model/data/cross-check-shape.js';
import type { SourceLocation } from '../../kernel/source-location.js';

/** 関数の本文が要求する索引 1 本(索引の列 + どの関数が引くか)。 */
export interface LookupIndexRequest {
  /** 索引を持つ表(関数の持ち場の表)。 */
  readonly table: string;
  /** 索引の列の並び(`lookup` の宣言順)。 */
  readonly columns: readonly string[];
  /** その本文が引く関数の名前。 */
  readonly function: string;
  /** 宣言の位置(その表の data_table の `functions.{名前}.lookup`)。 */
  readonly location: SourceLocation;
}

/**
 * 全 data_table の `functions[].lookup` を集める。
 *
 * @param dataTables 読み込み済みの data_table
 * @returns 表の宣言順・関数の宣言順の要求(`lookup` を持たない関数は載らない)
 */
export function lookupIndexRequests(dataTables: DataTableSpecModel): readonly LookupIndexRequest[] {
  return dataTables.tables.flatMap((spec) =>
    spec.functions.flatMap((fn) =>
      fn.lookup === undefined
        ? []
        : [{ table: spec.table, columns: fn.lookup, function: fn.name, location: { ...spec.location, pointer: `functions.${fn.name}.lookup` } }],
    ),
  );
}

/**
 * 未ログインの作成の天井(access_spec の `creates[].abuse`)が要求する索引を集める。
 *
 * 全体の天井は時刻の欄 `[at]`、鍵ごとの天井は `[column, at]` を引く(生成されるトリガ関数の本文が自表をその列で絞る)。
 * **関数の `lookup:` を手で書かせない** —— 宣言は abuse の 1 か所で、索引の要求はそこから導く(2 か所に同じ宣言を書かせない)。
 * 要求元の名前は生成されるトリガ関数の名前で、`lookup` の要求と同じ種類(`lookup`)として前方一致の畳み込みに載る。
 *
 * @param dataTables 読み込み済みの data_table
 * @param domain ドメイン仕様(abuse と時刻の欄を引く)
 * @returns 表の宣言順の要求(天井を生成しない表は載らない)
 */
export function ceilingIndexRequests(dataTables: DataTableSpecModel, domain: SpecModel): readonly LookupIndexRequest[] {
  return dataTables.tables.flatMap((spec) => {
    const plan = ceilingPlanOf(spec, domain);
    if (plan === null) return [];
    const location = { ...spec.location, pointer: 'creates.abuse' };
    const global = { table: spec.table, columns: [plan.at], function: plan.name, location };
    return plan.perKey === undefined ? [global] : [global, { ...global, columns: [plan.perKey.column, plan.at] }];
  });
}

/**
 * 別の集約の列との等式の制約トリガ(参照される側の端)が要求する索引を集める。
 *
 * 参照される側の表(例: 従業員)の行が更新されたとき、本文は「その行を指す行」を、参照の欄(例: 店舗の責任者)で引く。
 * 参照の欄に索引が無いと、相手の表を全部読む(会社の変更ごとに全件走査)。だから**不変条件が住む表**に、参照の欄の索引を要求する。
 * 参照する側(host)の端の本文は主キーで引くだけなので索引を要求しない。**関数の `lookup:` を手で書かせない** ——
 * 宣言は不変条件とトリガ(`invariant:`)の 1 か所で、索引の要求はそこから導く。要求元の名前は生成されるトリガ関数の名前で、
 * `lookup` の要求と同じ種類(`lookup`)として前方一致の畳み込みに載り、参照の欄の外部キーの索引があれば期待から外れる(索引名は増えない)。
 *
 * @param dataTables 読み込み済みの data_table
 * @param domain ドメイン仕様(不変条件と参照の欄を引く)
 * @returns 表の宣言順・トリガの宣言順の要求(参照される側の端でないトリガは載らない)
 */
export function crossIndexRequests(dataTables: DataTableSpecModel, domain: SpecModel): readonly LookupIndexRequest[] {
  return dataTables.tables.flatMap((spec) =>
    spec.triggers.flatMap((trigger): LookupIndexRequest[] => {
      const judged = crossShapeOf(trigger, spec, domain, dataTables.tables);
      if (judged.kind !== 'shape' || judged.shape.side !== 'referenced') return [];
      return [
        {
          table: judged.shape.host.table,
          columns: [judged.shape.refColumn],
          function: trigger.functionName,
          location: { ...spec.location, pointer: `triggers.${trigger.name}` },
        },
      ];
    }),
  );
}

/**
 * 作成 RPC が監査ログを引く列の並び(`sql/rpc-resend.ts` の `refuseRecreated` の字面と同じ。一致は単体テストが見る)。
 * 作成は行を入れた後に、同じ鍵・同じ操作の作成が監査ログに既にあるかを引く(1 回目の行が消された後の押し直しを作り直さない。点検 23 回目 O23-2)。
 */
export const RECREATE_AUDIT_LOOKUP = ['entity_id', 'event_id'] as const;

/**
 * 作成 RPC の本文が要求する、監査ログ(`framework: domain_events` の表)の索引を集める。
 *
 * 作成の本文は生成物で、行を入れるたびに監査ログを `(entity_id, event_id)` で引く。**関数の `lookup:` を手で書かせない** —— 要求は
 * 作成の形(`shape: create`)の宣言から導く。要求元の名前は作成 RPC の名前で、`lookup` の要求と同じ種類として前方一致の畳み込みに載る。
 *
 * @param dataTables 読み込み済みの data_table
 * @returns 作成 RPC ごとの要求(監査ログの表が無い・作成が無ければ空)
 */
export function recreateIndexRequests(dataTables: DataTableSpecModel): readonly LookupIndexRequest[] {
  const audit = dataTables.tables.find((spec) => spec.framework === 'domain_events');
  if (audit === undefined) return [];
  return dataTables.tables.flatMap((spec) =>
    spec.functions.flatMap((fn) =>
      fn.kind === 'rpc' && fn.shape === 'create'
        ? [{ table: audit.table, columns: [...RECREATE_AUDIT_LOOKUP], function: fn.name, location: { ...spec.location, pointer: `functions.${fn.name}` } }]
        : [],
    ),
  );
}
