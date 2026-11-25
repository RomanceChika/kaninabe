/**
 * 生成物として書き出される migration のファイル名を、仕様が宣言する欄の読み取り(`ddl_migration` ほか)。
 *
 * 名前は 14 桁の連番 + `_` + 小文字・数字・`_` + `.sql` に絞る。`../` や絶対パスを書き先にさせない
 * (書き込みの関所〔`lib/generate/write-gate.ts`〕が書き先の木も見るが、綴りそのものを読み込みで落とす二重の守り)。
 * 形が違う宣言はモデルに載せず、違反として記録する(落とした宣言として数える)。
 */

import type { SpecReporter } from './parse-common.js';
import type { YamlReader } from './yaml-reader.js';

/** 生成物の migration のファイル名の綴り。 */
export const MIGRATION_FILE_NAME = /^\d{14}_[a-z0-9_]+\.sql$/;

/** 報告に出す値(制御文字を `?` にして、報告の行を壊さない)。 */
function printable(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '?').slice(0, 80);
}

function accept(reader: YamlReader, reporter: SpecReporter, key: string, value: string, suggestion: string): string | undefined {
  if (MIGRATION_FILE_NAME.test(value)) return value;
  reporter.error(
    reader.pointer(key),
    `${key} が migration のファイル名の形ではありません`,
    `${suggestion}(14 桁の連番 + _ + 小文字・数字・_ + .sql。ディレクトリや .. は書けない)`,
    { value: printable(value) },
  );
  reporter.dropRows();
  return undefined;
}

/**
 * 任意の migration のファイル名を取り出す。形が違えば違反として記録し、undefined を返す。
 *
 * @param reader 欄を持つマッピングの読み取り器
 * @param reporter 違反の記録先
 * @param key 欄の名前
 * @param suggestion どう直すか
 */
export function optionalMigrationFile(reader: YamlReader, reporter: SpecReporter, key: string, suggestion: string): string | undefined {
  const value = reader.optionalString(key, suggestion);
  return value === undefined ? undefined : accept(reader, reporter, key, value, suggestion);
}

/**
 * 必須の migration のファイル名を取り出す。欠落・型不正・形の不正は null。
 *
 * @param reader 欄を持つマッピングの読み取り器
 * @param reporter 違反の記録先
 * @param key 欄の名前
 * @param suggestion どう直すか
 */
export function requiredMigrationFile(reader: YamlReader, reporter: SpecReporter, key: string, suggestion: string): string | null {
  const value = reader.requiredString(key, suggestion);
  return value === null ? null : (accept(reader, reporter, key, value, suggestion) ?? null);
}
