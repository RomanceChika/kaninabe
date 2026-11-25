import type { InvariantResolver } from '@kaninabe/runtime/bindings';
import type { UsecaseRepository } from '@kaninabe/runtime/ports';
import { callRpc } from '../rpc/call-rpc';
import type { RpcSource } from '../rpc/rpc-outcome';

/**
 * 保存点の**複合 RPC** を 1 回呼び出す口（束⑯c）。
 *
 * 仕様: docs/rules/decisions/common/ADR-0011-usecase-layer-two-origins.md §4
 *       supabase/migrations/{saves[].migration}（生成された plpgsql）
 *
 * 集約ごとのリポジトリと違い、**この口は集約を知らない**。関数名も引数も実行計画
 * （生成物 `@/domain/generated/usecase-plans`）が渡す。
 *
 * ここが持つのは**複合 RPC の引数の名前の規約**だけである —— 保存点はどれも
 * `p_id` / `p_actor_id` / `p_actor_roles` / `p_expected` / `p_input` の 5 本で呼ぶ
 * （生成された plpgsql の署名）。
 * 結末の写像（0 行・`UC409`・23xxx・想定外）は単発の操作とまったく同じものであり、
 * `../rpc/rpc-outcome.ts` の 1 か所に置いてある（束 ⑰。同じ読み方を 2 つ持たない）。
 *
 * どの合図でもトランザクション全体が戻っているので、**部分的に書かれた状態は無い**。
 *
 * 複合 RPC は副作用の ID を引数に載せない(本文が積む)ので、受領の `requestedEffects` は `null`
 * (要求した効果を追っていない)になる。空の配列にはしない —— 空は「積まなかった」と読めてしまう。
 * `outbox` は単発と同じく常に `unknown` である。
 */

/**
 * `UsecaseRepository` を作る。
 *
 * @param source - 関数名を実行時に決める最小の口(適合は製品の接続層。ADR-0013)
 * @param invariantOfMessage - DB の不整合のメッセージ → 不変条件 ID(製品が渡す)（`permit` は operation が立て終えている）
 * @returns 保存点の複合 RPC を 1 回呼び出す口
 */
export function createUsecaseRepository(source: RpcSource, invariantOfMessage: InvariantResolver): UsecaseRepository {
  return {
    call: (rpc, args) =>
      callRpc(
        source,
        rpc,
        {
          p_id: args.id,
          p_actor_id: args.actorId,
          p_actor_roles: [...args.actorRoles],
          p_expected: args.expected,
          p_input: args.input,
        },
        { emptyIsConflict: false, tracksEffects: false },
        invariantOfMessage,
      ),
  };
}
