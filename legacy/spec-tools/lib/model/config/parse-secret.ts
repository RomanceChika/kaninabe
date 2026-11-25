/**
 * config_spec の行が持つ **秘密の宣言**(`rotation` / `strength` / `previous`)のパーサー。
 *
 * - `rotation: { every: "{n} day|month", procedure, holders }` … 寿命と更新の手順(ASVS V11.1.1)。種類が `confidential: true` の行は必須(K6)
 * - `strength: { min_length: n }` … 長さの下限(ASVS V13.2.3)。サービスの認証の秘密は必須(K6)
 * - `previous: NAME` … 更新の間だけ旧い値も受けるための環境変数名(ASVS V11.2.2)。名前が宣言された行か・`strength` を持つ行だけが書けるかは K6 が見る
 *
 * ここは**形だけ**を見る(書式・型・正の整数)。必須かどうかと行どうしの対応は語彙を読む K6 の仕事。
 * 1 つでも読めなければ行ごと落とす(壊れた宣言を半端に通さない)。
 */

import type { SpecReporter } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { ConfigRotationDecl, ConfigRotationUnit, ConfigStrengthDecl } from './types.js';
import { CONFIG_ROTATION_UNITS } from './types.js';

/** `every` の書式(例 `365 day`・`12 month`)。 */
const EVERY = /^([1-9][0-9]*) (day|month)$/u;

/** 環境変数名(SCREAMING_SNAKE)。 */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/u;

const ROTATION_SUGGESTION =
  'rotation を "{ every: \\"365 day\\", procedure: {手順または文書の場所}, holders: [{持つ者}], reason: {周期の根拠(任意)} }" で書く(every は "{正の整数} day" か "{正の整数} month")';
const STRENGTH_SUGGESTION = 'strength を "{ min_length: {正の整数} }" で書く(これに満たない値は設定されていないものとして口を閉じる)';

/** 読んだ秘密の宣言(無い分は欠ける)。 */
export interface ConfigSecretDecls {
  readonly rotation?: ConfigRotationDecl;
  readonly strength?: ConfigStrengthDecl;
  readonly previous?: string;
}

/**
 * 行の `rotation` / `strength` / `previous` を読む。
 *
 * @param item 行のマッピング
 * @param id 環境変数名(違反の文に出す)
 * @param reporter 違反の記録先
 * @returns 宣言。読めなければ null(行ごと落とす)
 */
export function parseSecretDecls(item: YamlReader, id: string, reporter: SpecReporter): ConfigSecretDecls | null {
  const rotation = parseRotation(item, id, reporter);
  if (rotation === null) return null;
  const strength = parseStrength(item, id, reporter);
  if (strength === null) return null;
  const previous = parsePrevious(item, id, reporter);
  if (previous === null) return null;
  return {
    ...(rotation === undefined ? {} : { rotation }),
    ...(strength === undefined ? {} : { strength }),
    ...(previous === undefined ? {} : { previous }),
  };
}

/** 下のマッピングを読む器(キーが無ければ undefined、マッピングでなければ違反を記録して null)。 */
function nested(item: YamlReader, key: string, suggestion: string, reporter: SpecReporter): YamlReader | null | undefined {
  if (!item.has(key)) return undefined;
  const raw = item.raw(key);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    reporter.error(item.pointer(key), `${key} がマッピングではありません`, suggestion);
    return null;
  }
  return new YamlReader(raw as Readonly<Record<string, unknown>>, item.pointer(key), reporter);
}

/** `rotation` を読む。 */
function parseRotation(item: YamlReader, id: string, reporter: SpecReporter): ConfigRotationDecl | null | undefined {
  const reader = nested(item, 'rotation', ROTATION_SUGGESTION, reporter);
  if (reader === undefined || reader === null) return reader;
  reader.rejectUnknownKeys(['every', 'procedure', 'holders', 'reason'], `設定 ${id} の rotation`, ROTATION_SUGGESTION);
  const every = reader.requiredString('every', ROTATION_SUGGESTION);
  const procedure = reader.requiredString('procedure', ROTATION_SUGGESTION);
  const holders = reader.requiredStringList('holders', ROTATION_SUGGESTION, false);
  const reason = reader.optionalString('reason', 'reason に周期の根拠を書く(運営がまだ決めていない仮置きの値は「仮置き・運用で決める」と明記する)');
  if (every === null || procedure === null || holders === null) return null;
  const match = EVERY.exec(every);
  const count = match?.[1];
  const unit = CONFIG_ROTATION_UNITS.find((candidate) => candidate === match?.[2]);
  if (count === undefined || unit === undefined) {
    reporter.error(reader.pointer('every'), `設定 ${id} の rotation.every ${every} は書式に合いません`, ROTATION_SUGGESTION, { id, every });
    return null;
  }
  return { everyCount: Number(count), everyUnit: unit satisfies ConfigRotationUnit, procedure, holders, ...(reason === undefined ? {} : { reason }) };
}

/** `strength` を読む。 */
function parseStrength(item: YamlReader, id: string, reporter: SpecReporter): ConfigStrengthDecl | null | undefined {
  const reader = nested(item, 'strength', STRENGTH_SUGGESTION, reporter);
  if (reader === undefined || reader === null) return reader;
  reader.rejectUnknownKeys(['min_length'], `設定 ${id} の strength`, STRENGTH_SUGGESTION);
  const minLength = reader.optionalNumber('min_length', STRENGTH_SUGGESTION);
  if (minLength === undefined || !Number.isInteger(minLength) || minLength < 1) {
    reporter.error(reader.pointer('min_length'), `設定 ${id} の strength.min_length は正の整数で書きます`, STRENGTH_SUGGESTION, { id });
    return null;
  }
  return { minLength };
}

/** `previous` を読む(環境変数名の形だけ。宣言された行かは K6)。 */
function parsePrevious(item: YamlReader, id: string, reporter: SpecReporter): string | null | undefined {
  const previous = item.optionalString('previous', 'previous に旧い値の環境変数名(SCREAMING_SNAKE。別の行として宣言する)を書く');
  if (previous === undefined) return undefined;
  if (!ENV_NAME.test(previous) || previous === id) {
    reporter.error(item.pointer('previous'), `設定 ${id} の previous ${previous} は別の環境変数名の形で書きます`, '更新の間だけ旧い値を入れる行の名前(例 CRON_SECRET_PREVIOUS)を書く', { id, previous });
    return null;
  }
  return previous;
}
