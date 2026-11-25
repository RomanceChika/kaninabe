/**
 * data_table の**表の形の器**(`indexes` / `sequences` / `exclusions`)のパーサー。
 *
 * どれも「この表はどういう器を持つか」の宣言であり、名前が突合キーになる(重複はここで落とす ——
 * 突合キーが壊れると「宣言にあって DB に無い」の判定そのものが立たない)。
 *
 * 読むものが `parse-data-table.ts` と違う —— あちらは「このファイルが何者か」の宣言で、ここは
 * 「表の形の器」である。
 */

import { fragmentField, identifierField, identifierListField } from '../sql-fields.js';
import type { SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type { DataExclusionDecl, DataIndexDecl, DataSequenceDecl } from './types-shape.js';
import { globalKeyOf } from '../parse-global-key.js';

/** indexes を読む。名前の重複はここで落とす(突合キーが壊れるため)。 */
export function parseIndexes(root: YamlReader, reporter: SpecReporter): readonly DataIndexDecl[] {
  const items = root.optionalList('indexes', 'indexes は "- name / on / unique / where" のリストで書く');
  const indexes: DataIndexDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, 'indexes', reporter, 'name と on(列のリスト)を持つ要素として書く', (reader, index) => {
    const name = identifierField(reader, reporter, 'name', reader.requiredString('name', 'name にインデックスの実名を書く(例: entries_workshop_id_idx)'));
    const on = identifierListField(reader, reporter, 'on', reader.requiredStringList('on', 'on にキー列を宣言順で並べる(例: on: [workshop_id])', false));
    if (name === null || on === null) return;
    if (seen.has(name)) {
      reporter.error(`indexes[${index}].name`, `インデックス名 ${name} が重複しています`, '重複した要素を削除する', { name });
      duplicates += 1;
      return;
    }
    seen.add(name);
    const where = fragmentField(reader, reporter, 'where', reader.optionalString('where', 'where に部分インデックスの述語(SQL 断片)を書く'));
    const invariant = reader.optionalString('invariant', 'invariant に由来する不変条件 ID を書く');
    indexes.push({
      name,
      on,
      unique: reader.optionalBoolean('unique', 'unique は true / false で書く'),
      ...(where === undefined ? {} : { where }),
      ...(invariant === undefined ? {} : { invariant }),
      ...globalKeyOf(reader, reporter),
    });
  });
  reporter.settleRows(items.length, indexes.length, duplicates);
  return indexes;
}

/** exclusions(排他制約)を読む。名前の重複はここで落とす(突合キーが壊れるため)。 */
export function parseExclusions(root: YamlReader, reporter: SpecReporter): readonly DataExclusionDecl[] {
  const items = root.optionalList('exclusions', 'exclusions は "- name / keys / range / where" のリストで書く');
  const exclusions: DataExclusionDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, 'exclusions', reporter, 'name / keys / range を持つ要素として書く', (reader, index) => {
    const name = identifierField(reader, reporter, 'name', reader.requiredString('name', 'name に排他制約の実名を書く(例: bookings_room_slot_exclude)'));
    const keys = identifierListField(reader, reporter, 'keys', reader.requiredStringList('keys', 'keys に一致を見る列を並べる(例: keys: [room_id])', false));
    const range = identifierListField(reader, reporter, 'range', reader.requiredStringList('range', 'range に [開始列, 終了列] をこの順で書く', false));
    if (name === null || keys === null || range === null) return;
    if (seen.has(name)) {
      reporter.error(`exclusions[${index}].name`, `排他制約名 ${name} が重複しています`, '重複した要素を削除する', { name });
      duplicates += 1;
      return;
    }
    if (range.length !== 2) {
      reporter.error(
        `exclusions[${index}].range`,
        `range は開始と終了の 2 列で書きます(${range.length} 個あります)`,
        'range: [starts_at, ends_at] のように 2 列で書く(端の扱いは半開区間に固定)',
        { range: range.join(', ') },
      );
      return;
    }
    seen.add(name);
    const where = fragmentField(reader, reporter, 'where', reader.optionalString('where', 'where に部分制約の述語(SQL 断片)を書く'));
    const invariant = reader.optionalString('invariant', 'invariant に由来する不変条件 ID を書く');
    exclusions.push({
      name,
      keys,
      range: [range[0] ?? '', range[1] ?? ''],
      ...(where === undefined ? {} : { where }),
      ...(invariant === undefined ? {} : { invariant }),
    });
  });
  reporter.settleRows(items.length, exclusions.length, duplicates);
  return exclusions;
}


/** シーケンス名(スネークケース)。 */
const SNAKE = /^[a-z][a-z0-9_]*$/;

/**
 * `sequences` を読む。名前の重複はここで落とす(突合キーが壊れるため)。
 *
 * @param root フロントマターの読み手
 * @param reporter 違反の記録先
 * @returns 宣言されたシーケンス(宣言順)
 */
export function parseSequences(root: YamlReader, reporter: SpecReporter): readonly DataSequenceDecl[] {
  const items = root.optionalList(
    'sequences',
    'sequences は "- name / start" のリストで書く(defaults の nextval が名指す採番の器)',
  );
  const sequences: DataSequenceDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, 'sequences', reporter, 'name を持つ要素として書く', (reader, index) => {
    const name = reader.requiredString('name', 'name にシーケンスの実名を書く(例: bookings_reference_seq)');
    if (name === null) return;
    if (!SNAKE.test(name)) {
      reporter.error(
        `sequences[${index}].name`,
        `シーケンス名 ${name} がスネークケースではありません`,
        'name をスネークケースで書く(例: bookings_reference_seq)',
        { name },
      );
      return;
    }
    if (seen.has(name)) {
      reporter.error(`sequences[${index}].name`, `シーケンス名 ${name} が重複しています`, '重複した要素を削除する', {
        name,
      });
      duplicates += 1;
      return;
    }
    seen.add(name);
    const start = reader.optionalNumber('start', 'start に最初の値を書く(省略すると 1)');
    if (reader.has('increment')) {
      reporter.error(
        `sequences[${index}].increment`,
        'sequences の要素に increment は書けません(この欄は無くなりました。刻みは常に 1)',
        'increment の行を削除する(刻みが 1 でよいなら何も要らない)',
      );
    }
    sequences.push({ name, ...(start === undefined ? {} : { start }) });
  });
  reporter.settleRows(items.length, sequences.length, duplicates);
  return sequences;
}

/** 保持の時間を持てる設計図の名前(この表だけが書ける。必須であることは Y12 が置き場の引き当てで見る)。 */
const RETENTION_FRAMEWORK = 'resend_digests';

/** `retention_hours` の書き方。 */
const RETENTION_SUGGESTION =
  'retention_hours に行を保つ時間を正の整数(時間)で書く(例: retention_hours: 24)。書けるのは framework: resend_digests の表だけ(ほかの表は無期限保持で、書いても行は消えない)';

/**
 * 保持の時間(`retention_hours`)を読む(点検 21 回目 A21-1)。正の整数で、`framework: resend_digests` の表だけが書ける。
 *
 * **この値が約束するのは「過ぎた行を比べに使わない」までである。** 物理的に消すのは保存点の 1 回目のたびの掃除だけ
 * (`sql/rpc-resend-digest.ts` の `recordResendDigest`)で、定期の掃除は無い —— 行が残る最長は「この時間 + 次にどれかの保存点が
 * 1 回目を書くまで」で、静かな製品では上限が無い(定期の掃除は BACKLOG の v1 後の整理)。
 *
 * @param root 表の読み手
 * @param reporter 違反の記録先
 * @param framework 表の `framework`
 * @returns 表の宣言に広げる欄(書いていない・不正なら空)
 */
export function parseRetentionHours(root: YamlReader, reporter: SpecReporter, framework: string | undefined): { readonly retentionHours?: number } {
  const hours = root.optionalNumber('retention_hours', RETENTION_SUGGESTION);
  if (hours === undefined) return {};
  if (framework !== RETENTION_FRAMEWORK) {
    reporter.error(root.pointer('retention_hours'), `retention_hours は framework: ${RETENTION_FRAMEWORK} の表だけが書けます`, RETENTION_SUGGESTION, { framework: framework ?? '' });
    return {};
  }
  if (!Number.isInteger(hours) || hours < 1) {
    reporter.error(root.pointer('retention_hours'), `retention_hours ${String(hours)} は正の整数ではありません`, RETENTION_SUGGESTION, { retention_hours: String(hours) });
    return {};
  }
  return { retentionHours: hours };
}
