/**
 * 新しい形の章の「できること」「見える範囲」の表の行の束ね(`html/spec-chapter.ts` が使う)。
 */

/**
 * 誰が以外が同じ規則を 1 行にまとめる(同じ内容の規則を役ごとに別々に宣言する書き方が多く、そのままだと同じ行が並ぶ)。
 * 同じかどうかは表示の文字列ではなく、呼び出し側が渡す**仕様の値の鍵**で決める(表示名が同じ別の欄・別の遷移を
 * 合わせないため。外部レビュー の Q2)。並びは最初に現れた順(入力の宣言順)。
 */
export function mergedRows(
  rows: readonly { readonly key: string; readonly by: readonly string[]; readonly rest: readonly string[] }[],
): { by: string[]; rest: readonly string[] }[] {
  const merged = new Map<string, { by: string[]; rest: readonly string[] }>();
  for (const row of rows) {
    const found = merged.get(row.key);
    if (found === undefined) merged.set(row.key, { by: [...row.by], rest: row.rest });
    else for (const role of row.by) if (!found.by.includes(role)) found.by.push(role);
  }
  return [...merged.values()];
}

