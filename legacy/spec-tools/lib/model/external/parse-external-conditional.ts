/**
 * external_spec の**条件付き必須の軸**の読み取り(`degrade_summary` / `timeout_ms` /
 * `retry_max` / `idempotency` / `idempotency_source` / `idempotency_reason`)。
 *
 * どれも「ある軸の値によって、その行が持つべき / 持ってはいけない」という形の規則である
 * (縮退するなら中身が要る・こちらから呼ぶなら待ち時間の上限が要る・有限回の再試行なら上限が
 * 要る・外の状態を変えるなら二重反映を何が防ぐかが要る)。1 行分を組む parse-external-rows.ts が
 * 呼ぶ下位の部品で、責務は 1 行の妥当性に閉じる。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import type {
  ExternalDegrade,
  ExternalDirection,
  ExternalEffect,
  ExternalRetry,
  IdempotencySource,
} from './types.js';
import { IDEMPOTENCY_SOURCES } from './types.js';

/** `degrade_summary` を読む。`not_configured` / `fallback` の行だけが持つ(必須)。 */
export function parseDegradeSummary(
  item: YamlReader,
  id: string,
  degrade: ExternalDegrade,
  reporter: SpecReporter,
): string | undefined | 'invalid' {
  const value = item.optionalString('degrade_summary', 'degrade_summary に縮退の中身を 1 行で書く');
  const needs = degrade === 'not_configured' || degrade === 'fallback';
  if (needs && value === undefined) {
    reporter.error(
      item.pointer('degrade_summary'),
      `連携 ${id} は degrade: ${degrade} なのに degrade_summary がありません`,
      'degrade_summary に「鍵が無いときの挙動」を 1 行で書く',
      { integration: id, degrade },
    );
    return 'invalid';
  }
  return value;
}

/** `timeout_ms` を読む。`direction: outbound` は必須(正の整数)。 */
export function parseTimeoutMs(
  item: YamlReader,
  id: string,
  direction: ExternalDirection,
  reporter: SpecReporter,
): number | undefined | 'invalid' {
  const suggestion = 'timeout_ms に 1 以上の整数(ミリ秒)を書く';
  if (!item.has('timeout_ms')) {
    if (direction === 'outbound') {
      reporter.error(item.pointer('timeout_ms'), `連携 ${id} は direction: outbound なのに timeout_ms がありません`, suggestion, {
        integration: id,
      });
      return 'invalid';
    }
    return undefined;
  }
  if (direction !== 'outbound') {
    reporter.error(
      item.pointer('timeout_ms'),
      `連携 ${id} は direction: ${direction} なのに timeout_ms があります`,
      'timeout_ms を消す(こちらから呼びに行かない受信の連携に待ち時間の上限は無い)',
      { integration: id, direction },
    );
    return 'invalid';
  }
  const value = item.optionalNumber('timeout_ms', suggestion);
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    reporter.error(item.pointer('timeout_ms'), `連携 ${id} の timeout_ms は 1 以上の整数で書きます`, suggestion, {
      integration: id,
    });
    return 'invalid';
  }
  return value;
}

/** `retry_max` を読む。`retry: inline` の行だけが持つ(必須・正の整数)。 */
export function parseRetryMax(
  item: YamlReader,
  id: string,
  retry: ExternalRetry,
  reporter: SpecReporter,
): number | undefined | 'invalid' {
  const suggestion = 'retry_max に 1 以上の整数(再試行の上限回数)を書く';
  if (!item.has('retry_max')) {
    if (retry === 'inline') {
      reporter.error(item.pointer('retry_max'), `連携 ${id} は retry: inline なのに retry_max がありません`, suggestion, {
        integration: id,
      });
      return 'invalid';
    }
    return undefined;
  }
  if (retry !== 'inline') {
    reporter.error(
      item.pointer('retry_max'),
      `連携 ${id} は retry: ${retry} なのに retry_max があります`,
      'retry_max を消す(有効なのは retry: inline の行だけ)',
      { integration: id, retry },
    );
    return 'invalid';
  }
  const value = item.optionalNumber('retry_max', suggestion);
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    reporter.error(item.pointer('retry_max'), `連携 ${id} の retry_max は 1 以上の整数で書きます`, suggestion, {
      integration: id,
    });
    return 'invalid';
  }
  return value;
}

/** `idempotency` を読む。`effect: write` の行だけが持つ(必須)。 */
export function parseIdempotency(
  item: YamlReader,
  id: string,
  effect: ExternalEffect,
  reporter: SpecReporter,
): string | undefined | 'invalid' {
  const value = item.optionalString('idempotency', 'idempotency に冪等キーの作り方を 1 行で書く');
  if (effect === 'write' && value === undefined) {
    reporter.error(item.pointer('idempotency'), `連携 ${id} は effect: write なのに idempotency がありません`, 'idempotency に冪等キーの作り方を 1 行で書く', {
      integration: id,
    });
    return 'invalid';
  }
  if (effect === 'read' && value !== undefined) {
    reporter.error(
      item.pointer('idempotency'),
      `連携 ${id} は effect: read なのに idempotency があります`,
      'idempotency を消す(必須なのは effect: write の行だけ)',
      { integration: id },
    );
    return 'invalid';
  }
  return value;
}

/**
 * `idempotency_source` を読む。`effect: write` の行だけが持つ(必須・値域)。
 *
 * @param item 行のマッピング
 * @param id 連携 ID
 * @param effect 読み終えた効果
 * @param reporter 違反の記録先
 * @returns 源(read の行は undefined)。読めなければ 'invalid'
 */
export function parseIdempotencySource(
  item: YamlReader,
  id: string,
  effect: ExternalEffect,
  reporter: SpecReporter,
): IdempotencySource | undefined | 'invalid' {
  const suggestion = `idempotency_source に ${IDEMPOTENCY_SOURCES.join(' / ')} のいずれかを書く`;
  if (!item.has('idempotency_source')) {
    if (effect === 'read') return undefined;
    reporter.error(
      item.pointer('idempotency_source'),
      `連携 ${id} は effect: write なのに idempotency_source がありません`,
      suggestion,
      { integration: id },
    );
    return 'invalid';
  }
  if (effect === 'read') {
    reporter.error(
      item.pointer('idempotency_source'),
      `連携 ${id} は effect: read なのに idempotency_source があります`,
      'idempotency_source を消す(必須なのは effect: write の行だけ)',
      { integration: id },
    );
    return 'invalid';
  }
  const value = item.optionalString('idempotency_source', suggestion);
  if (value === undefined || !IDEMPOTENCY_SOURCES.includes(value as IdempotencySource)) {
    reporter.error(
      item.pointer('idempotency_source'),
      `連携 ${id} の idempotency_source ${value ?? '(空)'} は値域(${IDEMPOTENCY_SOURCES.join(' / ')})にありません`,
      suggestion,
      { integration: id, idempotency_source: String(value) },
    );
    return 'invalid';
  }
  return value as IdempotencySource;
}

/**
 * `idempotency_reason` を読む。`idempotency_source: none` の行だけが持つ(必須)。
 *
 * @param item 行のマッピング
 * @param id 連携 ID
 * @param source 読み終えた冪等の源(read の行は undefined)
 * @param reporter 違反の記録先
 * @returns 理由(不要な行は undefined)。読めなければ 'invalid'
 */
export function parseIdempotencyReason(
  item: YamlReader,
  id: string,
  source: IdempotencySource | undefined,
  reporter: SpecReporter,
): string | undefined | 'invalid' {
  const value = item.optionalString('idempotency_reason', 'idempotency_reason に「防がなくてよい理由」を 1 行で書く');
  if (source === 'none' && value === undefined) {
    reporter.error(
      item.pointer('idempotency_reason'),
      `連携 ${id} は idempotency_source: none なのに idempotency_reason がありません`,
      '二重反映が起こりうると宣言するなら、なぜそれでよいかを 1 行で書く(免除には理由が要る)',
      { integration: id },
    );
    return 'invalid';
  }
  if (source !== 'none' && value !== undefined) {
    reporter.error(
      item.pointer('idempotency_reason'),
      `連携 ${id} は idempotency_source: ${source ?? '(無し)'} なのに idempotency_reason があります`,
      'idempotency_reason を消す(必要なのは idempotency_source: none の行だけ)',
      { integration: id },
    );
    return 'invalid';
  }
  return value;
}

/**
 * `endpoints`(この連携を使う手書きの HTTP の入口)を読む。**`direction: outbound` の行だけが持ち、任意**。書くなら 1 本以上。
 *
 * 受信の行は口が生成物(`/api/inbound/{連携 id}`)で URL が決まっているので持てない(二重の宣言にしない)。
 * URL の書き方・Route Handler の実在・ほかの宣言との衝突は J2 が見る(ジョブの `endpoint` と同じ分担)。
 */
export function parseEndpoints(
  item: YamlReader,
  id: string,
  direction: ExternalDirection,
  reporter: SpecReporter,
): readonly string[] | undefined | 'invalid' {
  if (!item.has('endpoints')) return undefined;
  if (direction !== 'outbound') {
    reporter.error(
      item.pointer('endpoints'),
      `連携 ${id} は direction: ${direction} なのに endpoints があります`,
      'endpoints を消す(受信の口は生成物で、URL は /api/inbound/{連携 id} に決まっている。口を足すのは送信の連携が手書きの口から使われるときだけ)',
      { integration: id, direction },
    );
    return 'invalid';
  }
  const suggestion = 'endpoints にこの連携を使う手書きの口の URL のパス(/api/...)を 1 本以上並べる(口が無いなら endpoints ごと書かない)';
  const values = item.requiredStringList('endpoints', suggestion, false);
  return values === null ? 'invalid' : values;
}
