/**
 * S9 テストの網羅チェック(画面版の A4)。
 *
 * screen-spec-writing.md の S9:「全 `screen_spec` が `test_cases` を 1 件以上持ち、
 * `requires_auth: true` の画面は入場の関門を確かめるケース(`covers` に `forbidden`)を持つ」。
 *
 * S8 が見るのは「**書いた**宣言が実在するか」だけで、書かなかったものは誰も咎めない。
 * テストを 1 本も持たない画面は、宣言した部品も遷移も**実行時には誰も確かめていない**のに
 * 静かに緑になる。A4(人間ロールの全イベントに action_spec を要求する)と同じ論法で、
 * 「宣言しなかったこと」の側をここで塞ぐ。
 *
 * **理由付きの免除(`unhandled:` 方式)は v1 では用意しない。** 画面は 4 枚しかなく、
 * 全部書ける規模で免除の口を先に作ると、それが既定の逃げ道になる。
 *
 * `requires_auth` の要求だけ意味クラスで表しているのは、検証器が読めるのが仕様側の宣言
 * (`covers`)だけだからである。テスト実装が本当に `requireSession()` の結果を見ているかは
 * ここからは分からない — 宣言と実装の食い違いは S8(テスト名の一致)が受け持ち、
 * ここが要求するのは「そのクラスのケースを 1 本は持つ」ところまでである。
 */

import type { Finding, ScreenVerifier } from '../verifier.js';
import { screenFinding } from '../verifier.js';
import type { ScreenInput, ScreenSpec } from '../../model/screen/types.js';
import { screenTestPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { ScreenContext } from '../verifier.js';

/** 入場の関門(未セッションでログイン画面へ送られること)を表す意味クラス。 */
const GATE_CLASS = 'forbidden';

/** S9: 画面がテストを持っているかを検証する。 */
export const testPresenceVerifier: ScreenVerifier = {
  id: 'S9',
  title: 'テストの網羅 — 全画面が test_cases を持ち、要ログイン画面は入場の関門を確かめる',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    return input.screens.screens.flatMap((screen) => checkScreen(screen, ctx.roots, ctx.layout));
  },
};

/** 画面 1 枚を見る。テストが 0 件のときは関門の指摘を重ねない(1 つの書き忘れに 2 つ出さない)。 */
function checkScreen(screen: ScreenSpec, roots: ProductRoots, layout: ProductLayout): Finding[] {
  if (screen.testCases.length === 0) return [missingTestsFinding(screen, roots, layout)];
  if (!screen.requiresAuth) return [];
  const covered = screen.testCases.some((testCase) => testCase.covers?.includes(GATE_CLASS) === true);
  return covered ? [] : [missingGateFinding(screen)];
}

/** 画面テストの置き場(置き場の配置の `screen-test`。実装の木を宣言していない製品・配置が決められないときは null)。 */
function testFile(roots: ProductRoots, layout: ProductLayout, screen: ScreenSpec): string | null {
  return screenTestPath(layout, roots, `${toFileName(screen.name)}.test.tsx`);
}

/**
 * 画面テストの置き場の言い方。示せない理由を 2 つに分ける(原因が違えば直し先が違う): 実装の木の宣言が無い(製品の宣言 `roots.app`)・
 * 実装の木はあるのに配置が決められない(置き場の配置に `screen-test` が無い・ファイル名がキーの形に合わない・基準の役割が辿れない)。
 */
function testFileWords(roots: ProductRoots, layout: ProductLayout, screen: ScreenSpec): string {
  const file = testFile(roots, layout, screen);
  if (file !== null) return file;
  return roots.app === null
    ? '画面テストの置き場(実装の木の宣言が無いので示せない)'
    : '画面テストの置き場(置き場の配置に screen-test の置き場が無い・ファイル名がキーの形に合わない・基準の役割が辿れないので示せない)';
}

/** test_cases が 1 件も無い。 */
function missingTestsFinding(screen: ScreenSpec, roots: ProductRoots, layout: ProductLayout): Finding {
  return screenFinding('S9', {
    message: `${screen.name} に test_cases がありません`,
    location: screen.location,
    suggestion:
      // 置き場を示せないときは、空パスを出すより示せない理由を言うほうが読める(実装の木の宣言が無い / 配置が決められない)。
      `${testFileWords(roots, layout, screen)} に screenTest を書き、` +
      `test_cases に "- id: TC-SCREEN-${screen.name.toUpperCase()}-001" として宣言する` +
      '(宣言した部品・排他表示・遷移先が実行時に確かめられていない画面を残さないため。' +
      '書き方は screen-test.md)',
    counterexample: { screen: screen.name, route: screen.route },
  });
}

/** requires_auth: true なのに入場の関門のケースが無い。 */
function missingGateFinding(screen: ScreenSpec): Finding {
  return screenFinding('S9', {
    message: `${screen.name} は requires_auth: true ですが、入場の関門を確かめるテストがありません`,
    location: screen.location,
    suggestion:
      '未セッションで画面を描画すると /login へ送られることを確かめる screenTest を足し、' +
      `そのケースの covers に ${GATE_CLASS} を書く` +
      '(requires_auth は実装の requireSession() に対応する観測可能な事実であり、' +
      '実測しないと宣言だけが残る)',
    counterexample: { screen: screen.name, requires_auth: 'true' },
  });
}

/** 画面名から screenTest のファイル名を導く(規約: screen-test.md の配置)。 */
function toFileName(name: string): string {
  return name.split('_').join('-');
}
