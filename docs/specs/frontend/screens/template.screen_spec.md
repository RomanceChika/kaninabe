---
doc_type: screen_spec
scope: frontend
id: "screen-{name をハイフン区切りにしたもの}"   # 例: screen-item-detail。ファイル名は {group}/{name}.md 固定

name: "{name}"                       # 必須。snake_case。testid は {name}.{スロット}.{部品} になる
label: "{日本語名}"                  # 任意。画面の表示名（例: 蔵書詳細）。testid にも route にも影響しない
route: "/{path}"                     # 必須。URL の形（動的セグメントは :param）
chrome: "chrome-{name}"              # 任意。継承する共有クロームの id
for: ["{role}"]                      # 必須。この画面を見るロール（グローバルロールのみ）
entry_point: false                   # 任意。ユーザーが最初に到達する画面なら true
requires_auth: false                 # 任意（既定 false）。セッション必須なら true

subject: "{entity}"                  # 任意。route の動的セグメントが指すエンティティ
precondition: "{ガード式}"           # 任意。入場条件（subject を起点に接地すること）
on_fail: "redirect(screen-{name})"   # precondition があるとき必須。成立しない人の行き先

reads: ["query-{name}"]              # 任意。この画面が読む query_spec の id
actions: ["{entity}.{event}"]        # 任意。この画面が発火するドメインイベント ID（予約 ID 可）

navigations:                         # 任意。画面から画面への遷移
  - on: "{イベント ID}.success"      # 操作の結果、または UI 都合の自由語彙（例: cancel）
    to: "screen-{name}"              # 遷移先の画面 id

overlays:                            # 任意。画面に重なる表示（モーダル・ポップアップ）
  - id: "{overlay_id}"
    label: "{確認の見出し}"           # 任意。確認の文言と実行ボタンの文言（無ければ遷移はイベントの label・予約 ID は既定の語）
    layout: { body: { center: ["{component}"] } }   # 確認の器は body.center の confirm_bar
    opened_by: "{component}"         # 任意。これを開く画面内の部品
    actions: ["{entity}.{event}"]    # 任意。重ね表示が発火する操作
    closes_on: ["{きっかけ}"]        # 任意。閉じるきっかけ（遷移は伴わない）

ux:                                  # 任意。UX 原則から外れてよい場所の受け入れ（指摘が出ているときだけ。受け入れだけで事実の欄は書けない）
  - principle: "{U1〜U5}"            # 原則の ID
    subject: "{指摘の subject}"      # 指摘の「反例: subject=...」の文字列（画面の接頭辞は付けない。画面そのものへの指摘は省略）
    reason: "{なぜその UX でよいのか}"  # 必須（空は S0）

layout:                              # 必須。スロットは header / body.left|center|right / footer
  body:
    center:
      - "{component}"                # 手書きの部品（kind を書かない）
      - "{form_component}":          # 任意。生成物のフォームにする部品（ADR-0015）
          kind: form                 # 値域は form / table / detail / actions。書かなければ手書き
          action: "{entity}.create"  # 載せる操作 1 つ。上の actions に居る作成 / 編集（S17）
          reads: "query-{name}-options"  # 任意。参照の欄の選択肢の出どころ（[id, 表示名] の読み。S18）
      - "{table_component}":         # 任意。生成物の表にする部品（読むだけ。states.requires に empty も要る）
          kind: table
          reads: "query-{name}-list" # 上の reads の要素。returns: many（S18）
          shows: [title, "{併読名}.{欄}"]  # 任意。省略 = projection の id と ref を除く全欄
      - "{detail_component}":        # 任意。生成物の詳細にする部品
          kind: detail
          reads: "query-{name}-detail"  # 上の reads の要素。returns: one（S18）
      - "{ledger_component}":        # 任意。行を編集でき・行のボタンを持つ表（shows とは併せない。S19）
          kind: table
          reads: "query-{name}-list"
          edit: "{entity}.update"    # 行をその場で編集する操作 1 つ。上の actions に居る編集
          actions: ["{entity}.delete", "{machine}.{event}"]  # 行のボタン。reads の source の遷移か削除（確認が要れば opened_by の重ね表示）
      - "{bar_component}":           # 任意。1 行に対する操作のボタン列
          kind: actions
          reads: "query-{name}-detail"  # returns: one（S19）
          actions: ["{machine}.{event}"]

states:                              # 任意。表示義務（loading / empty / error / not_found）
  requires: [loading]

test_cases:                          # 必須。1 件以上（S9）。requires_auth: true なら covers に forbidden のケースも要る
  - id: "TC-SCREEN-{NAME}-001"       # 画面名を大文字に（区切りのアンダースコアは残す）
    type: unit
    covers: [success]                # action_spec と同じ 8 分類。画面版の導出規則は無い
    spec_ids: ["screen-{name}"]      # 画面/chrome/query の id とドメインイベント ID だけ
    implementation: "app/src/app/__screens__/{screen-name}.test.tsx::{テスト名}"
---

<!--
記入ガイド

- プレースホルダ（"{...}" で囲まれた部分）は実値に置き換え、引用符は不要になったら外す。
- この仕様は薄いことが正しい。以下は**ここに書かない**（他の仕様が正）:
    誰に何が見えるか・どの列を隠すか   → specs/domain/{aggregate}/access.md
    フィールドの型・必須・最大長       → specs/domain/{aggregate}/entity.md（フォームは生成物を使う）
    状態遷移・操作の実行権限           → specs/domain/{aggregate}/states.md
    何を受けて何を書き換えるか         → specs/backend/actions/{aggregate}/{event}.md
    どう絞り込んで読むか               → specs/backend/queries/{aggregate}/{name}.md
- **縛るのは構造と配線だけ**。スタイル・文言・アニメーション・コンポーネントの内部分割・
  ローディングの見せ方は実装の自由であり、仕様に書かない。
- **入場の関門は 3 つに分かれる**: for =「誰が見る画面か」（グローバルロール）、
  requires_auth =「ログインが要るか」、precondition =「いま入ってよいか」（対象の状態・時間窓）。
  ログインの要否を precondition に書かない（actor にロールのフィールドは無く、接地しない）。
- precondition の式に書けるのは subject 自身のフィールド / subject の context で辿れるパス /
  now / actor.id だけ。S5 が接地を検査する。
- navigations の on は「{イベント ID}.success」か、ドットを含まない自由語彙のどちらか。
  **操作の失敗では遷移しない**（拒否は同じ画面に表示する）のが既定で、.failure は書けない。
  同じ on を 2 回書かない（どちらへ遷移するか決まらなくなる）。
- 共有ヘッダの部品から出る遷移は chrome_spec の navigations に書く（ここに書き写さない）。
- レイアウトのスロットは 5 つ（header / body.left / body.center / body.right / footer）で閉じている。
  収まらないものはコンポーネントの内側か、入れ子の layout（`- own_entry: { footer: [submit_bar] }`）で表す。
- **同時には出ない部品は variants で束ねる**（`- variants: { no_entry: entry_form, own_entry: own_entry_panel }`）。
  キーは状態名（自由語彙）で、**どちらが出るかの条件は書かない**（見せ方の自由）。状態名は testid に現れない。
- **フォームは書かずに生成する**: 部品に `kind: form` と `action: {entity}.create`（または `.update`）を書くと、
  欄の集合・並び・制約・入力の種類は生成物（`app/src/app/_screens/generated/`）になる。遷移と削除は
  フォームにできない（ボタンで出す）。`kind` を書かない部品は手書きで、免除の語は無い。
- **行の編集とボタンも書かずに生成する**: `kind: table` に `edit: {entity}.update`（行をその場で編集。列は
  `writes` の欄で、`shows` とは併せない）と `actions: [{entity}.delete, …]`（行ごとのボタン。遷移か削除）を書き、
  1 行に対するボタン列は `kind: actions` + `reads`（returns: one）+ `actions` で書く。**確認が要る操作を
  載せた部品**（行のボタン・フォームの action）は、その部品を `opened_by` に持つ重ね表示（`body.center` に
  `confirm_bar`。見出しは任意の `label`）を宣言する。
- **chrome は外枠**であり、画面の layout はその内側に入る。chrome が header を持っていても、
  画面が header を宣言してよい（衝突しない）。testid の名前空間も別になる。
- **route は実装（app/src/app/**/page.tsx）と 1 対 1**（S7）。requires_auth: true の画面は
  src/proxy.ts の matcher に覆われている必要がある。testid の骨格は実装が手で書かず、
  生成物（app/src/domain/generated/testids.ts）を使う。
- タブは原則としてルートに昇格させる（1 タブ = 1 画面 = 1 ルート）。クライアント内タブを
  使ってよいのは「同一データの見せ方切替」だけ。
- test_cases が指すのは screenTest（app/src/app/__screens__/）。RSC を「依存を引数で受ける
  関数」として呼び、宣言した部品・排他表示・入場の関門・遷移先を確かめる。書き方の正は
  docs/rules/process/frontend/system/standards/conventions/screen-test.md。
- 本文の手書き散文は**標識**2種だけ（各 1〜3 行）: 否定（検討して捨てた代替案）と線引き（ここでは
  やらないの宣言）。事実の再記述はドリフト源なので書かない。経緯は NOTES へ。
- 書き方の正: docs/rules/process/frontend/specification/standards/screen-spec-writing.md
-->

# {画面の日本語名}（{name}）

{手書き散文は標識 2 種・各 1〜3 行のみ。可視性や権限の再掲はしない。例:}

- {否定の標識: 「variants のどちらが出るかの条件は書かない — 条件まで書くと画面が読み取り条件を再定義する」}
- {線引きの標識: 「◯◯の作成はこの画面に無い（creates 未宣言） — 認証フローで扱う」}

<!-- AUTO-GENERATED:screen-body -->
（この見本では空のまま。実ファイルでは npm run generate が宣言のマトリクスを差し込む）
<!-- /AUTO-GENERATED:screen-body -->
