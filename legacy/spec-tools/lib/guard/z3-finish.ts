/**
 * CLI が出力を済ませた後に Z3 の worker を畳むときの、終了コードの決め方。
 *
 * 後始末(`shutdownZ3`)が失敗しても、**検証・生成の出力はすでに出ている**ので、「検証が赤」と「後始末が赤」を見分けられる
 * ようにする: 失敗は 1 行の文面にして標準エラーへ出し、終了コードを 1 にする(元が 1 ならそのまま)。スタックだけで落ちない。
 */

/**
 * 後始末を実行し、最終の終了コードを返す(reject しない)。
 *
 * @param code 出力まで済ませた時点の終了コード
 * @param shutdown 後始末(`shutdownZ3`)
 * @param report 失敗の 1 行の出し先(標準エラー)
 * @param label 行頭の CLI 名(`verify` など)
 * @returns 後始末が成功すれば `code`、失敗すれば 1
 */
export async function exitCodeAfterShutdown(
  code: number,
  shutdown: () => Promise<void>,
  report: (line: string) => void,
  label: string,
): Promise<number> {
  try {
    await shutdown();
    return code;
  } catch (error) {
    report(`${label}: Z3 の後始末に失敗: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
