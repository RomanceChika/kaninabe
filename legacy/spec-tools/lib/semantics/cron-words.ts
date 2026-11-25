/**
 * cron 式を、人が読む時刻の言い方にする(頻度と、日本時間での時刻)。
 *
 * ジョブの章は「いつ起きるか」を人が判定する公理として出すので、cron 式そのものだけでなく、読める形を添える。
 * 読めるのは**よくある 3 つの形**だけで、ほかの形は `null`(推測で言い換えない。呼ぶ側は cron 式だけを出す)。
 * **cron 式の時刻は UTC** という前提を置く(DB 内のスケジューラ(例: Postgres の拡張)と、主要なホストの Cron に共通の前提で、特定の後段の語ではない。
 * 時計の鳴る場所が別の時刻帯で動く後段を足す日は、この前提を後段の宣言にする)。時刻は +9 時間で日本時間にする
 * (`docs/rules/process/backend/system/standards/conventions/datetime.md` の「表示は Asia/Tokyo を明示する」)。
 *
 * 純粋関数だけ。例外は投げない。
 */

/** UTC から日本時間への差(時間)。 */
const JST_OFFSET_HOURS = 9;

/** 0 以上の整数の文字列か。 */
function isNumber(text: string | undefined): text is string {
  return text !== undefined && /^\d+$/.test(text);
}

/** 2 桁に揃える。 */
function two(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * cron 式(5 欄)の言い方。
 *
 * - 分の欄が間隔(スラッシュ + 数)で、ほかが `*` → 「n 分ごと」
 * - `m * * * *` → 「毎時 m 分」
 * - `m h * * *` → 「毎日 HH:MM(日本時間)」
 *
 * @param expression cron 式
 * @returns 言い方。読めない形・範囲外の値は null
 */
export function cronWords(expression: string): string | null {
  const fields = expression.trim().split(/\s+/);
  const [minute, hour, day, month, weekday] = fields;
  if (fields.length !== 5 || day !== '*' || month !== '*' || weekday !== '*') return null;
  const every = /^\*\/(\d+)$/.exec(minute ?? '');
  if (every !== null && hour === '*') {
    const step = Number(every[1]);
    return step >= 1 && step <= 59 ? `${step} 分ごと` : null;
  }
  if (!isNumber(minute) || Number(minute) > 59) return null;
  if (hour === '*') return `毎時 ${Number(minute)} 分`;
  if (!isNumber(hour) || Number(hour) > 23) return null;
  return `毎日 ${two((Number(hour) + JST_OFFSET_HOURS) % 24)}:${two(Number(minute))}(日本時間)`;
}
