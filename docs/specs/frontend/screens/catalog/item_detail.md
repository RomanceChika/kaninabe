---
doc_type: screen_spec
scope: frontend
id: screen-item-detail
name: item_detail
label: 蔵書の詳細
route: /items/:id
chrome: chrome-library
for: [patron]
requires_auth: true

subject: item

reads: [query-item-detail]
actions: [loan.create, loan.check_out, item.lend, hold.create]

usecases: [borrow_self.borrow, hold_and_collect.place]

navigations:
  - on: usecase.borrow_self.borrow.success
    to: screen-my-library
  - on: usecase.hold_and_collect.place.success
    to: screen-my-library
  - on: back_to_catalog
    to: screen-item-list

layout:
  header:
    - page_title:
        label: 蔵書の詳細
  body:
    center:
      - item_summary
      - variants:
          on_shelf: borrow_form
          unavailable: hold_form

states:
  requires: [not_found]

test_cases:
  - id: TC-SCREEN-ITEM_DETAIL-001
    type: unit
    covers: [other]
    spec_ids: [screen-item-detail]
    implementation: app/src/app/__screens__/item-detail.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-ITEM_DETAIL-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-item-detail]
    implementation: app/src/app/__screens__/item-detail.test.tsx::未ログインはログイン画面へ送られる
---

# 蔵書の詳細（item_detail）

- どちらのフォームが出るかの条件は書かない — 条件まで書くと画面が読み取り条件を再定義する。

<!-- AUTO-GENERATED:screen-body -->
### 入場と読み取り

| 項目 | 値 |
| --- | --- |
| route | `/items/:id` |
| chrome | chrome-library |
| 閲覧ロール（for） | patron |
| entry_point | — |
| requires_auth | ✓ |
| subject | item |
| precondition | — |
| on_fail | — |
| reads（query_spec） | query-item-detail |
| 表示義務（states.requires） | not_found |

### 骨格

凡例: `[排他{n} {​状態}]` は同時には出ない部品(どの状態でどちらが出るかは実装の自由)。**同じ番号の中から 1 つだけ**が描かれ、番号が違うグループは互いに独立している(番号が 2 つあれば、各グループから 1 つずつ = 同時に 2 つ描かれる)。`└` は部品の内側の入れ子スロット。`—` は宣言の無いスロット。chrome の枠は外枠で、画面の枠はその内側に入る。

```text
+-- chrome: library
|   header : app_header
+-- screen: item_detail
|   header      : page_title
|   body.left   : —
|   body.center : item_summary
|                 [排他1 on_shelf] borrow_form
|                 [排他1 unavailable] hold_form
|   body.right  : —
|   footer      : —
```

### 操作（actions）

| 操作 | 種別 | by | 前提（ドメイン仕様からの導出） | 宣言元 |
| --- | --- | --- | --- | --- |
| `loan.create` | 作成(access_spec: loan の creates) | patron, librarian | patron: `item.state == available`、librarian: `item.state == available` | 画面 |
| `loan.check_out` | 状態遷移(state_spec: loan) | librarian, loan_owner | requested(受取待ち) → checked_out(貸出中) | 画面 |
| `item.lend` | 状態遷移(state_spec: item) | patron, librarian | available(在架) → on_loan(貸出中) | 画面 |
| `hold.create` | 作成(access_spec: hold の creates) | patron | — | 画面 |

### 排他表示（variants）

| スロット | グループ | 状態（key） | 部品 |
| --- | --- | --- | --- |
| body.center | 排他1 | on_shelf | borrow_form |
| body.center | 排他1 | unavailable | hold_form |

### 遷移（navigations）

| きっかけ（on） | 遷移先（to） | 宣言元 |
| --- | --- | --- |
| usecase.borrow_self.borrow.success | screen-my-library | 画面 |
| usecase.hold_and_collect.place.success | screen-my-library | 画面 |
| back_to_catalog | screen-item-list | 画面 |
| catalog_link | screen-item-list | chrome-library |
| my_library_link | screen-my-library | chrome-library |
| desk_link | screen-desk | chrome-library |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-SCREEN-ITEM_DETAIL-001 | unit | other | — | screen-item-detail | `app/src/app/__screens__/item-detail.test.tsx::宣言したスロット部品がすべて描画される` |
| TC-SCREEN-ITEM_DETAIL-002 | unit | forbidden | — | screen-item-detail | `app/src/app/__screens__/item-detail.test.tsx::未ログインはログイン画面へ送られる` |
<!-- /AUTO-GENERATED:screen-body -->
