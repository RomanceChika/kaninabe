---
doc_type: screen_spec
scope: frontend
id: screen-my-library
name: my_library
label: 自分の棚
route: /my
chrome: chrome-library
for: [patron]
requires_auth: true

reads: [query-loan-own-list, query-hold-own-list, query-loan-own-history, query-hold-own-history]
actions: [loan.create, loan.check_out, loan.return_item, item.lend, item.shelve, hold.collect]

usecases: [hold_and_collect.collect]

navigations:
  - on: usecase.hold_and_collect.collect.success
    to: screen-my-library
  - on: item_link
    to: screen-item-detail

overlays:
  - id: cancel_confirm
    layout: { body: { center: [cancel_bar] } }
    opened_by: hold_table
    actions: [hold.cancel]
    closes_on: [hold.cancel.success, cancel]

layout:
  header:
    - page_title:
        label: 自分の棚
  body:
    center:
      - loan_table
      - hold_table
      - loan_history_table:         # 返却済みの貸出の履歴(期限の新しい順)。操作は持たない = 読むだけの生成物の表(kind: table)
          label: 貸出の履歴
          kind: table
          reads: query-loan-own-history
      - hold_history_table          # 受取済み・取消済みの予約の履歴(id の降順。予約に日時の欄が無く新しさでは並べない)。操作は持たない

states:
  requires: [empty]

test_cases:
  - id: TC-SCREEN-MY_LIBRARY-001
    type: unit
    covers: [other]
    spec_ids: [screen-my-library]
    implementation: app/src/app/__screens__/my-library.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-MY_LIBRARY-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-my-library]
    implementation: app/src/app/__screens__/my-library.test.tsx::未ログインはログイン画面へ送られる
---

# 自分の棚（my_library）

- 履歴の表は操作を持たない — 返却済み・受取済み・取消済みは終端の状態で、起こせる操作が残っていない。履歴は専用の読み取り経路(loan_own_history / hold_own_history)が返すもので、画面が loan_own_list の結果へ足すことはしない。

<!-- AUTO-GENERATED:screen-body -->
### 入場と読み取り

| 項目 | 値 |
| --- | --- |
| route | `/my` |
| chrome | chrome-library |
| 閲覧ロール（for） | patron |
| entry_point | — |
| requires_auth | ✓ |
| subject | — |
| precondition | — |
| on_fail | — |
| reads（query_spec） | query-loan-own-list, query-hold-own-list, query-loan-own-history, query-hold-own-history |
| 表示義務（states.requires） | empty |

### 骨格

凡例: `[排他{n} {​状態}]` は同時には出ない部品(どの状態でどちらが出るかは実装の自由)。**同じ番号の中から 1 つだけ**が描かれ、番号が違うグループは互いに独立している(番号が 2 つあれば、各グループから 1 つずつ = 同時に 2 つ描かれる)。`└` は部品の内側の入れ子スロット。`—` は宣言の無いスロット。chrome の枠は外枠で、画面の枠はその内側に入る。

```text
+-- chrome: library
|   header : app_header
+-- screen: my_library
|   header      : page_title
|   body.left   : —
|   body.center : loan_table
|                 hold_table
|                 loan_history_table
|                 hold_history_table
|   body.right  : —
|   footer      : —
+-- overlay: cancel_confirm (opened_by: hold_table)
|   body.center : cancel_bar
```

### 操作（actions）

| 操作 | 種別 | by | 前提（ドメイン仕様からの導出） | 宣言元 |
| --- | --- | --- | --- | --- |
| `loan.create` | 作成(access_spec: loan の creates) | patron, librarian | patron: `item.state == available`、librarian: `item.state == available` | 画面 |
| `loan.check_out` | 状態遷移(state_spec: loan) | librarian, loan_owner | requested(受取待ち) → checked_out(貸出中) | 画面 |
| `loan.return_item` | 状態遷移(state_spec: loan) | librarian, loan_owner | checked_out(貸出中), overdue(延滞) → returned(返却済み) | 画面 |
| `item.lend` | 状態遷移(state_spec: item) | patron, librarian | available(在架) → on_loan(貸出中) | 画面 |
| `item.shelve` | 状態遷移(state_spec: item) | patron, librarian | on_loan(貸出中) → available(在架) | 画面 |
| `hold.collect` | 状態遷移(state_spec: hold) | librarian, hold_owner | ready(取置中) → collected(受取済み) | 画面 |
| `hold.cancel` | 状態遷移(state_spec: hold) | hold_owner, librarian | placed(受付), ready(取置中) → cancelled(取消) | overlay: cancel_confirm |

### 重ね表示（overlays）

| overlay | opened_by | actions | closes_on |
| --- | --- | --- | --- |
| cancel_confirm | hold_table | hold.cancel | hold.cancel.success, cancel |

### 遷移（navigations）

| きっかけ（on） | 遷移先（to） | 宣言元 |
| --- | --- | --- |
| usecase.hold_and_collect.collect.success | screen-my-library | 画面 |
| item_link | screen-item-detail | 画面 |
| catalog_link | screen-item-list | chrome-library |
| my_library_link | screen-my-library | chrome-library |
| desk_link | screen-desk | chrome-library |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-SCREEN-MY_LIBRARY-001 | unit | other | — | screen-my-library | `app/src/app/__screens__/my-library.test.tsx::宣言したスロット部品がすべて描画される` |
| TC-SCREEN-MY_LIBRARY-002 | unit | forbidden | — | screen-my-library | `app/src/app/__screens__/my-library.test.tsx::未ログインはログイン画面へ送られる` |
<!-- /AUTO-GENERATED:screen-body -->
