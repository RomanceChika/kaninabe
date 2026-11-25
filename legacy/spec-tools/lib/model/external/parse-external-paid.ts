/**
 * external_spec の**有料の口の軸**(`spend` と `abuse`)の読み取り。
 *
 * 設計: 凍結案 r5-abuse-freeze.md §2-2。1 行分を組む parse-external-rows.ts が呼ぶ下位の部品。
 *
 * 読み込みが閉じるのは**形**だけである —— `spend` の値域・`abuse` の知らないキー・本文の上限の型と範囲・枠の `per` の字面と
 * `key` の値域・`source` と `max` のどちらか 1 つ。**揃っているか**(`endpoints` の全部に上限があるか・枠があるか・
 * `source` が実在するか)と、書いてよい行か(受信の行・口の無い行には書けない)は検査 R5-7 / R5-8 が見る(黙って補わない)。
 * これは**宣言の読み取り**であり、宣言した上限や枠が実装で効いているかは見ない。
 */

import { asRecord, type SpecReporter } from '../parse-common.js';
import { PERIOD } from '../parse-access-abuse.js';
import { YamlReader } from '../yaml-reader.js';
import { EXTERNAL_AUTHZ_KINDS, EXTERNAL_SPENDS, MAX_INBOUND_BODY_BYTES, QUOTA_KEYS } from './types.js';
import type { ExternalAbuseDecl, ExternalAuthzDecl, ExternalQuotaDecl, ExternalSpend } from './types.js';

/** `abuse` に書けるキー。 */
const ABUSE_KEYS: readonly string[] = ['max_body_bytes', 'quota'];

/** `abuse.quota` に書けるキー。 */
const QUOTA_DECL_KEYS: readonly string[] = ['source', 'max', 'per', 'key'];

/** `authz` に書けるキー。 */
const AUTHZ_KEYS: readonly string[] = ['kind', 'role'];

/** RPC の名前・役の ID の綴り(スネークケース)。 */
const SNAKE_NAME = /^[a-z][a-z0-9_]*$/u;

/** `abuse` の書き方(違反の直し方)。 */
export const PAID_ABUSE_SUGGESTION =
  'abuse は "max_body_bytes: { {口の URL}: {バイト数}, ... }"(endpoints の全部に必須)と ' +
  '"quota: { source: {config の id}, per: \\"1 day\\", key: actor }"(source の代わりに max: n も書ける)で書く';

/**
 * `spend` を読む(書かれていなければ undefined)。いまの値域は `paid` だけ。
 *
 * @param item 行のマッピング
 * @param id 連携 ID
 * @param reporter 違反の記録先
 * @returns 値、書かれていなければ undefined、読めなければ `'invalid'`
 */
export function parseSpend(item: YamlReader, id: string, reporter: SpecReporter): ExternalSpend | undefined | 'invalid' {
  if (!item.has('spend')) return undefined;
  const suggestion = `spend に ${EXTERNAL_SPENDS.join(' / ')} を書く(呼び出しごとにお金か枠を使う連携だけ。使わない連携には書かない)`;
  const value = item.requiredString('spend', suggestion);
  if (value === null) return 'invalid';
  const found = EXTERNAL_SPENDS.find((candidate) => candidate === value);
  if (found !== undefined) return found;
  reporter.error(item.pointer('spend'), `連携 ${id} の spend ${value} は値域(${EXTERNAL_SPENDS.join(' / ')})にありません`, suggestion, { integration: id, spend: value });
  return 'invalid';
}

/** 違反を記録して `'invalid'` を返す。 */
function reject(reporter: SpecReporter, pointer: string, message: string, suggestion: string, id: string): 'invalid' {
  reporter.error(pointer, message, suggestion, { integration: id });
  return 'invalid';
}

/** `max_body_bytes`(口ごとの本文の上限の写像)を読む。 */
function readBodyLimits(abuse: YamlReader, id: string, reporter: SpecReporter): Readonly<Record<string, number>> | 'invalid' {
  if (!abuse.has('max_body_bytes')) return {};
  const suggestion = 'max_body_bytes に "{口の URL}: {バイト数}" の写像を書く(口は endpoints と同じ URL。バイト数は 1 以上の整数)';
  const record = asRecord(abuse.raw('max_body_bytes'));
  if (record === null) return reject(reporter, abuse.pointer('max_body_bytes'), `連携 ${id} の abuse.max_body_bytes は写像で書きます`, suggestion, id);
  const limits: Record<string, number> = {};
  for (const [endpoint, value] of Object.entries(record)) {
    const valid = typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_INBOUND_BODY_BYTES;
    if (!valid) {
      return reject(
        reporter,
        `${abuse.pointer('max_body_bytes')}.${endpoint}`,
        `連携 ${id} の abuse.max_body_bytes の ${endpoint} の値 ${String(value)} は 1 以上 ${MAX_INBOUND_BODY_BYTES} 以下の整数ではありません`,
        suggestion,
        id,
      );
    }
    limits[endpoint] = value;
  }
  return limits;
}

/** `quota` の `source` / `max` を読む(どちらか 1 つ)。 */
function readQuotaSize(quota: YamlReader, id: string, reporter: SpecReporter): Pick<ExternalQuotaDecl, 'source' | 'max'> | 'invalid' {
  const suggestion = 'quota に source(上限の数を持つ config の id)か max(1 以上の整数)の、どちらか 1 つを書く';
  const source = quota.optionalString('source', suggestion);
  const max = quota.optionalNumber('max', suggestion);
  if ((source === undefined) === (max === undefined)) {
    return reject(reporter, quota.pointer('source'), `連携 ${id} の abuse.quota は source か max の、ちょうど 1 つが要ります`, suggestion, id);
  }
  if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
    return reject(reporter, quota.pointer('max'), `連携 ${id} の abuse.quota.max ${String(max)} は 1 以上の整数ではありません`, suggestion, id);
  }
  return max === undefined ? { source: source ?? '' } : { max };
}

/** `quota`(回数の枠)を読む(書かれていなければ undefined)。 */
function readQuota(abuse: YamlReader, id: string, reporter: SpecReporter): ExternalQuotaDecl | undefined | 'invalid' {
  if (!abuse.has('quota')) return undefined;
  const record = asRecord(abuse.raw('quota'));
  if (record === null) return reject(reporter, abuse.pointer('quota'), `連携 ${id} の abuse.quota は写像で書きます`, PAID_ABUSE_SUGGESTION, id);
  const quota = new YamlReader(record, abuse.pointer('quota'), reporter);
  quota.rejectUnknownKeys(QUOTA_DECL_KEYS, `連携 ${id} の abuse.quota`, `書けるのは ${QUOTA_DECL_KEYS.join(' / ')} だけ`);
  const size = readQuotaSize(quota, id, reporter);
  const per = quota.requiredString('per', 'quota.per に期間の幅を "{n} {minute|hour|day}" で書く(例: 1 day)');
  const key = quota.requiredString('key', `quota.key に ${QUOTA_KEYS.join(' / ')} を書く(actor = 実行者ごと / global = 全体)`);
  if (size === 'invalid' || per === null || key === null) return 'invalid';
  if (!PERIOD.test(per.trim())) {
    return reject(reporter, quota.pointer('per'), `連携 ${id} の abuse.quota.per "${per.slice(0, 40)}" は期間の幅の形ではありません`, 'quota.per は "{n} {minute|hour|day}" の形で書く(例: 1 day)', id);
  }
  const found = QUOTA_KEYS.find((candidate) => candidate === key);
  if (found === undefined) {
    return reject(reporter, quota.pointer('key'), `連携 ${id} の abuse.quota.key ${key} は値域(${QUOTA_KEYS.join(' / ')})にありません`, 'quota.key に actor か global を書く', id);
  }
  return { ...size, per: per.trim(), key: found };
}

/**
 * `abuse`(有料の口の濫用の歯止めの宣言)を読む(書かれていなければ undefined)。
 *
 * @param item 行のマッピング
 * @param id 連携 ID
 * @param reporter 違反の記録先
 * @returns 宣言、書かれていなければ undefined、読めなければ `'invalid'`
 */
export function parseExternalAbuse(item: YamlReader, id: string, reporter: SpecReporter): ExternalAbuseDecl | undefined | 'invalid' {
  if (!item.has('abuse')) return undefined;
  const record = asRecord(item.raw('abuse'));
  if (record === null) return reject(reporter, item.pointer('abuse'), `連携 ${id} の abuse は写像で書きます`, PAID_ABUSE_SUGGESTION, id);
  const abuse = new YamlReader(record, item.pointer('abuse'), reporter);
  abuse.rejectUnknownKeys(ABUSE_KEYS, `連携 ${id} の abuse`, `書けるのは ${ABUSE_KEYS.join(' / ')} だけ`);
  const maxBodyBytes = readBodyLimits(abuse, id, reporter);
  const quota = readQuota(abuse, id, reporter);
  if (maxBodyBytes === 'invalid' || quota === 'invalid') return 'invalid';
  return { maxBodyBytes, ...(quota === undefined ? {} : { quota }), location: reporter.location(`integrations.${id}.abuse`) };
}

/**
 * `meter`(枠を消費する RPC の名前)を読む(書かれていなければ undefined)。
 *
 * 形(スネークケースの名前)だけを見る。名前が `data_table` の `kind: rpc` の関数に実在するかは R5-7、本文が役の述語を持ち消費が原子的かは X8 が見る。
 *
 * @param item 行のマッピング
 * @param id 連携 ID
 * @param reporter 違反の記録先
 * @returns 名前、書かれていなければ undefined、読めなければ `'invalid'`
 */
export function parseMeter(item: YamlReader, id: string, reporter: SpecReporter): string | undefined | 'invalid' {
  if (!item.has('meter')) return undefined;
  const suggestion = 'meter に枠を消費する RPC の名前(data_table の kind: rpc の関数。スネークケース)を書く';
  const value = item.requiredString('meter', suggestion);
  if (value === null) return 'invalid';
  if (SNAKE_NAME.test(value)) return value;
  return reject(reporter, item.pointer('meter'), `連携 ${id} の meter "${value.slice(0, 40)}" は RPC の名前(スネークケース)ではありません`, suggestion, id);
}

/**
 * `authz`(有料の口の認可)を読む(書かれていなければ undefined)。
 *
 * 読み込みが閉じるのは**形**だけ —— `kind` の値域・`kind: role` なら `role` が要り `kind: public` なら書けない。役が役の台帳に実在し
 * 立てられるグローバルロールか・`public` を有料の口に書いてよいか(書けない)は R5-9 が見る。
 *
 * @param item 行のマッピング
 * @param id 連携 ID
 * @param reporter 違反の記録先
 * @returns 宣言、書かれていなければ undefined、読めなければ `'invalid'`
 */
export function parseAuthz(item: YamlReader, id: string, reporter: SpecReporter): ExternalAuthzDecl | undefined | 'invalid' {
  if (!item.has('authz')) return undefined;
  const suggestion = `authz は "{ kind: role, role: {役の ID} }" で書く(kind の値域は ${EXTERNAL_AUTHZ_KINDS.join(' / ')}。有料の口に public は書けない)`;
  const record = asRecord(item.raw('authz'));
  if (record === null) return reject(reporter, item.pointer('authz'), `連携 ${id} の authz は写像で書きます`, suggestion, id);
  const authz = new YamlReader(record, item.pointer('authz'), reporter);
  authz.rejectUnknownKeys(AUTHZ_KEYS, `連携 ${id} の authz`, `書けるのは ${AUTHZ_KEYS.join(' / ')} だけ`);
  const kind = authz.requiredString('kind', suggestion);
  if (kind === null) return 'invalid';
  const found = EXTERNAL_AUTHZ_KINDS.find((candidate) => candidate === kind);
  if (found === undefined) {
    return reject(reporter, authz.pointer('kind'), `連携 ${id} の authz.kind ${kind} は値域(${EXTERNAL_AUTHZ_KINDS.join(' / ')})にありません`, suggestion, id);
  }
  const location = reporter.location(`integrations.${id}.authz`);
  if (found === 'public') {
    if (!authz.has('role')) return { kind: found, location };
    return reject(reporter, authz.pointer('role'), `連携 ${id} の authz は kind: public に role を書けません`, suggestion, id);
  }
  const role = authz.requiredString('role', 'authz.kind: role には role に役の ID を書く');
  if (role === null) return 'invalid';
  if (!SNAKE_NAME.test(role)) {
    return reject(reporter, authz.pointer('role'), `連携 ${id} の authz.role "${role.slice(0, 40)}" は役の ID(スネークケース)ではありません`, suggestion, id);
  }
  return { kind: found, role, location };
}
