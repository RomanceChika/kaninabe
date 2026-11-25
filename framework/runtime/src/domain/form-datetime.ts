/**
 * 日時の入力欄（`<input type="datetime-local">`）とスキーマの表記のあいだの写し。
 *
 * `form.ts`（フォームとスキーマの口）とは別に、**日時の変換規則だけ**をここに置く。
 *
 * **ここは口の内側の部品であり、外から呼ぶものではない。** `form.ts` はこの 2 つを再輸出せず
 * （`form.ts` の再輸出の節）、画面が使う口は `parse` / `parseField` / `toInputValue` の 3 つだけ
 * である。画面がここを直に呼べると「画面が変換する」経路が復活し、**変換規則の置き場は口 1 つ**
 * という約束がその時点で崩れる（`form-changes.ts` は呼び出し側が使う判定なので扱いが違う）。
 * いまの歯止めはこの注意書きだけで、機械執行は無い（NOTES のバックログ）。
 *
 * ## なぜ変換が要るか
 *
 * `entity_spec` の `timestamp` は**オフセット付き ISO 8601**（`z.iso.datetime({ offset: true })`）
 * として生成される。一方 HTML の `datetime-local` が返す値は `YYYY-MM-DDTHH:mm` で、
 * **タイムゾーンを持たない**。この差を埋めないと、利用者は ISO 文字列を手で打つしかない。
 *
 * ## タイムゾーンの決め（フレームワークの規約）
 *
 * **入力欄の値は「実行環境のローカルタイムゾーンの壁時計」として解釈し、UTC の ISO 8601 に
 * 正規化して渡す。表示はその逆にローカルへ戻す。** この口が動くのはフォームのある場所
 * （＝ブラウザ）なので、利用者が画面で見ている時刻と入力した時刻が一致する。
 *
 * **特定の地域のタイムゾーンを実装に書かない。** 「このアプリは日本時間」はアプリの都合であり、
 * フレームワークが持てる根拠ではない。地域を固定する必要が出たら、それは仕様（`entity_spec`）に
 * 現れるべき宣言であって、変換規則の側で決めることではない。
 *
 * ## 精度（分）
 *
 * `datetime-local` の既定の粒度は分である（`step` を指定しない限り秒の欄は出ない）。したがって
 * **表示は分に丸める**。秒以下を持つ値を編集フォームに載せると、送り返した時点で秒が落ちる
 * ——これは「丸めたことにする」のではなく、**分精度の入力欄で編集した結果そのもの**である。
 * 秒を保ちたいフィールドが現れたら、それは `entity_spec` 側で精度を宣言する話になる。
 */

/**
 * `datetime-local` が返す値の形（タイムゾーンを持たない日時）。
 *
 * 秒・ミリ秒は `step` 次第で付くことがあるので任意にしてある。**末尾に `Z` や `+09:00` が
 * 付いていればここには一致しない** — その値はすでに瞬間を名指しているので、ローカル時刻として
 * 読み直してはならない。
 */
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

/** `YYYY-MM-DDTHH:mm` の長さ（この口が扱う分精度の表記そのもの）。 */
const MINUTE_PRECISION_LENGTH = 16;

/**
 * 2 桁の 0 埋め（月・日・時・分）。
 *
 * @param value - 埋める数値
 * @returns 2 桁の文字列
 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 入力欄の値を、スキーマが期待する ISO 8601（UTC）に正規化する。
 *
 * タイムゾーンを持たない値だけを**ローカル時刻として**解釈する（`new Date('2026-04-01T10:00')`
 * は ECMAScript の規定でローカル時刻になる）。それ以外はそのまま返す。
 *   - すでにオフセットを持つ値（`…+09:00` / `…Z`）… 瞬間が確定しているので触らない
 *   - 日時として読めない値 … 変換せずに渡し、**zod に落とさせる**（ここで独自のエラーを作らない）
 *
 * **「読めない」の判定に `Number.isNaN` だけでは足りない。** `new Date('2026-02-30T10:00')` は
 * V8 では NaN にならず**3 月 2 日に繰り上がる**ので、存在しない日付が「有効な別の日時」に
 * 化けて保存される（利用者から見れば黙って書き換えられている）。そこで変換した結果を
 * **入力欄の表記に戻して照合**し、書いたものと違う日時になっていれば変換しない。
 * 照合の粒度は入力欄と同じ分までである（秒はこの写しに現れない）。
 *
 * この照合は夏時間の**存在しない壁時計**（春の 1 時間の飛び）も同じ扱いにする —— 繰り上がりと
 * 見分けが付かないし、どちらも「書いたとおりの瞬間が無い」ことに変わりはない。1 時間ずらして
 * 黙って通すより、zod に落とさせて入力し直させるほうが正しい。
 *
 * @param value - 入力欄の文字列
 * @returns ISO 8601（UTC）に正規化した文字列。正規化の対象でなければ元の文字列
 */
export function toIsoFromInput(value: string): string {
  if (!LOCAL_DATETIME.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const iso = parsed.toISOString();
  // 分までの表記に戻して、書かれたものと同じ日時を指しているかを確かめる。
  return toInputFromIso(iso) === value.slice(0, MINUTE_PRECISION_LENGTH) ? iso : value;
}

/**
 * スキーマの表記（ISO 8601）を、入力欄に載る文字列に写す。
 *
 * ローカルタイムゾーンの壁時計に直し、`datetime-local` の粒度（分）で切る。
 * 日時として読めない値は**空文字（未入力）**にする — 入力欄に載せられない値を無理に載せると、
 * ブラウザが黙って捨てて「表示は空なのに送信すると元の値が戻る」という状態になる。
 * 空で出れば、そのまま送っても必須違反として目に見える形で落ちる。
 *
 * @param value - スキーマの形の日時（ISO 8601）
 * @returns `YYYY-MM-DDTHH:mm`。読めなければ空文字
 */
export function toInputFromIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const date = `${String(parsed.getFullYear()).padStart(4, '0')}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  return `${date}T${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
}
