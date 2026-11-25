/**
 * サービスの認証に使う共有秘密の部品(読む関門・固定長要約の照合・更新の間の新旧両対応)。
 *
 * 仕様: 設定カタログの `strength: { min_length }`(長さの下限)と `previous`(更新の間だけ受ける旧い値)。
 *       docs/rules/process/backend/specification/standards/config-spec-writing.md
 * 見張り: 設定仕様検証の K6(宣言の欠けと、実装の読み口がこの関門を通っていること)。
 *
 * 3 つの口がある。
 *   - `readServiceSecret` — 設定の秘密を読む関門。**未設定・空・下限に満たない値は「設定されていない」と同じ**(`undefined`)にする。
 *     手で入れた推測されやすい短い値で口が開かないよう、既定を閉じる側に倒す(PRIN-0009。値は例外にも表示にも出さない)。
 *   - `constantTimeEquals` — 2 つの文字列を、**固定長の要約同士の比較で、食い違った位置で早く終わらずに**比べる。両辺を SHA-256(どちらも 32 バイト)にしてから
 *     `timingSafeEqual` で比べるので、長さの違いで例外にならず、比較は一致位置に依存しない。**入力の長さに時間が依存しないとは言わない**
 *     (要約の計算は入力の長さに比例する)。時間の実測による確認もしていない。
 *   - `matchesAnySecret` — 現在の秘密と更新前の秘密のどちらかに一致するか(ASVS V11.2.2。更新の間に新旧どちらで署名した相手も受ける)。
 *     **一致した時点で止めず、全部と比べる**(どちらの秘密に一致したかを時間に出さない)。
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** 長さを揃えて比べるための SHA-256(32 バイト)。 */
function digestOf(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * 2 つの文字列が等しいかを、固定長の要約同士の比較で、食い違った位置で早く終わらずに比べる(秘密の照合用)。
 * 入力の長さに依存しない時間であるとは主張しない(要約の計算は入力の長さに比例する)。
 *
 * @param first - 一方の文字列(UTF-8 として扱う)
 * @param second - もう一方の文字列
 * @returns 等しければ `true`
 */
export function constantTimeEquals(first: string, second: string): boolean {
  return timingSafeEqual(digestOf(first), digestOf(second));
}

/**
 * 設定の秘密を読む関門。
 *
 * 未設定・空・`minLength` 文字に満たない値は `undefined`(= 設定されていない。口は閉じる)を返す。
 * 例外にしないのは、短い値が入っていても**素通しにも停止にもせず**、未設定と同じ閉じた振る舞い(カタログの `absence`)にするため。
 * 値そのものは返す以外に出さない。
 *
 * @param name - 環境変数の名前(宣言と突き合わせるための印。判定には使わない)
 * @param raw - `process.env[name]` の値
 * @param minLength - カタログの `strength.min_length`
 * @returns 下限を満たす値。満たさなければ `undefined`
 * @throws `minLength` が正の整数でないとき(呼び出しの書き間違い)
 */
export function readServiceSecret(name: string, raw: string | undefined, minLength: number): string | undefined {
  if (!Number.isInteger(minLength) || minLength < 1) {
    throw new Error(`readServiceSecret('${name}', …) の minLength は正の整数で書いてください。`);
  }
  if (raw === undefined || raw === '' || raw.length < minLength) return undefined;
  return raw;
}

/**
 * 提示された値が、受け付ける秘密のどれかに一致するか。
 *
 * 更新の間は現在の秘密と更新前の秘密を並べて渡す(`[current, previous]`)。`undefined`(未設定・短すぎて関門が捨てた値)は数えない。
 * 受け付ける秘密が 1 つも無ければ `false`(口は閉じる)。
 *
 * @param presented - 相手が提示した値(未提示なら `null`)
 * @param secrets - 受け付ける秘密(関門 `readServiceSecret` を通した値)
 * @returns どれかに一致すれば `true`
 */
export function matchesAnySecret(presented: string | null, secrets: readonly (string | undefined)[]): boolean {
  if (presented === null) return false;
  let matched = false;
  for (const secret of secrets) {
    if (secret === undefined) continue;
    // 一致しても続ける(比べる回数が、どれに一致したかで変わらない)。
    if (constantTimeEquals(presented, secret)) matched = true;
  }
  return matched;
}
