---
doc_type: process
scope: frontend
norms: [PRIN-0001, PRIN-0002, PRIN-0007, PRIN-0009, ARCH-BE-0001]
decisions: [ADR-0006]
---

# スタイル（デザイントークンと部品のスタイル）

画面の**見た目**をどう書くかの規約。論理層で守っている「状態名を手書きしない」を、視覚層で
「**色と px を手書きしない**」として再演する。

## 目的

- 意匠を**値域**にする。使ってよい色・余白・字組を仕様（`design_token_spec`）が持ち、実装はその写像だけを引く。
- コントラスト（WCAG AA）を**レビューではなく計算**で確かめられる状態にする。色が実装に散っていると「何と何が重なるか」を機械が知る手段が無い。
- 見た目の変更で screenTest（U6）が落ちないことを保ち続ける。**構造は screen_spec、意匠はトークン**という分担を崩さない。

## 参照するもの

- トークンの実値: [docs/specs/frontend/design/tokens.md](../../../../../../specs/frontend/design/tokens.md)（`design_token_spec`。ここが正）
- 画面の構造と配線: [screen-spec-writing.md](../../../specification/standards/screen-spec-writing.md)（見た目は書かない）
- 画面テスト: [screen-test.md](./screen-test.md)（見るのは testid と href だけ ⇒ スタイルの変更では落ちない）
- 機械執行の全件表: [enforcement-matrix.md](../../../../backend/system/standards/conventions/enforcement/enforcement-matrix.md) 第 8.8 節（G1〜G4・G7）

---

## 仕組み（一方向）

```text
docs/specs/frontend/design/tokens.md      ← 正（人が編集するのはここだけ）
        │  npm run generate
        ▼
app/src/domain/generated/tokens.css       ← :root の CSS custom property
app/src/domain/generated/tokens.ts        ← 同じ値の TS 定数
        │  var(--…) / import
        ▼
app/src/app/globals.css                   ← 素の要素の既定
app/src/**/*.module.css                   ← 部品ごとのスタイル
```

- **生成物は手で触らない。** 鮮度は `npm run generate:check`（C1）が見る。
- **逆流させない。** 実装で見つけた「この色が要る」は、CSS に足すのではなく仕様に足してから再生成する。

## 書き方

### 1. 値は必ずトークンから引く（G1）

`.module.css` と `globals.css` に**色・長さ・時間・フォント族の生値を書かない**。

```css
/* ✗ 生値 */
.card { padding: 16px; border: 1px solid #ccc; background: white; }

/* ○ トークン */
.card {
  padding: var(--space-4);
  border: var(--border-hairline) solid var(--color-border);
  background-color: var(--color-surface);
}
```

**許可リスト方式**（2026-09 反転。`g1-tables.ts` が持つ 3 つの値域が正）。

- **単位は `%` / `fr` / `vw` / `vh` だけが通る。** `px` / `rem` / `em` / `ch` / `ex` / `pt` / `pc` / `in` / `cm` / `mm` / `q` / `ms` / `s` はもちろん、表に無い単位（`dvh` / `cqw` 等、将来 CSS に増える単位を含む）も一律で落ちる ―— 単位を「知っている悪い形」ではなく「通ってよい形」で閉じているので、新しい単位が増えても検査は自動で追随する。
- **色は `var(--…)` / `transparent` / `currentColor` だけが通る。** hex・`rgb()` 系の色関数に加えて、CSS の名前付き色(全 148 語)とシステム色キーワード(`ButtonText` 等。OS/ブラウザのテーマに連動するため単一テーマ前提と両立しない)は、どちらも閉じた表で丸ごと落ちる。
- **無単位の数は `0` と、対応するトークンを持たないプロパティ(`flex` / `flex-grow` / `flex-shrink` / `order` / `z-index` / `aspect-ratio`)の値だけが通る。** `font-size` / `line-height` / `letter-spacing` / `font-weight` / `opacity` はトークングループ(`text` / `leading` / `tracking` / `weight` / `opacity`)を持つので、`0` を含め無単位のままでは書けない ―— `font-size: 0`（文字を消す古いハック）のような、単位が無いから通っていたマジック値を塞ぐ。
- **`content` に文字・数字を含む文字列を書かない。** 空文字・`attr()` / `counter()` / `url()` / `var()`・記号だけの区切り(`"/"` 等)は通すが、装飾ラベル(eyebrow 等)を `content` で密輸することは禁止する ―— 翻訳できず、スクリーンリーダーの読み上げも曖昧になり、全検査の外にある。画面に必要な文言は screen_spec の部品として宣言し、DOM に実テキストとして出す。
- **4px 刻みに無い余白が要るときは、トークンを足す前にまず部品の設計を疑う。** 6px が要る状況は、たいてい隣の部品と揃っていないことの現れである。

### 2. JSX に `style` 属性を書かない（G4）

インラインの `style` は `.css` に現れないので、G1 の走査の**外側**にある。値ではなく口を塞ぐ。

```tsx
// ✗
<main style={{ padding: '1.5rem', maxWidth: '48rem' }}>

// ○
import ui from '../_styles/ui.module.css';
<main className={ui.pageNarrow}>
```

### 3. トークン名の綴りは検査される（G2）

未定義の CSS 変数は**エラーにならず静かに無視される**（継承値か初期値になるだけ）。
`var(--color-acccent)` のような綴り違いは G2 が落とす。

外から供給される変数（`next/font` が作るフォント変数）は、仕様の `externals` に
**供給元と理由つきで**宣言してある分だけが通る。

### 4. 重ねる色は宣言する（G3）

前景と背景の組み合わせは、仕様の `contrast` に書いた分だけ比が検査される。
**新しい重ね方をしたら 1 行足す。** 書かなければ検査されない（総当たりにしていないのは、
実際には重ねない色の比まで守るとパレットが痩せるためである）。

`contrast` に一度も現れない色トークン(palette を参照するトークン)は、G3 の**網羅の床**が
warning で挙げる(2026-09 追加)。実際に重ねているのに書き忘れたなら `contrast` に 1 行足す。
装飾的で本当に重ねない色(区切り線等)なら、放置せず **`decorative: <理由>` をトークンに書いて
受け入れる**(U 群の「理由つきで受け入れる」作法と同じ形。書くと warning が消える)。
逆に `decorative` を書いたのに `contrast` にも現れるトークンは、重ねないと言いながら重ねている
矛盾として **error** になる ―― 実際に重ねているなら `decorative` を消して比の検査に委ねる。

### 5. 使わなくなったトークンは削除する（G7）

`app/src` の CSS のどこからも `var(--…)` で引かれていないトークンは G7 が落とす。
「使ってよい色・余白・字組の値域」は、宣言しただけで誰も引いていない語が混ざると
その主張が崩れる(実測: radius を全廃したあとも 4 語のトークンが緑のまま残っていた)。
画面を削って不要になったトークンは、`tokens.md` から消してから `npm run generate` する。

**走査範囲は `app/src` の CSS だけではない。** ハンドブックの人向けの表示の CSS(`docs/.vitepress/theme/book-face/`)も、
G1(生値)・G2(実在)・G7(死語彙)に同じ規約で渡る(`lib/model/design/loader.ts` の `loadBookFaceCss`)。ブックの章の読み方の印の色のように
**ブックだけが使うトークン**を足したときに、実装の CSS が引かないために G7 が落ちる、という形を避けるためである
(ブックの部品が引いていれば緑、引かなくなれば落ちる)。文字色は VitePress の本文に従い、地と文字を組で持つもの
(読み方の印・ピル・カード)だけトークンの組を使う。画面幅の分岐(`@media` の px)は G1 が生値として落とすので書かず、折り返しで解く。

### 6. ロゴ（アプリのアイコン）は `brand` に必須で宣言する（G8）

背景: 本番に出ていたのは Next のテンプレート既定の `favicon.ico`（create-next-app が置く
Vercel の三角）だった。「ついそのまま」を人の目でのレビューに頼らず、他のトークンと同じく
**宣言 → 検査**の形で仕組みに載せる。

```yaml
brand:
  icon: app/src/app/icon.png          # 必須。Next の Metadata Files 規約（icon.png | icon.svg）
  apple_icon: app/src/app/apple-icon.png   # 任意
  og_image: app/src/app/opengraph-image.png # 任意
  placeholder:                         # 任意。実物のロゴが無い期間だけ
    reason: 実物のロゴ待ち（2026-09-07。仮のアイコン）
```

名前（アプリ名）は設定カタログ `APP_NAME` が持つのでここには書かない
（config-spec-writing.md）。`favicon.ico` は使わない —— Next は `icon.*` があれば
`favicon.ico` を要らず、置いたままだと G8(d) がテンプレート既定の残骸として検出する。

**G8 が見る 4 点。**

| # | 何を | 格下げ |
|---|------|--------|
| (a) | `brand.icon` が宣言されている | 無い(常に error) |
| (b) | 宣言したファイルが実在する | `placeholder` があれば warning |
| (c) | 宣言したファイルが Next テンプレート既定の `favicon.ico` と一致しない(SHA-256 比較) | `placeholder` があれば warning |
| (d) | `app/src/app/favicon.ico` が残っていない | 無い(常に error) |

(a)(d)を `placeholder` があっても常に error のままにしているのは、「宣言していない」
「既定の残骸が残っている」が仮のロゴの有無とは無関係の別の不備だからである。

**(b)(c)(d)は `app/` の木がある環境でだけ見る。** 実ファイルとの突合なので、仕様だけを持つ
リポジトリ(サンプル・実装をまだ書いていない新規プロジェクト)では成立しない —— 飛ばさないと
「`placeholder` を宣言し続ける以外に消せない warning」になり、`placeholder` が実物待ちの
受け入れではなく**回避の道具**になる(X1・J2 と同じ扱い)。飛ばしたことは `npm run verify` の
G 群の行に出る。(a)は仕様だけで判定できるので常に見る。
`placeholder` を書いた実物待ちの期間は、`npm run verify` の出力に
「`brand: placeholder 1 件`」と 1 行出る(消し込み忘れをレビューで見つけやすくするため)。

**実物のロゴに差し替える手順**は 3 行:

1. 実物のアイコン画像を用意し、`app/src/app/icon.png`(推奨。SVG のロゴが無ければ)に置く
2. `tokens.md` の `brand.icon` のパスを実物のファイルに直し、`placeholder` の節ごと削除する
3. `npm run verify` を通す(`brand: placeholder 0 件` になることを確認する)

## 置き場所

| 何を | どこに | なぜ |
|------|--------|------|
| 素の要素の既定（`body` / `h1` / `a` / `button` / `input` / `hr`） | `app/src/app/globals.css` | クラスを付けなくても成り立つ見た目。ここが無いと全部品が同じ 5 行を持つ |
| 画面をまたぐ部品の形（器・表・定義リスト・操作バー・バッジ・ダイアログ） | `app/src/app/_styles/ui.module.css` | 表と定義リストと操作バーは 5 画面以上で同じ形をしている。1 枚にまとめてあるのは共有相手がディレクトリをまたぐため |
| `src/components` の部品のスタイル | その部品の隣（`action-error-view.module.css`） | 層境界（B8）。`src/components` は `src/app` を import できず、CSS も同じ線で分ける |

- **`ui.module.css` に画面固有のクラスを足さない。** 1 画面でしか使わない形は、その画面の隣に `.module.css` を置く（現状その実例はまだ無い）。

## 状態バッジ（意味色）

状態の**文言**は生成物（`{aggregate}.labels.ts`）が正であり、実装は
`app/src/app/_components/state-badge.tsx` を通して表示する。

- 色の語彙は 4 つ（`info` / `positive` / `neutral` / `critical`）で、トークン仕様の
  `color-badge-*` に対応する。
- **状態 → 語彙の対応は仕様に置き場が無い。** 「受理は良い知らせ」は業務の事実ではなく見せ方の
  判断であり、`state_spec` に色を書き始めるとドメイン仕様が視覚の語彙を持つ。
- ただし**書き漏らしは型で落ちる**。`satisfies Record<keyof typeof {…}StateLabels, Tone>` が
  あるので、仕様に状態を 1 つ足して再生成すると型エラーになる。

## してはいけないこと

- **CSS フレームワーク・CSS-in-JS を入れる。** Tailwind も styled-components も採らない（NOTES 2026-08-20 の判断: ランタイムゼロ・RSC 無摩擦・撤退可能性・トークンの持ち出しやすさ）。
- **生成物（`tokens.css` / `tokens.ts`）を編集する。** 次の `generate` で消える。
- **`data-testid` を CSS のセレクタに使う。** testid はテストの持ち物であり、スタイルが依存すると「テストのための属性」を消せなくなる。
- **色を TS（`designTokenValues`）から読んで JSX に渡す。** その経路はスタイルをコンポーネントの内側に戻し、G1 の視界から外す。TS 定数は CSS を持てない場所（将来の React Native・生成器のテスト）のための口である。

## 既知の穴

- **G1 の CSS の読み方は行単位である。** 1 行に複数の宣言を書いた場合や、値が複数行にまたがる場合は読み落とす。読めなかった書き方は「検査されない」のであって「通った」のではない（許可リスト方式に反転した後もこの限界は残る ―― 表と照合する前に、そもそも宣言として拾えていない）。
- **G3 は宣言した組み合わせしか見ず、行を消せば黙る。** 書き漏らした重ね方は AA を割っていても緑になる（実測: `color-border-strong` を `color-surface-raised` / `color-danger-soft` に重ねた 2 組が 2.89:1 / 2.97:1 のまま緑だった）。**新しい重ね方をしたら `contrast` に 1 行足す**のが利用者側の義務であり、逆に行を消して緑にするときは**なぜ重ならないかを YAML のコメントに残す**（検査を消す操作と設計を直す操作が同じ形をしているため）。**網羅の床**（§4）は「1 行も現れない色トークン」を warning で拾うが、これは「宣言が 1 つも無い」ことしか見ておらず、**宣言した比が正しいかどうかは相変わらず利用者の義務**である。
- **G3 は `opacity` を計算に入れない。** 宣言上の比であって、画面に出ている実効比ではない。`opacity` をトークン化した（2026-09）ことで「無単位の生値を直書きできる」という G1 側の穴は塞いだが、**G3 が opacity を掛け合わせた実効コントラストを計算しない**という穴はそのまま残る。面ごと減光している箇所（`.barMuted` 等）の実効コントラストは誰も見ていない ―― 実ブラウザで計算値を読む層（G6)が要る。**確認ダイアログ（`ConfirmDialog`）が開いている間に背後へ退く要素は `inert` を付ける**のが裁定（U1 相当。2026-09-04）であり、G6（`npm run shots`）は `[inert]` 配下・`[aria-hidden="true"]` 配下を検査対象から外す ―― 押せずフォーカスも通らない表現の薄さは意図どおりとして扱う。
- **アプリはダークモードに対応していない（意図的）。ブックの器だけが夜の組を持つ。** ハンドブックの器（`docs/.vitepress/theme/book-face/`）は `color-night-*`（canvas / surface / text / text-secondary / border）を持ち、`light-dark()` で 1 か所ずつ切り替える（トークンの名前は上書きしない。中の「実物」の断片が夜に巻き込まれないため）。夜の組は G3 の `contrast` に宣言してあり、アプリの CSS は引かない（引くなら、下に書いた 2 組目のテーマの設計が先）。以下はアプリの話である。トークンは明るい地の 1 組しか持たず、`globals.css` が `color-scheme: light` を宣言して単一テーマ前提であることを明示している。暗い配色を足すなら、トークン仕様に 2 組目のテーマという概念を入れるところから設計し直す（いまの `contrast` の宣言も 1 組目にしか効かない）。
- **どのトークンをどこに当てるかは縛っていない。** `--color-danger` を見出しに使っても機械は止めない。「終端遷移を発火するボタンは danger トークンを使う」のような**意味論 → 視覚の写像**の検査（G5）は未実装 ―― 縛る語彙（部品のバリアントの値域）が screen_spec 側に無く、DSL 拡張の要否から要トリアージ（BACKLOG）。
- **レイアウトの正しさは見ていない。** はみ出し・重なり・タップ領域の幾何学的な検査（レイアウト不変条件。G6）と VRT は未着手であり、崩れは人間が見るしかない。当面の材料はハンドブックの画面カードに載る SSR プレビュー（[book-previews.md](./book-previews.md)）と、実ブラウザで確かめたいときの `npm run shots` である。
- **`npm run shots` と `npm run dev` は同時に実行できない。** どちらも `.next` を共有し、撮影側が `next build` を掛けるため開発サーバーが壊れる（E2E スモークと同じ既知の問題。DB の多重起動ガードの守備範囲外であり、`distDir` を分ける対処はしていない）。
- **レスポンシブは設計していない。** ブレークポイントのトークンを持たず、確かめているのはデスクトップ幅（1280px）だけである。
- **G7 は CSS 経由の使用しか見ない。** `designTokenValues` / `designTokenVars`(CSS を持てない場所向けの TS 定数)からの参照は「使用」に数えない。現状どこからも import されていないため実害は無いが、将来この口を使い始めたら G7 の判定条件を見直す必要がある。

## 関連ドキュメント

- [tokens.md](../../../../../../specs/frontend/design/tokens.md) — トークンの実値（テーマ `night_library`）
- [screen-test.md](./screen-test.md) — 画面テスト（スタイルの変更で落ちないことの担保）
- [enforcement-matrix.md](../../../../backend/system/standards/conventions/enforcement/enforcement-matrix.md) — 機械執行の全件表
