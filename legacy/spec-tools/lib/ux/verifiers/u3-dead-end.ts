/**
 * U3 行き止まりの検出。
 *
 * ux-lint.md の U3:「どの画面からも、その画面の外へ出る `navigations` が 1 本以上ある」。
 *
 * S3(到達可能性)の対、出口版である。S3 が「どこからも入れない画面」を見るのに対し、
 * ここが見るのは「入ったら出られない画面」だ。どちらも 1 画面ずつ読んでいる限り見えない
 * (欠けているのは**画面の外**にある)。ブラウザの戻るがあるから実害が無いように見えるが、
 * 「次に何をすればよいか」が仕様に書かれていない画面という事実は残る。
 *
 * **自分自身へ戻る遷移は出口として数えない**。操作の成功後に同じ画面へ戻る配線
 * (`entry.submit.success → 自画面`)は再描画の宣言であって、そこから先へ進む道ではない。
 */

import type { ScreenSpec } from '../../model/screen/types.js';
import type { UxInput, UxIssue } from '../../model/ux/types.js';
import type { UxVerifier } from '../verifier.js';
import { acceptHint, uxIssue } from '../verifier.js';

/** U3: 出口の無い画面(行き止まり)を検出する。 */
export const deadEndVerifier: UxVerifier = {
  id: 'U3',
  title: '行き止まり — どの画面にも外へ出る遷移が 1 本以上ある',

  verify(input: UxInput): UxIssue[] {
    return input.screens.screens.filter(isDeadEnd).map(deadEnd);
  },
};

/** 自分以外の画面へ出る遷移を 1 本も持たないか(chrome から継承した遷移も含めて見る)。 */
function isDeadEnd(screen: ScreenSpec): boolean {
  return !screen.navigations.some((navigation) => navigation.to !== screen.id);
}

/** 行き止まりの画面。 */
function deadEnd(screen: ScreenSpec): UxIssue {
  return uxIssue('U3', [screen.id], '', {
    message: `画面 ${screen.name} から他の画面へ出る遷移がありません(行き止まり)`,
    location: screen.location,
    suggestion:
      `この画面の navigations に次に進む先を足す。共通ヘッダから戻れるなら chrome を継承する` +
      `(chrome の遷移は継承画面へ展開されるので、それだけで出口になる)。` +
      `本当に出口が無い画面なら受け入れる(${acceptHint('U3', '')})`,
    counterexample: { screen: screen.name, route: screen.route },
  });
}
