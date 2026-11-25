/**
 * 表示のための日時整形（**唯一の口**）。
 *
 * クエリは `timestamptz` を ISO 文字列のまま返す（`query_spec` の projection）。それを人が
 * 読む形にするとき、**どのタイムゾーンで見せるかを実行環境に決めさせない**。手書きの
 * `getFullYear()` 系は実行環境の TZ で動くため、同じ画面の中で「開演日時」（この口を通ったもの）と
 * 告知文（手書きだったもの）が 9 時間食い違う実害が出ていた（Vercel は UTC・ローカルは JST）。
 *
 * この口は `domain` に置く。告知文の整形（`clipboard/formatters.ts`）も画面（`app/_lib/format.ts`）も
 * ここを通すが、**画面の層をドメインが参照することはできない**ので、共通の下層に置く以外にない。
 *
 * **基準タイムゾーンは呼び出し側が引数で渡す。** `domain` は `process.env` を読めない
 * （ARCH-BE-0001）ので、ここに決め打ちの値は置かない。宣言は設定カタログ
 * （docs/specs/backend/config.md）の `DISPLAY_TIMEZONE`（必須の設定として宣言されている）で、
 * 読む口は `@/composition/config`（Composition Root）の `displayTimeZone()` の 1 か所に集める。
 */

/**
 * ISO 8601 の日時文字列を、指定したタイムゾーンで整形する。
 *
 * @param iso - クエリが返した日時文字列
 * @param timeZone - 表示の基準タイムゾーン（IANA 名。呼び出し側が解決して渡す）
 * @param options - `Intl.DateTimeFormat` のオプション（`timeZone` はこの口が固定する）
 * @returns 表示文字列
 */
function formatIn(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString('ja-JP', { ...options, timeZone });
}

/**
 * 画面の一覧・詳細に出す日時（`2026/04/01 10:00`）。
 *
 * @param iso - クエリが返した日時文字列
 * @param timeZone - 表示の基準タイムゾーン（IANA 名）
 * @returns 表示文字列
 */
export function formatDateTime(iso: string, timeZone: string): string {
  return formatIn(iso, timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 告知文に貼る日時（`2026/04/01 10:00`）。
 *
 * 画面の表示と**同じ口を通す**ことがこの関数の存在理由である。別に整形すると、
 * 同じ催しの同じ時刻が画面と告知文で食い違う（実際に起きていた）。
 *
 * @param iso - クエリが返した日時文字列
 * @param timeZone - 表示の基準タイムゾーン（IANA 名。画面と同じ値を渡す）
 * @returns 告知に貼る文字列
 */
export function formatAnnouncementDateTime(iso: string, timeZone: string): string {
  return formatDateTime(iso, timeZone);
}
