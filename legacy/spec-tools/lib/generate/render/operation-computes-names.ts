/**
 * `computes`(実行時に純関数が決める値)の**純関数の置き場と名前**(束 ㉒)。
 *
 * hooks(`operation-hooks-names.ts`)と対になる宣言であり、どちらも「生成物ではないものの
 * 名前」を持つ。違いは層である —— hooks は入力を見て不変条件を判定する operation の仕事だが、
 * `computes` の関数は**読んだ事実と入力だけから値を出す純関数**なので domain に置く
 * (ARCH-BE-0001。DB も時刻も外界も見ない = 純関数であることが `computes` の条件そのもの)。
 *
 * 名前の規約は `ref` そのものである。仕様が名指しした 1 語がファイル名と主 export の両方に
 * なるので、綴りの正が仕様の外にもう 1 つできない(PRIN-0007)。
 * 純関数のモジュール指定子は置き場の配置の役割 `computes-module` が決める(`body-modules.ts` の `computes`)。ここが持つのは名前の全数だけ。
 */

/**
 * その計画が要求する純関数の名前(重複なし・名前順)。
 *
 * 母集合は**手順が宣言した `computes`** である —— 引数に現れたものだけを拾うと、引数を
 * 受け取らない RPC に宣言だけが残ったとき、配線が黙って消える。
 *
 * @param steps 計画の手順(`computes` は欄 → 純関数名)
 * @returns 純関数名の並び(重複なし・名前順)
 */
export function computeRefsOf(steps: readonly { readonly computes: Readonly<Record<string, string>> }[]): readonly string[] {
  const refs = new Set<string>();
  for (const step of steps) for (const ref of Object.values(step.computes)) refs.add(ref);
  return [...refs].sort((a, b) => a.localeCompare(b));
}
