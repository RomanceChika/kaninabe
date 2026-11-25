/**
 * パーツ見本の静的マークアップ(ハンドブック「デザイン」の章)。
 *
 * ここにあるのは**器(HTML 構造)と定型の見本文言**だけである。見た目はすべて
 * docs/book/assets/ の実 CSS(globals.css / ui.module.css のスコープ写し)が決めるので、
 * ここが実装の値を書き写すことはない。文言は「◯◯の見本」の定型に限る
 * (実データ・実文言を捏造しない — 実物の文言はスクリーンショットの領分)。
 *
 * CSS Modules の `composes:`(tdNumeric → td / barMuted → bar)は素の CSS に写せないため、
 * マークアップ側が**両方のクラスを書く**ことで再現する。
 */


/** 見本 1 項目。 */
export interface DemoSample {
  /** 見出し(部品のまとまりの名前)。 */
  readonly title: string;
  /** 使っているセレクタの表示名(クラスは `.card`、要素は `button` の形)。 */
  readonly names: readonly string[];
  /** 見本の HTML(空行を含まない行の並び)。 */
  readonly stage: readonly string[];
  /** 生成器の定数だけでできた見本(フォーム部品を含む)。**1 つのブロックとして**登録する = そのまま出す。状態バッジは仕様の文言を含むので登録しない。 */
  readonly constant?: true;
}

/**
 * 見本の並び(状態バッジだけは仕様と実装から動的に組むため、外から受け取って挟む)。
 *
 * @param badges 状態バッジの見本(parts-demo.ts が組む)
 * @returns 表示順の見本
 */
export function demoSamples(badges: DemoSample): DemoSample[] {
  return [
    typography(),
    buttons(),
    header(),
    badges,
    form(),
    cards(),
    table(),
    barAndDialog(),
    emptyAndPages(),
  ].map((sample) => (sample === badges ? sample : { ...sample, constant: true as const }));
}

/** 見出し・本文・注記・箇条書き。 */
function typography(): DemoSample {
  return {
    title: '見出しと本文',
    names: ['h1', 'h2', 'p', 'a', '.pageTitle', '.lead', '.note', '.inlineList'],
    stage: [
      `<h1 class="pageTitle">見出し h1 の見本</h1>`,
      `<p class="lead">リード文(lead)の見本。</p>`,
      `<h2>見出し h2 の見本</h2>`,
      `<p>本文(p)の見本。<a href="#">リンク(a)の見本</a>を含む。</p>`,
      `<p class="note">注記(note)の見本。</p>`,
      `<ul class="inlineList">`,
      `<li>箇条書き(inlineList)の見本</li>`,
      `<li>箇条書き(inlineList)の見本</li>`,
      `</ul>`,
    ],
  };
}

/** ボタン 4 態(既定・主・破壊的・無効)。 */
function buttons(): DemoSample {
  return {
    title: 'ボタン',
    names: ['button', '.bar', '.primary', '.danger'],
    stage: [
      `<div class="bar">`,
      `<button type="button">二次ボタン(既定)の見本</button>`,
      `<button type="button" class="primary">主ボタン(primary)の見本</button>`,
      `<button type="button" class="danger">破壊的ボタン(danger)の見本</button>`,
      `<button type="button" disabled>無効(disabled)の見本</button>`,
      `</div>`,
    ],
  };
}

/** 共有ヘッダ(濃い地の上の部品)。 */
function header(): DemoSample {
  return {
    title: '共有ヘッダ',
    names: ['.header', '.headerLink', '.headerSpacer', '.headerNote', '.headerButton'],
    stage: [
      `<header class="header">`,
      `<a class="headerLink" href="#">headerLink の見本</a>`,
      `<a class="headerLink" href="#">headerLink の見本</a>`,
      `<span class="headerSpacer"></span>`,
      `<span class="headerNote">headerNote の見本</span>`,
      `<button type="button" class="headerButton">headerButton の見本</button>`,
      `</header>`,
    ],
  };
}

/** フォーム部品(ラベル・入力欄・複数行・エラー表示)。 */
function form(): DemoSample {
  return {
    title: 'フォーム',
    names: ['.field', '.control', 'input', 'textarea', '.errorText'],
    stage: [
      `<div class="card">`,
      `<label class="field">入力欄(field / control)の見本`,
      `<input class="control" type="text" value="入力値の見本">`,
      `</label>`,
      `<label class="field">複数行(textarea)の見本`,
      `<textarea class="control" rows="3">テキストエリアの見本</textarea>`,
      `</label>`,
      `<p class="errorText">エラー表示(errorText)の見本。</p>`,
      `</div>`,
    ],
  };
}

/** カードと定義リスト(概要の形)。 */
function cards(): DemoSample {
  return {
    title: 'カードと定義リスト',
    names: ['.card', '.cardTitle', '.dl', '.row', '.dt', '.dd', '.stack'],
    stage: [
      `<div class="stack">`,
      `<section class="card">`,
      `<h2 class="cardTitle">カード見出し(cardTitle)の見本</h2>`,
      `<dl class="dl">`,
      `<div class="row"><dt class="dt">項目名(dt)の見本</dt><dd class="dd">値(dd)の見本</dd></div>`,
      `<div class="row"><dt class="dt">項目名(dt)の見本</dt><dd class="dd">値(dd)の見本</dd></div>`,
      `</dl>`,
      `</section>`,
      `<section class="card"><h2 class="cardTitle">カード(card)の見本</h2><p class="note">stack で縦に並ぶ見本。</p></section>`,
      `</div>`,
    ],
  };
}

/** 表(見出し行・数量列・行操作)。 */
function table(): DemoSample {
  return {
    title: '表',
    names: ['.tableWrap', '.table', '.th', '.td', '.tdNumeric', '.rowActions'],
    stage: [
      `<div class="tableWrap">`,
      `<table class="table">`,
      `<thead><tr><th class="th">列見出し(th)の見本</th><th class="th">数量(tdNumeric)</th><th class="th">操作(rowActions)</th></tr></thead>`,
      `<tbody>`,
      `<tr><td class="td">セル(td)の見本</td><td class="td tdNumeric">1234</td><td class="td"><div class="rowActions"><button type="button">行操作の見本</button></div></td></tr>`,
      `<tr><td class="td">セル(td)の見本</td><td class="td tdNumeric">56</td><td class="td"><div class="rowActions"><button type="button">行操作の見本</button></div></td></tr>`,
      `</tbody>`,
      `</table>`,
      `</div>`,
    ],
  };
}

/** 操作バー(減光つき)と確認ダイアログ。 */
function barAndDialog(): DemoSample {
  return {
    title: '操作バーと確認ダイアログ',
    names: ['.bar', '.barSpaced', '.barMuted', '.dialog', '.dialogMessage'],
    stage: [
      `<div class="bar barSpaced barMuted">`,
      `<button type="button" class="danger">破壊的操作の見本</button>`,
      `<button type="button">別の操作の見本</button>`,
      `</div>`,
      `<dialog class="dialog" open>`,
      `<p class="dialogMessage">確認ダイアログ(dialogMessage)の見本。</p>`,
      `<div class="bar">`,
      `<button type="button" class="danger">確定の見本</button>`,
      `<button type="button">やめる見本</button>`,
      `</div>`,
      `</dialog>`,
    ],
  };
}

/** 空表示とページの器(幅の値域)。 */
function emptyAndPages(): DemoSample {
  return {
    title: '空表示とページの器',
    names: ['.empty', '.pageForm', '.pageNarrow', '.pageWide'],
    stage: [
      `<p class="empty">空表示(empty)の見本。</p>`,
      `<div class="stack">`,
      `<div class="pageForm parts-demo-page"><p class="note">pageForm の幅の見本</p></div>`,
      `<div class="pageNarrow parts-demo-page"><p class="note">pageNarrow の幅の見本</p></div>`,
      `<div class="pageWide parts-demo-page"><p class="note">pageWide の幅の見本</p></div>`,
      `</div>`,
    ],
  };
}
