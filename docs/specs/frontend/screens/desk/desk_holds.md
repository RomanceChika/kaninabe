---
doc_type: screen_spec
scope: frontend
id: screen-desk-holds
name: desk_holds
label: 予約カウンター
route: /desk/holds
chrome: chrome-library
for: [librarian]
requires_auth: true

reads: [query-desk-hold-list]
actions:
  - hold.prepare
  - hold.collect
  # hold.cancel は overlays 側にのみ書く(負の意味の終端状態への遷移 = 確認を挟む)

navigations:
  - on: item_link
    to: screen-item-detail
  - on: loans_link
    to: screen-desk

overlays:
  # 予約の取消は負の意味の状態(cancelled)への終端遷移で、利用者が待っている取置を取り消す(U1)
  - id: hold_cancel_confirm
    layout:
      body:
        center: [confirm_bar]
    opened_by: desk_hold_table      # 予約の行の中の「取り消す」ボタンが開く
    actions: [hold.cancel]
    closes_on: [hold.cancel.success, cancel]

layout:
  header:
    - page_title:
        label: 予約カウンター
  body:
    center:
      - desk_hold_table

states:
  requires: [empty]

test_cases:
  - id: TC-SCREEN-DESK_HOLDS-001
    type: unit
    covers: [other]
    spec_ids: [screen-desk-holds]
    implementation: app/src/app/__screens__/desk-holds.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-DESK_HOLDS-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-desk-holds]
    implementation: app/src/app/__screens__/desk-holds.test.tsx::未ログインはログイン画面へ送られる
---

# 予約カウンター（desk_holds）

- 貸出・返却の操作はここに置かない — それは desk が持つ（予約の台帳だけを見る画面にする）。

<!-- AUTO-GENERATED:screen-body -->
### 入場と読み取り

| 項目 | 値 |
| --- | --- |
| route | `/desk/holds` |
| chrome | chrome-library |
| 閲覧ロール（for） | librarian |
| entry_point | — |
| requires_auth | ✓ |
| subject | — |
| precondition | — |
| on_fail | — |
| reads（query_spec） | query-desk-hold-list |
| 表示義務（states.requires） | empty |

### 骨格

凡例: `[排他{n} {​状態}]` は同時には出ない部品(どの状態でどちらが出るかは実装の自由)。**同じ番号の中から 1 つだけ**が描かれ、番号が違うグループは互いに独立している(番号が 2 つあれば、各グループから 1 つずつ = 同時に 2 つ描かれる)。`└` は部品の内側の入れ子スロット。`—` は宣言の無いスロット。chrome の枠は外枠で、画面の枠はその内側に入る。

```text
+-- chrome: library
|   header : app_header
+-- screen: desk_holds
|   header      : page_title
|   body.left   : —
|   body.center : desk_hold_table
|   body.right  : —
|   footer      : —
+-- overlay: hold_cancel_confirm (opened_by: desk_hold_table)
|   body.center : confirm_bar
```

### 操作（actions）

| 操作 | 種別 | by | 前提（ドメイン仕様からの導出） | 宣言元 |
| --- | --- | --- | --- | --- |
| `hold.prepare` | 状態遷移(state_spec: hold) | librarian | placed(受付) → ready(取置中)、`item.state == available` | 画面 |
| `hold.collect` | 状態遷移(state_spec: hold) | librarian, hold_owner | ready(取置中) → collected(受取済み) | 画面 |
| `hold.cancel` | 状態遷移(state_spec: hold) | hold_owner, librarian | placed(受付), ready(取置中) → cancelled(取消) | overlay: hold_cancel_confirm |

### 重ね表示（overlays）

| overlay | opened_by | actions | closes_on |
| --- | --- | --- | --- |
| hold_cancel_confirm | desk_hold_table | hold.cancel | hold.cancel.success, cancel |

### 遷移（navigations）

| きっかけ（on） | 遷移先（to） | 宣言元 |
| --- | --- | --- |
| item_link | screen-item-detail | 画面 |
| loans_link | screen-desk | 画面 |
| catalog_link | screen-item-list | chrome-library |
| my_library_link | screen-my-library | chrome-library |
| desk_link | screen-desk | chrome-library |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-SCREEN-DESK_HOLDS-001 | unit | other | — | screen-desk-holds | `app/src/app/__screens__/desk-holds.test.tsx::宣言したスロット部品がすべて描画される` |
| TC-SCREEN-DESK_HOLDS-002 | unit | forbidden | — | screen-desk-holds | `app/src/app/__screens__/desk-holds.test.tsx::未ログインはログイン画面へ送られる` |
<!-- /AUTO-GENERATED:screen-body -->
