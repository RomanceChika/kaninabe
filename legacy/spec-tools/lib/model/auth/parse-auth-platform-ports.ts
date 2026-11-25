/**
 * auth_spec の `platform_ports`(配線先のポートの宣言)・`shapes`(返す欄と配線先の行との対応表)・`secret_field_words` の読み取り。
 *
 * parse-auth-platform-ops.ts が呼ぶ下位の部品。ここが見るのは形だけで、対応の過不足・型の一致・秘密語の不在は H9 が見る。
 *
 * ```yaml
 * platform_ports:
 *   SessionManagement:                        # 配線先のポートの型名
 *     result: { type: SessionManagementResult, ok: ok, value: value, reason: reason }   # 結果の union の判別の欄
 *     refusals:                               # 失敗の理由 → 画面に出す文言(閉じた集合)
 *       unauthenticated: ログインしてください
 *     rows:                                   # 配線先が返す行の型(型・null の有無・省略)
 *       SessionSummary: { id: string, lastActiveAt: 'string?', current: boolean }
 * shapes:
 *   session_summary:
 *     row: SessionSummary                     # 対応表: 宣言した欄 → 行のプロパティ(欄ごとにちょうど 1 つ)
 *     fields: { id: id, last_used_at: lastActiveAt, is_current: current }
 * ```
 */

import type { SpecReporter } from '../parse-common.js';
import { asRecord } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { PlatformFieldFormat, PlatformFieldMapping, PlatformPortDecl, PlatformRefusalDecl, PlatformRowDecl, PlatformRowProp, PlatformShape, PlatformValueType } from './platform-ops.js';
import { PLATFORM_FIELD_FORMATS, PLATFORM_VALUE_TYPES } from './platform-ops.js';

const SNAKE = /^[a-z][a-z0-9_]*$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PORTS_SUGGESTION =
  'platform_ports は "{ポートの型名}: { result: { type, ok, value, reason }, refusals: { 理由: 文言 }, rows: { 行の型名: { プロパティ: 型 } } }" のマッピングで書く(配線先の ABI の宣言。型は string / boolean / number、null がありうるなら "string?" と書く)';
const SHAPES_SUGGESTION =
  'shapes は "{名前}: { row: 行の型名, fields: { 欄: 行のプロパティ }, labels?: { 欄: 見出し }, formats?: { 欄: datetime } }"(対応表。推奨)か "{名前}: { fields: [欄名, …] }"(対応表なし。H9 が拒む)のマッピングで書く';

/**
 * `platform_ports` を読む(任意)。
 *
 * @param root 認証フロー仕様のルート
 * @param reporter 違反の記録先
 * @returns ポートの宣言(書かれていなければ空)
 */
export function parsePorts(root: YamlReader, reporter: SpecReporter): readonly PlatformPortDecl[] {
  if (!root.has('platform_ports')) return [];
  const record = asRecord(root.raw('platform_ports'));
  if (record === null) {
    reporter.error(root.pointer('platform_ports'), 'platform_ports はマッピングで書きます', PORTS_SUGGESTION);
    reporter.dropRows();
    return [];
  }
  const ports: PlatformPortDecl[] = [];
  for (const [name, raw] of Object.entries(record)) {
    const port = readPort(name, raw, `platform_ports.${name}`, reporter);
    if (port !== null) ports.push(port);
  }
  return ports;
}

/** ポート 1 つ。 */
function readPort(name: string, raw: unknown, at: string, reporter: SpecReporter): PlatformPortDecl | null {
  const body = asRecord(raw);
  if (body === null || !IDENT.test(name)) {
    reporter.error(at, body === null ? `${at} はマッピングで書きます` : `ポート名 ${name} が識別子ではありません`, PORTS_SUGGESTION, { port: name });
    reporter.dropRows();
    return null;
  }
  const reader = new YamlReader(body, at, reporter);
  reader.rejectUnknownKeys(['result', 'refusals', 'rows'], at, PORTS_SUGGESTION);
  const union = readUnion(reader, reporter);
  const refusals = readRefusals(reader, reporter);
  const rows = readRows(reader, reporter);
  if (union === null || refusals === null || rows === null) return null;
  return { name, union, refusals, rows, location: reporter.location(at) };
}

/** `result`(結果の union の判別の欄)。 */
function readUnion(reader: YamlReader, reporter: SpecReporter): PlatformPortDecl['union'] | null {
  const record = asRecord(reader.raw('result'));
  if (record === null) {
    reporter.error(reader.pointer('result'), reader.has('result') ? 'result はマッピングで書きます' : 'result がありません', PORTS_SUGGESTION);
    reporter.dropRows();
    return null;
  }
  const body = new YamlReader(record, reader.pointer('result'), reporter);
  body.rejectUnknownKeys(['type', 'ok', 'value', 'reason'], 'result', PORTS_SUGGESTION);
  const type = body.requiredString('type', PORTS_SUGGESTION);
  const ok = body.requiredString('ok', PORTS_SUGGESTION);
  const value = body.requiredString('value', PORTS_SUGGESTION);
  const reason = body.requiredString('reason', PORTS_SUGGESTION);
  if (type === null || ok === null || value === null || reason === null) return null;
  const bad = [type, ok, value, reason].filter((word) => !IDENT.test(word));
  if (bad.length > 0) {
    reporter.error(body.pointer('type'), `result に識別子でない語 ${bad.join(', ')} があります`, PORTS_SUGGESTION);
    return null;
  }
  return { type, ok, value, reason };
}

/** `refusals`(理由 → 文言。空にできない)。 */
function readRefusals(reader: YamlReader, reporter: SpecReporter): readonly PlatformRefusalDecl[] | null {
  const record = asRecord(reader.raw('refusals'));
  if (record === null || Object.keys(record).length === 0) {
    reporter.error(reader.pointer('refusals'), reader.has('refusals') ? 'refusals は理由 → 文言のマッピングで、空にできません' : 'refusals がありません', PORTS_SUGGESTION);
    reporter.dropRows();
    return null;
  }
  const refusals: PlatformRefusalDecl[] = [];
  for (const [reason, message] of Object.entries(record)) {
    if (!SNAKE.test(reason) || typeof message !== 'string' || message.trim() === '') {
      reporter.error(`${reader.pointer('refusals')}.${reason}`, `refusals の ${reason} は、スネークケースの理由に空でない文言を書きます`, PORTS_SUGGESTION, { reason });
      reporter.dropRows();
      return null;
    }
    refusals.push({ reason, message });
  }
  return refusals;
}

/** 行の型の型指定(`string` / `string?` / `boolean` / `number`)。 */
function readPropType(raw: unknown): { readonly type: PlatformValueType; readonly nullable: boolean } | null {
  if (typeof raw !== 'string') return null;
  const nullable = raw.endsWith('?');
  const type = nullable ? raw.slice(0, -1) : raw;
  return (PLATFORM_VALUE_TYPES as readonly string[]).includes(type) ? { type: type as PlatformValueType, nullable } : null;
}

/** `rows`(行の型名 → { プロパティ: 型 })。 */
function readRows(reader: YamlReader, reporter: SpecReporter): readonly PlatformRowDecl[] | null {
  if (!reader.has('rows')) return [];
  const record = asRecord(reader.raw('rows'));
  if (record === null) {
    reporter.error(reader.pointer('rows'), 'rows はマッピングで書きます', PORTS_SUGGESTION);
    reporter.dropRows();
    return null;
  }
  const rows: PlatformRowDecl[] = [];
  for (const [name, raw] of Object.entries(record)) {
    const at = `${reader.pointer('rows')}.${name}`;
    const props = asRecord(raw);
    if (props === null || !IDENT.test(name) || Object.keys(props).length === 0) {
      reporter.error(at, `行の型 ${name} は、識別子の名前に、プロパティ → 型のマッピングを書きます`, PORTS_SUGGESTION, { row: name });
      reporter.dropRows();
      return null;
    }
    const list: PlatformRowProp[] = [];
    for (const [prop, typeRaw] of Object.entries(props)) {
      const type = readPropType(typeRaw);
      if (type === null || !IDENT.test(prop)) {
        reporter.error(`${at}.${prop}`, `行の型 ${name} のプロパティ ${prop} の型が書けない語です`, `型は ${PLATFORM_VALUE_TYPES.join(' / ')}(null がありうるなら末尾に ? を付ける)`, { row: name, prop });
        reporter.dropRows();
        return null;
      }
      list.push({ name: prop, ...type });
    }
    rows.push({ name, props: list });
  }
  return rows;
}

/**
 * `shapes`(任意)を読む。`fields` はマッピング(欄 → 行のプロパティ。`row` が要る)かリスト(対応表なし)。
 *
 * @param root 認証フロー仕様のルート
 * @param reporter 違反の記録先
 * @returns 返す欄の集合
 */
export function parseShapes(root: YamlReader, reporter: SpecReporter): readonly PlatformShape[] {
  if (!root.has('shapes')) return [];
  const record = asRecord(root.raw('shapes'));
  if (record === null) {
    reporter.error(root.pointer('shapes'), 'shapes はマッピングで書きます', SHAPES_SUGGESTION);
    reporter.dropRows();
    return [];
  }
  const shapes: PlatformShape[] = [];
  for (const [name, raw] of Object.entries(record)) {
    const shape = readShape(name, raw, `shapes.${name}`, reporter);
    if (shape !== null) shapes.push(shape);
  }
  return shapes;
}

/** shape 1 つ。 */
function readShape(name: string, raw: unknown, at: string, reporter: SpecReporter): PlatformShape | null {
  const body = asRecord(raw);
  if (body === null || !SNAKE.test(name)) {
    reporter.error(at, body === null ? `${at} はマッピングで書きます` : `shapes の名前 ${name} がスネークケースではありません`, SHAPES_SUGGESTION, { shape: name });
    reporter.dropRows();
    return null;
  }
  const reader = new YamlReader(body, at, reporter);
  reader.rejectUnknownKeys(['row', 'fields', 'labels', 'formats'], at, SHAPES_SUGGESTION);
  const location = reporter.location(at);
  const mapping = asRecord(reader.raw('fields'));
  if (mapping === null) {
    const fields = reader.requiredStringList('fields', SHAPES_SUGGESTION, false);
    if (fields === null) {
      reporter.dropRows();
      return null;
    }
    const row = reader.optionalString('row', SHAPES_SUGGESTION);
    return { name, fields, ...(row === undefined ? {} : { row }), location };
  }
  const row = reader.requiredString('row', '対応表(fields をマッピングで書く形)には row(配線先の行の型名)が要る');
  const entries: PlatformFieldMapping[] = [];
  for (const [field, from] of Object.entries(mapping)) {
    if (typeof from !== 'string' || !IDENT.test(from)) {
      reporter.error(`${at}.fields.${field}`, `欄 ${field} の対応先は、配線先の行のプロパティ名(識別子)で書きます`, SHAPES_SUGGESTION, { shape: name, field });
      reporter.dropRows();
      return null;
    }
    entries.push({ field, from });
  }
  if (row === null || entries.length === 0) {
    if (entries.length === 0) reporter.error(reader.pointer('fields'), 'fields が空です', SHAPES_SUGGESTION);
    return null;
  }
  const labels = readFieldWords(reader, 'labels', reporter);
  const formats = readFieldWords(reader, 'formats', reporter);
  if (labels === null || formats === null) return null;
  const formatEntries: { readonly field: string; readonly format: PlatformFieldFormat }[] = [];
  for (const entry of formats) {
    if (!(PLATFORM_FIELD_FORMATS as readonly string[]).includes(entry.word)) {
      reporter.error(`${at}.formats.${entry.field}`, `欄 ${entry.field} の整形 ${entry.word} は書けません`, `formats に書けるのは ${PLATFORM_FIELD_FORMATS.join(' / ')} だけ`, { shape: name, field: entry.field });
      return null;
    }
    formatEntries.push({ field: entry.field, format: entry.word as PlatformFieldFormat });
  }
  return {
    name,
    fields: entries.map((entry) => entry.field),
    row,
    mapping: entries,
    ...(labels.length === 0 ? {} : { labels: labels.map((entry) => ({ field: entry.field, label: entry.word })) }),
    ...(formatEntries.length === 0 ? {} : { formats: formatEntries }),
    location,
  };
}

/** 欄 → 語のマッピング(`labels` / `formats`。任意)。空の語は書けない。 */
function readFieldWords(reader: YamlReader, key: 'labels' | 'formats', reporter: SpecReporter): readonly { readonly field: string; readonly word: string }[] | null {
  if (!reader.has(key)) return [];
  const record = asRecord(reader.raw(key));
  if (record === null) {
    reporter.error(reader.pointer(key), `${key} はマッピングで書きます`, SHAPES_SUGGESTION);
    reporter.dropRows();
    return null;
  }
  const words: { readonly field: string; readonly word: string }[] = [];
  for (const [field, word] of Object.entries(record)) {
    if (typeof word !== 'string' || word.trim() === '') {
      reporter.error(`${reader.pointer(key)}.${field}`, `${key} の ${field} は空でない文字列で書きます`, SHAPES_SUGGESTION, { field });
      reporter.dropRows();
      return null;
    }
    words.push({ field, word });
  }
  return words;
}

/**
 * `secret_field_words`(shapes を書くなら必須の、返せない欄名の語)を読む。
 *
 * @param root 認証フロー仕様のルート
 * @param hasShapes shapes を書いているか
 * @param reporter 違反の記録先
 * @returns 語(小文字)
 */
export function parseSecretWords(root: YamlReader, hasShapes: boolean, reporter: SpecReporter): readonly string[] {
  const suggestion = 'secret_field_words に、欄名に含んではいけない語(小文字)を並べる(例: トークン・秘密を指す語。体系は語彙を持たないので製品が宣言する)';
  if (!root.has('secret_field_words')) {
    if (hasShapes) {
      reporter.error(root.pointer('secret_field_words'), 'shapes を宣言したのに secret_field_words がありません', suggestion);
      reporter.dropRows();
    }
    return [];
  }
  const words = root.requiredStringList('secret_field_words', suggestion, false) ?? [];
  const bad = words.filter((word) => word !== word.toLowerCase() || word.trim() === '');
  for (const word of bad) {
    reporter.error(root.pointer('secret_field_words'), `secret_field_words の ${JSON.stringify(word)} は小文字の空でない語で書きます`, suggestion, { word });
  }
  return words.filter((word) => !bad.includes(word));
}
