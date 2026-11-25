/**
 * data_table の書き込み RPC の、`also_writes` 以外の**書き込みの宣言**のパーサー。
 *
 *   - `self_writes: [insert | update | delete | scrub]` … 帰属表(自表)への書き込みの種類
 *   - `event_writes: { {イベント ID}: { {表}: [種類…] } }` … イベントごとに行う書き込み(also_writes の部分集合)
 *   - `calls: [関数名…]` … 本文が呼ぶ他の関数(呼ばれた側の書き込みが合流する)
 *   - `dynamic_sql: {理由}` … 本文が動的 SQL(execute)を使うことの理由
 *
 * どれも `kind: rpc` でだけ書ける。ここが見るのは**形と書ける場所**だけで、意味(表の実在・also_writes の部分集合・
 * イベントの過不足・呼び先の実在)は T20 / T22 が、本文との一致は rpc-parity が見る(パーサーはファイル I/O をしない)。
 */

import { asRecord } from '../parse-common.js';
import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import { parseKindList, parseWritesMap } from './parse-also-writes.js';
import type { DataFunctionDecl, DataFunctionShape, DataWriteKind } from './types.js';

/** 読み取り結果(書かれていない欄はキーを持たない)。 */
export type RpcWriteDecls = Pick<DataFunctionDecl, 'selfWriteKinds' | 'eventWrites' | 'calls' | 'dynamicSql'>;

/** 関数名(スネークケース)。 */
const FUNCTION_NAME = /^[a-z][a-z0-9_]*$/;

/** イベント ID(`{機械}.{イベント}`)。 */
const EVENT_ID = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** その関数の形・出どころ(書ける場所の判定の材料)。 */
export interface RpcWriteContext {
  readonly kind: DataFunctionDecl['kind'];
  readonly shape: DataFunctionShape | undefined;
  /** 本文が手書きと宣言されているか(定型 4 形でも `self_writes` を書ける条件)。 */
  readonly handwritten: boolean;
}

/** その欄を書けない場所に書いた、を記録する。 */
function misplaced(reader: YamlReader, key: string, name: string, why: string, reporter: SpecReporter): void {
  reporter.error(reader.pointer(key), `${name} には ${key} を宣言できません(${why})`, '行を削除する', { function: name, key });
  reporter.dropRows();
}

/**
 * `self_writes` を読む。`shape: composite` では必須、定型 4 形は形が決めるので手書きの本文だけが書ける。
 *
 * @param reader その関数の要素
 * @param name 関数名
 * @param context 形と出どころ
 * @param reporter 違反の記録先
 * @returns 種類(書かれていなければ undefined)
 */
function parseSelfWrites(
  reader: YamlReader,
  name: string,
  context: RpcWriteContext,
  reporter: SpecReporter,
): readonly DataWriteKind[] | undefined {
  const composite = context.kind === 'rpc' && context.shape === 'composite';
  if (!reader.has('self_writes')) {
    if (composite) {
      reporter.error(
        reader.pointer('self_writes'),
        `${name} は shape: composite なのに self_writes(帰属表への書き込みの種類)がありません`,
        'self_writes に本文が帰属表に行う書き込みを並べる(例: self_writes: [delete, insert])。帰属表に書かないなら self_writes: [] と書く',
        { function: name },
      );
      reporter.dropRows();
    }
    return undefined;
  }
  if (context.kind !== 'rpc') {
    misplaced(reader, 'self_writes', name, `kind: ${context.kind} は書き込み RPC ではありません`, reporter);
    return undefined;
  }
  if (!composite && !context.handwritten) {
    misplaced(
      reader,
      'self_writes',
      name,
      `定型の形(${context.shape ?? ''})で本文が生成物なので、帰属表への書き込みは形が決めます(二重の正を作らない)`,
      reporter,
    );
    return undefined;
  }
  return parseKindList(reader.raw('self_writes'), reader.pointer('self_writes'), `${name} の self_writes`, reporter, true) ?? undefined;
}

/**
 * `event_writes` を読む(キーはイベント ID、値は表 → 種類の写像。書かないイベントは `{}`)。
 *
 * @param reader その関数の要素
 * @param name 関数名
 * @param reporter 違反の記録先
 * @returns イベントごとの書き込み(書かれていなければ undefined)
 */
function parseEventWrites(reader: YamlReader, name: string, reporter: SpecReporter): DataFunctionDecl['eventWrites'] {
  if (!reader.has('event_writes')) return undefined;
  const record = asRecord(reader.raw('event_writes'));
  const suggestion = 'event_writes は "{イベント ID}: { {表}: [種類…] }" の写像で書く(そのイベントで書かないなら {})';
  if (record === null) {
    reporter.error(reader.pointer('event_writes'), `${name} の event_writes が写像ではありません`, suggestion, { function: name });
    reporter.dropRows();
    return undefined;
  }
  const result: Record<string, Readonly<Record<string, readonly DataWriteKind[]>>> = {};
  for (const [event, value] of Object.entries(record)) {
    const at = `${reader.pointer('event_writes')}.${event}`;
    if (!EVENT_ID.test(event)) {
      reporter.error(at, `${name} の event_writes のキー ${event} がイベント ID({機械}.{イベント})ではありません`, suggestion, { function: name, event });
      reporter.dropRows();
      continue;
    }
    const parsed = parseWritesMap(value, at, `${name} の event_writes の ${event}`, reporter);
    if (parsed !== null) result[event] = parsed.kinds;
  }
  return result;
}

/**
 * `calls` を読む(重複なし・関数名の形)。
 *
 * @param reader その関数の要素
 * @param name 関数名
 * @param reporter 違反の記録先
 * @returns 呼び先(書かれていなければ undefined)
 */
function parseCalls(reader: YamlReader, name: string, reporter: SpecReporter): readonly string[] | undefined {
  if (!reader.has('calls')) return undefined;
  const raw = reader.raw('calls');
  const items = Array.isArray(raw) ? (raw as readonly unknown[]) : null;
  const suggestion = 'calls に本文が呼ぶ関数名を並べる(例: calls: [{関数名}])。呼ばないならキーごと消す';
  if (items === null || items.length === 0 || !items.every((item): item is string => typeof item === 'string' && FUNCTION_NAME.test(item))) {
    reporter.error(reader.pointer('calls'), `${name} の calls が関数名(スネークケース)の 1 つ以上の並びではありません`, suggestion, { function: name });
    reporter.dropRows();
    return undefined;
  }
  const duplicated = items.find((item, index) => items.indexOf(item) !== index);
  if (duplicated !== undefined) {
    reporter.error(reader.pointer('calls'), `${name} の calls に ${String(duplicated)} が重複しています`, suggestion, { function: name });
    reporter.dropRows();
    return undefined;
  }
  return items as readonly string[];
}

/**
 * 書き込み RPC の `self_writes` / `event_writes` / `calls` / `dynamic_sql` を読む。
 *
 * @param reader その関数の要素
 * @param name 関数名
 * @param context 形と出どころ
 * @param reporter 違反の記録先
 * @returns 読めた宣言
 */
export function parseRpcWriteDecls(reader: YamlReader, name: string, context: RpcWriteContext, reporter: SpecReporter): RpcWriteDecls {
  const selfWriteKinds = parseSelfWrites(reader, name, context, reporter);
  const rpcOnly = ['event_writes', 'calls', 'dynamic_sql'].filter((key) => reader.has(key));
  if (context.kind !== 'rpc') {
    for (const key of rpcOnly) misplaced(reader, key, name, `kind: ${context.kind} は書き込み RPC ではありません`, reporter);
    return selfWriteKinds === undefined ? {} : { selfWriteKinds };
  }
  const eventWrites = parseEventWrites(reader, name, reporter);
  const calls = parseCalls(reader, name, reporter);
  const dynamicSql = reader.optionalLabel('dynamic_sql', 'dynamic_sql に本文が動的 SQL(execute)を使う理由を 1 行で書く。使わないならキーごと消す');
  return {
    ...(selfWriteKinds === undefined ? {} : { selfWriteKinds }),
    ...(eventWrites === undefined ? {} : { eventWrites }),
    ...(calls === undefined ? {} : { calls }),
    ...(dynamicSql === undefined ? {} : { dynamicSql }),
  };
}
