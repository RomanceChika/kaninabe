/**
 * external_spec の**受信の軸**(`signature` + 鍵/理由 / `event_id_table` / `emits` /
 * `migration` / `on_conflict`)の読み取り。
 *
 * 1 行分を組む parse-external-rows.ts が呼ぶ下位の部品で、責務は
 * 「`direction` に応じてこれらが在るべきか無いべきか」に閉じる。
 * 値が実在の表・遷移・設定に接地するかは X5(x5-inbound-grounding.ts)の担当である。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import type { ExternalDirection, InboundConflictReply, InboundIntegrationDecl, InboundSignature, InboundSignatureDecl } from './types.js';
import { DEFAULT_INBOUND_MAX_BODY_BYTES, INBOUND_CONFLICT_REPLIES, INBOUND_SIGNATURES, MAX_INBOUND_BODY_BYTES } from './types.js';

/** 受信の軸(受信の行だけが持ち、どれも揃っている)。 */
export type InboundAxes = Pick<
  InboundIntegrationDecl,
  'eventIdTable' | 'emits' | 'migration' | 'onConflict' | 'maxBodyBytes'
> &
  InboundSignatureDecl;

/** `direction: inbound` の行だけが持つキー(送信の行にあればエラー)。 */
const INBOUND_ONLY_KEYS: readonly string[] = [
  'signature',
  'signature_key',
  'signature_reason',
  'event_id_table',
  'emits',
  'migration',
  'on_conflict',
  'max_body_bytes',
];

/** `{machine}.{event}` の形(ドメインイベント ID)。 */
const DOMAIN_EVENT = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** 生成 migration のファイル名の形(`{14 桁}_inbound_{連携 id}.sql`)。 */
const MIGRATION = /^\d{14}_inbound_[a-z][a-z0-9_]*\.sql$/;

/**
 * 受信の軸を読む。**`direction: inbound` の行だけが持ち、どれも必須**である。
 *
 * 揃って初めて受信口を生成できる —— 誰の署名をどの鍵で検証するか(`signature` +
 * `signature_key`)・同じ通知を 2 度反映しない根拠はどの表か(`event_id_table`)・受け取った
 * 結果どのドメインイベントが起きるか(`emits`)・記録と遷移を 1 トランザクションで起こす RPC を
 * どの migration に書き出すか(`migration`)・状態が合わなかったときに相手へ何を返すか
 * (`on_conflict`)。1 つでも欠けると「受信するらしい」以上のことを誰も言えない宣言になるので、
 * 部分的に書ける形にしない。実在への接地(表・遷移・設定)は X5 が見る。
 *
 * `max_body_bytes` だけは任意で、書かなければ小さめの既定(`DEFAULT_INBOUND_MAX_BODY_BYTES`)になる ——
 * 既定は閉じる側(大きな本文を断る)なので、緩めるのは宣言だけである。
 *
 * @param item 行のマッピング
 * @param id 連携 ID
 * @param direction 読み終えた向き
 * @param reporter 違反の記録先
 * @returns 読めた軸(送信の行では null)、または `'invalid'`
 */
export function parseInboundAxes(
  item: YamlReader,
  id: string,
  direction: ExternalDirection,
  reporter: SpecReporter,
): InboundAxes | null | 'invalid' {
  const present = INBOUND_ONLY_KEYS.filter((key) => item.has(key));
  if (direction !== 'inbound') {
    if (present.length === 0) return null;
    reporter.error(
      item.pointer(present[0] ?? 'signature'),
      `連携 ${id} は direction: ${direction} なのに受信の軸(${present.join(' / ')})があります`,
      '受信の軸を消すか、direction: inbound に直す(送信の連携は署名検証もイベント ID の一意制約も持たない)',
      { integration: id, direction },
    );
    return 'invalid';
  }
  const signature = readSignature(item, reporter);
  const eventIdTable = item.requiredString(
    'event_id_table',
    'event_id_table に外部イベント ID の一意制約を持つ表の data_table id(例: table-webhook_events)を書く',
  );
  const emitsSuggestion =
    'emits に外部イベントが起こすドメインイベントを {machine}.{event} で書く(by に system を含む遷移であること)';
  const emits = item.requiredString('emits', emitsSuggestion);
  const migration = item.requiredString(
    'migration',
    `migration に受信の RPC を書き出す migration のファイル名を書く(例: 20260912000001_inbound_${id}.sql)`,
  );
  const onConflict = readConflictReply(item, reporter);
  if (signature === null || eventIdTable === null || emits === null || migration === null || onConflict === null) {
    return 'invalid';
  }
  const keyed = readSignatureKey(item, id, signature, reporter);
  if (keyed === 'invalid') return 'invalid';
  const maxBodyBytes = readMaxBodyBytes(item, id, reporter);
  if (maxBodyBytes === null) return 'invalid';
  if (!DOMAIN_EVENT.test(emits)) {
    reporter.error(item.pointer('emits'), `連携 ${id} の emits ${emits} が {machine}.{event} 形式ではありません`, emitsSuggestion, {
      integration: id,
      emits,
    });
    return 'invalid';
  }
  if (!MIGRATION.test(migration)) {
    reporter.error(
      item.pointer('migration'),
      `連携 ${id} の migration ${migration} が {14 桁}_inbound_{連携 id}.sql の形ではありません`,
      `migration を "20260912000001_inbound_${id}.sql" の形に直す(先頭 14 桁が適用順を決める)`,
      { integration: id, migration },
    );
    return 'invalid';
  }
  return { ...keyed, eventIdTable, emits, migration, onConflict, maxBodyBytes };
}

/** `max_body_bytes` を読む(省略は既定。書くなら 1 以上・天井以下の整数)。 */
function readMaxBodyBytes(item: YamlReader, id: string, reporter: SpecReporter): number | null {
  if (!item.has('max_body_bytes')) return DEFAULT_INBOUND_MAX_BODY_BYTES;
  const value = item.raw('max_body_bytes');
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_INBOUND_BODY_BYTES) return value;
  reporter.error(
    item.pointer('max_body_bytes'),
    `連携 ${id} の max_body_bytes ${String(value)} は 1 以上 ${MAX_INBOUND_BODY_BYTES} 以下の整数ではありません`,
    `max_body_bytes に受け取る本文の上限をバイトの整数で書く(省略すると ${DEFAULT_INBOUND_MAX_BODY_BYTES}。` +
      '受信口は本文を全部読んでから署名を検証するので、上限は相手が送る最大の本文に合わせて小さく保つ)',
    { integration: id, max_body_bytes: String(value) },
  );
  return null;
}

/** `signature` を体系側の値域として読む。 */
function readSignature(item: YamlReader, reporter: SpecReporter): InboundSignature | null {
  const suggestion = `signature に ${INBOUND_SIGNATURES.join(' / ')} のいずれかを書く(鍵そのものは config の領分)`;
  const value = item.requiredString('signature', suggestion);
  if (value === null) return null;
  const found = INBOUND_SIGNATURES.find((candidate) => candidate === value);
  if (found !== undefined) return found;
  reporter.error(item.pointer('signature'), `signature ${value} は値域(${INBOUND_SIGNATURES.join(' / ')})にありません`, suggestion, {
    signature: value,
  });
  return null;
}

/** `on_conflict` を体系側の値域として読む。 */
function readConflictReply(item: YamlReader, reporter: SpecReporter): InboundConflictReply | null {
  const suggestion =
    `on_conflict に ${INBOUND_CONFLICT_REPLIES.join(' / ')} のいずれかを書く` +
    '(retry = 5xx で再送させる / ack = 2xx で閉じる。相手の再送の契約で決まる)';
  const value = item.requiredString('on_conflict', suggestion);
  if (value === null) return null;
  const found = INBOUND_CONFLICT_REPLIES.find((candidate) => candidate === value);
  if (found !== undefined) return found;
  reporter.error(
    item.pointer('on_conflict'),
    `on_conflict ${value} は値域(${INBOUND_CONFLICT_REPLIES.join(' / ')})にありません`,
    suggestion,
    { on_conflict: value },
  );
  return null;
}

/**
 * 署名の鍵(`signature_key`)と、検証しない理由(`signature_reason`)の対応を読む。
 *
 * `none` はどちらも逆向きである —— 鍵は持たず、理由を必ず持つ。最も危険な宣言だけが理由なしで
 * 書ける状態にしない(`degrade_summary` / `unhandled` / `unscanned` と同じ流儀)。
 */
function readSignatureKey(
  item: YamlReader,
  id: string,
  signature: InboundSignature,
  reporter: SpecReporter,
): InboundSignatureDecl | 'invalid' {
  const key = item.optionalString('signature_key', 'signature_key に署名の鍵として使う config の id を書く');
  const reason = item.optionalString('signature_reason', 'signature_reason になぜ署名が要らないかを 1 行で書く');
  if (signature === 'none') {
    if (key !== undefined) {
      reporter.error(
        item.pointer('signature_key'),
        `連携 ${id} は signature: none なのに signature_key があります`,
        'signature_key を消す(検証しないと宣言した口は鍵を使わない)',
        { integration: id },
      );
      return 'invalid';
    }
    if (reason === undefined) {
      reporter.error(
        item.pointer('signature_reason'),
        `連携 ${id} は signature: none なのに signature_reason がありません`,
        'signature_reason に「なぜ署名を検証しなくてよいか」を 1 行で書く' +
          '(署名の無い口は誰でも叩ける。理由の無い免除をこの体系は持たない)',
        { integration: id },
      );
      return 'invalid';
    }
    return { signature, signatureReason: reason };
  }
  if (reason !== undefined) {
    reporter.error(
      item.pointer('signature_reason'),
      `連携 ${id} は signature: ${signature} なのに signature_reason があります`,
      'signature_reason を消す(検証する口に「検証しない理由」は要らない)',
      { integration: id, signature },
    );
    return 'invalid';
  }
  if (key === undefined) {
    reporter.error(
      item.pointer('signature_key'),
      `連携 ${id} は signature: ${signature} なのに signature_key がありません`,
      'signature_key に署名の鍵として使う config の id を書く(config の先頭が暗黙の鍵になる形にしない)',
      { integration: id, signature },
    );
    return 'invalid';
  }
  return { signature, signatureKey: key };
}
