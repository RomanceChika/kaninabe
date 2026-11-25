---
doc_type: process
scope: frontend
norms: [PRIN-0001, PRIN-0006, PRIN-0007, PRIN-0008, PRIN-0010, ARCH-SP-0002]
decisions: [ADR-0003]
---

# 画面仕様（screen_spec / chrome_spec）の書き方

`docs/specs/frontend/screens/{group}/{name}.md` に置く `screen_spec` と、`docs/specs/frontend/chrome/{name}.md` に置く `chrome_spec` の YAML スキーマと、検証器が実行するチェック（S0〜S19）を定義する。

## 目的

- 画面の**構造と配線**（何を読み・何を発火し・どこへ遷移し・どのスロットに何が載るか）を宣言に固定し、**見た目と操作感**（スタイル・文言・アニメーション・コンポーネントの内部分割）を実装の自由に残す。UI の変更の大半を占める微修正が「自由地帯の変更＝検証不要」と「配線の変更＝仕様から」に自動で分かれることが、この線引きの狙いである。
- 画面が**他の仕様を再定義しない**ことを形として強制する（ARCH-SP-0002 / PRIN-0007）。可視性の正は `access_spec`、読み取り経路の正は `query_spec`、操作の可否の正は `state_spec` にあり、`screen_spec` が書くのはそれらの**名前への参照**だけである。
- 「どこからも辿り着けない画面」「リンク切れの遷移」「読めないロール向けの画面」を、レビューではなく機械が検出できる形にする（PRIN-0006）。

## 参照するもの

- **実装側の写像**: `app/src/domain/generated/testids.ts` / `app/src/domain/generated/screens.ts`（生成物）・`app/src/proxy.ts` の `matcher`（S7 の突合先）・`app/src/app/__screens__/`（S8 の突合先）・`app/e2e/*.spec.mts`（S11 の突合先。trace の走査範囲に含む — [screen-test.md §E2E スモーク](../../system/standards/conventions/screen-test.md)）
- **画面テストの規約**: [screen-test.md](../../system/standards/conventions/screen-test.md)（`test_cases` が指す screenTest の書き方）
- **可視性・操作の正**: [domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md)（`access_spec` の `reads` / `creates`、`state_spec` の `events`）
- **式の文法**: 同上 §ガード式の文法（`precondition` は同じ文法・同じパーサーを使う）
- **読み取り経路**: [query-spec-writing.md](../../../backend/specification/standards/query-spec-writing.md)（`reads` の参照先）
- **書き込み経路**: [action-spec-writing.md](../../../backend/specification/standards/action-spec-writing.md)（`actions` が指すドメインイベント ID の語彙・`test_cases` の形式）
- **テンプレート**: `docs/specs/frontend/screens/template.screen_spec.md` / `docs/specs/frontend/chrome/template.chrome_spec.md`

<!-- TODO(port): 配置の正である ARCH-SP-FE-0001 は未整備。作成したら norms と本節に追加する。 -->

## 暫定（ユーザーレビュー待ち）

**本文書の次の 5 点は暫定の決定であり、動くものを見たうえでのユーザーレビューで覆りうる。** 覆った場合の影響範囲は「`docs/specs/frontend/` の仕様ファイルと、対応する検証器 1〜2 本」に閉じる（この範囲に収まるよう、5 点はいずれも追加的な語彙として設計してある）。

| # | 暫定の決定 | 覆ったときに直す場所 |
|---|-----------|-------------------|
| ① | **入場の関門を 2 つに分ける** — セッションの要否は `requires_auth`（真偽値）、業務上の入場条件は `subject` を起点にした `precondition`（ガード式）+ `on_fail`。**入場条件はドメインのパスに接地することを検査する** | 語彙 4 つと S5 |
| ② | **時間駆動の遷移は v1 では自由語彙**（`on: talk_time_ended` のように書き、検証の対象にしない） | `navigations[].on` の解釈と S2 |
| ③ | **タブはルートに昇格させる**（1 タブ = 1 画面 = 1 ルート）。クライアント内タブは「同一データの見せ方切替」だけに使う | 規約のみ（検証器なし） |
| ④ | **`overlays` と `chrome_spec` を語彙に追加する** — 重ね表示と共有クロームは 1 画面の内側では表せないため。**chrome は骨格に加えて遷移を持て**、ロード時に継承画面へ展開される | 語彙 2 つと S2 / S3 / S6 |
| ⑤ | **レイアウトは 3×3 スロット + 入れ子**（header / body.left・center・right / footer）。**chrome は外枠で、画面の layout はその内側に入る**（スロットは衝突しない） | `layout` と S6 |
| ⑥ | **排他表示は `variants`**（同じスロットに「どれか 1 つだけ出る」部品を並べる語彙）。状態名は自由語彙で、**どの状態でどちらが出るかは仕様では縛らない** | `layout` の語彙と S6・ワイヤーフレーム生成 |

出所は設計記録 screen-dsl-draft と、参考実例 23 画面に当てた設計記録 screen-dsl-stress-test（どちらも非公開。①〜⑤ はそこで「骨格は破れないが追加語彙が要る」と結論した 5 点である）。

## ルール・基準

### 共通形式

- **YAML フロントマターが正**とする。本文の手書き散文は標識 2 種のみ（§散文の規則）。
- `doc_type: screen_spec` / `scope: frontend` / `id` を必ず書く。`id` は `screen-{name をハイフン区切りにしたもの}`（例: `item_detail` → `screen-item-detail`）。
- **1 ファイル 1 画面**。ファイルパスは `screens/{group}/{name}.md` とし、ファイル名（拡張子を除く）は `name` と一致させる。ディレクトリは 1 段（S0 が検査する）。
- `{group}` は**画面の束ね方**（業務のまとまり）であり、集約名と一致しなくてよい。1 画面が複数の集約を読むため、`query_spec` の `{aggregate}` のような 1 対 1 の対応は成り立たない。
- 識別子（画面名・コンポーネント名・重ね表示 ID）は**スネークケース**とする。`id` だけはハイフン区切り。

### 散文の規則

手書き散文で書いてよいのは**標識 2 種・各 1〜3 行**のみ（2026-08-24 のユーザー裁定）: **否定の標識**（検討して捨てた自然な代替案。例:「variants のどちらが出るかの条件は書かない — 画面が読み取り条件を再定義してしまう」）と**線引きの標識**（「ここではやらない」のスコープ宣言。例:「◯◯の作成はこの画面に無い — creates 未宣言」）。

- 事実の再記述（YAML の言い換え・実装パスの写し）は書かない — 再記述はドリフト源である。
- 事実の可読形はファイル末尾の生成ブロック `screen-body`（入場・骨格・操作・排他 / 重ね表示・遷移・テストケースの表。chrome_spec は `chrome-body`）が担い、`npm run generate` が差し込む。手で編集しない。
- 系全体の意味論（入場の関門・chrome の展開・testid の規約など、その画面固有でない話）は本文に書かず、本書へのリンク 1 行に置き換える。
- 経緯・歴史（「第 1 波では〜」等）は `NOTES.md` へ。消費者への契約は標識 1 行に圧縮して残す。
- YAML フロントマター内のコメントは**行ローカルの短注（1 行）**のみ。段落級のコメントは標識に移すか削除する。

根拠: 同じ情報が二箇所に住むと片方が黙って嘘になる（2026-08-24 の例解ドリフト実測）。

### スキーマ（screen_spec）

全項目を 1 つに詰めた**架空の例**である（実物は §書き味の実例）。

```yaml
doc_type: screen_spec
scope: frontend
id: screen-sample-detail

name: sample_detail                # 必須。snake_case。testid は {name}.{スロット}.{部品} になる
label: サンプル詳細                # 任意。画面の日本語名（§label — 画面そのものの表示名）
route: /samples/:id               # 必須。URL の形（動的セグメントは :param）
chrome: chrome-library              # 任意。継承する共有クロームの id
for: [patron]                      # 必須。この画面を見るロール（グローバルロールのみ）
entry_point: false                 # 任意。ユーザーが最初に到達する画面なら true
requires_auth: true                # 任意（既定 false）。セッション必須（実装の requireSession()）

subject: sample                    # 任意。route の動的セグメントが指すエンティティ
precondition: state == closed      # 任意。入場条件（subject を起点に接地するガード式）
on_fail: redirect(screen-login)    # precondition があるとき必須

reads: [query-sample-detail]       # 任意。読む query_spec の id
actions: [sample.create, sample.submit] # 任意。発火するドメインイベント ID（予約 ID 可）

usecases: [sample_task.register]   # 任意。この画面から起こせる保存点（`{ユースケース名}.{保存点 ID}`）

platform_ops: [session.end_mine]   # 任意。この画面が露出するプラットフォーム操作（auth_spec の `platform_ops` の id。ドメインイベントでない認証基盤の操作。`actions` と並ぶ第 3 の口。ADR-0019）

navigations:                       # 任意
  - on: sample.create.success      # 操作の結果、保存点の結果、または UI 都合の自由語彙（例: cancel）
    to: screen-sample-detail
  - on: usecase.sample_task.register.success  # 保存点の結果（`usecase.` の名前空間）
    to: screen-sample-detail

overlays:                          # 任意。画面に重なる表示
  - id: report_dialog
    label: 通報する                # 確認の見出し（任意。確認の文言と実行ボタンの文言になる。§overlays）
    layout: { body: { center: [report_form] } }
    opened_by: report_button
    actions: [sample.report]
    closes_on: [report.success, cancel]

layout:                            # 必須
  body:
    center:
      - sample_summary
      - variants:                  # 排他表示。同時に出るのはどれか 1 つだけ
          no_loan: sample_form    # キー = 状態名（自由語彙）、値 = 部品
          has_loan:               # 部品は入れ子の layout を持ってもよい
            sample_panel:
              footer: [submit_bar]
      - sample_create_form:
          kind: form               # この部品は生成物（フォーム）。書かなければ手書きの部品（§kind / action）
          action: sample.create    # 載せる操作 1 つ（actions に居る作成 / 編集。S17）
      - sample_table:
          kind: table              # 表（returns: many の読み 1 本。生成物。S18）
          reads: query-sample-list # 出す読み（画面の reads の要素）
          shows: [title, branch.name]  # 出す欄（省略 = id と ref を除く全欄。併読は {併読名}.{欄}）
      - sample_ledger:
          kind: table
          reads: query-sample-list
          edit: sample.update      # 行をその場で編集する（列は writes の欄になり shows とは併せない。S19）
          actions: [sample.delete] # 行ごとのボタン（遷移か delete。確認が要れば opened_by の重ね表示が要る。S19）
      - sample_bar:
          kind: actions            # 1 行に対する操作のボタン列（reads は returns: one。S19）
          reads: query-sample-detail
          actions: [sample.open, sample.close]
  header:
    - page_title:
        label: サンプル詳細        # 部品の表示名（任意。§label）

states:                            # 任意。表示義務
  requires: [loading, error]

test_cases:                        # 任意。書いたら S8 が screenTest と突き合わせる
  - id: TC-SCREEN-SAMPLE_DETAIL-001
    type: unit
    covers: [success]
    spec_ids: [screen-sample-detail]
    implementation: app/src/app/__screens__/sample-detail.test.tsx::宣言したスロット部品がすべて描画される

smoke:                              # 任意。E2E スモークがこの画面を通るなら書く（§smoke）
  - summary: 利用者セッションで一覧が開けることを実ブラウザで通す
    implementation: app/e2e/smoke.spec.mts::利用者が3階層で申し込み、司書が貸出を締めて延滞料を確定し、予約を整えて中止するまで通る

ux:                                 # 任意。UX 原則から外れてよい場所の受け入れ（§ux）
  - principle: U4
    subject: sample.open
    reason: 並ぶのは別々のカードで、同時に選ばされるのは 2〜3 個である
```

#### name / label / route

- **すべきこと:** `name` を snake_case で書く。この名前は**そのまま testid のスロットパスの先頭**（`item_detail.body.center.loan_form`）になり、画面仕様とテストの対応をつくる。
- **すべきこと:** `route` を URL の形で書く（`/items/:id`）。動的セグメントは `:param`（`:` はセグメント全体。`/x/pre:id` は不可）で、同じ route の中で名前を重ねない。置き場の記法（Next.js なら動的セグメントの角括弧）は仕様に書かず、後段の写像が直す。動的セグメントの名前も実装の置き場と揃える。キャッチオールは文法に無い（要る日に足す）。旧い角括弧の記法で書くと S1 が error で「`:id` に書き直す」と名指す。
- **してはいけないこと:** `route` を末尾スラッシュ付きで書く、`:id` のような別フレームワークの表記で書く（S1 がエラーにする）。
- **すべきこと（推奨）:** `label` に**画面そのものの日本語名**（例: `label: 蔵書詳細`）を書く。部品の `label`（§label）の 1 段上で、原則は同じ「内部名で配線・label で表示」— **`testid` にも `route` にも現れず、配線は `name` のまま何も変わらない**。生成物だけがこの label を引く: ハンドブックの画面一覧の「日本語名」列・画面カードの見出し（`item_detail — 蔵書詳細`）・遷移図の節点（内部名 / 日本語名 / route の 3 行）、および `testids.ts` の `{画面名}Labels` の `screenTitle` キー（スロットパスは snake_case なので camelCase のこのキーと衝突しない）。空文字は不可、**全画面・全クローム間で重複不可**（S0。同じ表示名が 2 つあると一覧の行も図の節点も区別が付かない）。書かなければ従来どおり内部名だけで表示される。
- `chrome_spec` も同じ `label` を持てる（例: `label: 利用者向けクローム`）。規則・名前空間は画面と共通である。

#### for / requires_auth

- **すべきこと:** 「誰がこの画面を見るか」をグローバルロール（`patron` / `anonymous` / `system`）で書く。
- **してはいけないこと:** 文脈依存ロール（`loan_owner` / `item_librarian`）を書く。それは「その人と対象との関係」であり、画面を見る資格ではない。関係で入場を絞りたいなら `precondition`、行を絞りたいなら `query_spec` の `via` が受け皿になる（S4 がエラーにする）。
- **すべきこと:** セッションが要る画面に `requires_auth: true` を書く。実装の `requireSession()`（未ログインをログイン画面へ送る前段）に 1 対 1 で対応する、**観測可能な事実**の宣言である。

**入場の関門は 3 つあり、書き分けは固定されている。**

| 関門 | どこに書くか | 問い | 例 |
|------|-------------|------|-----|
| 資格 | `for` | **誰が見る画面か** | 利用者向けの画面＝ `for: [patron]` |
| セッション | `requires_auth` | **ログインが要るか** | `requires_auth: true` |
| 業務条件 | `precondition` + `on_fail` | **いま入ってよいか**（対象の状態・時間窓） | `state == closed` |

- **ログインの要否を `precondition` で表してはならない。** `actor` はドメインのエンティティではなく「実行者の識別子」だけを持つ予約語であり、`actor.role` のようなフィールドはどこにも定義されていない。ガード式で書けてしまうと、**評価器が評価できない条件**が仕様に住みつく。真偽値 1 つに落とすことで、入場条件の側はドメインのパスだけを見ればよくなり、接地を必須にできる（S5）。

**「この画面はどの関門(gate)に掛かるか」を画面が新しく宣言することはしない。** `requires_auth` と `for` はそれ自体が観測可能な事実であり、どの関門に掛かるかは**そこから機械的に導かれる**(`requires_auth: true` → auth_spec の `gates` のうち `guards: requires_auth` / `for` に auth_spec が宣言したロール(`gates[].role`。例: `librarian`)を含む → `guards: role_gate`)。この対応の正は auth-spec-writing.md §画面の関門は宣言から導く にあり、H4 が screen_spec ⇔ auth_spec を双方向に閉じる(画面が掛かる関門の宣言漏れはエラー、誰も掛からない関門は警告)。**新しい語彙(`gate:` のような欄)は screen_spec に足さない** — `requires_auth` / `for` という既存の 2 つの宣言だけで導出できるところに、宣言をもう 1 つ重ねると二重の正になる。

#### reads / actions

- **すべきこと:** `reads` に `query_spec` の id を並べる。画面が読めるのは仕様化された経路だけである（S2）。
- **すべきこと:** `actions` にドメインイベント ID（`loan.submit`）または予約 ID（`loan.create` / `.delete` / `.update`）を並べる。語彙は `action_spec` の `handles` と同じで、接地先も同じ（状態機械のイベント、または `access_spec` の `creates` / `deletes` / `writes`）。
- **してはいけないこと:** 画面が読む条件・絞り込み・並び順をここに書く。それは `query_spec` の `filters` / `sort` であり、画面は「どの経路を使うか」しか言わない。
- **してはいけないこと:** 「この操作はこの状態でだけ押せる」を書く。可否の正は状態機械であり、画面が先読みで隠すと二重管理になる。押した結果の拒否をそのまま見せるのが既定の作りである。

##### 先読みの線引き — 何を隠してよいか

管理画面のように操作が並ぶ画面では「いま押せない操作をボタンにするか」が必ず問題になる。**線引きは 1 本である。**

| 材料 | 先読み | なぜ |
|------|:---:|------|
| 状態機械の宣言（`from` / `by`） | **してよい** | 生成物（遷移表）から機械的に導けるので、画面が判断を発明しない。仕様に遷移を足せばボタンが増え、消せば消える |
| 画面仕様の `actions` | **しなければならない** | 宣言していない操作を画面が起こしてよい道理が無い（UI 到達の正は `screen_spec` である）。**出してよいのは「宣言した `actions` ∩ 状態機械の遷移」の交差だけ**である |
| 関係（ロールの `binding`） | **してはいけない** | 「その人が本当にこの蔵書の司書か」は画面が持っていない事実であり、判定を書けば可視性の判断を画面に持つことになる |
| ガード式（`now >= starts_at` など）・競合 | **してはいけない** | 評価に必要な事実（時刻・他の行）が画面には無く、書けば状態機械の評価器を画面に写すことになる |
| ガード式のうち、**画面が既に描画している事実だけで決まるもの** | **してよい**（下記の条件つき） | 状態機械のイベントは `from` を持つので交差で導けるが、予約 ID（`create` / `update` / `delete`）の可否は `access_spec` の `when` にしか書かれていない。ここを一律「先読み禁止」にすると、**下書き専用の削除ボタンが受理済みの申込みにも出る**（第 2 波の実測）。画面がその行の `state` を現に描いているなら、判定の材料は画面の中にあり、外の事実を持ち込んでいない |

##### 予約 ID のガードを先読みしてよい条件

**「その行について画面が既に描画している事実だけで決まる述語」であること。** 具体的には次の 3 つを全部満たすときに限る（Phase C-6 第 2 波の決定）。

| # | 条件 | なぜ |
|---|------|------|
| ① | `access_spec` の `when` が **`{フィールド} == リテラル`** または **`{フィールド} == actor.id`**（本人条件）の形（`and` / `or` / `in` で結合されたものを含む）で、参照するパスが**その行の表示に現に使っている値**であること | 「まだ描いていない値」を取りに行った時点で、画面が読み取り経路を発明している。**`actor.id` だけは例外**で、画面は実行者を確実に持っている（`requires_auth` の関門を通った時点で解決済み）ため、外の事実を持ち込むことにならない |
| ② | 他エンティティのフィールド（`item.state` など）を参照する場合、**その実体を画面が `reads` していること** | 読んでいないエンティティの状態を判定に使うには、それを取ってくる経路が要る。それは `query_spec` の話であり、画面が勝手に決めてよいことではない |
| ③ | 判定は**生成表のガード AST をエンジンの評価器（`evaluateGuard`）にかけて**行い、画面が状態名を手で書かないこと。評価できない（`unknown`）なら**先読みしない**（口を出して押した結果に委ねる） | 状態名を手で書けば、`when` を変えたときに画面だけが古い条件を持つ。`unknown` を「隠す」に倒すと、評価漏れが「操作が消える」という静かな形で出る |

**時刻（`now`）・他の行・関係（`binding`）は依然として先読みしてはならない。** 上の①が自動的にそれらを排除する（画面が描いていない事実だからである）。

**本人条件（`{フィールド} == actor.id`）を①に含めたのは Phase D-4 先行分の実測による。** `patron` の `writes`（`patron.id == actor.id`）がこの形で、判定に要る 2 値は**どちらも画面が確実に持っている**（実行者はセッション、対象の識別子は描いている行）。これは「関係（`binding`）の先読み」とは別物である — 関係は「その人がこの蔵書の司書か」という**画面が持っていない事実**の推測だが、本人条件は自分自身との突き合わせであり、外の行を 1 つも読まない。なお**自分の行しか描かない画面では常に真になる**ので、先読みしてもしなくても表示は変わらない（差が出るのは、同じ部品で他人の行を描く画面ができたときである。例: 自分の一覧だけを描く画面と、他人の行も描ける画面）。

実例は、状態が `draft` のときだけ起こせる操作（`state == draft` を `{集約}.deletes.ts` の AST から評価）と、行の状態に依る入場条件（`precondition` を `{集約}.writes.ts` の AST から評価）。入場条件の書式の実物は [`shelf_stock`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/stores/docs/specs/frontend/screens/store/shelf_stock.md)（`precondition: is_active == true`）。

したがって拒否の表示（`ActionError` の 4 分類）は先読みの有無に関わらず必要である — 交差で残ったボタンも、押せば `guard_unsatisfied` / `forbidden` / `invariant_violated` で断られうる。実例は [`desk`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs/frontend/screens/desk/desk.md)（実装は生成物 `screens.ts` の `actions` と `{machine}.transitions.ts` の交差を取る）。
- **`actions` は「その操作が UI から起こせる」という宣言でもある。** 人間が実行できる操作がどの画面の `actions` にも現れないと S10 がエラーにする。まだ画面を作らないなら `specs/frontend/screens/README.md` の `unexposed` に理由を書く — **その一覧が「これから作る画面」の一覧になる**。

#### navigations

- **すべきこと:** 画面から画面への遷移を `on`（きっかけ）と `to`（遷移先の画面 id）で並べる。
- **すべきこと:** 操作の結果で遷移するときは `on: {イベント ID}.success` と書く。このとき、そのイベントがドメインに接地し、かつ同じ画面の `actions` に宣言されていること（S2 が検査する）。
- **すべきこと:** それ以外のきっかけ（リンク、キャンセル、時間経過）は**ドットを含まない自由語彙**（snake_case）で書く。検査されるのは `to` の実在だけである。
- **すべきこと:** 自由語彙の `on` には**画面内の操作の起点**を表す名前を書く（`home_link` / `item_selected` / `signed_out`）。この名前が指す相手（どのボタン・どのリンクか）は**機械が確かめない** — 実装の内部事象であり、描画結果にも仕様にも現れないためである。したがってこれは**レビュー対象の規約**であり、`x1` のような無意味な名前や、画面に存在しない操作を指す名前を書いても検査は通ってしまう。
- **してはいけないこと:** ドットを含むのに `.success` で終わらない `on` を書く（`loan.submit.sucess` のような綴り違い、`loan.submit.failure` のような別の結果）。ドットは「操作の結果」を指す印であり、書けるのは成功だけである（S2 がエラーにする）。
- **既定: 操作の失敗では遷移しない。** 拒否は同じ画面に表示する（可否の正は状態機械であり、画面は押した結果を見せるだけ）。だから `.failure` に相当する語彙を持たない。失敗で別画面へ送りたくなったら、それは業務上「別の操作」である可能性が高いので、まずドメイン側を見直す。
- **してはいけないこと:** 同じ `on` を 2 回書く（同じきっかけに 2 つの行き先があると、どちらへ遷移するかが宣言から決まらない。S2 がエラーにする — 状態機械の決定性検査 V8 と同じ論法）。
- **してはいけないこと:** 同じ画面に留まる操作を書き落とす。「作成後に同じ画面を読み直す」も遷移であり、`to` に自分自身を書く（グラフ上の自己ループとして現れる）。
- **してはいけないこと:** 共有クロームの部品から出る遷移を各画面に書き写す。それは `chrome_spec` の `navigations` に 1 回書けば、継承する画面すべてに展開される。

##### 遷移の表示条件は行き先の入場条件から導く（宣言しない）

`to` が指す画面が入場条件（`requires_auth` / `for` / `precondition`）を持つとき、**その遷移（リンク）をいつ表示してよいか**は画面が新しく宣言しない。「この画面はどの関門に掛かるか」を画面が宣言しないのと同じ理由で、表示条件は行き先の画面が既に持っている宣言から機械的に導く（§for / requires_auth の「新しく宣言することはしない」と同じ線）。導出は生成物 `navigation-visibility.ts` が担い、実装は `NavLink`（`@/components/nav-link`）を経由する——書き方の規約は [navigation.md](../../system/standards/conventions/navigation.md) が正である。

#### subject / precondition / on_fail

- **すべきこと:** `route` の動的セグメントが指すエンティティを `subject` に書く。これが `precondition` の式を解決する**起点**になる（起点が無いと「`state` とは何の state か」が決まらない）。
- **すべきこと:** ロールでもセッションでも表せない入場条件をガード式で書く（文法は `domain-spec-writing.md` §ガード式の文法と同じ）。「編成中の蔵書でだけ並べ替え画面に入れる」「開始 10 分前から分館に入れる」がこの形になる。
- **すべきこと:** `precondition` を書いたら `subject` と `on_fail` を必ず書く。`on_fail` は `redirect({画面 id})` の形で、成立しない人の行き先を指す（S0 / S5）。
- **式に書けるのは次の 3 つだけ**であり、S5 が接地を検査する（解決できないパスは失敗する）。
  - `subject` 自身のフィールド（`state` / `subject.state`）
  - `subject` の `entity_spec` の `context` で辿れるエンティティのフィールド（`item.state`）
  - 予約語 `now` と **`actor.id`**（`actor` が持つのは識別子だけ。`actor.role` のような属性は書けない）
- **してはいけないこと:** 可視性（見えてはいけないデータ）を `precondition` で表す。それは `access_spec` の `reads` と RLS の担当であり、画面の入場条件を外しても見えてはいけないものは見えない。`precondition` が守るのは**体験**（意味のない画面に入らせない）であって、安全ではない（PRIN-0010）。
- **してはいけないこと:** `on_fail` で自分自身へ、あるいは互いに送り返す（弾かれた人が永久に往復する。S5 が閉路としてエラーにする）。

#### layout

- **すべきこと:** スロットは 5 つの値域（`header` / `body.left` / `body.center` / `body.right` / `footer`）から選ぶ。どれを使うかは自由だが、**1 つも使わない `layout` は書けない**（骨格を決めていない宣言は testid の骨格も生成できない。S6）。
- **すべきこと:** スロットの値はコンポーネント名（snake_case）のリストにする。コンポーネントは入れ子の `layout` を持てる（`- own_loan: { footer: [submit_bar] }`）。入れ子は 3 段まで。
- **すべきこと:** 1 つのスロットの中で部品名を一意にする（同じ名前が 2 つあると、testid のスロットパスが 2 つの物を指す。S6）。別のスロットに同じ名前があるのは構わない。
- **してはいけないこと:** スロット語彙を画面ごとに増やす。スロットパスは testid の骨格であり、語彙が開くと「見た目を変えてもテストが壊れない」という性質が成り立たなくなる。収まらないものはコンポーネントの内側（実装の自由）か入れ子で表す。
- **してはいけないこと:** コンポーネントの内部分割・並び・余白・レスポンシブの詳細を書く。縛るのは骨格だけである。

##### label — 部品の表示名（文言の規則）

部品は表示名を持てる（`- page_title: { label: 蔵書一覧 }`。入れ子の `layout` と並べて書いてもよい）。
`state_spec` の `states[].label` / `events[].label` と同じ線を画面の語彙まで延ばしたもので、規則も同じ —
**内部名（部品名 = testid の骨格）で配線し、表示はこの label を生成物経由で引く**。

- **仕様が持つのは業務の名詞だけ**（画面の見出し・部品名・フィールドのラベル）。説明文・ヘルプ・空状態やエラーの文言・ボタンの操作文は従来どおり**実装の自由**。
- 生成物は `testids.ts` の `{画面名}Labels`（キーは testid の表と同じスロットパス）。フィールドのラベルは `entity_spec` の `fields[].label`（`domain-spec-writing.md` §entity_spec）が持ち、`{entity}FieldLabels` から引く。
- `label` は任意。無ければ従来どおり文言は実装が持つ。空文字は不可、1 つのレイアウトの中で重複不可（S6）。**「label を書いたのに実装が使っていない」はまだ検査しない**（導出の配線は各画面の実装時に足す）。
- `label` はスロット名と同じ場所に現れる予約語であり、この名前のスロットは書けない（`variants` と同じ扱い。`kind` / `action` / `reads` / `shows` / `edit` / `actions` も同じ — §kind / action / reads / shows）。

##### kind / action / reads / shows / edit / actions — 部品が生成物であることの宣言（ADR-0015）

部品は「**この部品は生成物か・どの操作 / どの読みを載せるか**」を持てる（`- branch_form: { kind: form, action: branch.create }` / `- item_table: { kind: table, reads: query-item-list, shows: [title, branch.name] }`。`label` と同じく、入れ子の `layout` と並べて書いてもよい）。[ADR-0015](../../../../decisions/common/ADR-0015-layout-component-kind.md) の層 (b)「どのスロットに何を載せるか・どの操作 / 読みを出すか」の口である。

- **`kind` を書かない部品 = 手書きの部品**（層 c）。**手書きが既定**で、生成物にするときだけ宣言する（免除の語は作らない）。`kind` の値域は**閉じた語**で、`form`（単発の操作の作成 / 編集フォーム）・`table`（表。読むだけでも、`edit` で行を編集し `actions` で行のボタンを持ってもよい）・`detail`（詳細の項目）・`actions`（1 行に対する操作のボタン列）の 4 つ。生成物の形が 1 つ増えるごとに 1 語足す。
- **属性は `kind` ごとに決まっていて、組で書く**（片方だけ・書けない属性は S0）。

| `kind` | 必須 | 任意 | 書けない |
|--------|------|------|---------|
| `form` | `action`（載せる操作 1 つ） | `reads`（参照の欄の選択肢の出どころ） | `shows` |
| `table` | `reads`（出す読み 1 本） | `shows`（出す欄）・`edit`（行を編集する操作 1 つ）・`actions`（行のボタンにする操作の一覧） | `action`・`edit` と `shows` を併せること |
| `detail` | `reads`（出す読み 1 本） | `shows`（出す欄） | `action`・`edit`・`actions` |
| `actions` | `reads`（`returns: one` の読み 1 本）・`actions`（ボタンにする操作の一覧） | — | `action`・`shows`・`edit` |
| `platform_read` | `op`（auth_spec の `platform_ops` の `kind: read` 1 つ） | `shows`（返す欄の部分集合）・`row_actions`（行のボタンにする `kind: do` の操作） | `action`・`reads`・`edit`・`actions` |
| `platform_actions` | `ops`（ボタンにする `kind: do` の操作の一覧） | — | `op`・`reads`・`shows`・`row_actions` |

- **`action`**（`kind: form`）は 1 つ。その画面の `actions`（`overlays[].actions` を含む。S2 / S10 と同じ母集合）の要素で、接地先が `creates` / `writes`（作成か編集）であること。遷移（状態機械のイベント）と削除は欄を持たないのでフォームではなくボタンであり、書けない（S17）。
- **`reads`**（`kind: table` / `detail`）は部品が出す読み（query_spec の ID）。**画面の `reads` の要素**でなければならず（画面が読むと宣言した経路だけを部品が出せる）、`kind: table` は `returns: many`・`kind: detail` は `returns: one` の読みである（S18）。1 本の読みが複数の部品を賄ってよい（`shows` が違う）。
- **`shows`**（`kind: table` / `detail`）は出す欄の一覧。欄は読みの `projection` か、**1 件に決まる併読**（読みの source が併読先への `ref` の欄を持つ — 蔵書 → 分館）の `{併読名}.{欄}`（併読名は併読先のエンティティ名）。**ref の欄は出せない**（行に入っているのは id だけで人が読める値ではない。`branch.name` のように併読の欄で書く）。**省略すると、projection の id と ref の欄を除く全欄**（宣言順）になる（S18）。表の列を絞るのは「返さないものを書かない」（projection を絞る）か、この `shows` でやる。
- **`edit`**（`kind: table`）は行をその場で編集する操作 1 つ。画面の `actions` の要素で、`reads` の source のエンティティの編集（`{entity}.update`）であること。確認が要る操作は載せられない（行の保存に確認の器は無い）。`runner: manual` の操作も載せられない（実行計画の外で、行の入力欄の集合を仕様から導けない）。書くと**表の列は編集してよい欄（`writes`。器が `writable` で渡す）になり、各セルが入力欄になる**ので `shows` とは併せて書けない（S0）。変わった行だけ保存でき（変更が無い行は保存ボタンが押せない）、行ごとの拒否は行の中に出る（S19）。
- **`actions`**（`kind: table` / `actions`）は行のボタンにする操作の一覧。要素は画面の `actions`（`overlays[].actions` を含む）に居て、**`reads` の source の状態機械のイベントか、source の削除（`delete`）**であること。作成はフォーム・編集は `edit` で書く（S19）。ボタンは**行の状態と実行者のロールで交差**して出る（遷移の `from` に行の状態があり `by` にロールがあるもの。削除は状態で絞らず、押した結果で拒否を出す）。文言は遷移がイベントの `label`・予約 ID が既定の語（登録 / 保存 / 削除）。
- **確認の器は overlay に統一する**: 確認が要る操作（`confirm_required`。方針の導出）を載せた部品（`actions` の要素と `kind: form` の `action`）は、**その部品を `opened_by` に持ち、その操作を `actions` に含む重ね表示**を宣言する（`layout` は `body.center` に `confirm_bar`。S19）。生成物は overlay の testid（`overlay.{id}.body.center` が器・`.confirm_bar` の `.confirm` / `.dismiss`）で確認ダイアログを出し、確認の文言は `{「行の名前」}{見出し}。{注意書き}`（見出しは overlay の `label`、無ければ遷移はイベントの `label`・予約 ID は既定の語。注意書きは操作の属性から。**行の名前は集約が `display_field` を宣言しているときだけ**、見出しの前に鉤括弧で付く — 行の表の行のボタンと `kind: actions` のボタン列が対象で、名前は client 側で押された行から引く。読みがその欄を返さなければ付かない。[ADR-0016](../../../../decisions/common/ADR-0016-entity-display-field.md)）。**製品固有の注記**（例: 終了の確認に残りの件数）は、行のボタンを持つ生成物（表・ボタン列）が受ける `confirmNotes`（鍵は確認の器を持つ操作 ID・値は器が描いた node。`rowExtras` と同じ形）で確認ダイアログの本文の下に差し込む（層 (c)。語彙は足さない）。
- **プラットフォーム操作の部品**（`platform_read` / `platform_actions`・`kind: table` の `row_actions`。ADR-0019）は、読む相手が query_spec でなく auth_spec の `platform_ops` である。部品が載せる操作はその画面の `platform_ops`（`overlays[].platform_ops` を含む）の要素で、`op` は `kind: read`・`ops` / `row_actions` は `kind: do`。引数が `from: row` の操作は行を持つ部品の `row_actions` にだけ載り、`of` は部品が表にする読み（`platform_read` の `op` / `table` の `reads`）に一致する。確認が要る操作（`confirm: true`）は、その部品を `opened_by` に持ち `platform_ops` にその操作を含む重ね表示と、`body.center` の `confirm_bar` を持つ（S20）。chrome には書けない。
- **生成される部品の形**（`code-platform-parts`）: `platform_read` は 列・見出し（shape の `labels`）・整形（`formats: datetime` は器が表示のタイムゾーンを渡す）・行のボタン（行の識別子を入力に渡し、引数の `skip_if` が true の行は出さない。例: いまの端末の行）を持つ表／`platform_actions` は行を持たないボタン列（確認が要る操作は重ね表示の確認の器を経る）／`kind: table` の `row_actions` は、表そのものは `kind: table` の生成物のまま、行のボタンと確認・拒否の表示を持つ提供者（`…Provider`）と行ごとのボタン（`…Buttons`。手書きの器が `rowExtras` に差し込む）を別に出す（確認の器は操作ごとに 1 つで表の行の数に依らない）。手書きの器が行・Server Action・`timeZone` を渡し、部品は `_actions` を import しない。拒否の文言は auth_spec の `platform_ports` の `refusals` から引く（理由の語は画面に出さない）。
- **`kind: actions`** は 1 行（`returns: one` の読み）に対するボタン列で、同じ読みを `kind: detail` と共有してよい。ボタンの出し方・確認の器は表の行のボタンと同じ部品である。**行の状態と実行者のロールの交差に出せる操作が 1 つも無いとき**（終端の状態など）は、生成物が既定の案内（「いまできる操作はありません」）を `.empty` の葉で出す（葉の表の `empty`）。
- **`kind: form` の部品は生成物になる**: 欄の集合・並び・制約・入力の種類・確認の要否は操作の入力スキーマ（生成 zod）と `access_spec` / `entity_spec` から出て、**画面の側は欄を 1 つも書かない**。出力先は `app/src/app/_screens/generated/{画面名}.{部品名}.tsx`（部品 1 つ = 生成物 1 本）。手書きの器（`_screens/{画面名}.tsx`）が Server Action を渡して置く。同じ名前の手書きの部品（`_components/{部品名の kebab}.tsx`）が残っていると構造テストが落ちる（二重実装の恒久化を防ぐ）。
- **`kind: table` の部品は生成物の表になる**: 列は `shows`（省略時は既定）、見出しは `{entity}FieldLabels`（併読の欄は併読先の `FieldLabels`。**読みの source が併読先を指す `ref` の欄がちょうど 1 つで、その `label` が併読先の集約の `label` と違うときは、役割を前に添える** — 購入希望の `handled_by`（対応者）→ 利用者の表示名は「対応者の表示名」。蔵書の `branch_id`（分館）→ 分館は集約の `label` と同じなので「分館名」のまま。指す欄が複数あれば添えない。`kind: detail` の項目名も同じ）、セルの整形は日時 → `formatDateTime`（表示のタイムゾーンは器が `timeZone` で渡す）・真偽値 → 「はい / いいえ」・enum → `{entity}EnumLabels`・状態 → `{machine}StateLabels`・値無し → 「—」。行が 0 件のときの空の表示（`{label}はまだありません` — 部品の `label` から作る既定の 1 形）も生成物が持つので、**表を持つ画面は `states.requires` に `empty` を宣言する**（S18。逆向き — `empty` を宣言したから生成の表が要る — は求めない: 手書きの表が空状態を自前で持つ画面も `empty` を宣言する）。行から別の画面へ遷移する画面（`navigations` に画面自身の `on`（ドット無し）が**ちょうど 1 本**ある）は、先頭列がそのリンクになる（testid は `nav.{on}`。行き先は**生成物が自分で組む** — 遷移先の `route` を `screenRoutes` から引き、動的セグメントを行の `id` で埋める。器は何も渡さない。編集する表（`edit`）の行は入力欄の行なのでリンクを持たない）。読みの欄で表せない列（現在状態でできる遷移の案内・任免のボタンなど）は、器が `rowExtras`（行の `id` を鍵に、器が行ごとに描いた node を渡す。関数は `'use client'` の生成物に server の器から渡せない）と `rowExtraHeader`（その列の見出し。文字列）を渡すと末尾の列として差し込まれる（層 (c)。渡さなければ列は出ない。差し込んだ部品の testid は表の testid を接頭辞に持たせる）。フックを呼ぶ表（`edit` / `actions` を持つもの）は `'use client'` で、操作の列の見出しは保存のセルか行のボタンがあるとき必ず出る（列ずれを作らない）。
- **`kind: detail` の部品は生成物の `<dl>`**: `shows` の順に `<dt>{見出し}</dt><dd>{整形した値}</dd>`（整形は表と同じ）。1 つの読みから出す項目だけが生成物で、**別クエリ由来の項目・固定文・フォールバックの値・司書のような付随する併読は、器が隣に置く手書きの部品**（層 c）。
- `kind` / `action` / `reads` / `shows` / `edit` / `actions` / `op` / `ops` / `row_actions` は `label` と同じく**スロット名としては予約語**である（この名前のスロットは書けない）。chrome の `kind: table` / `detail` は書けない（chrome は読みを持たない外枠。S18）。`kind: actions` も同じ（S19）。
- **参照の欄**（他の集約の id）の選択肢は、`kind: form` の `reads` で宣言する。`reads` が指すのは**選択肢の形の読み**（`returns: many` で projection が `[id, 表示名の 1 欄]`）で、その `source` が**操作の入力に居る ref の欄の参照先**と一致しなければならない（一致する欄が無ければ error・2 欄以上なら曖昧で error。S18）。一致した ref の欄は、生成物が器から `options`（読みの行の配列）を受けて選択欄にする（先頭は「選ばない」選択肢で、既定の語は「未選択」。器が `emptyOptionLabel`（鍵は参照の欄の名前）で欄ごとに言い換えられる）。**参照先の集約が `display_field` を宣言していれば、`reads` の表示名（第 2 列）はその欄でなければならない**（S18。宣言の無い集約は従来どおり問わない）。`reads` の無い形は従来どおり**器が決めて渡す**: 作成のフォームは `initial`（参照の欄の値）、**欄ごとの選択肢は `choices`**（`{ 欄名: [{ value, label }, …] }`。ある欄を選択欄として描く。出どころは器の責務で、仕様の語彙ではない）。
- **編集のフォーム**（`action` が編集）は `initial` を**操作の入力と同じ型**で受け（対象の識別子といまの値。入力欄の文字列への写し — 数値の文字列化・値が無い欄の空欄化・日時の表記・真偽値の目盛り — は生成物がフォームの口で行い、器は文字列にしない）、出す欄は器が `writable`（書き込みの規則 × 対象の状態の先読み）で絞る。変わった欄だけ(編集を始めたときの値 `baseline` との差。refresh で届いた最新との差ではない)を送り、変更が無いあいだ・競合(他の人が先に変えた欄)が残るあいだは送信ボタンを押せない。確認が要る操作（`confirm_required`）を載せたフォームは、送信の前に確認ダイアログを挟む（要否は操作の属性から生成時に決まる。器は**その部品を `opened_by` に持つ重ね表示**で、S19 が要求する — 部品の子の `confirm_bar` は無い）。

##### 排他表示（`variants`）

同じスロットに載るが**同時には出ない**部品は `variants` で束ねる。束ねずに並べて書くと、
ワイヤーフレームも testid も「両方が同時に居る」と読めてしまう（C-1 の実測で最初に足りなくなった語彙）。

```yaml
body:
  center:
    - item_summary
    - variants:                     # ここから下は「どれか 1 つだけ」
        no_loan: loan_form        # キー = 状態名（自由語彙の snake_case）
        own_loan:                  # 値 = 部品。入れ子の layout を持ってもよい
          own_loan_panel:
            footer: [submit_bar]
```

- **すべきこと:** 状態名（キー）は「どういうときにその部品が出るか」が読める snake_case にする。語彙は閉じていない。
- **してはいけないこと:** 排他の**条件**を書く。「自分のアクティブな申込みがあるとき」は `query_spec` が返す件数から実装が決めることであり、条件まで仕様に書くと画面が読み取り条件を再定義してしまう（v1 で意図的に縛らない — 暫定⑥）。
- **状態名は testid に現れない。** DOM 上はどちらか一方しか存在しないため、パスに状態名を含めるとテストが「いまどちらが出ているか」を先に知らないと部品を引けなくなる。`loan_form` の testid は排他かどうかに関わらず `item_detail.body.center.loan_form` である。
- **部品名の一意性の規則は排他でも同じ**（S6）。排他だからといって同じスロットに同じ部品名を 2 つ置くことはできない（testid が 2 つの物を指す）。1 つの排他グループの中で状態名も一意にする。
- **1 つのスロットに `variants` を 2 つ以上書いてよい**。別のブロックは別のグループであり、互いに排他ではない（同じ状態名を使ってもよい）。ワイヤーフレームにはグループ番号が出る（`[排他1 …]` / `[排他2 …]`）ので、「各グループから 1 つずつ出る」ことが図から読める。
- **`variants` は予約語であり、この名前の部品は書けない。** スロットの要素に現れた `variants:` は常に排他グループの宣言として読まれるため、`variants` という名前のコンポーネントを置くことはできない（置いたつもりの宣言が、中身を部品名として読まれる）。部品には別の名前を付ける。

##### chrome との関係 — 外枠と中身（衝突しない）

`chrome` を継承した画面の `layout` は、**chrome の内側に入る**（Next.js の `layout.tsx` の入れ子と同型）。chrome が `header` を持っていても、画面が `header` を宣言してよい — 両者は別の階層にあり、取り合いにならない。

testid の名前空間も別で、次のように分かれる。

| 誰の部品か | testid |
|-----------|--------|
| chrome の部品 | `{chrome_name}.{スロット}.{部品}`（例: `patron.header.app_header`） |
| 画面の部品 | `{screen_name}.{スロット}.{部品}`（例: `item_list.header.page_title`） |
| 入れ子の部品 | 親のスロットパスを継ぐ（例: `item_detail.body.center.own_loan_panel.footer.submit_bar`） |
| 重ね表示の部品 | `{screen_name}.overlay.{overlay id}.{スロットパス}.{部品}`（例: `item_manage.overlay.cancel_confirm.body.center.confirm_bar`） |

**重ね表示（`overlays`）に `overlay.{id}.` を挟むのは、画面の `layout` と重ね表示の `layout` が
同じスロット名（`body.center`）を持てるためである。** 挟まないと定数表のキーが衝突し、どちらの
`body.center` かが引けなくなる。定数表は画面ごとに 1 つのままで（実装から見れば同じ画面が描く
ものであり、import を 2 つに割る理由が無い）、キーが `overlay.` で始まるものがそれにあたる。

##### testid — 骨格は生成物から取る（実装が書かない）

上の表の文字列は `layout` の写像でしかないので、**実装側の定数として生成する**
（`app/src/domain/generated/testids.ts`。`npm run generate` が出す）。画面は import して使う。

```tsx
import { itemDetailTestIds } from '@/domain/generated/testids';

const FORM_TESTID = itemDetailTestIds['body.center.loan_form'];
<section data-testid={FORM_TESTID}>
  <input data-testid={`${FORM_TESTID}.title`} />   {/* 部品の内側は自由地帯 */}
</section>
```

- 表に載るのは**スロット自身と、仕様が宣言した部品**だけである（キーはスロットパスそのもの）。器（`<main>`）にも testid が要るので、スロット自身も 1 本の定数になる。
- **部品の内側**（入力欄・行・エラー表示）は仕様が持たない自由地帯なので、生成定数を前置きにした派生（`` `${定数}.title` ``）で作る。
  **前置きにしてよいのは「宣言した部品」の定数だけ**である（スロット自身の定数に葉を生やして `` `${itemDetailTestIds['body.center']}.error` `` と書くことはできない）。この 1 本の規則があるおかげで、描画結果に現れた testid が「葉」か「宣言していない部品」かを機械が区別でき、screenTest が後者を検出できる（[screen-test.md](../../system/standards/conventions/screen-test.md) §葉の命名規則）。
- **`src/app/**` で `data-testid` に文字列を直書きしてはならない**（ESLint `TESTID_RESTRICTED_SYNTAX`。骨格を手で書けると仕様と DOM が静かにずれる — C-1 では共有ヘッダが `app.header.…` を名前に使っており、仕様の名前空間 `patron.header.…` と別物になっていた）。テンプレート literal を手書きの文字列で始めることも同じ理由で禁じる。
- **重ね表示（`overlays`）の testid も生成する**（上の表の 4 行目）。Phase C-6 の初実例
  （`item_manage` の `cancel_confirm`）で名前空間を決めたので、C-2 から開いていた穴は閉じた。
- **操作を伴わない `navigations`（`on` にドットが無い。一覧の行リンク・「もどる」リンクの
  ような screen_links）も生成する**（2026-09-04 拡張。BACKLOG「L3 ウォーカーの発見②」）。
  こういう遷移元は宣言した `layout` の部品と 1 対 1 で対応するとは限らない（1 つの部品
  `item_table` の下に行の数だけ遷移元がある、のような形）ため、`{画面名 or chrome
  名}.nav.{on}` という別枠のキーで表に載る（`nav` はスロット語彙に無い接頭辞なので衝突しない）。
  `{event}.success` 形（操作の結果としての遷移）はここに出ない —
  発火元のボタンは `actions` 経由で既に `layout` に骨格を持つ。共有クロームから展開された
  遷移（`viaChrome` を持つ）も出ない — 骨格は展開元の chrome の表が持つ。
  ```tsx
  import { itemListTestIds } from '@/domain/generated/testids';

  const NAV_ITEM_SELECTED = itemListTestIds['nav.item_selected'];
  <Link data-testid={NAV_ITEM_SELECTED} href={`/items/${item.id}`}>{item.title}</Link>
  ```
  この骨格が無いと screenTest / walker(`npm run walk` が実行する、仕様から導いた期待で画面を歩き回って破れを探す道具)がその遷移元の DOM 要素を機械で特定できない<!-- term: walker -->
  （実測: walker のクリック候補列挙は `[data-testid]` を持つ要素しか見ないため、testid の
  無いリンクは踏めない）。骨格を宣言した部品と同じ「常に描かれているはず」の期待には
  加えない（`app/src/domain/generated/screens.ts` の `navComponentTestIds` — `components`
  とは別の配列。行リンクは 0 件描かれる状況が普通にあるため）が、
  screenTest の「宣言に無い testid が描かれていないか」の許容集合には入る。

#### states

- **すべきこと:** 表示義務のある状態を `requires` に並べる。値域は `loading` / `empty` / `error` / `not_found`。
- **してはいけないこと:** 見せ方（スピナーかスケルトンか、文言は何か）を書く。**存在義務だけを縛り、表現は自由にする**（操作を実行した後の pending の見せ方は実行器が持つ — [action-runner.md](../../system/standards/conventions/action-runner.md)）。
- **すべきこと:** `not_found` は「**1 件引いて見つからないことがある**」画面に宣言する。判定の materials は `reads` の `query_spec` の `returns: one` であって `params` の有無ではない — **`params` を持たない `returns: one`**（「自分の 1 件」のように実行者から決まる読み取り）でも、その行がまだ無い状態はありうる（例: 集約の `creates` がドメインに無く、認証ユーザに対応する行が無い状態が実在する場合）。
- **してはいけないこと:** 起こり得ない状態を宣言する。**`reads` の `query_spec` がどれも `params` を持たない画面は `error` を宣言しない** — 読み取りの `invalid_input` は `params` の検査から出るものであり、`params` が無ければ到達しない。宣言すると、実装に到達しない分岐が生まれ、それを緑にするために**偽のエラーを注入するテスト**が要る（画面が守っているものは 1 つも増えない）。実例: [`item_list`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs/frontend/screens/catalog/item_list.md) は `empty` だけを宣言する。**S12 が機械執行する**（`reads` が空の画面は対象外 — その場合の `error` は読み取り以外の理由でありうる。2026-09-05、`item_check_admin` / `branch_admin` / `item_list` の実違反を機に追加）。

#### overlays

- **すべきこと:** モーダル・ポップアップを `id`（snake_case・画面の中で一意）と `layout` で宣言し、発火する操作があれば `actions` に書く（実在は S2 が見る）。
- **すべきこと:** `opened_by` に、これを開く部品の名前を書く。その部品が画面の `layout` のどこかに実在すること（S2）— 開く口の無い重ね表示は、どこからも辿れない画面と同じで到達できない。
- **任意:** `label` に確認の見出しを書く（確認の文言と実行ボタンの文言になる。部品の `label` と同じ口。無ければ遷移はイベントの `label`・予約 ID は既定の語（登録 / 保存 / 削除））。確認が要る操作を載せた部品の確認の器は重ね表示で宣言する（S19。§kind / action / reads / shows / edit / actions）。
- **してはいけないこと:** 重ね表示の中の細かい活性・非活性（「理由未入力なら送信できない」）を書く。縛るのは「その重ね表示がその操作を発火する」という配線までである。
- **`navigations` に `{イベント ID}.success` を書くとき、そのイベントは画面の `actions` か `overlays[].actions` のどちらかにあればよい。** 検査（S2 / S4 / S10）と生成物（`screens.ts` の `actions`）はどれも**画面と重ね表示の和**を 1 つの母集合として見る — どこに置かれたボタンでも、発火するのはその画面だからである。**Phase C-6 第 2 波の決定（V9）**であり、第 1 波では和を取っていなかったため、重ね表示が発火する操作を `navigations` に書くには同じ操作を両方へ並べる二重宣言が要った。
- **実例:** [`screens/desk/desk.md`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs/frontend/screens/desk/desk.md) の `overdue_confirm`（貸出の延滞の記録）と [`screens/claim/claim_detail.md`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/expenses/docs/specs/frontend/screens/claim/claim_detail.md) の `claim_delete_confirm`（申請の削除）。どちらも**戻る道の無い操作**の前に確認を挟むもので、`loan.report_overdue` / `claim.delete` は `overlays[].actions` にだけ書いてある（V9 の後は二重宣言が要らない）。testid の名前空間は §testid の表を参照。

#### test_cases

`action_spec` / `query_spec` と同形式であり、`@tc` の突合も同じ規則で行う（[action-spec-writing.md](../../../backend/specification/standards/action-spec-writing.md) §test_cases が正）。テストケース ID は**全仕様を通じて一意**であり、一意性は台帳を見る A9 が検査する。

- **形式は他の仕様と同じ**である（`id` / `type` / `covers` / `spec_ids` / `implementation` が必須）。テストケース ID は `TC-SCREEN-{画面名を大文字にしたもの}-{NNN}` とする（`TC-SCREEN-ITEM_DETAIL-001`。画面名の区切りはアンダースコアのまま残す — ID の形式が 3 つの部分で固定されているため）。
- **`implementation` が指すのは screenTest** である（`app/src/app/__screens__/{screen-name}.test.tsx::{テスト名}`）。書き方の正は [screen-test.md](../../system/standards/conventions/screen-test.md)。
- **`spec_ids` に書けるのは値域**である（S8 が実在を検査する）。
  - `screen_spec` の `id`（例: `screen-item-detail`）— 画面の配線そのものを守るテスト
  - `chrome_spec` の `id`（例: `chrome-library`）— 共有クロームの骨格を守るテスト
  - `query_spec` の `id` / ドメインイベント ID — その画面が読む経路・発火する操作
  - **`access_spec` の id と不変条件 ID は書けない。** 可視性と不変条件を守っているのは RLS と DB 制約であり、偽のクエリ結果を渡す画面テストからは 1 ミリも確かめられない。書けてしまうと「守られている」という見え方だけが増える。
- **`type: integration` は要求しない。** 画面が守っているのは配線であり、実 DB を通しても確かめられることは増えない（増えるのは読み取りの可視性で、それは `query_spec` の Q6 が既に要求している）。
- **1 件以上を必須とする（S9）。** テストを 1 本も持たない画面は、宣言した部品も遷移も実行時には誰も確かめていないのに静かに緑になる。A4（人間ロールの全イベントに `action_spec` を要求する）と同じ論法で、「書かなかったこと」の側を塞ぐ。**理由付きの免除（`unhandled:` 方式）は用意していない** — 画面は全部書ける規模であり、免除の口を先に作るとそれが既定の逃げ道になる。
- **`requires_auth: true` の画面は `covers: [forbidden]` のケースを 1 件以上持つ（S9）。** 未セッションでログイン画面へ送られることの実測であり、これが無いと `requires_auth` は宣言だけになる。**検証器が読めるのは仕様側の `covers` だけ**なので、そのテストが本当に `requireSession()` の結果を見ているかまでは見ていない（テスト名と実装の一致は S8 が担う）。

**書いたケースが何を確かめるかは [screen-test.md](../../system/standards/conventions/screen-test.md) §確かめること が正である。** `covers` は `action_spec` と同じ 8 分類をそのまま流用するが、**画面版の「必要な意味クラス」の導出規則（A7 相当）は無い**。

**したがって `covers` は原則として人間のレビュー材料であり、機械は消費しない。** 唯一の例外が S9 の `forbidden`（入場の関門）で、これだけは「そのクラスのケースがあるか」を数えている。それ以外のクラスは、書いても書かなくても検査の結論は変わらない。
- そのため **`other` の多用は禁止対象ではない**（`action_spec` の `covers` では「迷ったものを機械的に `other` にしない」と定めているが、あれは A7 の網羅判定を甘くしないための規則であり、数える相手がいない画面側には効かない）。画面の確認事項の多く（部品が描かれる・宣言に無い遷移先が無い・空表示がある）は 8 分類のどれにも当たらないので、素直に `other` を選んでよい。

#### smoke

E2E スモーク（[screen-test.md §E2E スモーク](../../system/standards/conventions/screen-test.md)）がこの画面を通ることの宣言（任意。2026-09-04 拡張。BACKLOG「E2E 注釈の受け皿」）。**`test_cases` とは別の、軽い受け皿である。**

- **書ける理由が違う。** `test_cases` は「1 テストケース ID = 1 画面」を前提にした台帳（A6/A9 が一意性と orphan を見る）に載るが、E2E スモークは 1 本の貫通シナリオが多数の画面をまたぐ（例: 利用者一覧 → 蔵書詳細 → 蔵書管理 → 司書一覧 → 予約の編成 → 公開サイト → ログイン、のような複数の画面）。すべての画面に同じテストを指す `test_cases` を書こうとすると、同じ物理テストに複数のテストケース ID を振ることになるが、**注釈（`// @spec ... @tc ...`）は 1 本の物理テストに 1 つしか付けられない**（直前のコメント行しかテスト宣言を飾れない）。そのため `smoke:` は台帳を経由しない別の語彙にした。
- **すべきこと:** `summary` にこの画面を通る手順の要約（日本語 1〜2 行）を書く。`implementation` は `test_cases` と同じ `{パス}::{テスト名}` 形式だが、パスは **`app/e2e/*.spec.mts`**（Playwright のスモーク。`app/src/app/__screens__/*.test.tsx` ではない）に限る。
- **正の登録はどれか 1 画面が `test_cases` で担う。** 台帳に載る本物のテストケース ID（`TC-SCREEN-{画面名}-{NNN}`）は、その E2E テストの中で最も中心的な画面（実例: `item_detail`）が `test_cases` に持ち、`spec_ids` にスモークが通る**全画面の id**を並べる。テスト側の注釈は 1 本（`// @spec {画面id...} @tc {テストケースID}`）で、`@spec` に空白区切りで複数書ける語彙をそのまま使う（実例: 製品の E2E の貫通スモーク `smoke.spec.mts`）。**他の画面の `smoke:` はこの 1 本の注釈を「指すだけ」で、自分のテストケース ID を持たない。**
- **してはいけないこと:** `smoke:` に新しいテストケース ID を発明する。台帳に載らない ID を書いても誰も突き合わせず、書いたのに効いていない宣言になる。
- 実在は **S11** が見る（走査結果の `@tc` アノテーションと `{file}::{テスト名}` の組が一致するかだけを見る。`@tc` の ID そのものまでは突き合わせない — それは正の登録を担う画面側で S8 が既に見ている）。

#### ux

UX 原則（台帳の[雛形](../../../../../specs/frontend/template.ux_principles_spec.md)・検査は [ux-lint.md](./ux-lint.md) の U 群）から**この画面だけ外れてよい**と決めた指摘を、理由つきで受け入れる口である。**受け入れだけ**で、事実の欄（`confirm: required` のように画面が方針を決める欄）は開けない（画面が方針を再定義する口にしないため）。action_spec の `ux: { confirm, reason }`（導出の上書き）と同じ「UX 原則への態度」の口だが、形は別である。

- **書くもの:** `principle`（原則の ID。U1〜U5）・`subject`（指摘の「反例: subject=...」の文字列。**画面は自明なので `screen-{name}/` の接頭辞は付けない**。画面そのものへの指摘 — U3 など — は省略）・`reason`（日本語で「なぜその UX でよいのか」。空は S0 がエラーにする）。
- **すべきこと:** 受け入れは**指摘が出ているときだけ**書く。出なくなったのに残っている宣言・存在しない原則の ID・同じ画面での重複は U0 が警告する。
- **してはいけないこと:** `principle` / `subject` / `reason` 以外のキーを書く（S0）。
- 受け入れの一覧は、ハンドブックの「UX 原則」の章に画面ごとの表（理由つき）で出る。

### スキーマ（chrome_spec）

```yaml
doc_type: chrome_spec
scope: frontend
id: chrome-library

name: patron
label: 利用者向けクローム            # 任意。クロームの日本語名（§label）
layout:
  header: [app_header]
navigations:                       # 任意。共有部の部品から出る遷移
  - on: signed_out                 # ドットを含まない自由語彙のみ
    to: screen-login
```

- **書けるのは `doc_type` / `scope` / `id` / `name` / `label` / `layout` / `navigations` の 7 つだけ**である（allowlist。これ以外は S0 がエラーにする）。禁止リストではなく許可リストにしてあるのは、綴りを間違えた宣言（`navigation:`）が黙って無視されて「書いたのに効いていない」状態が残るのを防ぐためである。
- **`reads` / `actions` / `for` は持てない。** 許すと「この画面が何を読み・何を発火し・誰が見るか」が画面仕様から消えて共有部に隠れ、画面ごとの検査（S2 / S4）がその分だけ効かなくなる。
- **`navigations` は持てる。** 共有ヘッダのボタンから出る遷移（ログアウト → ログイン画面）を継承画面すべてに書き写すのは、chrome を導入した動機そのものを裏切る。ここに 1 回書けば**ロード時に継承画面へ展開**され、以降の検査（S2 / S3）と遷移図は展開後のグラフを見る。
- **`on` にドットは書けない。** `{イベント ID}.success` は「その操作を宣言している画面」でしか書けず、chrome は `actions` を持たないためである。

##### 展開の見え方

`chrome-library` に `home_link → screen-item-list` を持たせると、それを継承する `item_detail` から一覧への辺が**遷移グラフに現れる**。共有部の遷移を宣言しなかった頃は、詳細画面から一覧へ戻る道がグラフ上に存在せず、到達可能性（S3）が実態より貧しいグラフを見ていた。

### 薄さの基準

次のいずれかを書きたくなったら、書く場所が違う。

| 書きたくなったもの | 正しい置き場所 |
|-------------------|--------------|
| 誰にどこまで見えるか / どの列を隠すか | `specs/domain/{aggregate}/access.md` |
| フィールドの型・必須・最大長（フォームの入力制約） | `specs/domain/{aggregate}/entity.md`（画面は生成された zod スキーマを使う） |
| どの状態でその操作ができるか | `specs/domain/{aggregate}/states.md` |
| 何を受けて何を書き換えるか | `specs/backend/actions/{aggregate}/{event}.md` |
| どう絞り込み、どう並べて読むか | `specs/backend/queries/{aggregate}/{name}.md` |
| スタイル・文言・アニメーション・コンポーネント分割 | 実装（仕様に書かない） |

### 検証チェック（S0〜S22）

検証器（`npm run verify` の S 群）は次のチェックを実行する。仕様はこれらを**すべて通過することを前提に**書く。

| # | チェック | 内容 | 出力例 |
|---|---------|------|--------|
| S0 | スキーマ適合 | `doc_type` / `scope` / 必須フィールドの型と形式、`id` と `name` の対応、置き場（`screens/{group}/{name}.md` の 1 段固定・`chrome/{name}.md`）、`layout` がマッピングであること・入れ子が 3 段までであること、`states.requires` が値域であること、`precondition` に `subject` と `on_fail` が伴うこと、`overlays[].id` が snake_case であること、**`actions` を持つ `overlays` に `opened_by` があること**、**`chrome_spec` が許可された 7 つの節だけを持ち**、その `navigations[].on` がドットを含まないこと、**トップレベル `label` が空でなく全画面・全クローム間で重複しないこと** | `subject が無い画面に precondition は書けません` |
| S1 | ルート | `route` が URL の形（動的セグメントは `:param`）であり、`route` と `name` が全 `screen_spec` を通じて重複しない | `route /items が複数の screen_spec で使われています` |
| S2 | 参照実在 | `reads` が `query_spec` に、`actions`（`overlays[].actions` を含む）がドメインイベント ID / 予約 ID に、`navigations[].to` が画面に、`chrome` がクロームに、`overlays[].opened_by` が `layout` の部品に実在する。`overlays[].closes_on` は `on` と同じ語彙である。`on` / `closes_on` はドットを含むなら `{接地したイベント}.success` 形でその操作が同じ画面の `actions`（`overlays[].actions` を含む）にあること、**`usecase.` で始まるなら `usecase.{ユースケース名}.{保存点 ID}.success` 形でその保存点が同じ画面の `usecases` にあること**、`platform_op.` で始まるものの実在は S20 が見ること（S2 は接地を問わない）、含まないなら snake_case であること。同じ `on` を 2 回書かないこと | `navigations の on(loan.submit.sucess)が "{イベント ID}.success" の形ではありません` |
| S3 | 到達可能性 | `entry_point: true` の画面が 1 つ以上あり、そこから `navigations`（**chrome から展開されたものを含む**）を辿って全画面に到達できる（孤立画面の検出） | `画面 loan_new にどこからも遷移してきません（孤立画面）` |
| S4 | ロール整合 | `for` が実在するグローバルロールで、`reads` する各 `query_spec` の `for` に含まれる。`actions`（`overlays[].actions` を含む）の実行ロール（`by`）と `for` の交差が空なら**警告** | `画面のロール anonymous は item_list を実行できません` |
| S5 | 入場条件 | `subject` が `entity_spec` に実在し、`precondition` がガード式として妥当で、**式のパスが `subject` を起点に接地し**（`actor` の後ろに書けるのは `id` と **`session: true` を宣言した欄**だけ。ドメインのガード式と同じ解決規則である）、`on_fail` の行き先が実在して閉路を作らない | `予約語 actor に role はありません(書けるのは id と session: true を宣言した欄だけ: id / is_staff)` |
| S6 | レイアウト | スロット名が値域（header / body.left / body.center / body.right / footer）に入り、コンポーネント名が snake_case で**予約語 `variants` でなく**、1 スロット内で部品名が重複せず（**排他表示の部品も同じ規則**）、排他表示の状態名が snake_case でグループ内で一意で、画面内で `overlays[].id` が重複せず、スロットが 1 つも無い `layout` を書かない | `スロット body.top はレイアウトの語彙にありません` |
| S7 | 実ルート | `route` が `app/src/app` の `page.tsx` と**両方向で** 1 対 1（仕様にあるのに実ルートが無い／実ルートにあるのに仕様が無い）。`requires_auth: true` の画面の `route` が `app/src/proxy.ts` の `matcher` に覆われている。page の外側で描くファイルは根の `layout.tsx` だけで、関門のある画面の `generateMetadata` は最初の文で画面の一番強い関門を待つ(下の §関門は画面ごと) | `実ルート /admin を宣言している screen_spec がありません` |
| S8 | テスト突合 | `test_cases[].implementation` が実在し、テスト側の `@tc` と一致する（ファイルの実在 → `@tc` の存在 → テスト名の一致の 3 段。A6 / Q6 と同じ規則）。`spec_ids` が値域（`screen_spec` / `chrome_spec` / `query_spec` の id・ドメインイベント ID）に実在する | `TC-SCREEN-HOME-002 のテスト名が implementation と一致しません` |
| S9 | テストの網羅 | 全 `screen_spec` が `test_cases` を 1 件以上持つ。`requires_auth: true` の画面は**入場の関門を確かめるケース**（`covers` に `forbidden`）を 1 件以上持つ | `item_list は requires_auth: true ですが、入場の関門を確かめるテストがありません` |
| S10 | UI 到達の網羅 | 人間ロールが実行できる全ドメイン操作（遷移イベント + 予約 ID `create` / `delete` / `update`）が、いずれかの `screen_spec` の `actions`（`overlays[].actions` を含む）に現れる。現れないものは `specs/frontend/screens/README.md` のフロントマター `unexposed` に**理由つきで**宣言する（A4 の `unhandled` と同じ免除方式。消し忘れは警告） | `loan.accept は人間ロール(librarian)が実行できますが、どの画面の actions にも現れません` |
| S11 | スモーク突合 | `smoke[].implementation` の `{file}::{テスト名}` が、走査結果（`app/e2e/*.spec.mts` を含む。§参照するもの）の `@tc` アノテーションと一致する（ファイルの実在 → 同じ組の実在の 2 段。台帳は経由しない — §smoke） | `item_list の smoke の implementation(app/e2e/smoke.spec.mts::…)に対応するテストが見つかりません` |
| S12 | error 到達可能性 | `reads` を 1 つ以上持つ画面で、その `reads` の `query_spec` がどれも `params` を持たないなら、`states.requires` に `error` を書けない（読み取りの `invalid_input` は `params` の検査からしか出ず、到達しないため。`reads` が空の画面は対象外 — OAuth コールバック・AI ストリーミングなど読み取り以外の理由がありうる）。2026-09-05 に `item_check_admin` / `branch_admin` / `item_list` の 3 画面が実際にこの規則へ違反していたことが判明し、機械執行を始めた | `item_check_admin の reads(query-check-item-list)はどれも params を持たないため、states.requires の error に到達できません` |
| S13 | 状態×ロールの到達 | 人間が起こせる遷移 `T`（状態機械 `M`・`from` の各状態 `s`・`by` の各人間ロール `r`）について、(a) `actions`（`overlays[].actions` を含む）に `T` があり (b) `r` が入れ（`for` / `requires_auth` / `role_gate`。H4 の `requiredGuardsOf` と同じ規則） (c) `precondition` が状態 `s` を弾かず（記号評価。§記号評価の限界） (d) `r` の入口画面から `navigations`（`{event}.success` を除く）で届く画面 `P` が存在する。無ければエラー。免除は S10 と同じ方式で `specs/frontend/screens/README.md` の `unreachable_states`（`transition` / `state` / `role` / `reason`） | `membership.suspend は状態 active のとき account_owner が起こせますが、そこに届く画面がありません` |
| S14 | 状態の可視性 | 状態機械の各状態 `s` について、`s` の実体を返しうる読み取り経路（`query_spec` の `filters` が `s` を除外しない。記号評価は S13 と同じ。母集合は**その集約を主エンティティとする query** — 併読 `includes` は対象外）を `reads` に持ち、人間ロールが入れる画面が存在する。無ければ**警告**（V6 デッドエンドの画面版）。免除は `specs/frontend/screens/README.md` の `unseen_states`（`{machine}.{state}` / `reason`） | `loan.withdrawn の実体を見せる読み取り経路 × 画面がありません` |
| S16 | 保存点の宣言 | `usecases` に書いた保存点（`{ユースケース名}.{保存点 ID}`）が usecase_spec に実在し、その**各手順の操作がこの画面の `actions`（`overlays[].actions` を含む）にも並んでいて**、そのユースケースの `start` からこの画面へ辿れる（Y3 と同じ探索規則）。**保存点を宣言した画面は、その手順を個別の操作としても持ち続けてよい** — 下書きを育てる経路と司書の代理入力の経路が要るからであり、同じ操作に 2 つの入口があるのは重複ではなく**粒度の違う 2 つのタスク**にそれぞれの入口があるということである（ADR-0011 §1） | `保存点 loan_self.register の手順 note.create を、この画面は操作として宣言していません` |
| S15 | 遷移後の着地 | `navigations` の `on: {イベント ID}.success` の行き先 `P2` について、（この画面の `for` と交差する）`T` の `by` の人間ロールが `P2` に入れ、`T` の `to` 状態で `P2` の `precondition` が成立する（記号評価は S13 と同じ）。満たさなければエラー(成功したのに not found へ飛ぶ)。免除の器は無い(遷移は画面自身が選んだ行き先であり、正当な未着手はあり得ない) | `patron_admin の navigations(on: membership.suspend.success)の行き先 patron_admin に、membership.suspend を実行できる account_owner が入れません` |
| S17 | フォームの部品 | 部品に書いた `kind: form` の `action`（§kind / action）が (a) その画面の `actions`（`overlays[].actions` を含む）に居る (b) 接地先が作成（`creates`）か編集（`writes`）であり、遷移・削除ではない (c) 1 部品 1 操作である (d) 同じ操作を 2 つの `kind: form` 部品が載せない (e) 載せる操作が実行計画で走る（`runner: manual` を宣言していない。manual は計画の外で、入力欄の集合を仕様から導けない）。chrome の部品には書けない。`kind` の値域・`kind` と `action` が組であることは S0 が見る。ドメインに接地しない `action` は S2 の領分で、S17 は黙る | `画面 branch_admin の部品 branch_form の action branch.delete は削除で、フォームにできません` |
| S18 | 読みを載せる部品 | 部品に書いた `kind: table` / `detail` の `reads` / `shows` と、`kind: form` の `reads`（§kind / action / reads / shows）が (a) 読みが種類に合う（table は `returns: many`・detail は `one`・form は `many` で projection が `[id, 表示名の 1 欄]`）(b) `reads` がその画面の `reads` の要素である (c) `shows` の欄が projection か 1 件に決まる併読の欄に実在し、ref の欄でない (d) `kind: form` の `reads` の source が操作の入力の ref の欄の参照先と一致する（無ければ error・2 欄以上は曖昧で error）(f) `kind: table` を持つ画面が `states.requires` に `empty` を宣言する。同じ読みを複数の table / detail が出すのは可。chrome の table / detail には書けない。`reads` / `shows` の形と組は S0 が見る。実在しない読みは S2 の領分で、S18 は黙る | `画面 item_list の部品 item_table の shows capacity が、読み query-item-list の欄にありません` |
| S19 | 操作を載せる部品 | 部品に書いた `kind: table` の `edit` / `actions` と `kind: actions`（§kind / action / reads / shows / edit / actions）が (a) 操作がその画面の `actions`（`overlays[].actions` を含む）に居る (b) `edit` は編集（update）で `reads` の source のエンティティの編集であり、確認が要る操作でも `runner: manual` の操作でもない (c) 確認が要る操作（`confirm_required`）を載せた部品（`actions` の要素と `kind: form` の `action`）を `opened_by` に持つ重ね表示が、その操作を `actions` に含み、`body.center` の `confirm_bar` を持つ (d) `kind: actions` の `reads` が画面の `reads` の要素で `returns: one` (e) `actions` の要素が `reads` の source の状態機械のイベントか source の削除（作成・編集は行のボタンにしない）(f) 行のボタンに載せる操作の入力が対象の識別子（`id`）だけ（他の入力が要る操作はボタンにできず `kind: form` にする）(g) 1 つの確認の重ね表示が、同じ部品が載せる確認が要る操作を 2 つ以上持たない（確認ダイアログの testid が重複する。操作ごとに重ね表示を分ける）。chrome に `kind: actions` は書けない。`edit` / `actions` の形・組・`edit` と `shows` を併せないことは S0 が見る。接地しない操作は S2 の領分で、S19 は黙る | `画面 branch_admin の部品 branch_table が載せる branch.delete は確認が要る操作ですが、確認の重ね表示がありません` |
| S20 | プラットフォーム操作 | 画面の `platform_ops`（`overlays[].platform_ops` を含む）と部品 `platform_read` / `platform_actions`・`row_actions`（§kind / action）が (a) 参照した操作が auth_spec の `platform_ops` に実在する (b) 露出する画面は `requires_auth: true`。ロールの操作は、画面の `for` の全ロールがそのロールを持つ（同じか含意する） (c) `navigations[].on` / `overlays[].closes_on` の `platform_op.{id}.success` の操作がその画面が露出する `kind: do` の操作である (d) `op` は `kind: read`、`ops` / `row_actions` は `kind: do` で、画面の `platform_ops` に居る。`shows` は操作の返す欄の部分集合 (e) 引数に `from: row` を持つ操作は `row_actions` にだけ載り、`of` が部品の表にする読みに一致する。行のボタンは行から受ける引数を 1 つ以上持つ。query_spec の出どころは画面の `reads` に居る (f) `confirm: true` の操作を載せた部品を `opened_by` に持つ重ね表示が、その操作を `platform_ops` に含み、`body.center` の `confirm_bar` を持つ。chrome の部品には書けない。auth_spec が使えない（阻害）ときは判定を出さない | `操作 session.end_member の実行者（ロール librarian）を、この画面を見る全ロール(patron)は持ちません` |
| S21 | プラットフォーム操作の UI 到達 | auth_spec の `platform_ops` に宣言した人間が起こす全操作（`system` ロールが実行者のものを除く）が、いずれかの画面の `platform_ops`（`overlays[].platform_ops` を含む）に現れる。現れないものは `specs/frontend/screens/README.md` のフロントマター `unexposed_platform_ops`（`- op` / `reason`）に**理由つきで**宣言する（S10 の `unexposed` と同じ免除方式。画面ができたのに残った宣言・実在しない操作の宣言は警告） | `プラットフォーム操作 session.end_every は人間が起こせますが、どの画面の platform_ops にも現れません` |
| S22 | プレビューの断片の許可表 | 製品が `previews` の根に置いた断片の全部が、許可表（`lib/kernel/preview-check.ts`）を通る。通らない断片は `generate` でも止まるが、ここで手前に分かる | `プレビューの断片 x が許可表を通りません` |

- `test_cases` は宣言を**全仕様共通の台帳**に載せる。ID の一意性は A9、テスト側 `@tc` の orphan 判定は A6 が、いずれも同じ台帳を母集合にして見る（仕様種をまたぐ性質なので S 群では見ない）。
- S4 の `actions` 側だけが警告なのは、「押したら断られるボタン」が UX として正しい場合があるためである。読み取り側（`reads`）は実行すれば必ず落ちるのでエラーにする。
- **実装（`app/`）を読むのは S7 と S8 だけである。** S8 が読むのは `app/src/**/*.test.ts(x)` の注釈（`@spec` / `@tc`）で、走査結果はトレース検証（A 群）が作ったものを共有する（同じ事実の入力口を 1 つに保つため）。
- **関門は画面ごと(S7・14 回目 B14-1)。** Next.js は layout と page を同時に描き、関門が `redirect()` / `notFound()` しても流せた分を 307 / 404 の本文に残す。だから layout の関門は page を守らず、page の関門は layout と `generateMetadata` を守らない。閉じ方は次の 3 つで、どれも検査が止める: ① page の外側で描くファイルは根の `layout.tsx` だけ(非根の `layout`・`template`、`loading`・`error`・`not-found` などは未対応の配置)。タブの見出しのような部品は各画面の関門の後で描く ② 根の layout は読み取りを持てない(`layer/root-layout-closed`) ③ 関門のある画面の `generateMetadata` は最初の文で関門を待つ(`export async function generateMetadata(…) { await requireSession(…); … }` の形だけ)。関門は描画の最初の `await` に置き、JSX の兄弟には置かない(`gate-implementation.test.ts`。同じ形をビルドの入口の関所 `build:gate` も見る)。
- **非根の layout は置けない。これは安全の側に倒した意図した制限である。** 設定の書き忘れではなく、機能の不足でもない。Next.js の layout は page と同時に描かれるので、タブや見出しを layout に置くと、関門が落ちた要求の本文にも載る。共通の部品は部品として作り、**各画面の器が関門の後で描く**。例(タブの見出しを持つ管理画面):

  ```tsx
  // 画面の器
  export async function renderPatronAdminScreen(deps: Deps) {
    await requireSession();          // 関門が最初の await
    await requireLibrarian();
    const patrons = await deps.patrons();
    return (
      <>
        <AdminTabs current="patrons" />{/* 関門の後で描く。layout には置かない */}
        <PatronTable patrons={patrons} />
      </>
    );
  }
  ```
- **S7 が読むのは実ルートである。** 走査の起点は CLI が渡し（検証器もローダーもパスを決め打ちしない）、`app/` が無いリポジトリでは S7 は何も見ずに「スキップした」と出力する。`matcher` の判定は**静的パース**であり、正規表現つきのパターン（`/settings/:id(\d+)`）は解釈できない。この場合の挙動は「そのパターンを検査対象から外した」という**警告 1 本 + 覆えなくなった画面ごとのエラー**であり、他に覆うパターンが無ければ verify は赤になる。つまり**正規表現つきの matcher は事実上使えない**（「覆っているかもしれない」を緑にすると、緑の意味が実際に確かめた範囲より広くなるため、この非対称は意図的である）。**例外は「接頭辞を除く全部」の形 1 つ**（`/((?!api/|_next/static/).*)`。Next.js の公式文書の例の形）で、除く接頭辞で始まり**うる** route（動的なセグメントに差しかかるものを含む）は覆わないと安全側に判定する。**リクエスト前段はいまアプリの枠の後段の生成物**で（ブラウザ側の守り — 要求ごとの nonce の CSP を文書の口の全部に付けるため、保護範囲は静的な資材と Route Handler を除く全部）、画面を足しても `matcher` を手で直す必要は無い（S7 は生成物の `matcher` を同じ規則で読む）。**ルーティング層の下の全部のファイルを分類する閉世界**で(`classifyPageFile`。点検 13 回目 B13-1)、URL にならないと名指せるのは `_` 始まりのフォルダの下と、読める配置のページでないファイル(`layout.tsx`・`route.ts`・同じ場所の部品)だけである。パラレルルート `@x`・インターセプト `(.)x`・キャッチオールと、読める形(静的な名前・`[id]`・`(グループ)`)のどれでもないセグメントの下は、ページでなくても全部「未対応の配置」の赤になる(どれも本物の URL になるのに宣言できない)。`page.mjs` のような受けない綴りも同じ。ルートグループ `(name)` はパスから畳む。 **画面の器・リクエスト前段の置き場と、ファイル配置 → route の逆引きは、置き場の配置(`ProductLayout` の `screen-shell` / `request-gate`。アプリの枠の後段が与える。部品化 ③-c2)が決める**(この表と上の「参照するもの」の `page.tsx` / `proxy.ts` は、アプリの枠が Next.js のときの綴り)。仕様の `route` が置き場 → 逆引きで同じ route に戻らない(ルーティングに使わない名前の下に置かれる `/_x` など)ときは、実ルートの欠落とは別に S7 が「辿れない」と指す(route の重複は S1 の持ち物)。**実装の木はあるのに、配置が画面の器の逆引きを決められない**(`screen-shell` が無い・逆引き `classify` が無い)ときは、S7 は全部を黙ってスキップせず**前提の失敗**として error を出す(実行ログも「実装の木が無いためスキップ」と言わない。配置の定義の検査が選ぶ根の 1 回で先に止める)。**配置にリクエスト前段(`request-gate`)が無い**(そのスタックには `matcher` が無い概念)ときは、`matcher` の被覆を黙って緑にせず、実行ログが「S7: 未実施 — 置き場の配置に request-gate(リクエスト前段)が無いため…」と名指す(範囲サマリの件数に入る)。**HTTP の入口(`http-entry`)の逆引きと画面の器の衝突**(同じセグメントに `page` と `route` は置けない)は J2 が見る(job-spec-writing.md)。仕様の `route` の動的セグメントは中立の `:param` で書き、置き場の綴り（Next.js の角括弧）への写像と、逆引きでの `:param` への正規化は後段が持つ。**仕様の route の文法に載らない実ルート**(パラレルルート・インターセプト・キャッチオールの page など。逆引きが置き場の綴りのままファイル名まで返す)は、どの仕様も宣言できないので、S7 は「宣言の無い実ルート」(`route:` を書け)とは案内せず、**「未対応の配置」と別の文面で名指す**(書き足しても S1 が文法外で止めて循環するため。直し方は page を静的セグメントか `:param` の形に分けること)。
- エラーは必ず「**何が・どこで・どう直すか**（+ 反例）」の 3 点セットで出す。
- **S10 の母集合は A4 に編集（`{entity}.update`）を足したものである。** A4 が `writes` を数えないのは「宣言 1 本 = Server Action 1 本」と機械的に言えないためだが、UI 到達では粒度に関係なく「その集約を編集する画面が 1 枚も無い」ことが言える。**免除の一覧（`unexposed`）はそのまま「これから作る画面」の一覧**であり、画面ができたら消す（消し忘れは警告で出る）。
- **S13 は S10 の全域化である。** S10 が見るのは「その操作を発火する画面がどこかにあるか」という**存在の向き**だけであり、「どの状態のときに・どのロールが」実際にその画面まで届くかは見ていなかった。patron_admin にボタンがあっても、そこへ入れないロールにとっては存在しないのと同じである — S13 はこの粒度の穴を塞ぐ。**免除（`unreachable_states`）は S10 の `unexposed` と同じ「まだ作っていないものの一覧」であり、3 軸（遷移・状態・ロール）の組で 1 件になる**（同じ遷移でも状態やロールが違えば到達の有無は変わるため）。
- **S13 / S15 の記号評価には限界がある（§記号評価の限界）。** `precondition` / `filters` が対象の状態フィールドを 1 つも参照していなければ無条件で admit する（弾いているとは言えない、が正しい既定）。参照していても、判定できない（`unknown`）ときは admit 側に倒す — 見逃しより過検出を避ける（誤って「この画面には届かない」と言う方が実害が大きい）。**つまりこの 2 つは「弾いていないことの証明」であって「届くことの証明」ではない** — precondition が状態以外の条件（`now` を含む時間窓・他の行との関係）で実質的に弾いていても、機械はそこまで読めない。
- **S15 が `T` の `by` を丸ごと見ないのはなぜか。** 同じ遷移を複数のロールが別々の画面から起こせることがある（`membership.suspend` は `by: [account_owner, librarian]` だが、`account_owner`（本人）の経路はまだ無く、`librarian` だけが `patron_admin` から実行する）。`navigations` は画面 1 枚の宣言なので、**その画面の `for` と交差しない `by` ロールは、そもそもその画面からは実行できない**（S4 の `checkActions` と同じ絞り込み）。丸ごと見ると、他画面が受け持つロールの都合でこの画面の遷移が誤ってエラーになる。
- **検証器はこの表の実装である。**表と `legacy/spec-tools/lib/screen/` がずれた場合は表が正であり、実装を直す（PRIN-0001）。

#### まだ検査していないもの（既知の穴）

| 穴 | なぜ v1 で塞がないか | いつ塞ぐか |
|----|-------------------|-----------|
| **`requires_auth: true` の画面が「どこへ送られるか」**（仕様の語彙として） | 送り先はいま実装（`requireSession()` が `/login` へ redirect する）が持っており、仕様の語彙に無い。`on_fail` と統合するか別に持つかは、画面が増えて実例が出てから決める。**静的検査（S7）が見るのは「前段（`matcher`）を通るか」までである**。ただし送り先そのものは screenTest が実測しており（未セッションで呼ぶと `/login` へ送られること）、「宣言と実装がずれても誰も気づかない」状態ではない | 未決（実測はある） |
| ~~**重ね表示（`overlays`）の testid**~~ | **塞いだ（Phase C-6 第1波）。** 初実例（`item_manage` の `cancel_confirm`）で名前空間を `{画面}.overlay.{overlay id}.{スロットパス}.{部品}` に決め、生成物（`testids.ts` / `screens.ts`）に載せた。**開いた状態そのもの**（押したら開く）は依然として見ていない — クリックは描画結果に現れないため、押した結果の遷移と同じ穴に属する | 塞いだ |
| **`precondition` / `on_fail` と実装の突合** | 生成物（`screens.ts`）に `precondition` が載っておらず、突き合わせる相手が無い。実装は条件（`item.state === 'closed'`）を仕様から**手で写して**おり、仕様を変えても検査は落ちない（screenTest が実測しているので「誰も気づかない」ではないが、テストも手で書いたものである）。**行き先だけは生成物から引ける**（`on_fail` の対応物は `screenRoutes.{画面}.route`。実例: `librarian_holds`）。塞ぐなら `screens.ts` に `precondition` の式を載せ、評価器（ガード式の実装は既にある）を画面が呼ぶ形になるが、そのとき評価に必要な事実をどう渡すかが未決である | Phase C-6 第 2 波で初実例が出た。S 群のバックログ |
| **予約 ID の `when` のうち、画面が描いていない事実に依るもの** | §先読みの線引き の①〜③を満たす `when`（`state == リテラル` 形）は先読みでき、そこは塞がった。**満たさないもの**（`now` を含む条件・他の行に依る条件・関係）は依然として先読みできないので、口が出たまま押した結果に委ねる。塞ぐには画面が判定に要る事実を持つことになり、それは読み取り経路の設計（`query_spec`）の話になる | 塞がない（設計上の線） |
| **先読み条件①②が「規約」でしか守られていない** | ③（生成表の AST をエンジンにかけること・`unknown` なら先読みしないこと）は実装の形として現れるので読めば分かるが、**①「参照するパスがその行の表示に現に使っている値であること」と②「他エンティティを参照するならその実体を `reads` していること」を機械は見ていない**。画面が `query_spec` に無い値を持ち出しても、AST 評価の形さえ守っていれば検査は通る。**Phase C-6 第 3 波でこの穴の対象が広がった** — 先読みが決めるのは「口を出すか」だけでなく**編集フォームに並ぶ入力欄の集合**（`writes` × `state`）にもなったので、①②を破った先読みは「見えている情報から作られていないフォーム」を生む。塞ぐには `screens.ts` に `reads` の射影（何を描いているか）を載せて突き合わせることになり、それは `query_spec` の `projection` ⇔ 実装の突合（Q3、未実装）と同じ問題である | 未決（Q3 と同時に判断する） |
| **予約 ID の表示名（ボタンの文言）** | 状態機械のイベントには `label` があり生成物（`{machine}.labels.ts`）に落ちるが、**予約 ID（`create` / `update` / `delete`）には `label` の置き場が無い**。「載せる」「外す」「下書きを削除する」「並べ替えを確定する」はすべて実装が手で書いた文言であり、仕様を読んでも UI の語彙が分からない。`access_spec` の `creates` / `writes` / `deletes` に `label` を足して生成物に載せる案があるが、1 つの宣言が複数のボタンに化ける（`writes` の 1 行が「確定」と「破棄」を生む）ので 1 対 1 にならない | 未決（D 系で labels 拡張の判断） |
| **部品の内側の testid の「名前」**（`…loan_form.title` の `title` の部分） | 何という葉を置くかは仕様が持たない自由地帯であり、宣言を要求すると「入力欄 1 つ足すたびに仕様を直す」ことになる。ただし**置き場所**は自由ではない — 葉は宣言した部品を接頭辞に持つ（screen-test.md §葉の命名規則）。この 1 本の規則で「宣言していない部品」と葉が文字列の形で区別でき、C-3 で開いていた穴（宣言外の部品を検出できない）は screenTest 側で塞がっている | 塞がない（名前だけが自由地帯） |
| **宣言されていない操作の不在**（蔵書の作成 `item.creates` / 利用者の登録 `patron.creates`） | S10 の母集合は**ドメイン仕様に宣言された操作**である。宣言そのものが無ければ「その操作を起こす画面が無い」ことも検出できない（検査が数えられるのは、誰かが「できる」と書いたものだけである）。蔵書管理画面を作るのに蔵書を作る操作がドメインに無い、という食い違いはいま**人間しか気づけない** | Phase C-6 の前にドメイン仕様側の意味レビューで決める |
| **クライアント操作後の状態**（編集状態・重ね表示の開閉） | screenTest は RSC を 1 回呼んだ描画結果しか見ないので、「上へを押したら並びが変わる」「未確定の表示が出る」は観測できない。**そこで、導出そのもの（並べ替え・未確定判定・確定ペイロード）は純関数として `src/domain/program/reorder.ts` に切り出し、カバレッジ 100% のユニットテストで縛っている**（コンポーネントに残るのは状態の保持と配線だけ）。押した結果そのものはブラウザ実行が要る | 導出は塞いだ。操作そのものはブラウザ実行を入れる回 |
| **押した結果の遷移**（`{イベントID}.success` の `navigations`） | 描画結果に現れるのはリンク（`href`）だけで、`router.push` とフォーム送信後の遷移は押さないと分からない。screenTest の遷移突合が**実装 → 仕様の片方向**にとどまるのはこのため | ブラウザ実行を入れる回（Phase C-6 の判断） |
| **`chrome_spec` のテスト** | `chrome_spec` は許可された 7 節しか持てず `test_cases` が無い。共有クロームの部品は継承した画面のテストの中で確かめられており、宣言は画面側にしか無い | 共有部が増えて独立に壊れ始めたとき |
| **`navigations[].on` が実装のどのきっかけか** | 遷移の突合が見るのは「行き先の集合」であり、`on`（どのボタンから出るか）は照合していない。`{イベント ID}.success` 形は S2 が `actions` へ接地させているが、**自由語彙の `on` は接地先を持たない** — 「その画面の操作や chrome 部品が発火し得るか」は実装の内部事象（クリックハンドラ）であって描画結果にも仕様にも現れず、静的にも実行時にも確かめる相手がいない。**Phase C-4 で S10 のスコープ外と決めた**（下の規約で縛る） | 未決（規約で縛る） |
| **自由語彙の `on` の接地** | 1 つ上の行のとおり照合していないが、**葉の命名規則が入ったことで手掛かりはできた** — `chrome-library` の `home_link` / `signed_out` は、現に葉の testid（`patron.header.app_header.home_link` / `.sign_out`）と同じ名前で実装されている。`on` を「その画面に存在する葉の名前」へ接地させる検査は書けるかもしれないが、命名の一致は今のところ偶然であり、規約として要求していない以上いま有効にすると意味のない改名を強いる | 実例が増えて命名の慣習が固まったとき（U 群の候補） |

- **新しい検査の番号は S18 以降を使う。** 設計ドラフト（screen-dsl-draft.md）の S 群は S1〜S6 に別の割り当てを持っていたが、実装にあたって付け直した。ドラフトの番号は参照しない（この表と §検証チェックが正である）。
- **ハンドブックに載る「実物」（SSR プレビュー）の鮮度は S 群ではなく app 側の検査が見る**（[book-previews.md](../../system/standards/conventions/book-previews.md)）。画面の話でありながら別の場所に置いたのは、入力が `screen_spec` ではなく**実装を描いた結果そのもの**であり、仕様の側からは判定できないからである。**画面の見た目に関わるものを触ったバッチは断片の書き直しが必須である** —— 免除の仕組みは無い（`cd app && npm run book:previews`）。

### 生成されるもの

`npm run generate` が画面仕様から出すのは 5 つ(+ `kind: form` / `table` / `detail` / `actions` の部品があるときの生成物)で、いずれも**仕様の写像**である（手で書かない）。

| 生成物 | 出力先 | 何のためか |
|--------|--------|-----------|
| 画面一覧表 | `specs/frontend/screens/README.md` | 「アプリに画面が何枚あり、どれが何を読み・何を発火するか」を 1 件ずつ開かずに見る |
| 遷移図（mermaid） | 同上 | S3 が真偽で見るのと同じ辺を、人間が「この遷移は業務としておかしい」と判断できる形にする |
| **ワイヤーフレーム** | 同上 | chrome の外枠を被せた**画面の形**（スロット・入れ子・排他・重ね表示）。位置や余白は仕様が持たないので描かない |
| **testid 定数** | `app/src/domain/generated/testids.ts` | 実装が骨格の文字列を手で書かないようにする（§testid） |
| **画面の配線表** | `app/src/domain/generated/screens.ts` | 画面テストが「宣言したスロット」「宣言した部品」「宣言した遷移先」を数えられるようにする（同じ仕様の別の射影。キー引きの表からは件数と排他関係が取り出せない） |
| **画面の部品の生成物**(`kind: form` / `table` / `detail` / `actions` の部品があるときだけ) | `app/src/app/_screens/generated/{画面}.{部品}.tsx` + 既定のスタイル `default.module.css` | 部品 1 つ = 生成物 1 本(§kind / action / reads / shows)。フォームの欄の集合・並び・制約・入力の種類は操作の入力スキーマから、表の列・詳細の項目は `shows` と読みの projection から（編集する表の列は `writes` から）出て、行のボタンは遷移表と実行者のロールから出る。配線表の部品には葉の表(`leaves`)が載る |

### 書き味の実例

**実例は書き写さず、実物を読む。**（この節に例を複製すると、仕様が変わったときに文書だけが古い ID・古い判断を語り続ける。）

| 見たい形 | 実物 | そこから読み取ること |
|---------|------|--------------------|
| 読み・書き・遷移・クロームが揃った画面 | [`screens/desk/desk.md`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs/frontend/screens/desk/desk.md) | `chrome` を継承し（共有ヘッダの遷移は chrome 側にある）、`actions` と `overlays` を併せ持つこと。負の意味の遷移（延滞・紛失の記録）は `overlays[].actions` にだけ書く。`precondition` は無い（入場の関門はセッションだけ） |
| 読むだけの一覧 | [`screens/catalog/item_list.md`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs/frontend/screens/catalog/item_list.md) | `actions` が空で `navigations` が 1 本だけであること（共有ヘッダの遷移は chrome 側にある）。ページ見出しが `header` に居ること — chrome も `header` を持つが、chrome は外枠なので衝突しない |
| ドメイン操作を持たない画面 | 製品の認証画面(実物は製品の仕様に置く) | 認証が仕様の語彙の外にあるため `actions` が空で、遷移の `on` が自由語彙になること |
| 入場条件つきの画面 | [`screens/store/shelf_stock.md`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/stores/docs/specs/frontend/screens/store/shelf_stock.md) | `subject` と `precondition: is_active == true` + `on_fail`（入場の関門が行の状態に依ること）。関係（責任者かどうか）は入場の関門ではなく行の可視性の話なので `precondition` に書かないこと。状態機械を持たない集約の画面では、**「宣言 ∩ 状態機械の遷移」の交差が使えない**こと |
| 共有クローム | [`chrome/library.md`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs/frontend/chrome/library.md) | `layout` と `navigations` だけであること。ここに書いた遷移が、継承する画面のグラフに現れる |

---

## 関連ドキュメント

- [query-spec-writing.md](../../../backend/specification/standards/query-spec-writing.md) — `reads` の参照先（読み取り経路）の書き方
- [action-spec-writing.md](../../../backend/specification/standards/action-spec-writing.md) — `actions` が指す操作の書き方と `test_cases` の形式
- [domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md) — 可視性・状態機械・ガード式の正
- [template.screen_spec.md](../../../../../specs/frontend/screens/template.screen_spec.md) — テンプレート
