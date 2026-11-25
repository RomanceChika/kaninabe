/**
 * 画面の部品の表・詳細の**見出しの組み立て**の文言(併読の欄に役割を添える連結)。
 *
 * 表・詳細の既定の文言(`TABLE_WORDING`)は `messages-screen.ts` にあるが、**ここに分けてあるのは `messages.ts`(が束ねる `messages-screen.ts`)が約束事のモデルの
 * 写し元(C24)の閉包に入っているため**である(`messages.ts` を 1 文字足すとモデルの鮮度が動く。見出しの連結はモデルが
 * 写している実装と関係が無い)。文言の層に置く原則(`messages.ts` 冒頭)は同じで、ここも `lib/messages/` の 1 枚である。
 */

/** 併読の欄の見出しの組み立て。 */
export const HEADING_WORDING = {
  /** 役割を前に添える連結(`対応者` + `の` + `表示名`)。 */
  roleOf: (): string => 'の',
} as const;
