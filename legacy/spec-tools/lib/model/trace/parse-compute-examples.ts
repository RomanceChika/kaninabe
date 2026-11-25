/**
 * `computes[].examples`(例の表)と `computes[].shape`(純関数の呼び口の形)のパーサー。
 *
 * スキーマの正: action-spec-writing.md §computes の「例の表」。
 * 入口は parse-action-plan.ts で、そこから呼ばれる下位のパーサーである(向きは入口 → ここ)。
 *
 * ここで見るのは **1 ファイルの中で閉じた形式**だけである —— 鍵と値の形(`note` / `given` / `expect`)・
 * 値が YAML の運べる値であること・`shape` の値域。事実の鍵が `reads` の範囲内か・入力の欄が実在するか・
 * `expect` の型が欄の型か・同じ例の重複は、仕様全体を引く **V18** が見る。
 */

import { COMPUTE_SHAPES } from './types-plan.js';
import type { ActionComputeExample, ComputeExampleValue, ComputeShape } from './types-plan.js';
import { asArray, asRecord, SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';

const SHAPE_SUGGESTION = `shape は ${COMPUTE_SHAPES.join(' / ')} のどちらか(省略は facts_input = (facts, input) の関数)`;

const EXAMPLES_SUGGESTION =
  'examples には "- note: 行の名前 / given: { facts: {…}, input: {…} } / expect: 値" の形で' +
  '入力 → 値の行を並べる(式は書かない。値だけを書く)';

/** 例の 1 行に書ける鍵。 */
const EXAMPLE_KEYS = ['note', 'given', 'expect'] as const;

/** `given` に書ける鍵。 */
const GIVEN_KEYS = ['facts', 'input'] as const;

/** 素のマッピングか(YAML の日付など、値としての意味を持つオブジェクトは運ばない)。 */
function isPlainRecord(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const prototype: unknown = Object.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null;
}

/** 例の値として運べる形か(YAML のスカラー・配列・マッピング)を調べて、型のついた値にする。読めなければ null。 */
function toValue(raw: unknown): { readonly value: ComputeExampleValue } | null {
  if (raw === null || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return { value: raw };
  const list = asArray(raw);
  if (list !== null) {
    const items: ComputeExampleValue[] = [];
    for (const item of list) {
      const converted = toValue(item);
      if (converted === null) return null;
      items.push(converted.value);
    }
    return { value: items };
  }
  const record = isPlainRecord(raw) ? asRecord(raw) : null;
  if (record === null) return null;
  const entries: Record<string, ComputeExampleValue> = {};
  for (const [key, item] of Object.entries(record)) {
    const converted = toValue(item);
    if (converted === null) return null;
    entries[key] = converted.value;
  }
  return { value: entries };
}

/** `shape` を読む(省略は `facts_input`)。 */
export function parseComputeShape(element: YamlReader, reporter: SpecReporter, index: number): ComputeShape {
  const raw = element.optionalString('shape', SHAPE_SUGGESTION);
  if (raw === undefined) return 'facts_input';
  if ((COMPUTE_SHAPES as readonly string[]).includes(raw)) return raw as ComputeShape;
  reporter.error(`computes[${index}].shape`, `computes[${index}].shape "${raw}" は値域にありません`, SHAPE_SUGGESTION, {
    shape: raw,
  });
  return 'facts_input';
}

/** マッピングの値(`facts` / `input`)を読む。書かれていなければ空。 */
function recordOf(
  given: YamlReader,
  key: (typeof GIVEN_KEYS)[number],
  reporter: SpecReporter,
  pointer: string,
): Readonly<Record<string, ComputeExampleValue>> {
  const raw = given.raw(key);
  if (raw === undefined || raw === null) return {};
  const converted = isPlainRecord(raw) ? toValue(raw) : null;
  const record = converted === null ? null : asRecord(converted.value);
  if (converted === null || record === null) {
    reporter.error(`${pointer}.${key}`, `${pointer}.${key} がマッピング(値は数値・真偽・文字列・null・配列・マッピング)ではありません`, EXAMPLES_SUGGESTION);
    return {};
  }
  return converted.value as Readonly<Record<string, ComputeExampleValue>>;
}

/** 例の 1 行を読む。形が壊れていれば記録して null。 */
function parseExample(
  row: YamlReader,
  reporter: SpecReporter,
  base: string,
  location: ActionComputeExample['location'],
): ActionComputeExample | null {
  row.rejectUnknownKeys(EXAMPLE_KEYS, 'examples の要素', EXAMPLES_SUGGESTION);
  const note = row.requiredString('note', EXAMPLES_SUGGESTION);
  const givenRaw = isPlainRecord(row.raw('given')) ? asRecord(row.raw('given')) : null;
  if (givenRaw === null) {
    reporter.error(`${base}.given`, `${base}.given がありません(given は { facts, input } のマッピング)`, EXAMPLES_SUGGESTION);
    return null;
  }
  const given = new YamlReader(givenRaw, `${base}.given`, reporter);
  given.rejectUnknownKeys(GIVEN_KEYS, 'given', EXAMPLES_SUGGESTION);
  const facts = recordOf(given, 'facts', reporter, `${base}.given`);
  const input = recordOf(given, 'input', reporter, `${base}.given`);
  if (!row.has('expect')) {
    reporter.error(`${base}.expect`, `${base}.expect がありません(値が無いことを言うなら null と書く)`, EXAMPLES_SUGGESTION);
    return null;
  }
  const expected = toValue(row.raw('expect'));
  if (expected === null) {
    reporter.error(`${base}.expect`, `${base}.expect が値(数値・真偽・文字列・null・配列・マッピング)ではありません`, EXAMPLES_SUGGESTION);
    return null;
  }
  if (note === null) return null;
  return { note, facts, input, expect: expected.value, location };
}

/**
 * `computes[].examples`(例の表)を読む。省略可能。
 *
 * @param element computes の要素の読み取り器
 * @param reporter 違反の記録先
 * @param index computes の要素の添字
 */
export function parseComputeExamples(
  element: YamlReader,
  reporter: SpecReporter,
  index: number,
): readonly ActionComputeExample[] {
  const items = element.optionalList('examples', EXAMPLES_SUGGESTION);
  const result: ActionComputeExample[] = [];
  const base = `computes[${index}].examples`;
  eachRecord(items, base, reporter, EXAMPLES_SUGGESTION, (row, position) => {
    const example = parseExample(row, reporter, `${base}[${position}]`, reporter.location(`${base}[${position}]`));
    if (example !== null) result.push(example);
  });
  return result;
}
