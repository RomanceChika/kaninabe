/**
 * data_table の `functions[].send_limit`(送信の上限の宣言)のパーサー。
 *
 * 正: ARCH-SP-BE-0001 §送信の上限。`kind: send_limit` の関数だけが書け、そこでは必須である。
 * ここが見るのは**宣言の中だけで決まる形**である —— 鍵・欄の名前の形と重複、上限が名指す鍵の実在、語の形と重複、
 * 範囲の幅と本数(R5 の天井と同じ `windowProblems`)。宣言の外の事実への接地(種別がジョブカタログにある・止める表と列が
 * 実在する・署名が宣言から導いた形と一致する)は T26 が見る(パーサーはほかの仕様を読まない)。
 *
 * 読めない宣言は**関数ごと**モデルに載せない(半分の上限を生成すると、宣言より緩い上限が黙って立つ)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { asRecord, type SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { windowProblems } from '../abuse-clock.js';
import type { SendLimitBlocked, SendLimitDecl, SendLimitHop, SendLimitKey, SendLimitRule, SendLimitUnit } from './types.js';

/** `send_limit` に書けるキー。 */
const SEND_LIMIT_KEYS: readonly string[] = ['event', 'types', 'keys', 'payload', 'limits'];

/** `keys[]` の要素に書けるキー。 */
const KEY_KEYS: readonly string[] = ['name', 'blocked', 'unit'];

/** `unit` の辿る 1 歩に書けるキー。 */
const HOP_KEYS: readonly string[] = ['table', 'column', 'to'];

/** 単位の既定(鍵の値そのもの)を明示する語。 */
const UNIT_DEFAULT = 'actor';

/** `blocked` に書けるキー。 */
const BLOCKED_KEYS: readonly string[] = ['table', 'column', 'values', 'word'];

/** `limits[]` の要素に書けるキー。 */
const LIMIT_KEYS: readonly string[] = ['word', 'key', 'max', 'per'];

/** 名前(鍵・欄・語・表・列・種別。スネークケース)。 */
const SNAKE = /^[a-z][a-z0-9_]*$/;

/** 操作 ID(`{集約}.{操作}`)。 */
const EVENT = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** 書き方の案内。 */
const SUGGESTION =
  'send_limit は event / types / keys / payload / limits を持つマッピングで書く(ARCH-SP-BE-0001 §送信の上限。' +
  '例: keys: [{ name: actor_id }]・limits: [{ word: x_daily, key: actor_id, max: 10, per: 24 hours }])';

/** 読み取りの途中の失敗の記録(1 つでもあれば関数ごと載せない)。 */
interface Problems {
  count: number;
}

/**
 * 関数 1 本の `send_limit` を読む。
 *
 * @param reader その関数の要素
 * @param kind 関数の種別
 * @param name 関数名(反例用)
 * @param reporter 違反の記録先
 * @returns 読めた宣言(書けない場所・読めない宣言・無いときは undefined)
 */
export function parseSendLimit(reader: YamlReader, kind: string, name: string, reporter: SpecReporter): SendLimitDecl | undefined {
  if (kind !== 'send_limit') {
    if (reader.has('send_limit')) {
      reporter.error(
        reader.pointer('send_limit'),
        `${name} は kind: ${kind} なので send_limit を宣言できません`,
        'send_limit は送信の上限の関数(kind: send_limit)の宣言である。行を削除するか kind を直す',
        { function: name, kind },
      );
    }
    return undefined;
  }
  const record = asRecord(reader.raw('send_limit'));
  if (record === null) {
    reporter.error(reader.pointer('send_limit'), `${name} は kind: send_limit ですが send_limit の宣言がありません`, SUGGESTION, { function: name });
    reporter.dropRows();
    return undefined;
  }
  const inner = new YamlReader(record, reader.pointer('send_limit'), reporter);
  inner.rejectUnknownKeys(SEND_LIMIT_KEYS, 'send_limit', `書けるのは ${SEND_LIMIT_KEYS.join(' / ')} だけ`);
  // 知らないキー(綴り違いの宣言)も関数ごと載せない(書いたつもりの上限が効かないまま、残りで生成しない)。
  const problems: Problems = { count: unknownKeys(record, SEND_LIMIT_KEYS) };
  const fail = (pointer: string, message: string, counterexample: Readonly<Record<string, string>> = {}): void => {
    reporter.error(pointer, message, SUGGESTION, { function: name, ...counterexample });
    problems.count += 1;
  };
  const event = inner.requiredString('event', 'event に拒否の本文に載せる操作 ID を書く(例: event: {集約}.update)');
  if (event !== null && !EVENT.test(event)) fail(inner.pointer('event'), `${name} の event "${event}" は {集約}.{操作} の形ではありません`);
  const types = namesOf(inner, 'types', fail, true);
  const keys = keysOf(inner, reporter, fail);
  const payload = namesOf(inner, 'payload', fail, false);
  for (const field of payload.filter((item) => keys.some((key) => key.name === item))) {
    fail(inner.pointer('payload'), `${name} の payload の欄 ${field} が keys と重なっています(鍵は payload に必ず載ります)`);
  }
  const limits = limitsOf(inner, reporter, keys, fail);
  const words = [...keys.flatMap((key) => (key.blocked === undefined ? [] : [key.blocked.word])), ...limits.map((limit) => limit.word)];
  const repeated = words.find((word, index) => words.indexOf(word) !== index);
  if (repeated !== undefined) fail(inner.pointer('limits'), `${name} の拒否の語 ${repeated} が重複しています(語はどの制限かを 1 つに名指す)`);
  if (event === null || problems.count > 0) {
    reporter.dropRows();
    return undefined;
  }
  return { event, types, keys, payload, limits };
}

/** マッピングの知らないキーの数(報告は `rejectUnknownKeys` が済ませている)。 */
function unknownKeys(record: Readonly<Record<string, unknown>>, allowed: readonly string[]): number {
  return Object.keys(record).filter((key) => !allowed.includes(key)).length;
}

/** 名前の並び(空でない・形・重複なし)。`required` なら欠落も失敗。 */
function namesOf(
  reader: YamlReader,
  key: string,
  fail: (pointer: string, message: string) => void,
  required: boolean,
): readonly string[] {
  if (!reader.has(key)) {
    if (required) fail(reader.pointer(key), `send_limit の ${key} がありません`);
    return [];
  }
  const values = reader.optionalStringList(key, SUGGESTION);
  if (!Array.isArray(reader.raw(key)) || (values.length === 0 && required)) {
    fail(reader.pointer(key), `send_limit の ${key} は 1 つ以上の名前の並びで書きます`);
    return [];
  }
  const bad = values.find((value) => !SNAKE.test(value));
  if (bad !== undefined) fail(reader.pointer(key), `send_limit の ${key} の ${bad} がスネークケースではありません`);
  const repeated = values.find((value, index) => values.indexOf(value) !== index);
  if (repeated !== undefined) fail(reader.pointer(key), `send_limit の ${key} に ${repeated} が重複しています`);
  return values;
}

/** `keys[]` を読む(1 つ以上・名前の形と重複・`blocked`)。 */
function keysOf(reader: YamlReader, reporter: SpecReporter, fail: (pointer: string, message: string) => void): readonly SendLimitKey[] {
  const items = reader.optionalList('keys', SUGGESTION);
  if (items.length === 0) {
    fail(reader.pointer('keys'), 'send_limit の keys は 1 つ以上の鍵の並びで書きます(数える単位が無い上限は何も数えません)');
    return [];
  }
  const keys: SendLimitKey[] = [];
  eachRecord(items, reader.pointer('keys'), reporter, 'keys の要素は { name, blocked? } で書く', (item, index) => {
    item.rejectUnknownKeys(KEY_KEYS, 'keys の要素', `書けるのは ${KEY_KEYS.join(' / ')} だけ`);
    if (unknownKeys(asRecord(items[index]) ?? {}, KEY_KEYS) > 0) return;
    const name = item.requiredString('name', 'name に payload の鍵を書く(例: name: actor_id)');
    if (name === null || !SNAKE.test(name)) {
      fail(item.pointer('name'), `鍵の名前 ${String(name)} がスネークケースではありません`);
      return;
    }
    if (keys.some((key) => key.name === name)) {
      fail(item.pointer('name'), `鍵 ${name} が重複しています`);
      return;
    }
    const blocked = item.has('blocked') ? blockedOf(item, reporter, fail) : undefined;
    if (blocked === null) return;
    const unit = unitOf(item.raw('unit'), item.pointer('unit'), fail);
    if (unit === null) return;
    keys.push({ name, ...(blocked === undefined ? {} : { blocked }), ...(unit === undefined ? {} : { unit }) });
  });
  if (keys.length !== items.length) fail(reader.pointer('keys'), 'send_limit の keys に読めない要素があります');
  return keys;
}

/** `blocked` を読む(読めなければ null)。 */
function blockedOf(reader: YamlReader, reporter: SpecReporter, fail: (pointer: string, message: string) => void): SendLimitBlocked | null {
  const record = asRecord(reader.raw('blocked'));
  if (record === null) {
    fail(reader.pointer('blocked'), 'blocked は { table, column, values, word } のマッピングで書きます');
    return null;
  }
  const blocked = new YamlReader(record, reader.pointer('blocked'), reporter);
  const unknown = Object.keys(record).filter((key) => !BLOCKED_KEYS.includes(key));
  if (unknown.length > 0) fail(reader.pointer('blocked'), `blocked に書けないキー ${unknown.join(', ')} があります(書けるのは ${BLOCKED_KEYS.join(' / ')})`);
  const table = blocked.optionalString('table', SUGGESTION);
  const column = blocked.optionalString('column', SUGGESTION);
  const word = blocked.optionalString('word', SUGGESTION);
  const values: readonly unknown[] | null = Array.isArray(record['values']) ? (record['values'] as readonly unknown[]) : null;
  const names = [table, column, word];
  if (names.some((value) => value === undefined || !SNAKE.test(value))) {
    fail(reader.pointer('blocked'), 'blocked の table / column / word はスネークケースの名前で、どれも必須です');
    return null;
  }
  if (values === null || values.length === 0 || values.some((value) => typeof value !== 'string' || !SNAKE.test(value))) {
    fail(reader.pointer('blocked'), 'blocked の values は 1 つ以上の値(スネークケース)の並びで書きます');
    return null;
  }
  if (unknown.length > 0) return null;
  return { table: table ?? '', column: column ?? '', values: values.map(String), word: word ?? '' };
}

/**
 * `unit` を読む(省略と `actor` は既定 = undefined。`{ via: [{ table, column, to }, …] }` は辿り方。読めなければ null)。
 *
 * @param raw 生の値
 * @param pointer 位置
 * @param fail 失敗の記録
 * @returns 辿り方(既定なら undefined)
 */
function unitOf(raw: unknown, pointer: string, fail: (pointer: string, message: string) => void): SendLimitUnit | undefined | null {
  if (raw === undefined || raw === null || raw === UNIT_DEFAULT) return undefined;
  const record = asRecord(raw);
  const via = record === null ? null : record['via'];
  if (record === null || Object.keys(record).some((key) => key !== 'via') || !Array.isArray(via) || via.length === 0) {
    fail(pointer, `unit は ${UNIT_DEFAULT}(既定 = 鍵の値ごと)か { via: [{ table, column, to }, …] }(参照の列を辿った先ごと)で書きます`);
    return null;
  }
  const hops: SendLimitHop[] = [];
  for (const hop of via as readonly unknown[]) {
    const entry = asRecord(hop);
    const values = entry === null ? [] : HOP_KEYS.map((key) => entry[key]);
    if (entry === null || Object.keys(entry).some((key) => !HOP_KEYS.includes(key)) || values.some((value) => typeof value !== 'string' || !SNAKE.test(value))) {
      fail(pointer, 'unit.via の 1 歩は { table, column, to } のスネークケースの名前で書きます(知らないキーは書けません)');
      return null;
    }
    hops.push({ table: String(values[0]), column: String(values[1]), to: String(values[2]) });
  }
  return { via: hops };
}

/** `limits[]` を読む(1 つ以上・鍵の実在・語の形・本数と幅)。 */
function limitsOf(
  reader: YamlReader,
  reporter: SpecReporter,
  keys: readonly SendLimitKey[],
  fail: (pointer: string, message: string) => void,
): readonly SendLimitRule[] {
  const items = reader.optionalList('limits', SUGGESTION);
  if (items.length === 0) {
    fail(reader.pointer('limits'), 'send_limit の limits は 1 つ以上の上限の並びで書きます');
    return [];
  }
  const limits: SendLimitRule[] = [];
  eachRecord(items, reader.pointer('limits'), reporter, 'limits の要素は { word, key, max, per } で書く', (item, index) => {
    item.rejectUnknownKeys(LIMIT_KEYS, 'limits の要素', `書けるのは ${LIMIT_KEYS.join(' / ')} だけ`);
    if (unknownKeys(asRecord(items[index]) ?? {}, LIMIT_KEYS) > 0) return;
    const word = item.requiredString('word', 'word に拒否の語を書く(UC412 の detail)');
    const key = item.requiredString('key', 'key に数える単位(keys の名前)を書く');
    const max = item.optionalNumber('max', 'max に範囲の中に積める本数の上限を書く(1 以上の整数)');
    const per = item.requiredString('per', 'per に範囲の幅を書く(例: per: 24 hours)');
    if (word === null || key === null || max === undefined || per === null) {
      fail(item.pointer('word'), 'limits の要素の word / key / max / per はどれも必須です');
      return;
    }
    if (!SNAKE.test(word)) fail(item.pointer('word'), `拒否の語 ${word} がスネークケースではありません`);
    if (!keys.some((candidate) => candidate.name === key)) fail(item.pointer('key'), `上限 ${word} の key ${key} が keys にありません`);
    for (const problem of windowProblems(`limits.${word}`, { max, per })) fail(item.pointer('per'), problem);
    limits.push({ word, key, max, per });
  });
  if (limits.length !== items.length) fail(reader.pointer('limits'), 'send_limit の limits に読めない要素があります');
  return limits;
}
