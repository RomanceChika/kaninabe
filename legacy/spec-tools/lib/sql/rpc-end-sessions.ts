/**
 * 遷移 RPC の本文が持つ**セッションを終える呼び出し**の配線を、ジョブカタログと状態機械から導く(R11)。
 *
 * ジョブカタログの行が `ends_sessions: {集約}` と `platform_call: {RPC}` を持ち、その集約の状態機械が
 * `effects` でその効果を載せるイベントがあれば、そのイベントで遷移が確定したとき、本文は同じトランザクションで
 * `{schema}.{platform_call}({対象の行の id})` を呼ぶ。どの機械の RPC かは `transitionTargetOf` が関数名から決める
 * (決まらない遷移 RPC の失敗はそちらが報告する)。呼び先の RPC 自身には配線しない(自分を呼ぶ再帰を作らない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { JobCatalogSpec } from '../model/job/types.js';
import type { SpecModel } from '../model/types.js';
import { transitionTargetOf } from './rpc-transition-machine.js';

/**
 * 遷移の本文がセッションを終える呼び出しを持つための配線(R11。ジョブカタログの `ends_sessions` から導く)。
 *
 * `events` のイベントで遷移が確定したとき、同じトランザクションの中で `{schema}.{call}({対象の行の id})` を呼ぶ。
 * 認証基盤の綴りは呼び先(`call`)の本文に閉じ、ここには出ない。
 */
export interface EndSessionsWiring {
  /** 呼び先の RPC 名(ジョブカタログの `platform_call`)。 */
  readonly call: string;
  /** 呼び先の置き場のスキーマ。 */
  readonly schema: string;
  /** 効果を `effects` に載せたドメインイベント(`p_event_id` と同じ `{機械}.{イベント}`)。 */
  readonly events: readonly string[];
}

/**
 * 遷移 RPC 1 本の、セッションを終える呼び出しの配線。
 *
 * @param fn 遷移 RPC の関数名
 * @param entity 表の集約(エンティティ名)
 * @param domain ドメイン仕様
 * @param catalog ジョブカタログ(無ければ配線は無い)
 * @param schema RPC の置き場のスキーマ
 * @returns 配線。効果を載せるイベントが無い・機械が決まらない・呼び先が自分自身なら undefined
 */
export function endSessionsWiringOf(
  fn: string,
  entity: string,
  domain: SpecModel,
  catalog: JobCatalogSpec | null | undefined,
  schema: string,
): EndSessionsWiring | undefined {
  const ending = (catalog?.jobs ?? []).filter((job) => job.endsSessions === entity && job.platformCall !== undefined && job.platformCall !== fn);
  const resolved = ending.length === 0 ? null : transitionTargetOf(fn, entity, domain);
  if (resolved === null || !resolved.ok) return undefined;
  const machine = resolved.target.machine;
  for (const job of ending) {
    const events = machine.effects.filter((effect) => effect.do.includes(job.id)).map((effect) => `${machine.machine}.${effect.on}`);
    if (events.length > 0) return { call: job.platformCall ?? '', schema, events };
  }
  return undefined;
}
