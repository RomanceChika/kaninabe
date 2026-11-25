/**
 * ハンドブックだけを出す入口(`cli/generate-book.ts`)が**値として読んでよい後段のファイル**の名指しと、その名指しが選択と食い違わないことの検査。
 *
 * この入口の実行時の閉包は、後段の登録の契約(`lib/target-api/**`)も後段の生成器・検査(`lib/targets/<後段>/**`)も持たない
 * (`lib-layers.ts` の `CLOSURE_BANS`)。入ってよいのは「設定の値」と「置き場の配置の値」を持つ 2 ファイルだけで、禁止の例外としてここで名指しする。
 * **名指しはデータで、選択(`cli/default-targets.ts` の `DEFAULT_TARGET_NAMES` = どの名前の後段を選ぶか)とは別の場所にある** ——
 * 選択を別の後段へ替えたのに名指しを直し忘れると、入口は選んだ後段の値を読めず(禁止に当たる)、直し忘れた側は選ばれていない後段のファイルを通し続ける。
 * そこで「名指しのファイル」と「選択から導いたファイル」の食い違いを、`targetSpellingProblems`(綴りの表と置き場の食い違い)と同じ形で赤にする。
 */

/** 役割ごとの、値を持つファイルの名前(後段の置き場の直下。プラットフォーム = 設定の値・アプリの枠 = 置き場の配置の値)。 */
export const BOOK_ENTRY_VALUE_FILES = { platform: 'platform-profile.ts', app_frame: 'layout.ts' } as const;

/** ハンドブックの入口が値として読んでよい後段のファイル(`lib/` 始まり)。選択(`DEFAULT_TARGET_NAMES`)と食い違えば `bookEntryTargetFileProblems` が赤にする。 */
export const BOOK_ENTRY_TARGET_FILES: readonly string[] = ['lib/targets/supabase/platform-profile.ts', 'lib/targets/nextjs/layout.ts'];

/** 正規表現の特殊文字をエスケープする。 */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ハンドブックの入口の閉包に入ってはいけない後段のファイルの正規表現(契約と、名指しのファイル以外の後段の置き場の全部)。
 *
 * @param allowed 値として読んでよい後段のファイル(`BOOK_ENTRY_TARGET_FILES`)
 * @returns 禁止の対象に当てる正規表現
 */
export function bookEntryBannedPattern(allowed: readonly string[]): RegExp {
  const exemptions = allowed.map((file) => escaped(file.replace(/^lib\/targets\//, ''))).join('|');
  return new RegExp(`^lib/(target-api/|targets/(?!(?:${exemptions})$))`);
}

/**
 * 名指しのファイルと、選択から導いたファイルの食い違い。
 *
 * @param allowed 名指しのファイル(既定は `BOOK_ENTRY_TARGET_FILES`)
 * @param names 選択した後段の名前(`cli/default-targets.ts` の `DEFAULT_TARGET_NAMES` のうち、値を持つ 2 つの役割)
 * @param exists ファイルが実在するか(`lib/` 始まりの相対パス)
 * @returns 食い違いの説明(無ければ空)
 */
export function bookEntryTargetFileProblems(
  allowed: readonly string[],
  names: Readonly<Record<keyof typeof BOOK_ENTRY_VALUE_FILES, string>>,
  exists: (file: string) => boolean,
): readonly string[] {
  const problems: string[] = [];
  const derived = (Object.keys(BOOK_ENTRY_VALUE_FILES) as (keyof typeof BOOK_ENTRY_VALUE_FILES)[]).map(
    (role) => ({ role, file: `lib/targets/${names[role]}/${BOOK_ENTRY_VALUE_FILES[role]}` }),
  );
  for (const { role, file } of derived) {
    if (!allowed.includes(file)) problems.push(`選択(${role} = ${names[role]})の値のファイル ${file} が、ハンドブックの入口の名指し(BOOK_ENTRY_TARGET_FILES)にありません`);
    if (!exists(file)) problems.push(`選択(${role} = ${names[role]})の値のファイル ${file} が実在しません`);
  }
  for (const file of allowed) {
    if (!derived.some((entry) => entry.file === file)) problems.push(`ハンドブックの入口の名指し ${file} が、選択(default-targets.ts の DEFAULT_TARGET_NAMES)が指すどの値のファイルとも一致しません`);
  }
  return problems;
}
