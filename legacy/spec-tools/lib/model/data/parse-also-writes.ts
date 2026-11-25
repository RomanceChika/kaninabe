/**
 * data_table の `functions[].also_writes`(主対象のほかに書き込む表と、その**書き込みの種類**)のパーサー。
 *
 * 形は `also_writes: { {表}: [insert | update | delete | scrub] }`。種類は必須で、表の名前だけの並び
 * (旧い書き方)は読まずに名指しで error にする(黙った既定を作らない —— 種類を足し忘れた表が「何もしない」と読まれて、
 * 操作の属性の導出から危険の表示が落ちるため)。
 *
 * **`shape: composite` ではキーそのものが必須**である(書き込み先の無い関数は `also_writes: {}` と明示する)。
 * 省略を「他の表に書かない」と読むと、手書きの本文が他の表に書いていても宣言からは何も見えないため。
 * 同じ「表 → 種類の並び」の形は `event_writes` の各イベントの値でも使うので、写像 1 つの読み取りをここに置く。
 */

import { asRecord } from '../parse-common.js';
import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import { DATA_WRITE_KINDS } from './types.js';
import type { DataWriteKind } from './types.js';

/** 読み取り結果(表の名前の並びと、表ごとの種類)。 */
export interface AlsoWrites {
  readonly tables: readonly string[];
  readonly kinds: Readonly<Record<string, readonly DataWriteKind[]>>;
  /** キーが書かれていたか(`{}` も書かれていたに数える)。 */
  readonly declared: boolean;
}

/** 表名(スネークケース)。 */
const TABLE_NAME = /^[a-z][a-z0-9_]*$/;

/** 直し方の例。 */
const SUGGESTION = `also_writes に "{表}: [${DATA_WRITE_KINDS.join(' | ')}]" を並べる(例: also_writes: { entries: [update, delete], domain_events: [insert] })`;

/**
 * 書き込みの種類の並び 1 つを読む(値域・重複なし・1 つ以上)。
 *
 * @param value 並びの生の値
 * @param pointer 指摘の位置
 * @param subject 指摘の主語(例: `apply_x_transition の also_writes の {表}`)
 * @param reporter 違反の記録先
 * @param allowEmpty 空の並び(`[]`)を「書き込まない」の明示として許すか
 * @returns 種類の並び(読めなければ null。指摘は記録済み)
 */
export function parseKindList(
  value: unknown,
  pointer: string,
  subject: string,
  reporter: SpecReporter,
  allowEmpty: boolean,
): readonly DataWriteKind[] | null {
  const list = Array.isArray(value) ? (value as readonly unknown[]) : null;
  if (list === null || (!allowEmpty && list.length === 0) || !list.every((item) => typeof item === 'string')) {
    reporter.error(
      pointer,
      `${subject} に書き込みの種類がありません(${allowEmpty ? '0 個以上' : '1 つ以上'}の ${DATA_WRITE_KINDS.join(' / ')} を並べる)`,
      `本文(migration)が実際に行う書き込みを書く(推測で埋めない)。値域は ${DATA_WRITE_KINDS.join(' / ')}`,
      { subject },
    );
    reporter.dropRows();
    return null;
  }
  const items = list as readonly string[];
  const bad = items.filter((item) => !(DATA_WRITE_KINDS as readonly string[]).includes(item));
  const duplicated = items.filter((item, index) => items.indexOf(item) !== index);
  if (bad.length > 0 || duplicated.length > 0) {
    reporter.error(
      pointer,
      `${subject} の種類が不正です(${[...bad, ...duplicated].join(', ')})。値域は ${DATA_WRITE_KINDS.join(' / ')}、重複なし`,
      SUGGESTION,
      { subject, kinds: items.join(',') },
    );
    reporter.dropRows();
    return null;
  }
  return items as readonly DataWriteKind[];
}

/**
 * 「表 → 種類の並び」の写像 1 つを読む(`also_writes` と `event_writes` の各値)。
 *
 * @param raw 写像の生の値
 * @param pointer 写像の位置
 * @param subject 指摘の主語(例: `apply_x_transition の also_writes`)
 * @param reporter 違反の記録先
 * @returns 表と種類(写像でなければ null。指摘は記録済み)
 */
export function parseWritesMap(
  raw: unknown,
  pointer: string,
  subject: string,
  reporter: SpecReporter,
): Omit<AlsoWrites, 'declared'> | null {
  const record = asRecord(raw);
  if (record === null) {
    reporter.error(
      pointer,
      `${subject} が書き込みの種類つきの写像ではありません(表の名前の並びだけでは書き込みの種類が分かりません)`,
      `${SUGGESTION}。書き込み先が無いなら {} と書く`,
      { subject },
    );
    reporter.dropRows();
    return null;
  }
  const tables: string[] = [];
  const kinds: Record<string, readonly DataWriteKind[]> = {};
  for (const [table, value] of Object.entries(record)) {
    const at = `${pointer}.${table}`;
    if (!TABLE_NAME.test(table)) {
      reporter.error(at, `${subject} の表名 ${table} がスネークケースではありません`, SUGGESTION, { subject, table });
      reporter.dropRows();
      continue;
    }
    const list = parseKindList(value, at, `${subject} の ${table}`, reporter, false);
    if (list === null) continue;
    tables.push(table);
    kinds[table] = list;
  }
  return { tables, kinds };
}

/**
 * 関数 1 本の `also_writes` を読む。
 *
 * @param reader その関数の要素
 * @param name 関数名(反例用)
 * @param reporter 違反の記録先
 * @param required キーそのものを必須にするか(`shape: composite`)
 * @returns 書き込み先の表と種類(書かれていなければ空)
 */
export function parseAlsoWrites(reader: YamlReader, name: string, reporter: SpecReporter, required: boolean): AlsoWrites {
  if (!reader.has('also_writes')) {
    if (required) {
      reporter.error(
        reader.pointer('also_writes'),
        `${name} は shape: composite なのに also_writes がありません(省略は「他の表に書かない」と読めないので明示が要ります)`,
        `${SUGGESTION}。本文が他の表に何も書かないなら also_writes: {} と書く`,
        { function: name },
      );
    }
    return { tables: [], kinds: {}, declared: false };
  }
  const parsed = parseWritesMap(reader.raw('also_writes'), reader.pointer('also_writes'), `${name} の also_writes`, reporter);
  return parsed === null ? { tables: [], kinds: {}, declared: true } : { ...parsed, declared: true };
}
