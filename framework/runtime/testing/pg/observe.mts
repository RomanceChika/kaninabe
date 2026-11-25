import type { Json } from '@kaninabe/runtime/ports';
import type { Sent } from '../contract/types.mjs';

/**
 * pg の参照 adapter が流した文(`pg/encode.mts` が組んだもの)から、**DB に届いた名前付き引数**を読み戻す。
 *
 * 契約テストの 3 値の群は「どの adapter でも DB に届く名前付き引数が同じ」ことを固定する。PostgREST では
 * 通信路(`fetch`)の本文がそのまま名前付き引数だが、pg では `名前 => $n::型` とパラメータに分かれて出る。
 * ここは**組んだ側の書式を知っている**読み手で、`encode.mts` と対になる(書式を変えたらこちらも変える)。
 *
 * jsonb の引数は `JSON.stringify` した文字列で渡っているので、JSON に戻す。NULL は `null`・
 * 配列型の引数は JS の配列のまま。
 */

/** `名前 => $n::型` の 1 つ(型は `,` か `)` まで)。 */
const NAMED_PARAM = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=>\s*\$(\d+)::([^,)]+)/gu;

/** `スキーマ.関数名(` の関数名。 */
const FUNCTION_NAME = /\b[A-Za-z_][A-Za-z0-9_]*\.([A-Za-z_][A-Za-z0-9_]*)\(/u;

/**
 * 流した文を、通信路に出た要求として読む。
 *
 * @param text - 流した SQL
 * @param values - パラメータの値
 * @returns 呼んだ RPC と名前付き引数。RPC の呼び出しの文でなければ `null`(事実の読み取りなど)
 */
export function sentOfQuery(text: string, values: readonly unknown[]): Sent | null {
  const rpc = FUNCTION_NAME.exec(text)?.[1];
  if (rpc === undefined) return null;
  const args: Record<string, Json> = {};
  for (const match of text.matchAll(NAMED_PARAM)) {
    const [, name, index, type] = match;
    if (name === undefined || index === undefined || type === undefined) continue;
    const value = values[Number(index) - 1];
    args[name] = (type.trim() === 'jsonb' && typeof value === 'string' ? (JSON.parse(value) as Json) : value) as Json;
  }
  return { rpc, args };
}
