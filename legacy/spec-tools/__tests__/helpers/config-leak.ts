/**
 * 設定の章に「設定の値」が出ていないかを見張る検出器(テスト用)。
 *
 * 設定の章が出してよいのは、名前・値の性質・要求度・挙動だけで、**値そのものは出さない**(秘密であり環境ごとに違う)。
 * 値が文に混ざる形は `NAME=値` だけではないので、**カタログの全 ID**の直後に `=` / `:` / `：` が来る形を広く拾う:
 *
 * - 名前が短い(`TZ=` / `CI=`)
 * - 名前と記号の間に空白がある(`SUPABASE_URL = https://…`)
 * - 名前がバッククォートや太字で囲まれている(`` `APP_NAME`=foo `` / `**APP_NAME**: foo`)
 * - 記号がコロン(`API_KEY: sk-…` / 全角の `：`)
 *
 * 名前を長い順に並べ、前後が名前の一部(英大文字・数字・`_`)になる場合は拾わない(`CRON_BASE_URL` の中の `URL` など)。
 */

/** 正規表現の特殊文字を無害にする。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 設定の名前の直後に値が続く形(`名前=` / `名前 : ` / `` `名前`= `` など)を、出てきた順にすべて返す。
 *
 * @param source 検査する文章(生成物の本文。数値の文字参照は戻してから見る)
 * @param names カタログの設定の名前(全 ID)
 * @returns 見つかった「名前と記号」の文字列。空なら漏れなし
 */
export function configValueLeaks(source: string, names: readonly string[]): string[] {
  if (names.length === 0) return [];
  // 生成器は Markdown の記号(`` ` `` `*` など)を数値の文字参照で書く。見張りは表示される字で見る(参照を戻してから)
  const text = source.replace(/&#(\d{1,6});/g, (_entity, code: string) => String.fromCodePoint(Number(code)));
  const alternatives = [...names].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`(?<![A-Z0-9_])(?:${alternatives.join('|')})(?![A-Z0-9_])[\`*"'\\s]*[=:：]`, 'g');
  return text.match(pattern) ?? [];
}
