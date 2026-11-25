/**
 * external_spec の `integrations` 1 行分の読み取り。
 *
 * parse-external.ts が呼ぶ下位の部品で、責務は「1 行の妥当性」(値域・`service` の語彙
 * 閉世界・条件付き必須の対応)に閉じる(`vocabulary` の読み取りとトップレベルの組み立ては
 * parse-external.ts が持つ)。
 */

import type { SpecReporter } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type {
  ExternalDegrade,
  ExternalDirection,
  ExternalEffect,
  ExternalRetry,
  ExternalSendsDecl,
  ExternalServiceTermDecl,
  IntegrationDecl,
} from './types.js';
import { EXTERNAL_DEGRADES, EXTERNAL_DIRECTIONS, EXTERNAL_EFFECTS, EXTERNAL_RETRIES } from './types.js';
import { parseInboundAxes } from './parse-external-inbound.js';
import { parseNeutralize } from './parse-external-neutralize.js';
import { parseAuthz, parseExternalAbuse, parseMeter, parseSpend } from './parse-external-paid.js';
import { codeNameField } from '../sql-fields.js';
import { modulePathProblem, typeNameProblem } from '../code-names.js';
import {
  parseDegradeSummary,
  parseEndpoints,
  parseIdempotency,
  parseIdempotencyReason,
  parseIdempotencySource,
  parseRetryMax,
  parseTimeoutMs,
} from './parse-external-conditional.js';

/** integrations の 1 要素に書けるキー。 */
export const INTEGRATION_KEYS: readonly string[] = [
  'id',
  'service',
  'direction',
  'effect',
  'port',
  'adapter',
  'config',
  'degrade',
  'degrade_summary',
  'timeout_ms',
  'retry',
  'retry_max',
  'idempotency',
  'idempotency_source',
  'idempotency_reason',
  'signature',
  'signature_key',
  'signature_reason',
  'event_id_table',
  'emits',
  'migration',
  'on_conflict',
  'max_body_bytes',
  'endpoints',
  'spend',
  'abuse',
  'meter',
  'authz',
  'sends',
  'summary',
];

/** sends の要素に書けるキー。 */
const SENDS_KEYS: readonly string[] = ['fields', 'text', 'neutralize', 'neutralize_none'];

/**
 * 連携 1 行分を読む。1 つでも読めなければ行ごと落とす(null)。
 *
 * @param item 行のマッピング(`rejectUnknownKeys` は呼び出し側で済ませてある)
 * @param id 読み終えた連携 ID
 * @param services カタログが宣言した語彙(service)
 * @param reporter 違反の記録先
 */
export function buildIntegration(
  item: YamlReader,
  id: string,
  services: readonly ExternalServiceTermDecl[],
  reporter: SpecReporter,
): IntegrationDecl | null {
  const service = parseService(item, id, services, reporter);
  const direction = parseClosedString(item, 'direction', EXTERNAL_DIRECTIONS, reporter) as
    | ExternalDirection
    | null;
  const effect = parseClosedString(item, 'effect', EXTERNAL_EFFECTS, reporter) as ExternalEffect | null;
  // ポート名とアダプタのパスは生成される受信口の import に置かれるので、文法で閉じる(R17)。
  const port = codeNameField(item, reporter, 'port', item.requiredString('port', 'port に業務側の IF 名(型・インターフェース名)を書く'), typeNameProblem);
  const adapter = codeNameField(
    item,
    reporter,
    'adapter',
    item.requiredString('adapter', 'adapter にアダプタの実装ファイル(リポジトリルート相対)を書く'),
    modulePathProblem,
  );
  const config = item.requiredStringList(
    'config',
    'config に接地する config カタログの id を 1 つ以上書く(鍵が無いときの挙動の根拠になる)',
    false,
  );
  const degrade = parseClosedString(item, 'degrade', EXTERNAL_DEGRADES, reporter) as ExternalDegrade | null;
  const retry = parseClosedString(item, 'retry', EXTERNAL_RETRIES, reporter) as ExternalRetry | null;
  const summary = item.requiredString('summary', 'summary に何をする連携かを 1 行で書く');
  const sends = parseSends(item, id, direction, reporter);

  if (
    service === null ||
    direction === null ||
    effect === null ||
    port === null ||
    adapter === null ||
    config === null ||
    degrade === null ||
    retry === null ||
    summary === null ||
    sends === null
  ) {
    return null;
  }

  const degradeSummary = parseDegradeSummary(item, id, degrade, reporter);
  const timeoutMs = parseTimeoutMs(item, id, direction, reporter);
  const retryMax = parseRetryMax(item, id, retry, reporter);
  const idempotency = parseIdempotency(item, id, effect, reporter);
  const idempotencySource = parseIdempotencySource(item, id, effect, reporter);
  const idempotencyReason = parseIdempotencyReason(
    item,
    id,
    idempotencySource === 'invalid' ? undefined : idempotencySource,
    reporter,
  );
  const inbound = parseInboundAxes(item, id, direction, reporter);
  const endpoints = parseEndpoints(item, id, direction, reporter);
  const spend = parseSpend(item, id, reporter);
  const abuse = parseExternalAbuse(item, id, reporter);
  const meter = parseMeter(item, id, reporter);
  const authz = parseAuthz(item, id, reporter);
  if (
    degradeSummary === 'invalid' ||
    timeoutMs === 'invalid' ||
    retryMax === 'invalid' ||
    idempotency === 'invalid' ||
    idempotencySource === 'invalid' ||
    idempotencyReason === 'invalid' ||
    inbound === 'invalid' ||
    endpoints === 'invalid' ||
    spend === 'invalid' ||
    abuse === 'invalid' ||
    meter === 'invalid' ||
    authz === 'invalid'
  ) {
    return null;
  }

  const base = {
    id,
    service,
    effect,
    port,
    adapter,
    config,
    degrade,
    ...(degradeSummary === undefined ? {} : { degradeSummary }),
    retry,
    ...(retryMax === undefined ? {} : { retryMax }),
    ...(idempotency === undefined ? {} : { idempotency }),
    ...(idempotencySource === undefined ? {} : { idempotencySource }),
    ...(idempotencyReason === undefined ? {} : { idempotencyReason }),
    ...(spend === undefined ? {} : { spend }),
    ...(abuse === undefined ? {} : { abuse }),
    ...(meter === undefined ? {} : { meter }),
    ...(authz === undefined ? {} : { authz }),
    sends,
    summary,
    location: reporter.location(`integrations.${id}`),
  };
  // 受信の軸は受信の行だけが持ち(送信の行で書けば parseInboundAxes が落とす)、送信の軸は送信の行だけが持つ。
  if (direction === 'inbound') return inbound === null ? null : { ...base, direction, ...inbound };
  return {
    ...base,
    direction,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(endpoints === undefined ? {} : { endpoints }),
  };
}

/** `service` を宣言された vocabulary.service に閉じて読む。 */
function parseService(
  item: YamlReader,
  id: string,
  services: readonly ExternalServiceTermDecl[],
  reporter: SpecReporter,
): string | null {
  const suggestion = `service に vocabulary.service の語(${services.map((s) => s.id).join(' / ') || '未宣言'})を書く`;
  const value = item.requiredString('service', suggestion);
  if (value === null) return null;
  if (services.some((term) => term.id === value)) return value;
  reporter.error(item.pointer('service'), `連携 ${id} の service ${value} は vocabulary.service に宣言されていません`, suggestion, {
    integration: id,
    service: value,
  });
  return null;
}

/** 体系側の値域を読む共通処理。 */
function parseClosedString(
  item: YamlReader,
  key: string,
  allowed: readonly string[],
  reporter: SpecReporter,
): string | null {
  const suggestion = `${key} に ${allowed.join(' / ')} のいずれかを書く`;
  const value = item.requiredString(key, suggestion);
  if (value === null) return null;
  if (allowed.includes(value)) return value;
  reporter.error(item.pointer(key), `${key} ${value} は値域(${allowed.join(' / ')})にありません`, suggestion, {
    [key]: value,
  });
  return null;
}

/** sends(fields + text + neutralize)を読む。fields と text が両方欠落はエラー。 */
function parseSends(item: YamlReader, id: string, direction: ExternalDirection | null, reporter: SpecReporter): ExternalSendsDecl | null {
  const suggestion = 'sends に fields(entity.field の参照)か text(散文)の少なくとも一方を書く';
  const raw = item.raw('sends');
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    reporter.error(item.pointer('sends'), `連携 ${id} に sends がありません`, suggestion, { integration: id });
    return null;
  }
  const sendsReader = new YamlReader(raw as Readonly<Record<string, unknown>>, item.pointer('sends'), reporter);
  sendsReader.rejectUnknownKeys(SENDS_KEYS, `連携 ${id} の sends`, `書けるのは ${SENDS_KEYS.join(' / ')} だけ`);
  const fields = sendsReader.optionalStringList(
    'fields',
    'fields に entity.field(entity_spec に実在するフィールド)の参照を並べる',
  );
  const text = sendsReader.optionalString('text', 'text に散文で外へ出す情報を書く');
  if (fields.length === 0 && text === undefined) {
    reporter.error(item.pointer('sends'), `連携 ${id} の sends は fields も text も空です`, suggestion, {
      integration: id,
    });
    return null;
  }
  const neutralize = parseNeutralize(sendsReader, id, direction, reporter);
  if (neutralize === 'invalid') return null;
  return { fields, ...(text === undefined ? {} : { text }), ...(neutralize === undefined ? {} : { neutralize }) };
}
