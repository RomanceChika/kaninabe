/**
 * `SOURCE-FN:` が名指しした関数を、**いま生きている migration** へ解決する。
 *
 * migration は追記専用の歴史である(C23)。DB の関数を直すときは旧いファイルを書き換えず、
 * **新しい番号のファイル**に `create or replace function` を書く。したがって
 * 「`supabase/migrations/20260809000009_….sql` の sha256」を鮮度の根拠にすると、
 * **実装を直してもその旧ファイルは 1 バイトも動かない** —— モデルは黙って古いままになり、
 * 検査は緑のまま `violated` と言い続ける(独立レビューの止める 2 件目)。
 *
 * そこで写し元を**関数名**で宣言し、その関数を定義している**最新番号のファイル**を
 * ここが解決する。新しい migration が出た瞬間に解決先が変わり、sha256 が変わって赤くなる。
 *
 * 純粋関数であり throw しない(ディレクトリの読み取りは CLI の仕事)。
 */

/** 読み込んだ migration 1 本。 */
export interface MigrationFile {
  /** `supabase/migrations/` からのファイル名(番号が先頭に付く)。 */
  readonly name: string;
  /** 本文。 */
  readonly text: string;
}

/** 関数を定義する 1 文の形(`create function` / `create or replace function`、スキーマ修飾は任意)。 */
function definitionPattern(fn: string): RegExp {
  const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(?:[a-z_][a-z0-9_]*\\.)?${escaped}\\s*\\(`, 'i');
}

/**
 * その関数を定義している**最新番号の** migration のファイル名を返す。
 *
 * 「最新」はファイル名の昇順の最後である(採番は単調増加の連番。migrations.md §不変則)。
 *
 * @param files 読み込んだ migration の並び(順不同でよい)
 * @param fn 関数名(スキーマ修飾なし)
 * @returns ファイル名。定義している migration が 1 本も無ければ null
 */
export function latestDefinition(files: readonly MigrationFile[], fn: string): string | null {
  const pattern = definitionPattern(fn);
  const defining = files.filter((file) => pattern.test(file.text)).map((file) => file.name);
  if (defining.length === 0) return null;
  return [...defining].sort().at(-1) ?? null;
}

/**
 * 関数の定義が**いくつの migration に分かれているか**(解決の材料を人に見せるため)。
 *
 * 1 本しか無ければ「まだ 1 度も直されていない」、複数あれば「最新が生きている」。
 * どちらも正常であり、0 本のときだけが異常である。
 *
 * @param files 読み込んだ migration の並び
 * @param fn 関数名
 * @returns 定義しているファイル名の昇順の並び
 */
export function allDefinitions(files: readonly MigrationFile[], fn: string): readonly string[] {
  const pattern = definitionPattern(fn);
  return files
    .filter((file) => pattern.test(file.text))
    .map((file) => file.name)
    .sort();
}
