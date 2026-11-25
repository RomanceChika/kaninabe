/**
 * access_spec の**濫用の歯止め**(`creates[].abuse`)と**未ログインに開く書き込みの受け入れ**(`public: 理由`)のパーサー。
 *
 * スキーマの正: domain-spec-writing.md §access_spec。検査の正は R5(`risk/verifiers/r5-abuse.ts`)。
 *
 * 読み込みが閉じるのは**形**だけである —— 知らないキー・型違い・欠けた `max` / `per` / `column`・`per` の字面(生成 SQL の
 * interval に置かれるので `{n} {minute|hour|day}` で閉じる)・欄名の識別子(R17)。値の意味(`max` が 1 以上か・鍵の欄が実在するか・
 * 鍵ごとが全体以下か)は検査(R5-2)が見る。**`global_ceiling` が無いこと**は読み込みでは欠落のまま持ち、R5-1 が止める
 * (黙って補わない)。
 */

import type { AbuseDecl, AbusePerKey, AbuseWindow } from './types.js';
import { asRecord, type SpecReporter } from './parse-common.js';
import { YamlReader } from './yaml-reader.js';
import { identifierProblem } from './sql-fragment.js';

/** `abuse` に書けるキー。 */
const ABUSE_KEYS: readonly string[] = ['global_ceiling', 'per_key', 'at'];

/** 全体の天井(`global_ceiling`)に書けるキー。 */
const WINDOW_KEYS: readonly string[] = ['max', 'per'];

/** 鍵ごとの天井(`per_key`)に書けるキー。 */
const PER_KEY_KEYS: readonly string[] = ['column', 'max', 'per'];

/** 期間の幅の字面: `{n} {minute|hour|day}`(複数形も同じ単位。`DERIVE_UNITS` と同じ閉じた語)。 */
export const PERIOD = /^[1-9]\d{0,5} (?:minute|hour|day)s?$/;

/** `abuse` の書き方。 */
export const ABUSE_SUGGESTION =
  'abuse は "global_ceiling: { max: {1 以上の整数}, per: \\"{n} {minute|hour|day}\\" }"(必須)と、' +
  '任意の "per_key: { column: {欄}, max: {n}, per: ... }" / "at: {期間を切る日時の欄}" で書く' +
  '(例: abuse: { global_ceiling: { max: 30, per: 1 hour }, per_key: { column: contact_email, max: 5, per: 1 hour } })';

/** `public` の書き方。 */
export const PUBLIC_SUGGESTION =
  'public は、未ログインのロールがこの更新・削除・遷移を起こせる形を意図して開けている理由を文字列で書く' +
  '(例: public: 未ログインの利用者が自分の送信を取り下げられる。取り下げるのは送信直後の行だけ)';

/** 天井の `max`・`per` を読む(どちらかが読めなければ null。違反は記録済み)。 */
function readWindow(reader: YamlReader, reporter: SpecReporter, what: string): AbuseWindow | null {
  const max = reader.optionalNumber('max', `${what}.max は 1 以上の整数で書く`);
  if (max === undefined) {
    if (!reader.has('max')) reporter.error(reader.pointer('max'), `${what}.max がありません`, `${what}.max に期間の中に存在してよい行数を書く`);
    return null;
  }
  const per = reader.requiredString('per', `${what}.per に期間の幅を "{n} {minute|hour|day}" で書く(例: 1 hour)`);
  if (per === null) return null;
  if (!PERIOD.test(per.trim())) {
    reporter.error(
      reader.pointer('per'),
      `${what}.per "${per.slice(0, 40)}" は期間の幅の形ではありません`,
      `${what}.per は "{n} {minute|hour|day}" の形で書く(n は 1 以上の整数。例: 1 hour)`,
      { per: per.slice(0, 40) },
    );
    reporter.dropRows();
    return null;
  }
  return { max, per: per.trim() };
}

/** 欄名(識別子の文法で閉じる。違反なら null)。 */
function columnName(reporter: SpecReporter, pointer: string, what: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const problem = identifierProblem(value);
  if (problem === null) return value;
  reporter.error(pointer, `${what} "${value.slice(0, 40)}" は欄名の形ではありません: ${problem}`, `${what} は entity_spec の欄の名前で書く`);
  reporter.dropRows();
  return null;
}

/** マッピングの子(`global_ceiling` / `per_key`)を読み取り器にする(マッピングでなければ違反を記録して null)。 */
function childReader(reader: YamlReader, reporter: SpecReporter, key: string, suggestion: string): YamlReader | null {
  const record = asRecord(reader.raw(key));
  if (record === null) {
    reporter.error(reader.pointer(key), `${key} はマッピングで書きます`, suggestion);
    reporter.dropRows();
    return null;
  }
  return new YamlReader(record, reader.pointer(key), reporter);
}

/**
 * `creates[]` の要素の `abuse` を読む。
 *
 * @param reader `creates` の 1 要素の読み取り器
 * @param reporter 違反の記録先
 * @param location この宣言の場所
 * @returns 宣言(書かれていなければ undefined。書かれていて読めない部分は落として違反を記録する)
 */
export function parseAbuse(reader: YamlReader, reporter: SpecReporter, location: AbuseDecl['location']): AbuseDecl | undefined {
  if (!reader.has('abuse')) return undefined;
  const abuse = childReader(reader, reporter, 'abuse', ABUSE_SUGGESTION);
  if (abuse === null) return undefined;
  abuse.rejectUnknownKeys(ABUSE_KEYS, 'abuse', `書けるのは ${ABUSE_KEYS.join(' / ')} だけ`);
  let globalCeiling: AbuseWindow | undefined;
  if (abuse.has('global_ceiling')) {
    const child = childReader(abuse, reporter, 'global_ceiling', ABUSE_SUGGESTION);
    if (child !== null) {
      child.rejectUnknownKeys(WINDOW_KEYS, 'global_ceiling', `書けるのは ${WINDOW_KEYS.join(' / ')} だけ`);
      globalCeiling = readWindow(child, reporter, 'global_ceiling') ?? undefined;
    }
  }
  let perKey: AbusePerKey | undefined;
  if (abuse.has('per_key')) {
    const child = childReader(abuse, reporter, 'per_key', ABUSE_SUGGESTION);
    if (child !== null) {
      child.rejectUnknownKeys(PER_KEY_KEYS, 'per_key', `書けるのは ${PER_KEY_KEYS.join(' / ')} だけ`);
      const column = columnName(
        reporter,
        child.pointer('column'),
        'per_key.column',
        child.requiredString('column', 'per_key.column に鍵になる欄(メール・端末 ID など)の名前を書く'),
      );
      const window = readWindow(child, reporter, 'per_key');
      if (column !== null && window !== null) perKey = { ...window, column };
    }
  }
  const at = columnName(reporter, abuse.pointer('at'), 'at', abuse.optionalString('at', 'at は期間を切る日時の欄の名前で書く'));
  return {
    ...(globalCeiling === undefined ? {} : { globalCeiling }),
    ...(perKey === undefined ? {} : { perKey }),
    ...(at === null ? {} : { at }),
    location,
  };
}

/**
 * 規則・遷移の `public`(未ログインに開く書き込みの理由)を読む。
 *
 * 空の理由は**そのまま持つ**(R5-5 が「理由が空」として止める。黙って捨てると「無い」と区別できなくなる)。
 *
 * @param reader 規則の読み取り器
 * @returns 理由(書かれていなければ undefined)
 */
export function parsePublic(reader: YamlReader): string | undefined {
  return reader.optionalString('public', PUBLIC_SUGGESTION);
}
