/**
 * ブラウザ側の守りの配線の見張りテスト(生成)に出る日本語の文言。
 *
 * 生成テストのテスト名は保証台帳(`security_headers_set` と、出口の関所の 1 本は `url_scheme_safe` の `test_cases[].implementation`)が名指す綴りで、
 * 生成物の文字列リテラルとして写る。**生成器に直接書かない**(`messages-cron.ts` と同じ理由)。**値を何も import しない**(文言の層は葉)。
 */

/** 見張りテストの文言。 */
export const BROWSER_DEFENSE_WORDING = {
  /** describe の見出し。 */
  suite: 'ブラウザ側の守りの配線(生成)',
  /** 全応答の固定のヘッダの配線のテスト名(保証台帳の `test_cases` が名指す)。 */
  staticHeaders: '枠の設定の headers() は全ルート(/:path*)に宣言の固定のヘッダを全部そのまま配り、CSP と CORS のヘッダを固定で配らず、X-Powered-By を出さない',
  /** リクエスト前段の配線のテスト名(同上)。 */
  requestGate: 'リクエスト前段は宣言の保護範囲を通り、出どころを確かめられない状態を変える要求(Server Action)を、セッションの更新に触れずに 403 で拒む',
  /** cookie で認証する口のテスト名(同上)。 */
  cookieRoutes:
    'cookie で認証する口(送信の連携の endpoints とサインインの開始・ログアウトの口)は、状態を変える要求の出どころを確かめられなければ、外への呼び出し(認証基盤・DB・外部の API)も認証の文脈も要求のボディも使わずに、関門と同じ応答の 403 で拒む',
  /** 要求ごとの描画のテスト名(同上)。 */
  dynamicRendering: '根のレイアウトは要求ごとに描画する(await connection()。nonce は要求ごとに描画した文書にしか付かない)',
  /** 同じオリジンの要求が本体へ進む対照のテスト名(同上)。 */
  trustedReach: '同じオリジンのページからの要求(フォームの送信・fetch・Server Action・前段のプロキシの後ろ)は、出どころの確認を通って口とリクエスト前段の本体へ進む(対照)',
  /** 全部の口が出口の関所で包まれていることのテスト名(保証台帳 `url_scheme_safe` の `test_cases` が名指す。点検 10 回目 B10-1)。 */
  routeGuard:
    '宣言した全部の口の全メソッドは出口の関所 guardRoute で包まれ、関所は口が返した外のオリジンへの Location を行き先の無い 500 に替える',
  /** 対照の要求を関門が閉じてしまったときの報告。 */
  closedByGuard: '関門が拒んだ(本体へ進まなかった)',
  /** リクエスト前段の見張りの行の名前。 */
  requestGateSource: 'リクエスト前段',
} as const;

/**
 * この表が持つ固定の日本語の断片の全数。上の表に語を足すときは、ここにも足す(足さなければ出力側の目が赤になる)。
 *
 * @returns 断片の全数
 */
export function browserDefenseFragments(): readonly string[] {
  return Object.values(BROWSER_DEFENSE_WORDING);
}
