---
doc_type: screen_spec
scope: frontend
id: screen-desk
name: desk
label: カウンター
route: /desk
chrome: chrome-library
for: [librarian]
requires_auth: true

reads: [query-desk-loan-list]
actions:
  - item.create
  - item.lend
  - item.shelve
  - loan.check_out
  - loan.return_item
  # item.report_lost / loan.report_overdue は overlays 側にのみ書く(負の意味の遷移 = 確認を挟む)

navigations:
  - on: item_link
    to: screen-item-detail
  - on: holds_link
    to: screen-desk-holds

overlays:
  # 延滞の記録は負の意味の状態(overdue)への遷移で、戻る道が無く、利用者の側にも影響する(U1)
  - id: overdue_confirm
    layout:
      body:
        center: [confirm_bar]
    opened_by: desk_loan_table      # 貸出の行の中の「延滞として記録する」ボタンが開く
    actions: [loan.report_overdue]
    closes_on: [loan.report_overdue.success, cancel]
  # 紛失の記録は負の意味の終端状態(lost)への遷移で、蔵書は目録から消える(U1)
  - id: lost_confirm
    layout:
      body:
        center: [confirm_bar]
    opened_by: item_stock_bar       # 蔵書の在庫操作の並びの中の「紛失として記録する」ボタンが開く
    actions: [item.report_lost]
    closes_on: [item.report_lost.success, cancel]

layout:
  header:
    - page_title:
        label: カウンター
  body:
    left:
      - accession_form
    center:
      - desk_loan_table
      - item_stock_bar

states:
  requires: [empty]

test_cases:
  - id: TC-SCREEN-DESK-001
    type: unit
    covers: [other]
    spec_ids: [screen-desk]
    implementation: app/src/app/__screens__/desk.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-DESK-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-desk]
    implementation: app/src/app/__screens__/desk.test.tsx::未ログインはログイン画面へ送られる
---

# カウンター（desk）

- 利用者の検索は置かない — 利用者の読み取り経路を仕様化していないため、画面だけ先に作らない。
- 予約の操作はこの画面に置かない — 貸出・返却・在庫の操作と予約の操作を 1 枚に並べると 1 つの状態で 9 個の操作が並ぶので、予約は別画面(desk_holds)へ分けた。

<!-- AUTO-GENERATED:screen-body -->
### 入場と読み取り

| 項目 | 値 |
| --- | --- |
| route | `/desk` |
| chrome | chrome-library |
| 閲覧ロール（for） | librarian |
| entry_point | — |
| requires_auth | ✓ |
| subject | — |
| precondition | — |
| on_fail | — |
| reads（query_spec） | query-desk-loan-list |
| 表示義務（states.requires） | empty |

### 骨格

凡例: `[排他{n} {​状態}]` は同時には出ない部品(どの状態でどちらが出るかは実装の自由)。**同じ番号の中から 1 つだけ**が描かれ、番号が違うグループは互いに独立している(番号が 2 つあれば、各グループから 1 つずつ = 同時に 2 つ描かれる)。`└` は部品の内側の入れ子スロット。`—` は宣言の無いスロット。chrome の枠は外枠で、画面の枠はその内側に入る。

```text
+-- chrome: library
|   header : app_header
+-- screen: desk
|   header      : page_title
|   body.left   : accession_form
|   body.center : desk_loan_table
|                 item_stock_bar
|   body.right  : —
|   footer      : —
+-- overlay: overdue_confirm (opened_by: desk_loan_table)
|   body.center : confirm_bar
+-- overlay: lost_confirm (opened_by: item_stock_bar)
|   body.center : confirm_bar
```

### 操作（actions）

| 操作 | 種別 | by | 前提（ドメイン仕様からの導出） | 宣言元 |
| --- | --- | --- | --- | --- |
| `item.create` | 作成(access_spec: item の creates) | librarian | — | 画面 |
| `item.lend` | 状態遷移(state_spec: item) | patron, librarian | available(在架) → on_loan(貸出中) | 画面 |
| `item.shelve` | 状態遷移(state_spec: item) | patron, librarian | on_loan(貸出中) → available(在架) | 画面 |
| `loan.check_out` | 状態遷移(state_spec: loan) | librarian, loan_owner | requested(受取待ち) → checked_out(貸出中) | 画面 |
| `loan.return_item` | 状態遷移(state_spec: loan) | librarian, loan_owner | checked_out(貸出中), overdue(延滞) → returned(返却済み) | 画面 |
| `loan.report_overdue` | 状態遷移(state_spec: loan) | librarian | checked_out(貸出中) → overdue(延滞)、`now > loan.due_at` | overlay: overdue_confirm |
| `item.report_lost` | 状態遷移(state_spec: item) | librarian | available(在架), on_loan(貸出中) → lost(紛失) | overlay: lost_confirm |

### 重ね表示（overlays）

| overlay | opened_by | actions | closes_on |
| --- | --- | --- | --- |
| overdue_confirm | desk_loan_table | loan.report_overdue | loan.report_overdue.success, cancel |
| lost_confirm | item_stock_bar | item.report_lost | item.report_lost.success, cancel |

### 遷移（navigations）

| きっかけ（on） | 遷移先（to） | 宣言元 |
| --- | --- | --- |
| item_link | screen-item-detail | 画面 |
| holds_link | screen-desk-holds | 画面 |
| catalog_link | screen-item-list | chrome-library |
| my_library_link | screen-my-library | chrome-library |
| desk_link | screen-desk | chrome-library |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-SCREEN-DESK-001 | unit | other | — | screen-desk | `app/src/app/__screens__/desk.test.tsx::宣言したスロット部品がすべて描画される` |
| TC-SCREEN-DESK-002 | unit | forbidden | — | screen-desk | `app/src/app/__screens__/desk.test.tsx::未ログインはログイン画面へ送られる` |
<!-- /AUTO-GENERATED:screen-body -->
