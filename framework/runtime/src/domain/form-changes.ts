import type { FormValues } from './form';

/**
 * 編集の入力について「何が変わったか」を数える判定。
 *
 * `form.ts`（フォームとスキーマの口）とは別に、**変更集合の判定だけ**をここに置く
 * （呼び出し側は `./form` から import してよい。同じものを再輸出している）。
 *
 * ここに置いてよいのは**入力の形**の判定だけであり、業務ルール（何が妥当か）は 1 つも書かない。
 */

/**
 * 編集の入力に「変更するフィールド」が 1 つでもあるか。
 *
 * 数えるのは**値が `undefined` でない鍵**である。`undefined` は「送られていない」の意味なので、
 * `{ id, title: undefined }` は「1 つも変更しない」と同じ扱いになる（鍵の有無だけを数えると、
 * 明示的に `undefined` を置いた入力が通ってしまう）。対象の識別子（`id`）は変更ではないので除く。
 *
 * ここは**入力の形**の判定であり、業務ルールではない。同じ規則を operation の定型
 * （`_template/update-fields.ts`）も持っており、境界と定型の二段で塞いである（境界を通らない
 * 呼び出し経路が将来増えても、空の更新が DB に届かない）。
 *
 * @param input - パース済みの編集入力（`id` + 更新するフィールド）
 * @returns 変更するフィールドが 1 つ以上あれば true
 */
export function hasAnyChange(input: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(input).some(([key, value]) => key !== 'id' && value !== undefined);
}

/**
 * 編集フォームで**実際に値が変わった**フィールドだけを返す。
 *
 * 単行 form の編集は部分更新（送られたフィールドだけを更新する）だが、フォームが並んでいる欄を
 * 毎回すべて送ると、**その部分更新が UI からは一度も起こらない**。監査ログの `payload` も
 * 「変更したフィールドの新しい値」ではなく「そのとき画面に出ていた全部」になり、履歴から
 * 「何を直したのか」が読めなくなる（server-actions.md §監査ログへの追記）。
 *
 * 比較するのは**入力欄の文字列そのもの**である。スキーマの形に直してから比べると、
 * 「空文字 → `null`」のような写し方の差で、触っていない欄が変更として現れうる。
 *
 * @param initial - いま表示している行から作った初期値（フィールド名 → 文字列）
 * @param current - 入力欄の現在値（同じ鍵を持つ）
 * @param fields - 並んでいるフィールド（`writes` から導いた集合。ここに無い欄は見ない）
 * @returns 初期値と違う値を持つフィールド（`fields` の順）
 */
export function changedFields<K extends string>(
  initial: FormValues<K>,
  current: FormValues<K>,
  fields: readonly K[],
): readonly K[] {
  return fields.filter((field) => current[field] !== initial[field]);
}
