/**
 * data_table の**掴みの宣言**の型(点検 19 回目 A19-1 / A19-3 / A19-4 / O19-2。`types.ts` が取り込む)。
 *
 * | 宣言 | 置き場 | 意味 |
 * |---|---|---|
 * | `locks: { {表}: share \| update }` | `triggers[]` | トリガが、発火させた行が直の外部キーで指す親の行を、その強さで掴む |
 * | `copies_from: [{ column, from, match }]` | `triggers[]` | トリガが供給する列の写し元(表・列)と、写し元の行の選び方(写し元の列 = 自表の列) |
 * | `advisory: ["{鍵の接頭辞}"]` | `triggers[]` | トリガの本文が取る advisory lock の鍵(`pg_advisory_xact_lock(hashtext('{接頭辞}' …))`) |
 * | `refuse_erased: { column, values, word, message, freezes_personal? }` | `foreign_keys[]` | 消去された行への新しい紐づけを断る(参照先の `column` が `values` なら拒否の語 `word`) |
 * | `refuse_erased.freezes_personal: { word, message }` | 同上 | 消去された行を**指したままの行**の個人列を凍らせる(参照先が消去済みなら、個人列の書き込みを拒否の語 `word` で断る。点検 20 回目 A20-1) |
 *
 * 生成器は `locks` と `copies_from` から定型 RPC の先掴みを決め(`rpc-closure-locks.ts`)、`refuse_erased` から紐づけの関所と
 * 個人列の凍結の関所を出す(`rpc-erased-refusal.ts`)。検査は `lock-order-parity`(掴みの強さ・写し元の先掴み・advisory の鍵)と
 * `erased-link-parity`(関所の有無と、掴んだ行と断る値の結びつき)が見る。
 */

/** 掴みの強さ(`for share` / `for update`)。 */
export type LockStrength = 'share' | 'update';

/** 強さの閉じた並び(弱い順)。 */
export const LOCK_STRENGTHS: readonly LockStrength[] = ['share', 'update'];

/** トリガが供給する列 1 つの写し元。 */
export interface TriggerCopySource {
  /** 供給する列(同じトリガの `supplies` にあること)。 */
  readonly column: string;
  /** 写し元の表(スキーマ修飾なし)。 */
  readonly fromTable: string;
  /** 写し元の列。 */
  readonly fromColumn: string;
  /** 写し元の行の選び方(写し元の列 → 自表の列。全部の等式の and)。 */
  readonly match: Readonly<Record<string, string>>;
}

/** 消去された行への新しい紐づけを断る宣言(外部キー 1 本)。 */
export interface RefuseErasedDecl {
  /** 参照先の表の、消去済みの印を持つ列。 */
  readonly column: string;
  /** 消去済みとみなす値。 */
  readonly values: readonly string[];
  /** 拒否の語(UC412 の detail。閉じた語)。 */
  readonly word: string;
  /** 拒否の語の画面の文言(人向け。`guard_unsatisfied` の `reason` がこの語のとき画面が出す)。 */
  readonly message: string;
  /**
   * 指したままの行の個人列の凍結(点検 20 回目 A20-1)。自表の entity が個人列を持つなら必須(T27)、持たなければ書けない。
   * 消去は紐づけを外さずに個人列を置き換えるので、消去済みを指す行に後から書いた実名は、以後消す道が無い。
   */
  readonly freezesPersonal?: FreezesPersonalDecl;
}

/** 消去済みを指したままの行の個人列を凍らせる宣言(拒否の語と画面の文言)。 */
export interface FreezesPersonalDecl {
  /** 拒否の語(UC412 の detail。閉じた語。紐づけの語と別の語にする)。 */
  readonly word: string;
  /** 拒否の語の画面の文言。 */
  readonly message: string;
}
