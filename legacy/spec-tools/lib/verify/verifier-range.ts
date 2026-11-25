/**
 * 実行ログに出す「どの検査器を実行したか」の範囲表記を、**登録配列から**組み立てる。
 *
 * **なぜ手書きの範囲表記をやめるのか。** 実行ログは `Y1〜Y11` / `S1〜S15` と手書きされて
 * いたが、実際には `y12-save-renderable` / `s16-usecase-exposure` まで登録済みだった
 * (検査の漏れ探し 2026-09-12 §2)。検査器を足したときにログの文字列を直し忘れても誰も咎めない
 * ——「どこまで見たか」を示す文字列が、見た範囲と突き合わされていなかったのである。
 * 登録配列から導けば、足した瞬間にログが追随し、範囲表記が腐らない。
 *
 * 表記は連番を畳む(`Y1〜Y12`)。抜けがあれば区間に割る(`A1〜A8・A10〜A15`)。
 * 番号を持たない ID(将来の拡張)はそのまま並べる。
 */

/** 区間の区切り(範囲)と、区間どうしの区切り(並置)。 */
const RANGE = '〜';
const JOIN = '・';

/** ID を「接頭辞 + 番号」に割る(番号が無ければ null)。 */
function split(id: string): { readonly prefix: string; readonly number: number } | null {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(id);
  const prefix = match?.[1];
  const digits = match?.[2];
  if (prefix === undefined || digits === undefined) return null;
  return { prefix, number: Number(digits) };
}

/** 同じ接頭辞の連番 1 区間を表記にする。 */
function segment(prefix: string, from: number, to: number): string {
  return from === to ? `${prefix}${from}` : `${prefix}${from}${RANGE}${prefix}${to}`;
}

/**
 * 検査器 ID の並びを範囲表記にする。
 *
 * 入力の順序は問わない(接頭辞ごとに初出の順で並べ、番号の昇順に畳む)。
 *
 * @param ids 実行した検査器の ID(登録配列の `id` をそのまま渡す)
 * @returns `A1〜A8・A10〜A15・V14` のような表記(空なら空文字)
 */
export function verifierRange(ids: readonly string[]): string {
  const byPrefix = new Map<string, number[]>();
  const bare: string[] = [];
  for (const id of ids) {
    const parsed = split(id);
    if (parsed === null) {
      if (!bare.includes(id)) bare.push(id);
      continue;
    }
    const numbers = byPrefix.get(parsed.prefix) ?? [];
    if (!numbers.includes(parsed.number)) numbers.push(parsed.number);
    byPrefix.set(parsed.prefix, numbers);
  }

  const parts: string[] = [];
  for (const [prefix, numbers] of byPrefix) {
    const sorted = [...numbers].sort((a, b) => a - b);
    let from = sorted[0];
    if (from === undefined) continue;
    let previous = from;
    for (const current of sorted.slice(1)) {
      if (current === previous + 1) {
        previous = current;
        continue;
      }
      parts.push(segment(prefix, from, previous));
      from = current;
      previous = current;
    }
    parts.push(segment(prefix, from, previous));
  }
  return [...parts, ...bare].join(JOIN);
}
