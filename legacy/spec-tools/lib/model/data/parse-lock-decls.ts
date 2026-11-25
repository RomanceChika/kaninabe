/**
 * data_table の**掴みの宣言**(`triggers[].locks` / `copies_from` / `advisory`・`foreign_keys[].refuse_erased`)と、写しの古い値の持ち主の記録の宣言
 * (`triggers[].remembers_owner`。接地は T28)のパーサー。
 *
 * ここが見るのは宣言の中だけで決まる形(語の形・強さの値域・写し元の書き方)である。宣言の外の事実への接地(表と列の実在・
 * 外部キーの実在・供給する列との一致)は T27 が見る。読めない要素は載せない(緩めない側。掴みを宣言より弱く生成しない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { asRecord, type SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { LOCK_STRENGTHS, type FreezesPersonalDecl, type LockStrength, type RefuseErasedDecl, type TriggerCopySource } from './types-locks.js';

/** 名前(表・列・語。スネークケース)。 */
const SNAKE = /^[a-z][a-z0-9_]*$/;

/** 写し元(`{表}.{列}`)。 */
const SOURCE = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;

/** advisory lock の鍵の接頭辞(文字列の定数に置ける字だけ)。 */
const ADVISORY_KEY = /^[a-z][a-z0-9_]*:[a-z0-9_:=]*$/;

/** トリガの掴みの宣言の書き方。 */
const LOCKS_SUGGESTION = 'locks は "{表}: share | update" のマッピングで書く(発火させた行が直の外部キーで指す親の行を、トリガがその強さで掴む)';

/** 写し元の書き方。 */
const COPIES_SUGGESTION = 'copies_from は "- column: {供給する列} / from: {表}.{列} / match: { {写し元の列}: {自表の列} }" のリストで書く';

/** 紐づけの関所の書き方。 */
const REFUSE_SUGGESTION =
  'refuse_erased は "{ column: {参照先の印の列}, values: [{消去済みの値}], word: {拒否の語}, message: {画面の文言}, ' +
  'freezes_personal: { word: {拒否の語}, message: {画面の文言} } }" で書く(freezes_personal は自表が個人列を持つときに要る)';

/** 個人列の凍結の書き方。 */
const FREEZE_SUGGESTION = 'freezes_personal は "{ word: {拒否の語(紐づけの語と別)}, message: {画面の文言} }" で書く';

/**
 * トリガの `locks` を読む。
 *
 * @param reader トリガの要素
 * @param reporter 違反の記録先
 * @returns 表 → 強さ(書かれていなければ undefined)
 */
export function parseTriggerLocks(reader: YamlReader, reporter: SpecReporter): Readonly<Record<string, LockStrength>> | undefined {
  if (!reader.has('locks')) return undefined;
  const declared = reader.optionalStringMap('locks', LOCKS_SUGGESTION);
  const locks: Record<string, LockStrength> = {};
  for (const [table, strength] of Object.entries(declared)) {
    if (!SNAKE.test(table) || !(LOCK_STRENGTHS as readonly string[]).includes(strength)) {
      reporter.error(`${reader.pointer('locks')}.${table}`, `locks の ${table}: ${strength} は読めません`, LOCKS_SUGGESTION, { table, strength });
      reporter.dropRows();
      continue;
    }
    locks[table] = strength as LockStrength;
  }
  return locks;
}

/**
 * トリガの `copies_from` を読む。
 *
 * @param reader トリガの要素
 * @param reporter 違反の記録先
 * @returns 写し元の並び(書かれていなければ undefined)
 */
export function parseCopiesFrom(reader: YamlReader, reporter: SpecReporter): readonly TriggerCopySource[] | undefined {
  if (!reader.has('copies_from')) return undefined;
  const items = reader.optionalList('copies_from', COPIES_SUGGESTION);
  const sources: TriggerCopySource[] = [];
  eachRecord(items, reader.pointer('copies_from'), reporter, COPIES_SUGGESTION, (element) => {
    element.rejectUnknownKeys(['column', 'from', 'match'], 'copies_from の要素', COPIES_SUGGESTION);
    const column = element.requiredString('column', COPIES_SUGGESTION);
    const from = element.requiredString('from', COPIES_SUGGESTION);
    const match = element.optionalStringMap('match', COPIES_SUGGESTION);
    const source = from === null ? null : SOURCE.exec(from);
    const names = Object.entries(match).flat();
    if (column === null || !SNAKE.test(column) || source === null || names.length === 0 || names.some((name) => !SNAKE.test(name))) {
      reporter.error(element.pointer('from'), `copies_from の要素が読めません(${String(column)} ← ${String(from)})`, COPIES_SUGGESTION, { column: String(column), from: String(from) });
      reporter.dropRows();
      return;
    }
    sources.push({ column, fromTable: source[1] ?? '', fromColumn: source[2] ?? '', match });
  });
  return sources;
}

/**
 * トリガの `advisory` を読む。
 *
 * @param reader トリガの要素
 * @param reporter 違反の記録先
 * @returns 鍵の接頭辞の並び(書かれていなければ undefined)
 */
export function parseAdvisory(reader: YamlReader, reporter: SpecReporter): readonly string[] | undefined {
  if (!reader.has('advisory')) return undefined;
  const keys = reader.optionalStringList('advisory', 'advisory はトリガの本文が取る advisory lock の鍵の接頭辞の並びで書く(例: ["members:floor"])');
  const kept = keys.filter((key) => ADVISORY_KEY.test(key));
  for (const key of keys.filter((candidate) => !ADVISORY_KEY.test(candidate))) {
    reporter.error(reader.pointer('advisory'), `advisory の鍵 ${key} は読めません`, '鍵は "{表}:{名前}" の形(英小文字・数字・_・:・=)で書く', { key });
    reporter.dropRows();
  }
  return kept;
}

/**
 * 外部キーの `refuse_erased` を読む。
 *
 * @param reader 外部キーの要素
 * @param reporter 違反の記録先
 * @returns 宣言(書かれていない・読めなければ undefined)
 */
export function parseRefuseErased(reader: YamlReader, reporter: SpecReporter): RefuseErasedDecl | undefined {
  if (!reader.has('refuse_erased')) return undefined;
  const record = asRecord(reader.raw('refuse_erased'));
  if (record === null) {
    reporter.error(reader.pointer('refuse_erased'), 'refuse_erased はマッピングで書きます', REFUSE_SUGGESTION);
    reporter.dropRows();
    return undefined;
  }
  const inner = new YamlReader(record, reader.pointer('refuse_erased'), reporter);
  inner.rejectUnknownKeys(['column', 'values', 'word', 'message', 'freezes_personal'], 'refuse_erased', REFUSE_SUGGESTION);
  const column = inner.requiredString('column', REFUSE_SUGGESTION);
  const values = inner.requiredStringList('values', REFUSE_SUGGESTION, false);
  const word = inner.requiredString('word', REFUSE_SUGGESTION);
  // 画面の文言は必須(拒否の語は画面まで運ばれ、閉じた表の語に当たれば汎用の「いまはこの操作ができません」の代わりにこれを出す)。
  const message = inner.requiredString('message', REFUSE_SUGGESTION);
  if (column === null || values === null || word === null || message === null || message.trim() === '' || !SNAKE.test(column) || !SNAKE.test(word)) {
    reporter.error(reader.pointer('refuse_erased'), 'refuse_erased が読めません', REFUSE_SUGGESTION);
    reporter.dropRows();
    return undefined;
  }
  if (!inner.has('freezes_personal')) return { column, values, word, message };
  const freezesPersonal = parseFreezesPersonal(inner, word, reporter);
  // 凍結が読めなくても紐づけの関所は残す(指摘は出ている。読めた分まで落とすと緩む側に寄る)。
  return freezesPersonal === undefined ? { column, values, word, message } : { column, values, word, message, freezesPersonal };
}

/**
 * `refuse_erased.freezes_personal` を読む。読めなければ指摘を出して載せない(verify は赤になる)。
 *
 * @param reader refuse_erased の中身
 * @param linkWord 紐づけの拒否の語(同じ語は書けない —— 画面の文言が 2 つの意味を持つ)
 * @param reporter 違反の記録先
 * @returns 宣言(読めなければ undefined)
 */
function parseFreezesPersonal(reader: YamlReader, linkWord: string, reporter: SpecReporter): FreezesPersonalDecl | undefined {
  const pointer = reader.pointer('freezes_personal');
  const record = asRecord(reader.raw('freezes_personal'));
  if (record === null) {
    reporter.error(pointer, 'freezes_personal はマッピングで書きます', FREEZE_SUGGESTION);
    reporter.dropRows();
    return undefined;
  }
  const inner = new YamlReader(record, pointer, reporter);
  inner.rejectUnknownKeys(['word', 'message'], 'freezes_personal', FREEZE_SUGGESTION);
  const word = inner.requiredString('word', FREEZE_SUGGESTION);
  const message = inner.requiredString('message', FREEZE_SUGGESTION);
  if (word === null || message === null || message.trim() === '' || !SNAKE.test(word) || word === linkWord) {
    reporter.error(pointer, 'freezes_personal が読めません(拒否の語はスネークケースで、紐づけの語と別の語にする)', FREEZE_SUGGESTION);
    reporter.dropRows();
    return undefined;
  }
  return { word, message };
}

/**
 * トリガの `remembers_owner`(行の元の持ち主を記録する。持ち主の列 1 つ)を読む。読めなければ載せない(T28 は宣言の無いトリガとして扱う)。
 *
 * @param reader トリガの要素
 * @param reporter 指摘の集め先
 * @returns `{ remembersOwner }`、または書いていない・読めないなら空
 */
export function parseRemembersOwner(reader: YamlReader, reporter: SpecReporter): { readonly remembersOwner?: string } {
  if (!reader.has('remembers_owner')) return {};
  const value = reader.optionalString('remembers_owner', 'remembers_owner に行の持ち主の列(本人を指す参照の列)を 1 つ書く');
  if (value === undefined) return {};
  if (!SNAKE.test(value)) {
    reporter.error(reader.pointer('remembers_owner'), `remembers_owner の ${value} は読めません(列の名前を書く)`, 'remembers_owner に持ち主の列の名前(スネークケース)を書く', { value });
    return {};
  }
  return { remembersOwner: value };
}
