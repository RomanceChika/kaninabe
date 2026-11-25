---
doc_type: decision
scope: common
id: ADR-0015
status: accepted
targets: [spec_dsl, verification, generation]
date: 2026-10-02
norms: [PRIN-0001, PRIN-0006, PRIN-0007, ADR-0003]
---

# ADR-0015: `screen_spec` の `layout` の部品が「生成物か・どの操作 / 読みを載せるか」を宣言する — `kind` / `action` / `reads` / `shows`

## Status

accepted (2026-10-02)。**改訂 (2026-10-03・束 画面 3a)**: `kind` の値域に `table` / `detail` を足し、属性 `reads` / `shows` を足した(下の「改訂 — 束 画面 3a」)。**改訂 2 (2026-10-03・束 画面 4a)**: `kind` の値域に `actions` を足し、属性 `edit` / `actions` を足し、確認の器を overlay に統一した(下の「改訂 2 — 束 画面 4a」)。

---

## Context

### 背景

画面の生成(設計記録 screen-generation-boundary。非公開)は、画面の要素を 3 層に分ける。**層 (a)** は仕様から一意に決まり好みの入らないもの(フォームの欄・制約・入力の型・確認の要否 …)で生成物にする。**層 (b)** は「選択肢が有限で、選ぶのが業務の意図」のもので、画面の宣言(`screen_spec`)が持つ。**層 (c)** は好みの入るもの(配置・余白・文言の温度)で、人が書く手書きの器が持つ。

層 (b) の中身のうち「**どのスロットに何を載せるか**」は `layout` が持つ。ところが「**その部品がどの操作を載せるか**」を書く場所が無い。`layout` の部品は名前(と `label`)だけを持つので、`branch_form` という部品が「分館の作成フォーム」であることは、**部品名の綴りと実装のファイル名にしか存在しない**(束 画面 1 の実装とレビューが実測した。`LayoutComponent` に欄が無い)。生成器は「どの部品をどの操作のフォームとして生成するか」を入力として持てず、名前から推すしかない。

### 前提条件

- フォームの欄の集合・並び・制約・入力の種類は、操作の入力スキーマ(生成 zod。`entity_spec` と `access_spec` から出る)から一意に決まる。画面が決めるのは「**どの部品がどの操作のフォームか**」だけである。
- 同じ操作に手書きのフォームと生成物のフォームが併存する移行期間を、**宣言の有無**で機械が区別できる必要がある(区別できないと二重実装が恒久化する)。
- 拡張の手順は [dsl-extension-triage.md](../../process/common/specification/playbooks/dsl-extension-triage.md) に従った。下の「トリアージの記録」がその結果である。

### トリアージの記録

- **手順 0(宣言の欠落として 1 行に)**: screen_spec の `layout` の部品に、「この部品はどの操作のフォームか」を書きたいが文法に無い。書きたい形は `branch_form: { kind: form, action: branch.create }`。
- **手順 1(迂回パターン集)**: P-1〜P-10 に該当なし。どれも可視性・ガード・参照の表現力の話で、画面の部品の属性の宣言ではない。
- **手順 2(別の見方)**: **命名規則で推す**(部品名 `{エンティティ}_form` から操作を導く) → これは**語彙の発明**であって宣言の代わりにならない。部品名は testid の骨格で自由語彙であり(S6 は snake_case と一意性しか見ない)、推す規則を決めると部品名に意味が乗って「名前を変えたら生成物が変わる」になる。**`opened_by` の向き** → `overlays[].opened_by` は「重ね表示 → それを開く部品」の向きの宣言で、逆向き(部品 → 載せる操作)は無い。overlay の `actions` を部品へ写す案は、操作を持たない部品や overlay に居ない部品を表せない。**キャッシュ / セキュリティ / 運用 / 告知の安定性** — 該当なし(画面の生成の話であり、読み取りの条件や公開範囲を動かさない)。
- **手順 3(2 実例)**: 同じ製品の中で、作成・編集のフォームを持つ画面が 6 枚以上ある(`branch_admin` / `item_check_admin` / `profile` / `librarian_items` / `item_detail` / `librarian_holds` …)。**ただし 1 製品の中の数え方であり、「別ドメイン・別プロジェクトでの再現」ではない**(手順 3 の数え方では 1 実例)。それでも導入するのは、手順 3 の例外条項ではなく、**層 (b) の設計決定がこの語を要求する**ためである(設計メモ §10-1 A「(a) にフォーム・一覧・詳細まで入れる」の決定は、『どの部品が生成物か』を宣言する口なしには実装できない — 口が無いと生成物と手書きの境が命名の約束事になる)。2 つ目の製品(archive)を立てる日に、この語彙が本当に一般かを再点検する。
- **手順 4(決定可能性)**: 変数は有限。`kind` は閉じた値域(いまは `form` だけ)、`action` は screen の `actions` の部分集合(全列挙で検査できる)。書き間違いは新しい検査 S17(下の「決定内容」)と、パーサー(S0)の語彙・組の検査が落とす。

---

## Decision

### 決定内容

**`screen_spec` の `layout` の部品(`chrome_spec` の部品を除く)に、`kind` と `action` の 2 つの属性を足す。**

```yaml
layout:
  body:
    center:
      - branch_form:
          kind: form                 # この部品は生成物(フォーム)。書かなければ手書きの部品(層 c)
          action: branch.create       # 載せる操作 1 つ(screen の actions に居る作成 / 編集)
      - branch_table                  # 手書きのまま
```

1. **`kind` を書かない部品 = 手書きの部品。** 手書きが既定で、生成物にするときだけ宣言する(**免除の語を作らない**)。値域は**閉じた語**で、この決定が足すのは `form` だけである。一覧・詳細(`table` / `detail`)は、その生成器ができた束(画面 3a)で足した(そのたびに本 ADR の「適用範囲」を更新する)。
2. **`action` は `kind: form` のとき必須・1 つ。** 接地先は `creates` / `writes`(作成か編集)。遷移(状態機械のイベント)と削除は欄を持たないのでフォームではなくボタンであり、書けない。
3. **検査 S17(error)**: (a) `action` がその画面の `actions`(`overlays[].actions` を含む。S2 / S10 と同じ母集合)に居る (b) 接地先が作成か編集で、遷移・削除ではない (c) 1 部品 1 操作 (d) 同じ操作を 2 つの `kind: form` 部品が載せていない (e) 載せる操作が実行計画で走る(`runner: manual` でない。manual は計画の外にあり、宣言しても生成物も期待木も出ない = 宣言したのに何も起きない状態を作らない。束 画面 2b の追補) — に加え、chrome の部品には書けない。ドメインに接地しない `action` は S2 の領分で、S17 は黙る(1 つの書き間違いに 2 つの指摘を出さない)。
4. **パーサー(S0)**: `kind` の値域・`kind` と `action` が組であること・`action` が操作 ID として読めること。`kind` / `action` は `label` と同じく部品のマッピングの中の予約語で、この名前の入れ子スロットは書けない。
5. **生成物**: `kind: form` の部品 1 つが生成物 1 本(`app/src/app/_screens/generated/{画面名}.{部品名}.tsx`)を持つ。期待ファイル木(閉世界)の `generated` はこの宣言から導かれる。**宣言が無ければ出力は 1 バイトも変わらない。**

### 適用範囲

`screen_spec` の `layout`(画面本体と `overlays[].layout`)の部品、S17・パーサー・生成器・期待ファイル木。`chrome_spec` の部品は書けない(操作を持たない外枠)。**既存の挙動は変えない** — `kind` を書かない部品は従来どおりである。参照の欄の選択肢(他の集約の id を読み取り経路から引く)を部品に宣言する口は、一覧・詳細の生成物と同じ束(画面 3a)で足した(下の「改訂」。`kind: form` の `reads`)。

### 改訂 — 束 画面 3a(読むだけの表・詳細・参照欄の選択肢)

**足したもの**: `kind` の値 `table`(読むだけの表。`returns: many` の読み 1 本)と `detail`(詳細の項目。`returns: one` の読み 1 本)・属性 `reads`(部品が出す読み。画面の `reads` の要素 1 本)と `shows`(出す欄。省略 = 読みの projection の id と ref の欄を除く全欄)。`kind: form` も `reads` を任意で持てる(参照の欄の選択肢の出どころ)。

```yaml
layout:
  body:
    center:
      - item_table:
          kind: table
          reads: query-item-list
          shows: [title, branch.name, starts_at, state]   # 併読の欄は {併読名}.{欄}。省略 = id と ref を除く全欄
      - item_summary:
          kind: detail
          reads: query-item-detail
          shows: [title, starts_at, branch.name, branch.access_note]
      - item_form:
          kind: form
          action: item.update
          reads: query-branch-options   # source が操作の入力の ref の欄(branch_id)の参照先と一致する欄の選択肢
```

**トリアージの記録(改訂分)**:

- **手順 0**: `layout` の部品に「どの読みを出すか・どの欄を出すか」を書きたいが文法に無い(書きたい形は `item_table: { kind: table, reads: …, shows: […] }`)。
- **手順 1(迂回パターン集)**: 該当なし。
- **手順 2(別の見方)**: `projection` を絞って 1 本の読み = 1 部品にする案(設計メモ §5)は、1 本の読み(`item_detail`)が複数の部品(概要・編集・次にやること …)を賄う実物で成立しない。**命名で推す**(`{読み}_table` から読みを導く)のは語彙の発明で、ADR 本文の Option 1 と同じ理由で退く。
- **手順 3(2 実例)**: 同一製品の中で、読むだけの表 2(`item_list` / `librarian_items`)・詳細 3(`item_detail` / `item_manage` / `public_item`)・参照欄 2(`branch_options` / `patron_options` を引くフォーム)。**本文と同じ注意 — 1 製品の中の数え方であり、手順 3 の数え方では 1 実例**。層 (b) の設計決定(設計メモ §10-1 A)が要求する語で、2 つ目の製品を立てる日に再点検する。
- **手順 4(決定可能性)**: 有限。`reads` は画面の `reads` の部分集合・`shows` は projection ∪ 1 件に決まる併読の欄・参照欄は操作の入力の ref の欄(全列挙で検査できる)。

**検査 S18(error)**: (a) `kind: table` の `reads` は `returns: many`・`kind: detail` は `one`・`kind: form` の `reads` は `many` で projection が `[id, 表示名 1 欄]`(選択肢の形) (b) `reads` が画面の `reads` の要素 (c) `shows` の欄が projection か 1 件に決まる併読の欄に実在し、ref の欄でない (d) `kind: form` の `reads` の `source` が、載せる操作の入力に居る ref の欄の参照先と一致する(一致する欄が無ければ error・2 欄以上なら曖昧で error) (e) 同じ読みを複数の table / detail が出すのは可 (f) `kind: table` を持つ画面は `states.requires` に `empty` を宣言する。chrome の table / detail は書けない。**(f) の向きの決定**: 設計の文言は「`empty` を宣言する画面は `kind: table` が要る」だったが、手書きの表が空状態を自前で持つ画面(`branch_admin` 等 11 枚)が `empty` を宣言しているので、その向きを error にすると生成物に移っていない画面が全部落ちる。生成の表が出す空の葉を宣言が覆うこと(逆向き)だけを要求する。パーサー(S0)は `kind` ごとの属性の組(table / detail は `reads` 必須・`action` 不可、form は `action` 必須・`shows` 不可)を見る。

**生成物**: `kind: table` / `detail` の部品 1 つが生成物 1 本(`_screens/generated/{画面名}.{部品名}.tsx`)を持つ。期待ファイル木(閉世界)・葉の表(`screens.ts` の `leaves`)・既定のスタイル(`screenTable*` / `screenDetail*`)はこの宣言から導かれる。行の型は生成 zod の行の型(`{Entity}Row`)から索引した型で、キーは**クエリの結果の型と同じ camelCase**(`Pick<Row, …>` の snake_case をそのまま使うと、手書きの camelCase の結果型を持つ器が全て詰め替えを要る — 結果型を snake に揃える工事は別に切る)。**snake_case への切り替えは生成器の 1 か所**(`screen-read-plan.ts` の `rowKeyOf`。キーの綴りの正はここだけで、生成物の行の型・セルの式・参照欄の選択肢の行の型が同じ関数を通る)。


### 改訂 2 — 束 画面 4a(編集する表・行のボタン・ボタン列・確認の器)

**足したもの**: `kind` の値 `actions`(1 行に対するボタン列。`returns: one` の読み 1 本)・属性 `edit`(`kind: table` が行をその場で編集する操作 1 つ)と `actions`(`kind: table` / `actions` がボタンにする操作の一覧)・`overlays[].label`(確認の見出し)。**確認の器を overlay に統一した**(束 2b で `kind: form` に持たせた部品の子の `confirm_bar` は廃止)。

```yaml
layout:
  body:
    center:
      - branch_table:
          label: 分館
          kind: table
          reads: query-branch-list
          edit: branch.update              # 行をその場で編集(列は writes の欄。shows とは併せない)
          actions: [branch.delete]         # 行ごとのボタン(reads の source の遷移か delete)
      - transition_bar:
          kind: actions                   # 1 行(returns: one の読み)に対する操作のボタン列
          reads: query-item-detail
          actions: [item.open, item.close]
overlays:
  - id: delete_confirm
    label: 分館を削除する                 # 確認の見出し(任意)
    layout: { body: { center: [confirm_bar] } }
    opened_by: branch_table                # 確認が要る操作を載せた部品を開く口
    actions: [branch.delete]
```

**トリアージの記録(改訂 2 分)**:

- **手順 0**: 「表の行で何を編集でき・どのボタンを出すか」「1 行に対するボタン列」を書きたいが文法に無い(書きたい形は `branch_table: { kind: table, edit: branch.update, actions: [branch.delete] }` / `transition_bar: { kind: actions, … }`)。
- **手順 1(迂回パターン集)**: P-1〜P-10 に該当なし(どれも可視性・ガード・参照の表現力の話)。
- **手順 2(別の見方)**: **画面の `actions` から部品を推す**案は、1 画面の `actions` が複数の部品に散るとき(`item_manage` は操作 9 本が 3 部品に散る)に、どの操作がどの部品のボタンか決まらない。**部品名で推す**のは語彙の発明(本文の Option 1 と同じ)。**生成器の設定に持つ**のは仕様の外に宣言を出すだけ(Option 3)。キャッシュ / セキュリティ / 運用 / 告知の安定性は該当なし。
- **手順 3(2 実例)**: 編集表 4(`branch_admin` / `item_check_admin` / `item_manage` の巻と蔵書点検表)・行の遷移 4(`patron_admin` / `purchase_request_admin` / `site_page_admin` / `invitation_admin`)・ボタン列 1(`item_manage` の `transition_bar`)。**本文と同じ注意 — 1 製品の中の数え方で、手順 3 の数え方では 1 実例**。層 (b) の設計決定(設計メモ §10-1 A)が要求する語で、2 つ目の製品を立てる日に再点検する。
- **手順 4(決定可能性)**: 有限。`edit` / `actions` は画面の `actions` の部分集合・遷移は `reads` の source の状態機械のイベント(全列挙で検査できる)。

**検査 S19(error)**: (a) `edit` / `actions` の操作がその画面の `actions`(`overlays[].actions` を含む)に居る (b) `edit` は編集(update)で `reads` の source のエンティティの編集・確認が要る操作でも `runner: manual` の操作でもない (c) **確認が要る操作(`confirm_required`)を載せた部品(`actions` の要素・`kind: form` の `action`)は、その部品を `opened_by` に持ち、その操作を `actions` に含み、`body.center` の `confirm_bar` を持つ重ね表示を宣言する** (d) `kind: actions` の `reads` は画面の `reads` の要素で `returns: one` (e) `actions` の要素は `reads` の source の状態機械のイベントか source の削除 (f) **行のボタンに載せる操作の入力は対象の識別子(`id`)だけ**(生成物は全ボタンを `{ id }` で呼ぶ。理由の欄などの入力が要る操作はボタンにできず、`kind: form` にする) (g) **確認の重ね表示は 1 つにつき、その部品が載せる確認が要る操作 1 つだけ**(2 つ以上を 1 つの重ね表示に束ねると確認ダイアログの testid が重複する。操作ごとに重ね表示を分ける)。chrome に `kind: actions` は書けない。パーサー(S0)は `kind` ごとの属性の組(table は `edit` / `actions` を任意・`actions` kind は `reads` と `actions` が必須・detail に `edit` / `actions` は書けない)と、`edit` と `shows` を併せて書かないことを見る。確認の要否(`confirm_required`)は検査も生成も意味解析の層の同じ導出(`deriveOperationAttributes`。action_spec の `ux` の上書きを適用した後)を読む。

**生成物**: `kind: table` の `edit` / `actions` を持つ表と `kind: actions` が、生成物 1 本(`_screens/generated/{画面名}.{部品名}.tsx`)を持つ。行のボタンと確認ダイアログは共有の部品(`components/action-runner/use-row-actions.tsx`)が持ち、生成物は**どの操作が出るか(行の状態と実行者のロールとの交差)と確認の器の testid・見出し**だけを渡す。葉の表には `save` / `row_error` / 行のボタン(`delete` / イベント名)が載る。

**決めたこと(設計が黙っていた所。暗黙にしない)**:

- **`edit` と `shows` は併せて書けない**(S0)。編集する表の列は `writes` の欄(器が `writable` で渡す)で決まり、`shows` が決める列と食い違う。読むだけの列を並べたいなら、`edit` を書かない表を別に置く。
- **`edit` に確認が要る操作は載せられない**(S19)。行をその場で保存する形に確認の器が無い。確認つきの編集は `kind: form`(確認の器を持てる)にする。
- **`edit` に `runner: manual` の操作は載せられない**(S19。`kind: form` の S17 (e) と同じ理由)。計画の外の操作は行の入力欄の集合を導けず、宣言したのに生成物が出ない状態になる。**行のボタン(`actions`)は manual の操作を載せてよい** — 遷移・削除のボタンが渡す入力は対象の識別子だけなので、生成 zod の入力の型が無くても `{ id }` で型が決まる(`item.confirm_fees` / `membership.erase` が実例)。
- **行のボタンの `delete` は行の状態で絞らない**。状態機械のイベントは `from` / `by` で交差して出すが、削除は `deletes` の `when` を先読みせず、押した結果の拒否(`guard_unsatisfied`)をボタンの下に出す(先読みを足すかは、削除が状態に依る実例が出た束で)。
- **実行者のロールは器が渡す**(`role` の props。遷移のボタンがあるときだけ)。`screen_spec` の `for` はグローバルロールの集合で、1 つに定まらないので、生成物は決め打ちしない。
- **確認の見出し(`overlays[].label`)の既定**は、遷移がイベントの `label`・予約 ID が既定の語(登録 / 保存 / 削除。`lib/messages` の `BUTTON_WORDING`)。確認の文言は `{見出し}。{注意書き}`(`ActionButton` と同じ組み立て)で、**行の名前を文に入れない**(生成物は行の名前の欄を知らない。入れたい画面は見出しに書く — 層 (c) の話ではなく仕様の話として、文言の口は overlay の `label` だけ)。 **(束 画面 5b で改訂 — 追記)**: 確認文は `{見出し}。{注意書き}` から `「{display_field の値}」{見出し}。{注意書き}` になった(名前は `entity_spec` の `display_field` を入力に、client 側で押された行から引く。ADR-0016)。「行の名前を文に入れない」は撤回で、`display_field` を宣言していない集約は従来の形のまま。注意書きの静的な差し込みは生成部品の `confirmNotes`(`ConfirmDialog` の `note`)が受け、製品固有の文言(終了の確認の「残り点検 N 件」)は器が渡す。
- **導出が「確認が要る」と言う操作を行のボタンに載せるには、確認の器か理由つきの上書きが要る**(4b)。旧手書きが確認なしで実行していた操作が、生成の表に載せた途端に S19 (c) に当たる — 利用者の無効化(`membership.disable`)は overlay を足し、購入希望の対応開始(`purchase_request.start_handling`)は 2026-08-26 の裁定(戻す業務が無い)を action_spec の `ux: { confirm: none, reason }` に移した。**S19 は `ux` 適用後の導出を、U1 は `ux` を見ない別の導出を読む**ので、後者の免除(`accepted_ux`)は残る(裁定の置き場が 2 つになる点は束 5 で整理する)。
- **1 つの行のボタンの部品が載せる確認が要る操作は、重ね表示を 1 つずつ持つ**(S19 (g))。確認ダイアログの testid が重ね表示の id で決まるので、束ねると重複する。
- **`kind: form` の確認も overlay に統一した**。2b で部品の子に出していた `confirm_bar` の葉(`{部品}.confirm_bar`)は廃止し、`overlay.{id}.body.center` / `.confirm_bar` を使う(題材の製品の `kind: form` は全数が確認なしで、出力は変わらない)。

---

## Consequences

### Positive（メリット）

- 「どの部品がどの操作のフォームか」が**宣言として読める**。生成器は名前から推さず、宣言を入力にする。
- 生成物と手書きの境が**宣言の有無**で決まる。生成物があるのに手書きが残る(二重実装)を、期待ファイル木の閉世界と `_components` の名前の突合で機械が落とせる。
- 迂回の余地がない。`kind` の値域は閉じており、免除の語を持たない。書き間違いは S0 / S17 が落とす。

### Negative（デメリット・トレードオフ）

- **語彙が 2 つ増える(`kind` / `action`)。** 書き場所は部品のマッピングの中に閉じ、誤った場所への記述は S0 / S17 が止める。
- **`action` の指す操作が本当にその画面の `actions` の部分集合であることは見るが、フォームが操作の全入力を過不足なく並べているかは、この宣言では見ない。** 並ぶ欄の正は生成 zod と `access_spec` であり、生成器が導く(宣言ではない)。
- **実例は 1 製品の中の複数画面である(手順 3 の数え方では 1 実例)。** 層 (b) の設計決定が要求するために導入した。2 つ目の製品を立てる日に、この語彙が本当に一般かを再点検する。
- **`kind` の値は生成物の形ごとに 1 語ずつ足していく。** 値が増えるたびに S17 / S18 の判定(どの `kind` がどの操作・読みの形を載せられるか)を拡張する必要があり、閉じた値域のまま検査が「`kind` ごとの規則表」になる(3a で `table` / `detail` を足し、読みの側は S18 に分けた)。

### Neutral（その他の影響）

- 生成物は単体で立つ(手書きの器が無くても `page.tsx` から直接呼べる)。器を書くかは任意。
- 部品名は引き続き testid の骨格であり、`kind` を足しても testid の写像は変わらない(`{画面名}.{スロットパス}.{部品名}`)。

---

## Alternatives Considered

### Option 1: 部品名の規則で推す(`{エンティティ}_form` → `{エンティティ}.create`)

- **Pros**: 新しい語彙が要らない。
- **Cons**: 部品名は testid の骨格で自由語彙であり、名前に意味を乗せると「名前を変えたら生成物が変わる」。作成と編集の区別・複数のフォームを持つ画面を表せず、規則の外れは黙って手書き扱いになる(検出できない)。
- **Why rejected**: 語彙の発明であり、宣言の代わりにならない(手順 2)。

### Option 2: `overlays[].actions` から部品へ写す(新しい語彙を足さない)

- **Pros**: `opened_by` と `actions` の既存の宣言だけで済む。
- **Cons**: overlay を持たない部品(画面本体に置くフォーム)を表せない。overlay の中のボタンの操作と、画面に常駐するフォームの操作は別の話である。
- **Why rejected**: 表せない部品がある。

### Option 3: 生成器の設定ファイルで「部品 → 操作」を持つ(仕様の外に置く)

- **Pros**: 仕様の文法が増えない。
- **Cons**: 仕様に書かれていない対応が仕組み側の設定にだけ存在し、S 群が見張れない(画面の宣言と設定が食い違っても誰も気づかない)。仕様が正(Spec as Truth)の原則に反する。
- **Why rejected**: 宣言を仕様の外に出すだけで、検査もレビューも届かなくなる。

---

## Implementation

### Tasks

- [x] 型(`LayoutComponent.kind` / `actionRefs`・`ComponentKind`)・パーサー(`parse-layout-form.ts`)
- [x] S17(`s17-form-component.ts`)・文面(`messages-screen-form.ts`)・S0 の語彙と組の検査
- [x] screen-spec-writing.md(§kind / action・S17)・テンプレート・enforcement-matrix(U13)
- [x] 生成器(`code-screen-forms.ts`)・期待ファイル木・既定スタイル・葉の表(束 画面 2a ②)
- [x] 改訂(束 画面 3a): 語彙 `table` / `detail` / `reads` / `shows`・S18・パーサーの組の検査・screen-spec-writing.md・テンプレート・enforcement-matrix(U14)・生成器(表・詳細・参照欄の選択肢・FieldLabels の全集約化)・期待木・既定スタイル・葉の表
- [x] 題材の製品の `branch_admin` への適用(束 画面 2a ③。同じ `branch_form` を載せる `librarian_items` / `item_manage` にも同じ宣言 — 部品の名前が同じ手書きの部品を 1 つ消すため)
- [x] 改訂 2(束 画面 4a): 語彙 `actions` / `edit` / `actions`(属性)・`overlays[].label`・S19・パーサーの組の検査・screen-spec-writing.md・テンプレート・enforcement-matrix(U15)・生成器(編集する表・行のボタン・確認の器・ボタン列)・フォームの確認の overlay 統一・`branch_admin` / `item_check_admin` への適用
- [ ] 改訂 2 の残り(束 画面 4b): `patron_admin` の行の遷移・`item_manage` の `transition_bar`・残りの行遷移表

### Timeline

- 開始: 2026-10-02
- 完了予定: 語彙と検査は同日、生成器と実証は束 画面 2 のうち

---

## Related Decisions

- **Supersedes**: None
- **Superseded by**: None
- **Related**: ADR-0003(表現力を制限し列挙ベース検証を採用する。S17 は列挙で検査できる範囲に収めた)/ ADR-0006(生成物をコミットし鮮度を検証する)/ ADR-0011(1 つの操作に粒度の違う入口があってよい — 保存点のフォームと単発の操作のフォームの関係)
- **Blocks**: None
- **Blocked by**: None

---

## References

- [dsl-extension-triage.md](../../process/common/specification/playbooks/dsl-extension-triage.md) — 拡張の手順(0〜4)
- [screen-spec-writing.md §kind / action / reads / shows](../../process/frontend/specification/standards/screen-spec-writing.md) — 書き方と S17
- 設計記録 screen-generation-boundary(非公開) — 層 (a)(b)(c) と束の切り方(§4・§9)
- [enforcement-matrix.md](../../process/backend/system/standards/conventions/enforcement/enforcement-matrix.md) — U13(S17)・U14(S18)・U15(S19)の行

---

## Notes

**`action` を 1 つに縛る理由。** 1 つの部品に 2 つの操作(作成と編集)を載せると、欄の集合・初期値・確認の要否が操作ごとに違う形を 1 つの生成物が持つことになり、生成物の形が「分岐の塊」になる。部品を分ければ、testid の骨格も操作ごとに 1 つになる。2 つの操作を 1 つの入口にしたい業務(下書き → 登録を 1 回で)は、画面の側の語彙ではなく**保存点**(usecase_spec。ADR-0011)の領分である。

**`kind` の値域が閉じている理由。** 値が開いていると `kind: whatever` が通り、生成器が知らない形の部品が「手書きでも生成物でもない」宙に浮く。閉じていれば、生成器を足す束が 1 語を足す(語彙の増加が必ず生成器の追加と対になる)。

**確認の葉の名前を増やさない(改訂 2 で overlay に統一)。** 確認が要る部品(`kind: form`・行のボタン)の確認ダイアログは、重ね表示の部品で既にある語 `confirm_bar`(`overlay.{id}.body.center.confirm_bar` の `.confirm` / `.dismiss`。器は `overlay.{id}.body.center`)で出す。束 2b〜2c で `kind: form` の部品の子に出していた `{部品}.confirm_bar` は、overlay の宣言(S19)が確認の器の正になったので廃止した。葉の名前 `submit` が製品のイベント id と綴りが重なる件は W1 の `KNOWN_COLLISIONS` に宣言してある。

**表の行のリンクを出す規則(暗黙にしない)。** `kind: table` の生成物が行のリンクを持つのは、**その画面自身の `navigations`(`on` にドットが無く、共有クロームから展開されたものでもない行)が、ちょうど 1 本**のときだけである。0 本ならリンクは出ない(口も無い)。2 本以上は「どの行の遷移か」が宣言から決まらないので、口を出さない(推測で 1 本を選ばない)。1 本のときは、その `on` の testid(`nav.{on}`)が行のリンクの testid になり、リンクになるのは先頭の列である。行の遷移先は**生成物が自分で組む**(遷移先の画面の `route` を `screenRoutes` から引き、動的セグメントが 1 つなら行の `id` で埋める。0 個なら `route` そのもの。2 個以上か実在しない画面なら、リンクを出さない — 生成物は throw しない)。器から関数を渡す口は無い(**生成物が `'use client'` — フックを呼ぶ表 — でも、server の器から関数の props は渡せない**。宣言から導けるものは生成物が自分で持つ)。行のリンクを持つのは読むだけの表と行のボタンだけの表で、**編集する表(`edit`)の行は入力欄の行なのでリンクを持たない**(リンクが要るなら編集しない表にする)。つまり**画面を 1 本の行遷移に絞る代わりに、宣言を足さずに済ませている** — 同じ画面に行の遷移が 2 本要る日は、`navigations` の側にどの部品の行かを宣言する口を足す改訂(トリアージ手順 0 から)になる。操作を伴う遷移(`on` にドットがある)は行の遷移ではなく、この規則に数えない。

**状態のセルの意味色は属性で渡す(`data-state`)。** 生成の表・詳細は、状態の欄のセルに表示名(文字)に加えて**状態の値そのもの**を `data-state="{state}"` で出す。生成物は色を知らない — バッジの色など意味色は、器の CSS / `skin` が `[data-state=…]` で当てる(層 (c))。文字だけでは状態の見分けが色に頼れず、生成物に色を入れると製品の語彙(どの状態が警告色か)を仕組みに持ち込むため、**属性だけを生成物が持つ**。

**行ごとの差し込み口(`rowExtras`)は宣言を持たない。** 読みの欄で表せない列(現在状態でできる遷移の案内・任免のボタンなど)は、`kind: table` の生成物が受ける `rowExtras?: Record<行の id, ReactNode>` と、その列の見出し `rowExtraHeader?: string` で器が足す(層 (c))。**関数ではなく、器が行ごとに描いた node を行の `id` を鍵にして渡す**(生成物が `'use client'` でも、node は server → client の境界を越えられる。関数は越えられない)。口は**全ての表が持ち**、渡したときだけ末尾に列が出る — 仕様に「差し込む列がある」宣言を足さない(宣言すると、器が差し込む中身(手書き)を仕様が知る形になり、`shows` の欄と手書きの列の境が語彙になる。2 実例が揃うまで足さない)。差し込む列に見出しの葉(testid)は付けない(`column.{欄}` は `shows` の欄の葉であり、手書きの列を混ぜない)。中身の葉は器が表の testid を接頭辞にして付ける。
