/**
 * ジョブカタログの行の `realized_by`（同一トランザクションで実現される効果が、実現する RPC を名指しする欄）の読み取り。
 *
 * 行の他のキーとは読み取りの規則が違う（書ける行が限られ、値が写像で、形の検査が独立している）ので `parse-jobs.ts` から割った。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import { SNAKE } from './parse-vocabulary.js';

/** イベント ID（`{machine}.{event}` / `{entity}.update`）の形。 */
const EVENT_ID = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * `realized_by`（効果を実現する RPC の名指し。`{イベント ID}: {RPC 名}`）を読む。
 *
 * 同一トランザクションで実現される行（`kind` の語が `in_transaction`）だけが持てる。形（キーがイベント ID・値が
 * スネークケースの RPC 名）はここで見る。必須かどうか・キーの過不足・RPC の実在は T19（ほかの仕様との突合）が見る。
 *
 * @returns 名指し（無ければ undefined。書けない行に書かれたら記録して null = 行ごと落とす）
 */
export function parseRealizedBy(
  item: YamlReader,
  id: string,
  inTransaction: boolean,
  reporter: SpecReporter,
): Readonly<Record<string, string>> | undefined | null {
  if (!item.has('realized_by')) return undefined;
  if (!inTransaction) {
    reporter.error(
      item.pointer('realized_by'),
      `ジョブ ${id} に realized_by が書かれていますが、この行の kind は同一トランザクションで実現される語（in_transaction）ではありません`,
      'realized_by は書き込みと同じトランザクションで実現される効果が、実現する RPC を名指しする欄である。キューに積まれる効果には書かない（キーを消す）',
      { job: id },
    );
    return null;
  }
  const map = item.optionalStringMap('realized_by', 'realized_by に "{イベント ID}: {RPC 名}" を並べる（例: membership.leave: apply_member_transition）');
  const entries = Object.entries(map);
  if (entries.length === 0) {
    reporter.error(
      item.pointer('realized_by'),
      `ジョブ ${id} の realized_by が空です`,
      '効果が起きる全部のイベントについて、実現する RPC を "{イベント ID}: {RPC 名}" で名指しする',
      { job: id },
    );
    return null;
  }
  for (const [event, rpc] of entries) {
    if (!EVENT_ID.test(event) || !SNAKE.test(rpc)) {
      reporter.error(
        `${item.pointer('realized_by')}.${event}`,
        `ジョブ ${id} の realized_by の ${event}: ${rpc} の形が違います`,
        'キーは "{machine}.{event}" / "{entity}.update" のイベント ID、値はスネークケースの RPC 名で書く',
        { job: id, event, rpc },
      );
      return null;
    }
  }
  return map;
}

