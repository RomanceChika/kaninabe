/**
 * 保存点から導く**置き場のキー**(保存点 ID・1 画面フォームのファイル名)の唯一の置き場。
 *
 * 生成器(`generate/render/usecase-app-names.ts`)と、置き場の取り合いを見る検査(`trace/placement-claims.ts`)が、同じキーを組み立てる。
 * 綴りの正が 2 つになると、生成した置き場と検査が数える置き場がすれ違う。名前は 2 語(ユースケース名・保存点 ID)から決まり、
 * アプリの語彙は 1 つも無い。
 */

/**
 * 保存点 ID(置き場の配置のキー。`{ユースケース名}.{保存点 ID}`)。
 *
 * @param usecaseName ユースケース名
 * @param saveId 保存点 ID
 * @returns 保存点 ID
 */
export function saveIdFor(usecaseName: string, saveId: string): string {
  return `${usecaseName}.${saveId}`;
}

/**
 * 1 画面フォームのファイル名(置き場の配置のキー。`{ユースケース名}.{保存点 ID}-form.tsx`)。
 *
 * @param usecaseName ユースケース名
 * @param saveId 保存点 ID
 * @returns ファイル名
 */
export function formFileNameFor(usecaseName: string, saveId: string): string {
  return `${saveIdFor(usecaseName, saveId)}-form.tsx`;
}
