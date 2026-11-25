---
doc_type: process
scope: frontend
norms: [PRIN-0001, PRIN-0006, PRIN-0007]
---

# ハンドブックの画面プレビュー(SSR プレビューの書き出しと鮮度)

ハンドブックの画面カードに載る「実物」をどう作り、どう新鮮に保つかの規約。描画は `app/`、章への埋め込みは `docs/` にまたがるので、両側で共通の決まりとしてここに置く。

## 目的

**「実物」が実装と一致していることを、人の善意ではなく機械で保つ。**

ハンドブック(`docs/book/`)の中身はほぼすべて生成物であり、古くなれば `generate:check` がエラーにする。実物だけが長らく例外だった —— **スクリーンショット**は生成物ではなく撮影物だったからで、鮮度は別枠の検査(かつての B 群)で近似するしかなかった。

いまは実物も生成物である。実装の画面部品を偽データで `renderToStaticMarkup` した **HTML 断片**を書き出し、章はそれに実装 CSS の写しを当てて縮小表示する。これで得たものは 3 つ:

- **バイナリが履歴に積もらない。** 撮り直しのたびに約 2 MB(可逆 webp でも 0.5 MB)が増えていた。断片は全 22 画面で約 140 KB のテキストで、差分が読める
- **撮影の運用が消える。** ブラウザもローカル Supabase も要らない。断片の書き出しは 3 秒で終わる
- **鮮度が近似でなくなる。** 「撮り直したか」を git のコミット時刻で推し量るのをやめ、**いま描いた結果と一致するか**を直接見る

## 参照するもの

- **描画の実体(既定の 1 状態)** — `app/src/app/__screens__/previews.tsx`(画面名 → 描画)と `previews-fixtures*.ts`(偽データ)
- **描画の実体(states.requires の状態別)** — `app/src/app/__screens__/previews-states.tsx`(画面 × `states.requires` → 描画、出せない組の理由)と `previews-fixtures-states.ts`(状態別の偽データ)。§状態別断片
- **描画の実体(操作の結果別)** — `app/src/app/__screens__/previews-action-states.tsx`(画面 × 操作の結果(`pending` / 拒否4分類)→ 描画。`initialPhase` を書けるのはこのファイルだけ)。§操作の結果別断片
- **書き出し・検査の実体** — `app/scripts/book-previews.mts`(`npm run book:previews` / `npm run book:previews:check`)
- **断片の置き場** — `docs/book/assets/previews/{画面名}.html`(既定)/ `{画面名}.{状態}.html`(states.requires の状態別・操作の結果別のどちらも同じ命名。先頭行は AUTO-GENERATED の注意書き)/ `_state-gaps.json`(出せない組の理由)
- **章への埋め込み(既定 + 状態別 + 操作の結果別)** — `legacy/spec-tools/lib/generate/render/book/screen-previews.ts`(既定。サニタイズ・重ね表示の切り出し・器)/ `screens-page-states.ts`(状態別 + 操作の結果別。同じ「状態ごとの見え方」に並べる)
- **CSS の写し** — `legacy/spec-tools/lib/generate/render/book/book-assets.ts` が `docs/book/assets/ui.css` に `.screen-preview` スコープで吐く
- **画面仕様の正** — [screen-spec-writing.md](../../../specification/standards/screen-spec-writing.md)(S 群。`states.requires` の語彙は §states)
- **検査の一覧** — [enforcement-matrix.md](../../../../backend/system/standards/conventions/enforcement/enforcement-matrix.md) の C11

---

## 2 コマンドの手順

```bash
cd app  && npm run book:previews   # ① 全画面を描いて断片を書き出す(約 3 秒)
npm run generate        # ② 断片を章(docs/book/screens.html)へ反映する
```

**画面の見た目に関わるものを触ったら、そのバッチの中で必ず 1 回通す。** ①を飛ばして②だけを回すと章は変わらず、`npm run book:previews:check` が落ちる。

画面を 1 枚足したら、`previews.tsx` の `RENDERS` に 1 行足す。足し忘れは検査がエラーにする(下の C11-a)。

## 検査(app 側の検査)

```bash
cd app && npm run book:previews:check
```

**これはテストではない。** 確かめているのは仕様ではなく「生成物が最新か」であり、`npm run generate:check` と同じ種類の検査である。だから `src/**` の外(`app/scripts/`)に置き、`npm run test:spec-tools` の母集合には入れない —— 入れると仕様⇔テストのトレース(A 群)が「注釈の無いテストファイル」として拾ってしまう。実行方法が vitest なのは、実装の画面部品をそのまま呼ぶ道具立て(TSX の変換・`@/` の解決・CSS Modules を素のクラス名に落とすプロキシ)が要るためで、素の node では画面 1 枚も描けない。

| # | 検査 | 何を見るか |
|---|------|-----------|
| C11-a | 画面の網羅 | `previews.tsx` が描く画面の集合が、生成物 `screenRoutes` の全画面と一致すること |
| C11-b | 断片の鮮度 | 置き場の断片が、**いま描いた結果**と 1 バイト違わず一致すること(過不足も見る) |
| C11-c | 状態別断片の網羅・鮮度 | 状態別の断片(states.requires + 操作の結果の 2 軸)が、それぞれの母集合(`screenRoutes[screen].requiredStates` / `.actions` が空でない画面 × 5 phase)から出せる組と過不足なく一致し、**いま描いた結果**と 1 バイト違わず一致すること。`_state-gaps.json`(出せない組の理由)も同じく鮮度を見る。§状態別断片・§操作の結果別断片 |

**免除は無い。** 落ちたら `npm run book:previews` を回す。それ以外の直し方は無い。

## 断片の作り方(なぜこの形か)

- **偽データは screenTest のものと共有しない。** screenTest の fixture は「宣言した部品が出るか」を確かめる最小のデータ(1 行で足りる)で、章に載せるのは**人間が眺めて意味が分かる**データである(名前・分館・日時が入っていなければ実物として読めない)。型はどちらも同じ query の戻り値なので、実装が形を変えれば typecheck が両方を同時にエラーにする
- **クライアント部品は初期マークアップまで。** `renderToStaticMarkup` は状態を進めないので、フォームは空、重ね表示(`<dialog>`)は閉じたまま出る。章はその閉じた `<dialog>` を**本体から外して** `open` を付け、「重ね表示」の欄に並べる —— 撮影時代は 2 つしか撮れていなかった重ね表示が、これで宣言された全数載る
- **CSS Modules のクラス名は素の名前で出す**(vitest の `classNameStrategy: "non-scoped"`)。章が当てる CSS は `ui.module.css` を写したもので、セレクタは `.pageWide` のような素の名前だからである。ビルド時のハッシュ名で出すと 1 つも当たらない
- **`composes:` はセレクタ側で継ぐ。** 素の CSS に `composes` は無く、実装では「両方のクラスが付く」ことで効いている。写す側(`ui-css.ts`)が合成元のルールに合成先のセレクタを並べて同じ効きにする
- **章に差し込む前にサニタイズする。** `<script>` / `<style>` / `on*` 属性を落とす(描画結果には現れないが、文書に生 HTML を差し込む経路に無防備な口を残さない)。操作できてしまうのは器の `inert` で止める

## 状態別断片(`{画面名}.{状態}.html`)

ここまでの断片は「データがある」という**1 つの状態**しか写さない。だが画面には他にも見せなければならない姿がある —— 読める行が 0 件のとき、入力エラーで一覧の代わりに指摘が出るとき、対象が見つからないとき。`screen_spec` の `states.requires`(値域: `loading` / `empty` / `error` / `not_found`。[screen-spec-writing.md §states](../../../specification/standards/screen-spec-writing.md)が正)はその**表示義務**の宣言であり、いまはこれも SSR プレビューで写す。

**母集合は生成物である。** `screens.ts` の `screenRoutes[screen].requiredStates` は `states.requires` をそのまま写した配列で、画面はここに載っている状態の分だけ断片を作り、載っていない状態の断片は作らない —— 仕様が要求していない見た目を先回りして見せると、その見た目自体が「仕様」の役割を持ち始めてしまう。

やり方は既定の断片と同じで、**deps(偽のクエリ結果)を差し替えるだけ**である。空を見せたいなら空配列を返す reader を渡し、入力エラーを見せたいなら `err({ kind: 'invalid_input', ... })` を返す reader を渡し、見つからないを見せたいなら `null` を返す reader を渡す —— どれも `_screens/` の描画ロジックは 1 行も触らない。`previews-fixtures-states.ts` が既定の deps( `previews-fixtures*.ts` )をスプレッドして**差分だけ**書くのは、同じ蔵書・利用者のデータを状態ごとに丸ごと書き写すと、どちらかだけ更新されて実物とズレるからである。

### 出せない状態がある(既知の穴として明示する)

`states.requires` を宣言していても、**deps の差し替えだけでは絶対に断片にできない**画面がある。理由は 2 つに大別できる。

1. **`'use client'` 部品の内部状態のうち、操作(action)に紐づかないもの。** `loading` の多くは実行器の `pending` そのものであり、いまは次節の手口で埋まる。それでも埋まらないのは、ドメインの操作を 1 つも発火しない画面の内部状態 —— OAuth ボタン(`login` / `invite`)の click ハンドラ、AI ストリーミング(`tutorial_chat`)、公開サイト 3 画面(`public_items` / `public_item` / `public_page`。読むだけで操作が無い)の `loading` —— で、`renderToStaticMarkup` はクリックもストリーミングも実行しないため、対応する実行器も無いこれらは断片にできない
2. **`notFound()`(`next/navigation`)が例外を投げる。** `not_found` を Next.js の 404 ページへ委譲している画面(`item_detail` / `item_manage` / `librarian_loans` / `librarian_holds` / `profile`)は、`renderToStaticMarkup` に渡す前に例外で止まる。同じ `not_found` でも、`public_item` / `public_page` のように**自前の JSX で「見つからない」を描く**画面は producible である —— 同じ状態名でも実装の作り方次第で出せるかが分かれる

出せない組は `previews-states.tsx` の `KNOWN_GAPS` に理由つきで載せ、`_state-gaps.json` に書き出す。章はそこに載っている組を「まだ出せない」の note として表示し、**空欄のまま見せない** —— 空欄だと「足し忘れ」なのか「原理的に無理」なのか読者に区別が付かない。`states.requires` にある状態が `KNOWN_GAPS` にも実装(`STATE_RENDERS`)にも無ければ、`previews-states.tsx` 自身が実行時に例外を投げる(足し忘れの検出。§検査)。

## 操作の結果別断片(`{画面名}.{phase}.html`)

`states.requires` が写すのは**読み取り**の表示義務だが、画面にはもう 1 つ写すべき姿がある —— **操作(action)を実行した結果**。送信中(`pending`)と、拒否の 4 分類(`invalid_input` / `guard_unsatisfied` / `forbidden` / `invariant_violated`。ARCH-BE-0013)である。これは [action-runner.md](./action-runner.md) の実行器が `initialPhase`(プレビュー専用の初期状態)を持ったことで初めて可能になった(第 1 段では「送信中」は `'use client'` 部品の内部状態でしかなく、断片にできなかった —— 上の §出せない状態がある①)。

**母集合は「この画面が発火する操作がある」画面 × 5 phase である。** 生成物 `screenRoutes[screen].actions` が空でない画面(`states.requires` とは無関係な、もう 1 つの独立した母集合)がすべて対象になり、`app/src/app/__screens__/previews-action-states.tsx` がそれを網羅する(母集合からの漏れも `previews-states.tsx` と同じ仕組みで実行時に検出する)。

**`initialPhase` を書けるのは `previews-action-states.tsx` だけ。** `app/eslint.config.mjs` の `no-restricted-syntax`(`PREVIEW_ONLY_RESTRICTED_SYNTAX`)が `__screens__/previews*` の外での使用(JSX 属性・オブジェクトのプロパティのどちらも)を禁じているため、個々の画面の描画ロジック(`_screens/*.tsx`)は「渡された要素をそのまま描く」枠(`actionPreview?: ReactElement`)を持つだけで、`initialPhase` という語彙を 1 度も書かない —— **本番の呼び側が誤って渡せる経路は増えていない**。画面につき代表 1 操作を実物の `ActionButton` で描くのは、母集合が「画面 × phase」であって「画面 × 操作 × phase」ではないためである。

`purchase_request_admin` / `site_page_admin` の `states.requires` の `loading` は、実はこの画面の行操作(`start_handling` / `create` 等)の送信中 state そのものであり、上の①の「出せない」を脱して producible になった(`previews-states.tsx` がここで作った `pending` の断片を再利用する)。

### 見つかった仕様の誤り(修正済み)

この機構(第 1 段)を作る過程で、`states.requires` の宣言と実装が食い違う画面が 3 つ見つかり、いずれも修正した(S12 として機械執行するようにもした。詳しくは screen-spec-writing.md §states)。

- **`item_check_admin` / `branch_admin` の `error`。** どちらも唯一の読み取りクエリ(`item_check_list` / `branch_list`)が `params` を持たず、`invalid_input` に到達する経路が無かった。実装はそれを自覚して「起こりえない」として `throw` していた(`states.requires` に `error` を書かない、という screen-spec-writing.md §states の規則に反していた)。**`states.requires` から `error` を外して修正した**(実装の `throw` は member_admin / invitation_admin と同じ「起こりえないことを assert する」慣習として残す —— 型の narrowing にも要る)
- **`item_list` の `error`。** 同じく `item_list` クエリは `params` を持たないが、こちらの実装は `throw` せず invalid_input の表示を防御的に描いていた。**こちらも `states.requires` から `error` を外して修正した**(実装・テストは変えていない —— 宣言より丈夫な実装を持つこと自体は問題ではない)

## 既知の穴

- **見た目の正しさは見ていない。** 見ているのは「断片が最新か」であって「崩れていないか」ではない。崩れの判定は人間の目のままである(幾何学的なレイアウト検査と VRT は未着手。matrix G6)
- **ブラウザで起きることは写らない。** 自己ホストのフォント(next/font)・クライアント側の状態遷移・スクロール連動は断片に無い。フォントは章側のフォールバック列(明朝/ゴシック)で近似する
- **実アプリとの一致は目視である。** 断片は実装の描画結果そのものだが、CSS の写し方(スコープ変換)まで含めた最終的な見え方が実画面と等しいことは機械が見ていない。疑わしいときは `cd app && npm run shots`(アサーションの無い撮影走査。成果物は gitignore 済みで履歴に入らない)で実画面を撮って並べる

## 検証方法

```bash
cd app  && npm run book:previews:check   # 断片(既定 + 状態別)が実装と一致するか
npm run generate:check        # 章が断片と一致するか
npm run test:spec-tools                  # 埋め込み側(screen-previews.ts / screens-page-states.ts)のユニットテスト
```

`screens-page.test.ts`(docs 側)は「母集合が `states.requires` から出ること」と「宣言していない状態の断片は出ないこと」を確かめる —— `legacy/spec-tools/__tests__/unit/generate/render/book/screens-page.test.ts`。

## 関連ドキュメント

- [styling.md](./styling.md) — 視覚層(G 群)。レイアウト検査がまだ無いことの説明はこちら
- [screen-test.md](./screen-test.md) — 画面仕様 ⇔ 実画面の突合(同じ描画の道具立てを使う)
- [screen-spec-writing.md](../../../specification/standards/screen-spec-writing.md) — 画面仕様(S 群)
- [enforcement-matrix.md](../../../../backend/system/standards/conventions/enforcement/enforcement-matrix.md) — 全検査の対応表(C11)
- [scripts-code-quality.md](../../../../common/tooling/standards/scripts-code-quality.md) — 生成器の設計規約(I/O と純粋ロジックの分離)
