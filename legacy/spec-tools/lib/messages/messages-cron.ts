/**
 * Cron 起動口の認可の見張りテスト(生成)に出る日本語の文言。
 *
 * 生成テストのテスト名は保証台帳(`config_absent_closes` の `test_cases[].implementation`)が名指す綴りで、
 * 生成物の文字列リテラルとして写る。**生成器に直接書かない** —— 別の言語のアプリを作るときに
 * 「何を訳せばよいか」が文言表 1 か所に揃うようにするためで、出力側の目(`generated-wording.ts`)が
 * 見る断片の全数(`message-fragments.ts` の `messageFragments`)にこの表の語が載る。
 * **値を何も import しない**(文言の層は葉)。
 */

/** 見張りテストの文言。 */
export const CRON_ROUTE_WORDING = {
  /** describe の見出し。 */
  suite: 'Cron 起動口の認可(生成)',
  /** 秘密が未設定の場面のテスト名(保証台帳の `test_cases` が名指す)。 */
  absent: 'CRON_SECRET が未設定なら、時刻起点のジョブの起動口はどれも 403 を返す',
  /** 秘密と違う Authorization(または無し)の場面のテスト名(保証台帳の `test_cases` が名指す)。 */
  mismatch: '秘密と違う Authorization(または無し)では、時刻起点のジョブの起動口はどれも 403 を返す',
  /** 起動口が例外で落ちたときの報告の前置き(あとに例外の理由が続く)。 */
  thrown: '例外: ',
} as const;

/**
 * この表が持つ固定の日本語の断片の全数。上の表に語を足すときは、ここにも足す
 * (足さなければ出力側の目が赤になる)。
 *
 * @returns 断片の全数
 */
export function cronRouteFragments(): readonly string[] {
  return Object.values(CRON_ROUTE_WORDING);
}
