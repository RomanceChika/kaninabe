/**
 * data_table の欄のうち、**生成される SQL にそのまま置かれるもの**の読み込み時の検査(文法は `lib/model/sql-fragment.ts`)。
 *
 * 違反した値はモデルに載せず、T0 の error と「落とした宣言」にする(生成は T0 の error で止まる)。
 * 識別子(名前・列)、SQL の式の断片(`where` / `rule` / `defaults`)、発火の節、導出の幅が対象。
 */

import type { SpecReporter } from './parse-common.js';
import type { YamlReader } from './yaml-reader.js';
import { patternProblem, firesProblem, identifierProblem, offsetProblem, qualifiedIdentifierProblem, sqlFragmentProblem, typeNameProblem } from './sql-fragment.js';

/** 値を検査して、違反なら記録して null を返す。 */
function accept(reporter: SpecReporter, pointer: string, what: string, value: string, problem: string | null, outlet = 'SQL'): string | null {
  if (problem === null) return value;
  reporter.error(pointer, `${what} が書ける形ではありません: ${problem}`, `${what} は生成される ${outlet} にそのまま置かれるので、文法に合う形で書く`, {
    value: value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '?').slice(0, 80),
  });
  reporter.dropRows();
  return null;
}

/** SQL の式の断片。 */
export function fragmentField(reader: YamlReader, reporter: SpecReporter, key: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return accept(reporter, reader.pointer(key), key, value, sqlFragmentProblem(value)) ?? undefined;
}

/**
 * 生成 TS にそのまま置かれる名前(型の名前・関数の名前・経路・モジュールのパス。文法は `lib/model/code-names.ts`。R17)。
 *
 * @param reader 読み取り器
 * @param reporter 違反の記録先
 * @param key 欄の名前
 * @param value 読んだ値(null は読めなかった)
 * @param problem 文法の判定
 * @returns 書いてよい値。違反なら記録して null
 */
export function codeNameField(
  reader: YamlReader,
  reporter: SpecReporter,
  key: string,
  value: string | null,
  problem: (value: string) => string | null,
): string | null {
  if (value === null) return null;
  return accept(reporter, reader.pointer(key), key, value, problem(value), 'TS');
}

/** 識別子(必須の欄。違反は null)。 */
export function identifierField(reader: YamlReader, reporter: SpecReporter, key: string, value: string | null): string | null {
  if (value === null) return null;
  return accept(reporter, reader.pointer(key), key, value, identifierProblem(value));
}

/** 識別子の並び(1 つでも違反があれば null)。 */
export function identifierListField(reader: YamlReader, reporter: SpecReporter, key: string, values: readonly string[] | null): readonly string[] | null {
  if (values === null) return null;
  const bad = values.find((value) => identifierProblem(value) !== null);
  if (bad === undefined) return values;
  accept(reporter, reader.pointer(key), key, bad, identifierProblem(bad));
  return null;
}

/** `スキーマ.名前` 形の参照先。 */
export function qualifiedField(reader: YamlReader, reporter: SpecReporter, key: string, value: string | null): string | null {
  if (value === null) return null;
  return accept(reporter, reader.pointer(key), key, value, qualifiedIdentifierProblem(value));
}

/** 発火の節。 */
export function firesField(reader: YamlReader, reporter: SpecReporter, key: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return accept(reporter, reader.pointer(key), key, value, firesProblem(value)) ?? undefined;
}

/** 導出の幅。 */
export function offsetField(reader: YamlReader, reporter: SpecReporter, key: string, value: string | null): string | null {
  if (value === null) return null;
  return accept(reporter, reader.pointer(key), key, value, offsetProblem(value));
}

/** `defaults`(列名 → SQL の式)。違反した項は落とす。 */
export function defaultsField(
  reader: YamlReader,
  reporter: SpecReporter,
  key: string,
  values: Readonly<Record<string, string>>,
  sequences: ReadonlySet<string>,
): Readonly<Record<string, string>> {
  const kept: Record<string, string> = {};
  for (const [column, expression] of Object.entries(values)) {
    const pointer = `${reader.pointer(key)}.${column}`;
    const name = accept(reporter, pointer, `${key} の列名`, column, identifierProblem(column));
    const value = accept(reporter, pointer, key, expression, sqlFragmentProblem(expression, sequences));
    if (name !== null && value !== null) kept[column] = expression;
  }
  return kept;
}

/** 引数の型名の並び(1 つでも違反があれば null)。 */
export function typeNameListField(reader: YamlReader, reporter: SpecReporter, key: string, values: readonly string[] | null): readonly string[] | null {
  if (values === null) return null;
  const bad = values.find((value) => typeNameProblem(value) !== null);
  if (bad === undefined) return values;
  accept(reporter, reader.pointer(key), key, bad, typeNameProblem(bad));
  return null;
}

/** 正規表現(`pattern`)。 */
export function patternField(reader: YamlReader, reporter: SpecReporter, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return accept(reporter, reader.pointer('pattern'), 'pattern', value, patternProblem(value)) ?? undefined;
}
