/**
 * auth_spec の `platform_ops[].binding`(配線先と、宣言した引数・戻り値との明示の対応表)の読み取り。
 *
 * parse-auth-platform-ops.ts が呼ぶ下位の部品。ここが見るのは**形**だけ —— 書けるキー・`params` の 2 形(スカラー 1 つ / プロパティごとに引数へ対応する
 * オブジェクト)・`result` の 2 形(スカラーの型 / 行の配列)・識別子であること。
 * 宣言した引数との過不足(未対応・余剰・重複)・型の一致・配線先の実在は H9 が見る(`params` / `result` の省略はここでは許し、H9 が拒む —— 「無い」ことを
 * 1 か所の検査が言う形に保つため)。
 *
 * 書き方の例:
 *
 * ```yaml
 * binding:
 *   port: SessionManagement
 *   method: endEverySession
 *   params:                              # 配線先のメソッドの引数(位置の順)
 *     - { name: options, optional: true, props: { keepSelf: { arg: keep_self, type: boolean, optional: true } } }
 *   result: number                       # 結果の union の value の型(read は { rows: 行の型名 })
 * ```
 */

import type { SpecReporter } from '../parse-common.js';
import { asRecord } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { PlatformBindingParam, PlatformBindingValue, PlatformOpBinding, PlatformParamArg, PlatformValueType } from './platform-ops.js';
import { PLATFORM_VALUE_TYPES } from './platform-ops.js';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SNAKE = /^[a-z][a-z0-9_]*$/;

const BINDING_SUGGESTION = 'binding は { port: ポートの型名, method: メソッド名, params: [引数の対応…], result: 戻り値の型 } で書く(例: { port: SessionManagement, method: endMySession, params: [{ name: sessionId, arg: session_id, type: string }], result: boolean })';
const PARAMS_SUGGESTION = 'params は "- { name: 配線先の引数名, arg: 宣言した引数, type: string|boolean|number, optional? }" か "- { name: 引数名, optional?, props: { プロパティ: { arg, type, optional? } } }" のリストで書く(配線先のメソッドの引数の位置の順)';
const RESULT_SUGGESTION = 'result は string / boolean / number(結果の union の value の型)か { rows: 行の型名 }(行の配列。行の型は platform_ports の rows)で書く';

/**
 * `binding` を読む。
 *
 * @param item 操作 1 件の読み手
 * @param reporter 違反の記録先
 * @returns 読めた配線先。形が壊れていれば null
 */
export function readBinding(item: YamlReader, reporter: SpecReporter): PlatformOpBinding | null {
  const record = asRecord(item.raw('binding'));
  if (record === null) {
    reporter.error(item.pointer('binding'), item.has('binding') ? 'binding はマッピングで書きます' : 'binding がありません', BINDING_SUGGESTION);
    reporter.dropRows();
    return null;
  }
  const reader = new YamlReader(record, item.pointer('binding'), reporter);
  reader.rejectUnknownKeys(['port', 'method', 'params', 'result'], 'binding', BINDING_SUGGESTION);
  const port = reader.requiredString('port', BINDING_SUGGESTION);
  const method = reader.requiredString('method', BINDING_SUGGESTION);
  if (port === null || method === null) return null;
  for (const [key, value] of [['port', port], ['method', method]] as const) {
    if (IDENT.test(value)) continue;
    reporter.error(reader.pointer(key), `binding.${key} ${value} が識別子ではありません`, `${key} は英数字と _ だけの識別子で書く`, { [key]: value });
    return null;
  }
  const params = readParams(reader, reporter);
  if (params === null) return null;
  const result = readResult(reader, reporter);
  if (result === null) return null;
  return { port, method, params, ...(result === undefined ? {} : { result }) };
}

/** `params`(任意。無ければ空)。 */
function readParams(reader: YamlReader, reporter: SpecReporter): readonly PlatformBindingParam[] | null {
  if (!reader.has('params')) return [];
  const list = reader.requiredList('params', PARAMS_SUGGESTION);
  if (list === null) return null;
  const params: PlatformBindingParam[] = [];
  for (const [index, raw] of list.entries()) {
    const at = `${reader.pointer('params')}[${index}]`;
    const record = asRecord(raw);
    if (record === null) {
      reporter.error(at, `${at} はマッピングで書きます`, PARAMS_SUGGESTION);
      reporter.dropRows();
      return null;
    }
    const param = readParam(new YamlReader(record, at, reporter), at, reporter);
    if (param === null) return null;
    params.push(param);
  }
  return params;
}

/** 値の型(`string` / `boolean` / `number`)を読む。 */
function readValueType(reader: YamlReader, key: string, reporter: SpecReporter): PlatformValueType | null {
  const value = reader.requiredString(key, PARAMS_SUGGESTION);
  if (value === null) return null;
  if (!(PLATFORM_VALUE_TYPES as readonly string[]).includes(value)) {
    reporter.error(reader.pointer(key), `${key} ${value} は書ける型ではありません`, `${key} は ${PLATFORM_VALUE_TYPES.join(' / ')} のどれか(配線先の TypeScript の型)`, { [key]: value });
    return null;
  }
  return value as PlatformValueType;
}

/** 任意の `optional: true|false`(無ければ false)。 */
function readOptional(reader: YamlReader): boolean | null {
  return reader.has('optional') ? reader.requiredBoolean('optional', 'optional は true / false で書く') : false;
}

/** `{ arg, type, optional? }`(スカラーの引数か、オブジェクトの 1 プロパティ)。 */
function readParamArg(reader: YamlReader, reporter: SpecReporter): PlatformParamArg | null {
  const arg = reader.requiredString('arg', PARAMS_SUGGESTION);
  const type = readValueType(reader, 'type', reporter);
  const optional = readOptional(reader);
  if (arg === null || type === null || optional === null) return null;
  if (!SNAKE.test(arg)) {
    reporter.error(reader.pointer('arg'), `arg ${arg} がスネークケースではありません`, 'arg には宣言した引数(args のキー)の名前を書く', { arg });
    return null;
  }
  return { arg, type, optional };
}

/** 引数 1 つ(スカラー / オブジェクト)。 */
function readParam(reader: YamlReader, at: string, reporter: SpecReporter): PlatformBindingParam | null {
  const location = reporter.location(at);
  if (reader.has('props')) {
    reader.rejectUnknownKeys(['name', 'optional', 'props'], `params の要素 ${at}`, PARAMS_SUGGESTION);
    const name = reader.requiredString('name', PARAMS_SUGGESTION);
    const optional = readOptional(reader);
    const props = asRecord(reader.raw('props'));
    if (name === null || optional === null) return null;
    if (props === null || !IDENT.test(name)) {
      reporter.error(reader.pointer('props'), props === null ? 'props はマッピングで書きます' : `引数名 ${name} が識別子ではありません`, PARAMS_SUGGESTION);
      reporter.dropRows();
      return null;
    }
    const list: (PlatformParamArg & { readonly prop: string })[] = [];
    for (const [prop, raw] of Object.entries(props)) {
      const body = asRecord(raw);
      const propAt = `${at}.props.${prop}`;
      if (body === null || !IDENT.test(prop)) {
        reporter.error(propAt, body === null ? `${propAt} はマッピングで書きます` : `プロパティ名 ${prop} が識別子ではありません`, PARAMS_SUGGESTION);
        reporter.dropRows();
        return null;
      }
      const propReader = new YamlReader(body, propAt, reporter);
      propReader.rejectUnknownKeys(['arg', 'type', 'optional'], `props.${prop}`, PARAMS_SUGGESTION);
      const arg = readParamArg(propReader, reporter);
      if (arg === null) return null;
      list.push({ prop, ...arg });
    }
    return { kind: 'object', name, optional, props: list, location };
  }
  reader.rejectUnknownKeys(['name', 'arg', 'type', 'optional'], `params の要素 ${at}`, PARAMS_SUGGESTION);
  const name = reader.requiredString('name', PARAMS_SUGGESTION);
  const map = readParamArg(reader, reporter);
  if (name === null || map === null) return null;
  if (!IDENT.test(name)) {
    reporter.error(reader.pointer('name'), `引数名 ${name} が識別子ではありません`, PARAMS_SUGGESTION, { name });
    return null;
  }
  return { kind: 'scalar', name, map, location };
}

/** `result`(任意。無ければ undefined —— H9 が拒む)。 */
function readResult(reader: YamlReader, reporter: SpecReporter): PlatformBindingValue | undefined | null {
  if (!reader.has('result')) return undefined;
  const raw = reader.raw('result');
  if (typeof raw === 'string') {
    if (!(PLATFORM_VALUE_TYPES as readonly string[]).includes(raw)) {
      reporter.error(reader.pointer('result'), `result ${raw} は書ける型ではありません`, RESULT_SUGGESTION, { result: raw });
      return null;
    }
    return { kind: 'scalar', type: raw as PlatformValueType };
  }
  const record = asRecord(raw);
  if (record === null) {
    reporter.error(reader.pointer('result'), 'result は型の語か { rows: 行の型名 } で書きます', RESULT_SUGGESTION);
    reporter.dropRows();
    return null;
  }
  const rows = new YamlReader(record, reader.pointer('result'), reporter);
  rows.rejectUnknownKeys(['rows'], 'result', RESULT_SUGGESTION);
  const row = rows.requiredString('rows', RESULT_SUGGESTION);
  if (row === null) return null;
  if (!IDENT.test(row)) {
    reporter.error(rows.pointer('rows'), `rows ${row} が識別子ではありません`, RESULT_SUGGESTION, { rows: row });
    return null;
  }
  return { kind: 'rows', row };
}
