/**
 * 結果表の元データを書き出す**JSON の整形**(束 ⑳-5b)。
 *
 * 素の `JSON.stringify(値, null, 2)` は配列の要素を 1 つずつ改行する。組み合わせ 1 つ = 1 行の
 * タプルを何千も持つ元データでは、それだけで数十万行になり**差分がレビューできない**。
 * ここの規則は 1 つだけである: **鍵を持つものを含まず、入れ子が 1 段までの配列は 1 行に収める**
 * (組み合わせ 1 つのタプルと、その中の軸の値の並びがそれに当たる)。入れ子を 1 段に限るのは、
 * タプルの並びそのものまで 1 行に潰れてしまわないようにするためである —— 行ごとに改行が入って
 * いれば、差分は「どの組み合わせの結末が変わったか」で読める。残りは 2 空白の字下げで、鍵の
 * 並びは呼び側が決めた順のままにする。
 *
 * 純関数であり throw しない。
 */

/** 字下げの 1 段。 */
const PAD = '  ';

/**
 * 生成物の JSON(末尾に改行を 1 つ置く)。
 *
 * @param value 書き出す値
 * @returns JSON の字面
 */
export function asCompactJson(value: unknown): string {
  return `${render(value, '')}\n`;
}

/** 値 1 つの字面。 */
function render(value: unknown, pad: string): string {
  if (Array.isArray(value)) return renderArray(value, pad);
  if (value !== null && typeof value === 'object') return renderObject(value as Record<string, unknown>, pad);
  return JSON.stringify(value ?? null);
}

/** 配列の字面(鍵を持つものを含まず、入れ子が 1 段までなら 1 行)。 */
function renderArray(values: readonly unknown[], pad: string): string {
  if (values.length === 0) return '[]';
  if (flat(values, 1)) return `[${values.map((value) => render(value, pad)).join(', ')}]`;
  const inner = `${pad}${PAD}`;
  return `[\n${values.map((value) => `${inner}${render(value, inner)}`).join(',\n')}\n${pad}]`;
}

/**
 * その配列を 1 行に収めてよいか。
 *
 * @param values 配列の中身
 * @param depth まだ許す入れ子の段数(0 = 中身は全部が素の値)
 * @returns 1 行に収めてよいか
 */
function flat(values: readonly unknown[], depth: number): boolean {
  return values.every((value) => {
    if (Array.isArray(value)) return depth > 0 && flat(value, depth - 1);
    return value === null || typeof value !== 'object';
  });
}

/** オブジェクトの字面(鍵の並びは呼び側が決めた順のまま)。 */
function renderObject(value: Readonly<Record<string, unknown>>, pad: string): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const inner = `${pad}${PAD}`;
  const lines = entries.map(([key, found]) => `${inner}${JSON.stringify(key)}: ${render(found, inner)}`);
  return `{\n${lines.join(',\n')}\n${pad}}`;
}
