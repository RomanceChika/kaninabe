/**
 * `bearer`(持っていれば効く値)の共通語(kernel 層 — 全層が読む)。
 *
 * 持っているだけで権能(入会の手続きに進める・戻せる・開ける)が手に入る値は、推測されてはならない。ASVS V11.5.1 は
 * 128 ビット以上の CSPRNG の乱数を求め、UUID を名指しで不可とする(v4 の乱数部は 122 ビットで、残りは固定の印)。
 * 生成する値は **32 バイトの CSPRNG をそのまま base64url にした 43 字**(256 ビット)で、DB の列の既定値がサーバー側で作る。
 * 式の綴りはここが唯一の定義で、data_table の `defaults` は(空白を詰めて)この綴りと一致しなければならない(R16 が見る)。
 */

/** 値に使う CSPRNG のバイト数(32 バイト = 256 ビット。ASVS の下限 128 ビットを十分に超える)。 */
export const BEARER_BYTES = 32;

/** 32 バイトを base64url(パディングなし)にした長さ。`bearer` の欄の `max_length` はこれ以上でなければならない。 */
export const BEARER_LENGTH = 43;

/**
 * 列の既定値の式(`pg_get_expr` の出力の綴り。data_table の `defaults` の突合と同じ流儀で、空白を詰めた文字列で比べる)。
 * `gen_random_bytes` は pgcrypto(拡張。Supabase は `extensions` スキーマ)の CSPRNG。`translate` は `+/` を `-_` に替え、
 * 余りの `=` を落とす(第 3 引数が短いと、対応のない文字は削除される)。
 */
export const BEARER_DEFAULT_SQL = "translate(encode(gen_random_bytes(32), 'base64'::text), '+/='::text, '-_'::text)";

/** 空白をすべて詰めた綴り(式の比較に使う)。 */
function squeeze(text: string): string {
  return text.replace(/\s+/gu, '');
}

/**
 * 列の既定値の式が、`bearer` の欄に要る CSPRNG の式(`BEARER_DEFAULT_SQL`)か。
 *
 * @param expression data_table の `defaults` に書かれた式
 * @returns 空白を詰めて一致すれば true
 */
export function isBearerDefault(expression: string): boolean {
  return squeeze(expression) === squeeze(BEARER_DEFAULT_SQL);
}

/** `bearer` の宣言のうち、失効と使用回数を宣言する側の欄の名前(YAML のキー)。 */
export const BEARER_EXPIRY_KEYS = ['expires_at', 'used_at'] as const;

/** `bearer` の宣言に書けるキー(失効と使い切りを欄で宣言するか、使い回しを理由つきで受け入れるか)。 */
export const BEARER_KEYS = [...BEARER_EXPIRY_KEYS, 'reusable'] as const;
