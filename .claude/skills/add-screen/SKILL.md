---
name: add-screen
description: 画面を1枚追加する完全手順。screen_spec（chrome/requires_auth/subject+precondition/reads/actions/navigations/layout/variants/overlaysの判定表）→ S検査 → 実装（_screens DI・生成testid・宣言∩遷移のボタン導出・writableFields）→ screenTest → unexposed消化 → 全検査。「画面を作りたい」「この操作をUIから起こせるようにしたい」ときに使う。
---

# 画面を1枚追加する

このリポジトリは**仕様が正（Spec as Truth）**である。実装を先に変えて仕様を後追いさせない。
このスキルは**手順の索引**であり、内容の正ではない。各手順の「正」に挙げた文書を必ず開く
（表とリンク先が食い違ったらリンク先が正）。

画面仕様が縛るのは**構造と配線**（何を読み・何を発火し・どこへ遷移し・どのスロットに何が載るか）だけである。
**見た目と操作感**（スタイル・文言・アニメーション・コンポーネントの内部分割）は実装の自由地帯であり、仕様に書かない。

## このリポジトリの進め方（ビルダー×レビュアー）

まとまった変更は **設計凍結 → ビルダーが実装 → 独立したレビュアーがレビュー → 裁定を反映** の4段で回す。
ビルダーは凍結した設計から外れる判断をしたら、その場で直さず**理由つきで報告**する。
レビュアーは実装を読まずに仕様と正典から期待を組み立て、差分を指摘する。
裁定は製品の作業記録に残し、正式化できるものだけ `docs/rules/` に昇格させる。
画面1枚のように閉じた作業では、ビルダー1人が **①⑥の全検査緑 ②自己レビュー（下の「わざと壊す観点」）** で代替してよい。

## 先に読む正典

| 何を | どこ |
|------|------|
| `screen_spec` / `chrome_spec` の書き方（S0〜S10 / 先読みの線引き / testid） | [screen-spec-writing.md](../../../docs/rules/process/frontend/specification/standards/screen-spec-writing.md) |
| screenTest の書き方（確かめること / 葉の命名規則 / 操作のボタン） | [screen-test.md](../../../docs/rules/process/frontend/system/standards/conventions/screen-test.md) |
| 読む経路の正 | [query-spec-writing.md](../../../docs/rules/process/backend/specification/standards/query-spec-writing.md)（クエリを足すなら `/add-query`） |
| 発火する操作の正 | [action-spec-writing.md](../../../docs/rules/process/backend/specification/standards/action-spec-writing.md)（操作を足すなら `/add-operation`） |
| 可視性・状態機械・ガード式の正 | [domain-spec-writing.md](../../../docs/rules/process/common/specification/standards/domain-spec-writing.md) |
| フォームと入力スキーマの共有 | [server-actions.md §フォームと Server Action は同じ導出スキーマを使う](../../../docs/rules/process/backend/system/standards/conventions/server-actions.md) |

---

## ① 先に確かめる — その画面が読む／発火するものは既にあるか

| 画面がやること | 先に必要なもの | 無ければ |
|--------------|--------------|---------|
| データを読む | その読み取り経路の `query_spec` | `/add-query` を先に回す |
| 操作を起こす | そのドメイン操作の `action_spec` と Server Action | `/add-operation` を先に回す |

画面だけ作っても呼ぶ先が無いなら、それは製品の `docs/specs/frontend/screens/README.md`（フロントマターの宣言の置き場。デモ製品の木には無い）の `unexposed` に
「バックエンドが未実装」と書いて待つ状態である（既存の宣言がその形をしている）。

## ② screen_spec を書く

置き場は `docs/specs/frontend/screens/{group}/{name}.md`（**ディレクトリは1段固定**。S0 が検査する）。
`{group}` は**画面の束ね方**（業務のまとまり）であり、集約名と一致しなくてよい（1画面が複数の集約を読むため）。
テンプレート: [`docs/specs/frontend/screens/template.screen_spec.md`](../../../docs/specs/frontend/screens/template.screen_spec.md)。
スキーマの正: [screen-spec-writing.md §スキーマ（screen_spec）](../../../docs/rules/process/frontend/specification/standards/screen-spec-writing.md)。

`id` は `screen-{name をハイフン区切りにしたもの}`、`route` は URL の形（動的セグメントは `:param`。`/items/:id`。置き場の綴りは後段が写す）。

### 判定1 — 入場の関門は3つ。書き分けは固定

| 関門 | 欄 | 問い |
|------|----|------|
| 資格 | `for` | **誰が見る画面か**。グローバルロール（`patron` / `anonymous` / `system`）だけ |
| セッション | `requires_auth` | **ログインが要るか**。実装の `requireSession()` に1対1で対応する観測可能な事実 |
| 業務条件 | `precondition` + `on_fail` | **いま入ってよいか**（対象の状態・時間窓） |

- **文脈依存ロール（`loan_owner` / `hold_owner`）を `for` に書かない**（S4 がエラーにする）。関係で入場を絞りたいなら `precondition`、行を絞りたいなら `query_spec` の `via`。
- **ログインの要否を `precondition` で表さない。** `actor` が持つのは `id` だけで、`actor.role` はどこにも定義されていない。
- **可視性を `precondition` で表さない。** それは `access_spec` の `reads` と RLS の担当。`precondition` が守るのは**体験**（意味のない画面に入らせない）であって安全ではない。

`precondition` を書いたら `subject`（`route` の動的セグメントが指すエンティティ＝式の起点）と `on_fail`（`redirect({画面id})`）を必ず書く。
式に書けるのは `subject` 自身のフィールド / `subject` の `context` で辿れるエンティティのフィールド / `now` と `actor.id` だけ（S5 が接地を検査する）。
`on_fail` で自分自身へ、あるいは互いに送り返さない（S5 が閉路としてエラーにする）。

### 判定2 — chrome を継承するか

| 状況 | `chrome` |
|------|---------|
| 既存の共有クロームの骨格と遷移を被せたい | 継承する（`chrome: chrome-library`） |
| 認証前の画面など、共有部を被せない | 書かない |
| **新しい共有クロームが要る** | `docs/specs/frontend/chrome/{name}.md` に `chrome_spec` を作る（`id` は `chrome-{name}`）。テンプレート: [`template.chrome_spec.md`](../../../docs/specs/frontend/chrome/template.chrome_spec.md)。**書けるのは6節だけ**（`doc_type` / `scope` / `id` / `name` / `layout` / `navigations`。allowlist なので綴り違いはエラーになる） |

**`entry_point` の判定**: ユーザーが最初に到達する画面（どこからも遷移してこなくてよい画面）だけ `true`。
それ以外の画面は、**必ずどこかの `navigations`（chrome からの展開を含む）の `to` に現れなければならない**（S3 が孤立画面としてエラーにする）。
新しい画面群を足して入口が無いなら、chrome 側にリンクを1本足すのが定石（誰に出すかを chrome が判断すると共有部が可視性を持つので、**全員に出す**）。

- **chrome は外枠で、画面の `layout` はその内側に入る**（スロットは衝突しない。chrome も画面も `header` を持てる）。
- **chrome の部品から出る遷移を各画面に書き写さない。** `chrome_spec` の `navigations` に1回書けばロード時に継承画面へ展開され、遷移グラフ（S3）もその展開後を見る。
- `chrome_spec` が持てるのは6節だけ（`doc_type` / `scope` / `id` / `name` / `layout` / `navigations`）。`reads` / `actions` / `for` / `test_cases` は持てない。

### 判定3 — `reads` と `actions`

- `reads` には `query_spec` の id を並べる。画面が読めるのは仕様化された経路だけ（S2）。`for` のロールがその `query_spec` の `for` に含まれること（S4）。
- `actions` にはドメインイベントID（`loan.check_out`）または予約ID（`loan.create` / `.delete` / `.update`）を並べる。
- **絞り込み条件・並び順を書かない**（それは `query_spec` の `filters` / `sort`）。
- **「この操作はこの状態でだけ押せる」を書かない**（可否の正は状態機械。画面が先読みで隠すと二重管理になる）。

### 判定4 — 先読みしてよいか（何を隠してよいか）

| 材料 | 先読み |
|------|:---:|
| 状態機械の宣言（`from` / `by`） | **してよい**（生成物＝遷移表から機械的に導ける） |
| 画面仕様の `actions` | **しなければならない**。出してよいのは「宣言した `actions` ∩ 状態機械の遷移」の**交差だけ** |
| 関係（ロールの `binding`） | **してはいけない**（画面が持っていない事実） |
| ガード式（`now > loan.due_at` 等）・競合 | **してはいけない**（評価に必要な事実が画面に無い） |
| 予約ID（`create` / `update` / `delete`）の `when` | **条件つきでしてよい**（下記3条件を全部満たすとき） |
| 実行者（`actor.id`）との突き合わせ | **してよい**（①の中に含まれる。画面は関門を通った時点で実行者を確実に持っている） |

**予約IDの `when` を先読みしてよい3条件**（全部満たすときに限る）:

| # | 条件 |
|---|------|
| ① | `when` が **`{フィールド} == リテラル`** または **`{フィールド} == actor.id`**（本人条件）の形（`and` / `or` / `in` の結合を含む）で、参照するパスが**その行の表示に現に使っている値**であること。`actor.id` が例外なのは、画面が実行者を確実に持っている（`requires_auth` の関門で解決済み）ためで、**関係（`binding`）の先読みとは別物**である（あちらは画面が持っていない他の行の事実） |
| ② | 他エンティティのフィールド（`item.state` 等）を参照するなら、**その実体を画面が `reads` していること** |
| ③ | 判定は**生成表のガード AST をエンジンの評価器（`evaluateGuard`）にかけて**行い、画面が状態名を手で書かないこと。評価できない（`unknown`）なら**先読みしない** |

**時刻（`now`）・他の行・関係は依然として先読みしてはならない**（①が自動的に排除する）。
**自分の行しか描かない画面では本人条件は常に真**なので、先読みしてもしなくても表示は変わらない
（評価を渡すかは実装の判断でよい。例: 自分の情報だけを描く画面）。
①②は**機械が見ていない**（規約でしか守られていない既知の穴）。破ると「見えている情報から作られていないフォーム」が生まれるので、自己レビューで必ず確かめる。

先読みの有無に関わらず、**拒否の表示（`ActionError` の4分類）は必要である** — 交差で残ったボタンも押せば断られうる。

### 判定5 — `navigations`

| きっかけ | `on` の書き方 | 検査 |
|---------|-------------|------|
| 操作の結果で遷移する | `{イベントID}.success` | そのイベントがドメインに接地し、かつ同じ画面の `actions` か `overlays[].actions` にあること（S2） |
| リンク・キャンセル・時間経過 | **ドットを含まない自由語彙**（snake_case） | `to` の実在だけ |

- **既定: 操作の失敗では遷移しない**（拒否は同じ画面に表示する）。`.failure` に相当する語彙は無い。
- **同じ `on` を2回書かない**（同じきっかけに2つの行き先があると宣言から決まらない。S2 がエラーにする）。
- **同じ画面に留まる操作も書き落とさない**（「作成後に同じ画面を読み直す」も遷移。`to` に自分自身を書く＝自己ループ）。
- 自由語彙の `on` には**画面内の操作の起点**を表す名前を書く（`home_link` / `signed_out`）。**この名前が指す相手は機械が確かめない**ので、`x1` のような無意味な名前でも検査は通る（レビュー対象の規約）。
- どこからも到達できない画面は S3 がエラーにする。`entry_point: true` の画面から `navigations`（chrome からの展開を含む）を辿って全画面に到達できること。

### 判定6 — `layout`

- スロットは**5つの値域**（`header` / `body.left` / `body.center` / `body.right` / `footer`）。どれを使うかは自由だが、**1つも使わない `layout` は書けない**（S6）。
- 値はコンポーネント名（snake_case）のリスト。コンポーネントは入れ子の `layout` を持てる（**3段まで**）。
- **1つのスロットの中で部品名を一意にする**（同じ名前が2つあると testid のスロットパスが2つの物を指す。S6）。別のスロットに同じ名前があるのは構わない。
- **スロット語彙を画面ごとに増やさない。** 収まらないものはコンポーネントの内側（実装の自由）か入れ子で表す。
- コンポーネントの内部分割・並び・余白・レスポンシブを書かない。

**排他表示（`variants`）の判定:**

| 状況 | 書き方 |
|------|-------|
| 同じスロットに載るが**同時には出ない** | `variants:` で束ねる。キー＝状態名（自由語彙の snake_case）、値＝部品 |
| 同時に出てよい | 並べて書く |

- **排他の「条件」は書かない**（「自分の返却前の貸出があるとき」は `query_spec` が返す件数から実装が決める）。
- **状態名は testid に現れない**（DOM 上はどちらか一方しか存在しないため）。
- 1スロットに `variants` を2つ以上書いてよい（別グループは互いに排他ではない）。
- `variants` は**予約語**であり、この名前の部品は置けない。

**重ね表示（`overlays`）の判定:**

| 状況 | 書き方 |
|------|-------|
| モーダル・ポップアップ。特に**戻る道の無い操作の前の確認** | `overlays` に `id`（画面内で一意）+ `layout` + `opened_by`（開く部品の名前。`layout` に実在すること）。操作を発火するなら `actions` |

- `actions` を持つ `overlays` には `opened_by` が必須（S0）。開く口の無い重ね表示は到達できない。
- 中の細かい活性・非活性（「理由未入力なら送信できない」）は書かない。
- **`navigations` の `.success` は、画面の `actions` か `overlays[].actions` のどちらかにあればよい**（検査も生成物も画面と重ね表示の**和**を1つの母集合として見る）。二重宣言は不要。

### 判定7 — `states.requires`

値域は `loading` / `empty` / `error` / `not_found`。**存在義務だけを縛り、表現（スピナーかスケルトンか、文言）は自由**。

| クラス | 宣言する条件 |
|--------|------------|
| `loading` | 読み込み中の表示を出す画面（`reads` があり、それが待ち時間として観測されうる）。読むものが無い画面には要らない |
| `empty` | 0件がありうる一覧を持つ |
| `error` | `reads` の `query_spec` の**どれかが `params` を持つ**とき。**どれも持たないなら宣言しない** — 読み取りの `invalid_input` は `params` の検査から出るので到達しない。宣言すると死に分岐が生まれ、それを緑にするために**偽のエラーを注入するテスト**が要る |
| `not_found` | **`reads` に `returns: one` のクエリがあり**、その 1 件が見つからないことがある。判定材料は `returns: one` であって `params` の有無ではない（`params` を持たない「自分の1件」でも、その行がまだ無い状態はありうる。例: 利用者自身のカード情報を1件読む画面） |

**存在義務だけを縛る。** 起こり得ない状態を宣言しない。
**この規則はまだ機械執行していない**（`states.requires` は生成物に載っておらず、突き合わせる相手が存在しない。S群のバックログ）。人間が見る。

### test_cases

- 形式は `action_spec` / `query_spec` と同じ（`id` / `type` / `covers` / `spec_ids` / `implementation` が必須）。
- `id` は `TC-SCREEN-{画面名を大文字にしたもの}-{NNN}`（画面名の区切りはアンダースコアのまま。例 `TC-SCREEN-ITEM_DETAIL-001`）。**全仕様を通じて一意**（A9）で**追記専用**。既存IDは `grep -rhoE 'TC-[A-Z0-9_-]+' docs/specs | sort -u` で確認する。
- `implementation` は `app/src/app/__screens__/{screen-name}.test.tsx::{テスト名}`。
- `spec_ids` に書けるのは `screen_spec` / `chrome_spec` / `query_spec` の id とドメインイベントID。**`access_spec` の id と不変条件 ID は書けない**（偽のクエリ結果を渡す画面テストからは1ミリも確かめられない）。
- **1件以上必須**（S9。免除の口は無い）。**`requires_auth: true` の画面は `covers: [forbidden]` のケースを1件以上**（S9）。
- `type: integration` は要求しない。`covers` は S9 の `forbidden` 以外**機械が消費しない**ので、画面側では `other` の多用は禁止対象ではない。

## ③ S検査を通して generate する

```bash
npm run verify
```

| 出たエラー | 何を直すか |
|-----------|----------|
| **S0** スキーマ適合 | 必須欄・置き場・`layout` の入れ子3段・`states.requires` の値域・`precondition` に `subject` と `on_fail`・`actions` を持つ `overlays` の `opened_by`・`chrome_spec` の6節 |
| **S1** ルート | `route` の表記、`route` / `name` の重複 |
| **S2** 参照実在 | `reads` / `actions` / `navigations[].to` / `chrome` / `opened_by` / `closes_on` の実在、`on` の形（`.success` かドット無し）、`on` の重複 |
| **S3** 到達可能性 | 孤立画面。`entry_point` から辿れない |
| **S4** ロール整合 | `for` がその `query_spec` を実行できるか（エラー）／`actions` の `by` と `for` の交差が空（**警告**。押したら断られるボタンが UX として正しい場合があるため） |
| **S5** 入場条件 | `subject` の実在、`precondition` の接地、`on_fail` の閉路 |
| **S6** レイアウト | スロット語彙・部品名の重複・`variants` の状態名・`overlays[].id` の重複・スロット0個 |
| **S7** 実ルート | `route` ⇔ `app/src/app` の `page.tsx` が**両方向で1対1**。`requires_auth: true` の `route` が前段 `app/src/proxy.ts` の `matcher` に覆われているか（**前段は生成物**。matcher は「接頭辞を除く全部」の形で生成され、手で足さない） |
| **S8** テスト突合 | `implementation` の実在 → `@tc` の存在 → テスト名の一致の3段、`spec_ids` の値域 |
| **S9** テストの網羅 | `test_cases` 0件、`requires_auth: true` なのに `covers: [forbidden]` が無い |
| **S10** UI到達の網羅 | 人間ロールの全操作がどこかの画面の `actions` に現れるか。現れないものは製品の `screens/README.md` の `unexposed` に理由つきで |

続けて生成:

```bash
npm run generate
```

出るのは5つ（いずれも仕様の写像。手で書かない）:

| 生成物 | 出力先 |
|--------|--------|
| 画面一覧表・遷移図（mermaid）・**ワイヤーフレーム**（3つ） | 製品の `docs/specs/frontend/screens/README.md` |
| **testid 定数** | `app/src/domain/generated/testids.ts` |
| **画面の配線表**（部品・排他グループ・遷移・`actions`・`overlays`・`slots`） | `app/src/domain/generated/screens.ts` |

ワイヤーフレームと遷移図を人間が読む（「この遷移は業務としておかしい」「この画面の形が意図と違う」は機械が判定できない）。

## ④ 実装する

### 実ルートを作る（S7 は両方向を見る）

| # | やること | 検査 |
|---|---------|------|
| 1 | `route` に対応する `app/src/app/**/page.tsx` を作る（ルートグループ `(name)` はパスから畳まれる。`_` 始まりのフォルダはルートを構成しない） | **S7**。仕様にあるのに実ルートが無い／実ルートにあるのに仕様が無い、の**両方向**で失敗する |
| 2 | `requires_auth: true` の `route` は、生成された前段 `app/src/proxy.ts` の `matcher`（文書の口の全部）に自動で覆われる。**手で足さない**（前段は `generate` の生成物。ブラウザ側の守りの束 2026-10-20） | **S7**。覆われていないとエラー |

### 置き場と DI

| 状況 | 置き場 |
|------|--------|
| 読むデータやセッションの解決など、**注入する依存がある** | 本体を `app/src/app/_screens/{screen-name}.tsx` に置き、`page.tsx` は既定の依存を渡して呼ぶだけ（**分岐を持たない**） |
| 注入する依存が**無い**（読むデータもセッション解決も無い） | `page.tsx` のままでよい。screenTest は default export を直接呼ぶ |

**分ける理由は「テストから依存を差し替えられるようにする」ことだけ**である。差し替えるものが無ければ分けない。
**注入するのは「読むもの」と「実行者は誰か」だけ。** 未セッションの行き先（`redirect('/login')`）は実装の `requireSession()` が持ち、テストから注入しない（注入できると `requires_auth` の突合相手が消える）。

### testid は生成物から引く

```tsx
import { itemDetailTestIds } from '@/domain/generated/testids';

const FORM_TESTID = itemDetailTestIds['body.center.borrow_form'];
<section data-testid={FORM_TESTID}>
  <input data-testid={`${FORM_TESTID}.title`} />   {/* 部品の内側は自由地帯 */}
</section>
```

- **`src/app/**` で `data-testid` に文字列を直書きしてはならない**（ESLint `TESTID_RESTRICTED_SYNTAX`）。テンプレート literal を手書きの文字列で始めることも禁止。
- **葉（部品の内側）は、宣言した部品の testid を接頭辞に持つ。** 名前は自由、置き場所は自由でない。スロット自身の定数に葉を生やしてはならない（`` `${ids['body.center']}.error` `` は不可）。この1本の規則で、宣言外の部品と葉が文字列の形だけで区別でき、screenTest が前者を検出できる。
- **状態表示（`error` / `empty` / `not_found`）は「代わりに出る相手の部品」の名前空間に置く**（一覧の代わりなら `…loan_table.error`）。器のスロットに置くと宣言外の部品と区別できなくなる。
- **エラーの葉は部品ごとに `.error` の1語彙**にする（読み取り失敗も操作の拒否も同じ語彙。`action_error` のような別語彙を作らない）。
- 重ね表示は `{画面名}.overlay.{overlay id}.{スロットパス}.{部品}`。

### 操作のボタンは宣言から導く

**画面がボタンにしてよい操作は「`screen_spec` の `actions` ∩ 状態機械の遷移（`from` / `by`）」の交差だけ**である。
材料は2つとも生成物（`screenRoutes[{画面}].actions` と `app/src/domain/generated/{machine}.transitions.ts`）。
**状態名の対応表を画面が持たない**（手で書けば、仕様を変えたときに画面だけが古い条件を持つ）。
ボタンの文言も生成物（`{machine}.labels.ts`）から引く。

- 予約ID（`create` / `update` / `delete`）はこの交差に乗らない（`from` が無い）。可否は `access_spec` の `when` にしかないので、**判定4の3条件**を満たすときだけ、生成表（`{entity}.creates.ts` / `.deletes.ts` / `.writes.ts`）のガード AST をエンジンの評価器にかける。満たさないなら口を出して、押した結果に委ねる。

  先読みしてよくても**テストの側は交差を組み立てられない**（材料が `from` / `by` ではなく `when` の AST 評価であるため）。確かめられるのは「宣言した操作それぞれに口があること」までである（[screen-test.md §操作のボタン](../../../docs/rules/process/frontend/system/standards/conventions/screen-test.md)）。
- イベント → Server Action の索引は `as const satisfies Record<{遷移表由来のイベント}, Action | null>` で **tsc に全域性を数えさせる**（`null` = 画面から発火する口が無い＝system専用イベント）。表にキーが無いと黙ってボタンが消える、という事故をここで塞ぐ。

### フォーム

- 制約を画面に書き写さない（`maxLength={100}` を書かない）。`app/src/domain/inputs/{entity}.ts` の導出（`app/src/domain/form.ts` の口）を、フォームと Server Action の**両方が import する**。
- **入力欄の初期値も口から作る**（`toInputValue`）。`null` の空欄化・数値の文字列化・日時の表記（ISO ⇔ `datetime-local`）を画面で書くと、送信側の変換規則とずれる。入力欄の `type` も属性から導く（`numeric` → `number` / `datetime` → `datetime-local` / それ以外 → `text`）。
- HTML の属性（`required` / `maxLength` / `min` / `max` / `step`）は口から導く。
- **どの入力欄を並べるかは生成された `writes` の表から導く**（`app/src/domain/preflight.ts` の `writableFields`）。画面がフィールド名を並べ直すと、仕様に1行足しても画面だけが古い集合を持つ。フィールドの**表示名**だけは画面が持つ（仕様に置き場が無い＝既知の穴）。
- **並ぶ入力欄が実行時に変わる編集フォームは、口の `parseField` でフィールドごとに検証する**（オブジェクト全体を1度に検証すると、並んでいないフィールドが「未入力」として落ちる）。
- 編集フォームは**行のスキーマ**（`{entity}RowSchema`）から導く（作成入力の `optional` では、一度入れた値を消せない）。
- クライアントで検証したことを理由にサーバー側の検証を省かない（クライアントの検証は UX であって関門ではない）。

### 読み取りの呼び出し

RSC から `app/src/composition/{aggregate}/queries.ts` のクエリ関数を呼ぶ。
クライアントコンポーネントから DB にアクセスしない。`useEffect` でデータ取得しない。読み取り専用の操作を Server Action にしない。

## ⑤ screenTest を書く

置き場は `app/src/app/__screens__/{screen-name}.test.tsx`（1画面1ファイル。`{screen-name}` は `name` をハイフン区切りにしたもの）。
共有の道具立ては2つ:

| ファイル | 責務 |
|---------|------|
| `app/src/app/__screens__/harness.tsx` | **描画する側**。レンダラー（`renderToStaticMarkup`）とルーター文脈だけを知る |
| `app/src/app/__screens__/declarations.ts` | **宣言と突き合わせる側**。生成物（`screens.ts`）だけを知る |

**`app/src/app/__screens__/` は `npm run test`（unit）で走る。** ブラウザも jsdom も使わない（RSC を関数として呼び、静的マークアップから `data-testid` と `href` を取り出す）。
テスト名は日本語で、`test_cases[].implementation` の `::` 以降と一字一句一致させる。`// @spec {仕様ID} @tc {テストケースID}` を書く。

### 宣言との突合の書き方

| 見るもの | 期待値の引き方 |
|---------|--------------|
| 宣言した部品の testid が全部ある | `declaredComponents({画面名})`（生成物から。**手で並べない**） |
| 重ね表示の部品が宣言どおりの名前空間に居る | `declaredOverlayComponents({画面名}, {overlay id})`。**画面の部品と混ぜない**（混ぜると閉じた状態のテストが落ちる） |
| 排他表示は片方だけ | **どの状態を見ているかをテストが必ず宣言する**（省略を「どちらでもよい」に倒すと、両方同時に描く実装が通る） |
| 描画結果の `href` の行き先が `navigations` の中にある | `undeclaredLinkTargets()`（`screenIdForHref()` が href → 画面id を解く）。突合は**実装 → 仕様の片方向**（押した結果の遷移は描画結果に現れない） |
| 宣言していない部品が生えていない | `undeclaredTestIds()`。**画面ごとに1回以上呼び、分岐した表示（エラー・空・排他のもう一方）はそれぞれ1回は通す** — 通っていない枝は誰も見ていない |
| 操作のボタンの集合 | 「`screenRoutes[{画面}].actions` ∩ `{machine}.transitions.ts`（`from` ∩ `by`）」を**実装とは独立に生成物から組み立てて**突き合わせる。**等値**で見る（⊆だけだと「宣言した操作のボタンが消えた」を見逃す）。**全状態を回す**（1状態だけ見ると、常に全部出す実装が偶然通る） |
| `requires_auth: true` の入場の関門 | 未セッションで `/login` へ送られること（`covers: [forbidden]`） |
| `precondition` | 成り立たないときに `on_fail` の画面へ送られること（**静的な突合が無いので、ここが唯一の担保**） |

### 重ね表示は「居るが閉じている」形にする

開いていないときに要素ごと消す作りにすると、宣言した部品が描画結果に1度も現れず、骨格を突き合わせる相手が居なくなる。
`<dialog open={...}>` のようにすれば、閉じた状態のままでも骨格を確かめられる。

### してはいけないこと

- **`vi.mock` でモジュールを差し替える**（注入点は引数だけ）。
- **テストのためだけに本体へフックを足す。**
- **期待する testid を手で書く**（骨格は生成物から引く）。
- **画面テストで可視性を確かめる**（偽のクエリ結果を渡している以上、1つも保証されない）。可視性は統合テスト（実RLS）、操作の可否はユニットテストと統合テストが守る。

### わざと壊す観点（自己レビュー）— これらを壊して赤になるか

| 壊すもの | 落ちるべきもの |
|---------|--------------|
| 宣言外の testid を1つ生やす | screenTest（`undeclaredTestIds`） |
| 仕様の `layout` から部品を1つ消す | **tsc**（生成 testid のキーが消える）→ 実装が型エラー |
| 実装のイベント→Server Action 索引から1キー落とす | tsc（`satisfies` の全域性） |
| 実装のボタンを1つ潰す（`finish: null` にする等） | screenTest のボタン集合の等値比較 |
| 仕様の `actions` から操作を1つ消す | **S2**（`navigations` の `on` が指す操作を発火しない）と **S10**（どの画面にも現れない） |
| 実ルートだけ作って仕様を書かない／その逆 | **S7**（両方向） |

**落ちなかった項目は、そこを誰も守っていないというサインである。**

## ⑥ unexposed を消化する

画面ができて `actions` に現れたら、製品の `docs/specs/frontend/screens/README.md` フロントマターの `unexposed` から**その項目を消す**。
消し忘れは S10 が警告する。逆に、まだ発火できない操作が残るなら理由を**そのまま**書く（「画面より先にバックエンドが無い」等）。

`unexposed` の綴りを間違えると（`unexposd:`）ローダーは「宣言なし」として黙る — 検査は厳しくなる側に寄るが、書いた人は気づかない（既知の穴）。

## ⑦ 全検査

リポジトリルートから回す（検証器・生成器の検査はルートの取り次ぎ。`app` の検査は**サブシェルで**回す —— `cd app` のあとは cwd が `app/` に残るため）。

```bash
npm run verify && npm run generate && npm run generate:check \
   && npm run typecheck:spec-tools && npm run test:spec-tools && npm run lint:spec-tools
(cd app  && npm run typecheck && npm run lint && npm run test \
   && npm run book:previews:check && npm run test:integration && npm run build)
```

- `verify` は **エラー0** が条件（警告は既存分が残っている）。
- screenTest は `npm run test`（unit）で走る。**`src/app/**` はカバレッジ計測の対象外**である（残る分岐が null 許容フィールドの表示フォールバックに寄り、埋めると文言だけを確かめる数字合わせになるため）。理由コメント込みで `app/vitest.config.mts` に固定されている。
- 仕様YAMLと生成物は同一コミットに含める。
- **ハンドブックの画面プレビューの書き直しは任意ではない。検査（C11）が強制する**: `(cd app && npm run book:previews)` → ルートで `npm run generate`（約 5 秒）。画面の見た目に関わるものを触ったバッチは、書き直さないかぎり `npm run book:previews:check` が赤いままである。**免除の仕組みは無い**（正: [book-previews.md](../../../docs/rules/process/frontend/system/standards/conventions/book-previews.md)）。**新画面なら `app/src/app/__screens__/previews.tsx` の `RENDERS` に 1 行と、`previews-fixtures*.ts` に偽データを足す**（足し忘れは検査がエラーにする）。

## 機械が見ていないもの（人間が見る）

自己レビューで意識的に確かめる。正は [screen-spec-writing.md §まだ検査していないもの](../../../docs/rules/process/frontend/specification/standards/screen-spec-writing.md) と [screen-test.md §既知の穴](../../../docs/rules/process/frontend/system/standards/conventions/screen-test.md)。

- **押した結果の遷移**（`{イベントID}.success` の `navigations`）— `router.push` とフォーム送信後は描画結果に現れない。
- **クリック・入力・送信の実挙動、ハイドレーション**（ブラウザ実行が要る。導出そのものは純関数に切り出してユニットテストで縛る。例: 貸出期限の計算を純関数にする）。
- **先読み条件①②**（参照するパスが現に描いている値か / 他エンティティを `reads` しているか）。
- **`states.requires` と実装の突合**（生成物に載っておらず、突き合わせる相手が無い。いま緑なのはテストが手で書いたからで、宣言が要求しているのではない）。
- **`precondition` / `on_fail` と実装の突合**（実装は条件を仕様から手で写している。行き先だけは生成物 `screenRoutes.{画面}.route` から引ける）。
- **自由語彙の `on` が実装のどのきっかけか**（接地先を持たない。規約でのみ縛る）。
- **予約IDの表示名**（ボタンの文言。仕様に置き場が無く実装が手で書いている）。
