/**
 * H8 ログアウトの操作 — 認証の要る全画面から、ログアウトが見える(ASVS V7.4.4)。
 *
 * 認証フロー仕様の `logout`(ログアウトの口)は、`control` に**ログアウトの操作の名前**を宣言する。名前は共有クロームの
 * `navigations[].on` と同じ自由語彙(例: `signed_out`)で、ログアウトのボタンはクロームの部品に居て、押した後に
 * 着地する画面への遷移を持つ。画面は `requires_auth: true` と書くだけで入場に認証が要る(関門 H4)が、
 * **その画面にログアウトの操作があるか**は別の問いである —— クロームを被り忘れた画面・クロームの遷移からログアウトを
 * 落とした画面は、ログインしたまま出られない行き止まりになる(共有端末で、ほかの人に見える)。
 *
 * | 見ること | なぜ |
 * |---|---|
 * | `logout` を宣言したなら `control` も宣言する | どの操作がログアウトかを機械が読める宣言にする(書かなければ検査が空振りする) |
 * | `requires_auth: true` の全画面が、`control` の遷移を持つクロームを被っている | クロームの `navigations` はローダーが継承画面へ展開する(`viaChrome`)。画面が自分で `control` の遷移を書いても、共有部の部品としては数えない(画面ごとに書き写すと、片方の画面だけ落ちる) |
 *
 * 画面仕様が採られていない・読めないときと、`logout` を宣言しない製品(サインインの口を持たない構成)は見ない
 * (口そのものの有無は J2 の閉世界と H0 の「帰り道があるなら開始とログアウトも要る」が見る)。
 * 見えるだけで、押したら本当にログアウトするかは実装の木の見張りテストと E2E が担う。
 */

import type { Finding } from '../../kernel/finding.js';
import type { CatalogInput } from '../../kernel/input-state.js';
import { readableValue } from '../../kernel/readable-value.js';
import type { AuthFlowSpec } from '../../model/auth/types.js';
import type { ScreenSpecModel } from '../../model/screen/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'H8';

/** H8 の指摘を組み立てる。 */
function h8(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { severity: 'error', verifier: VERIFIER_ID, ...args };
}

/**
 * ログアウトの操作の宣言と、認証の要る画面がそれを持つクロームを被っていることを検証する。
 *
 * @param auth 読み込み済みの認証フロー仕様(null なら他の検証器が指摘済み)
 * @param screensInput 画面仕様の入力の状態(読めないときは何も見ない)
 * @returns 違反のリスト
 */
export function verifyLogoutControl(auth: AuthFlowSpec | null, screensInput: CatalogInput<ScreenSpecModel>): Finding[] {
  const logout = auth?.logout;
  if (auth === null || logout === undefined) return [];
  const control = logout.control;
  if (control === undefined) {
    return [
      h8({
        message: 'logout(ログアウトの口)を宣言していますが、control(ログアウトの操作の名前)がありません',
        location: logout.location,
        suggestion:
          'logout に "control: {共有クロームの navigations の on}"(例: signed_out)を書く。認証の要る全画面から、' +
          'ログアウトの操作が見えること(ASVS V7.4.4)をこの名前で検査する',
        counterexample: { logout: logout.endpoint },
      }),
    ];
  }
  const screens = readableValue(screensInput);
  if (screens === undefined || !screens.available || screensInput.state !== 'loaded') return [];
  return screens.screens
    .filter((screen) => screen.requiresAuth)
    .filter((screen) => !screen.navigations.some((navigation) => navigation.on === control && navigation.viaChrome !== undefined))
    .map((screen) =>
      h8({
        message:
          `画面 ${screen.name} は requires_auth ですが、ログアウトの操作(${control})を持つ共有クロームを被っていません` +
          (screen.chrome === undefined ? '(chrome がありません)' : `(被っているクローム ${screen.chrome.id} の navigations に ${control} がありません)`),
        location: screen.location,
        suggestion:
          `画面の chrome に、ヘッダなどにログアウトのボタンを置いて "on: ${control}" の遷移を持つクローム(chrome_spec)を宣言して被る。` +
          '認証の要る画面にログアウトが無いと、ログインしたまま出られない(共有端末で次の人に見える)',
        counterexample: { screen: screen.name, control, chrome: screen.chrome?.id ?? '' },
      }),
    );
}
