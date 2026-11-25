/**
 * 画面プレビューの断片の入口の検査(`previewProblems`)。
 *
 * コミットされた入力は信頼しない。許可表(タグ・属性・URL・style・id)に合わない断片は、理由つきで拒否する(登録簿に載せる前の関所)。
 */

import { describe, expect, it } from 'vitest';
import { previewProblems } from '../../../../../lib/kernel/preview-check.js';

describe('通る断片(実装が描く画面の形)', () => {
  it.each([
    ['構造とテキスト', '<main class="screen" data-testid="x"><h1>題</h1><p>本文 <b>強調</b></p><ul><li>一</li><li>二</li></ul></main>'],
    ['フォーム部品', '<form><label>名前<input type="text" name="title" maxLength="50" required value="a"></label><select name="s"><option value="x" selected>x</option></select><textarea rows="3">a</textarea><button type="submit" disabled>送る</button></form>'],
    ['リンクと画像', '<a href="/items/1" class="x">見る</a><a href="#top">上</a><img src="./a.png" alt="" width="10" height="10">'],
    ['SVG', '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" /><circle cx="5" cy="5" r="2" /></svg>'],
    ['自分を閉じた svg', '<svg viewBox="0 0 10 10"/>'],
    ['空要素の />', '<br/><hr/><img src="a"/><input name="a"/><wbr/>'],
    ['製品の name', '<textarea name="body"></textarea>'],
    ['data / aria の属性', '<div data-state="open" aria-label="閉じる" role="dialog">x</div>'],
    ['同じオリジンのパスへ送るフォーム', '<form method="post" action="/api/auth/logout"><button type="submit">ログアウト</button></form>'],
  ])('%s', (_name, html) => {
    expect(previewProblems(html)).toEqual([]);
  });
});

describe('拒否する断片', () => {
  it.each([
    ['別のオリジンへ送るフォーム', '<form method="post" action="https://evil.example/x"><button>x</button></form>'],
    ['プロトコル相対の送り先', '<form action="//evil.example/x"></form>'],
    ['javascript: の送り先', '<form action="javascript:alert(1)"></form>'],
    ['許可表に無い method', '<form method="dialog" action="/x"></form>'],
    ['script', '<div>a<script>alert(1)</script></div>'],
    ['style の要素', '<div><style>.x{}</style></div>'],
    ['iframe', '<iframe src="/x"></iframe>'],
    ['object', '<object data="x"></object>'],
    ['embed', '<embed src="x">'],
    ['template', '<template><b>x</b></template>'],
    ['link / meta / base', '<link rel="stylesheet" href="x">'],
    ['on* の属性(引用符あり)', '<button onclick="go()">押す</button>'],
    ['on* の属性(引用符なし)', '<img src=x onerror=alert(1)>'],
    ['on* の属性(単引用符)', "<button onclick='go()'>押す</button>"],
    ['v-html', '<div v-html="x">a</div>'],
    ['@click', '<div @click="x()">a</div>'],
    [':items の式', `<div :items="[1,alert(1)]">a</div>`],
    ['スロットの略記', '<div #x>a</div>'],
    ['javascript: の href', '<a href="javascript:alert(1)">a</a>'],
    ['文字参照で綴った javascript:', '<a href="jav&#x61;script:alert(1)">a</a>'],
    ['data: の src', '<img src="data:text/html,x">'],
    ['プロトコル相対の URL', '<a href="//evil.example/x">a</a>'],
    ['style(CSP が止める属性は表に置かない)', '<div style="--swatch: var(--color-text);">x</div>'],
    ['url() を含む style', '<div style="background:url(//evil/x)">a</div>'],
    ['expression を含む style', '<div style="width:expression(alert(1))">a</div>'],
    ['予約された id', '<div id="app">a</div>'],
    ['予約された name', '<input name="window">'],
    ['許可表に無い属性', '<div srcdoc="x">a</div>'],
    ['コメント', '<!-- c --><div>a</div>'],
    ['タグにならない <', 'a < b <div>a</div>'],
    ['閉じていないタグ', '<div>閉じていない'],
    ['余分な閉じ', '<div>a</div></div>'],
    ['入れ違い', '<b><i>x</b></i>'],
    ['重複した属性', '<span class="a" class="b">x</span>'],
    ['大文字小文字違いの重複した属性', '<b id="x" ID="y">z</b>'],
    ['値の無い属性の重複', '<input disabled disabled>'],
    // ブラウザの解析器は非 void の要素の `/` を読み捨てる(点検 13 回目 C13-6)。
    ['自分を閉じた textarea', '<textarea/>'],
    ['自分を閉じた select', '<select name="a"/>'],
    ['自分を閉じた a', '<a href="https://evil.example/"/>x'],
    ['自分を閉じた dialog', '<dialog open/>'],
    ['自分を閉じた div', '<div/>'],
    ['自分を閉じた form', '<form/>'],
    ['svg の外の path', '<path d="M0 0"/>'],
    // `document` の名前を `<img name>` で潰さない(点検 13 回目 C13-8)。
    ['querySelector の name', '<img src="a" name="querySelector">'],
    ['querySelectorAll の name', '<img src="a" name="querySelectorAll">'],
    ['createElement の name', '<form name="createElement"></form>'],
    ['addEventListener の name', '<img src="a" name="addEventListener">'],
    ['documentElement の name', '<img src="a" name="documentElement">'],
  ])('%s', (_name, html) => {
    expect(previewProblems(html).length, html).toBeGreaterThan(0);
  });

  it.each([
    ['onclick', '<a onclick="x">a</a>', '属性 onclick(a)は置けません'],
    ['ONERROR', '<img ONERROR="x">', '属性 ONERROR(img)は置けません'],
    ['v-html', '<div v-html="x">a</div>', '属性 v-html(div)は置けません'],
    ['@click', '<div @click="x">a</div>', '属性 @click(div)は置けません'],
    [':items', '<div :items="x">a</div>', '属性 :items(div)は置けません'],
    ['#x', '<div #x>a</div>', '属性 #x(div)は置けません'],
  ])('実行の道の属性は許可表の外でなく「置けない」と名指す: %s', (_name, html, reason) => {
    expect(previewProblems(html)).toContain(reason);
  });

  it('理由は、何が置けないかを名指す(属性なら属性名とタグ)', () => {
    expect(previewProblems('<img src=x onerror=alert(1)>').join('\n')).toContain('onerror');
  });
});
