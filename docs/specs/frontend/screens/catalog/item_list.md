---
doc_type: screen_spec
scope: frontend
id: screen-item-list
name: item_list
label: 蔵書目録
route: /items
chrome: chrome-library
for: [anonymous, patron]
entry_point: true

reads: [query-item-list]

navigations:
  - on: item_selected
    to: screen-item-detail

layout:
  header:
    - page_title:
        label: 蔵書目録
  body:
    center:
      - item_table

states:
  requires: [empty]

test_cases:
  - id: TC-SCREEN-ITEM_LIST-001
    type: unit
    covers: [other]
    spec_ids: [screen-item-list]
    implementation: app/src/app/__screens__/item-list.test.tsx::宣言したスロット部品がすべて描画される
---

# 蔵書目録（item_list）

- 貸出の操作はここに置かない — 一覧から直接借りられると、どの 1 冊かの確認が飛ぶ。

<!-- AUTO-GENERATED:screen-body -->
### 入場と読み取り

| 項目 | 値 |
| --- | --- |
| route | `/items` |
| chrome | chrome-library |
| 閲覧ロール（for） | anonymous, patron |
| entry_point | ✓ |
| requires_auth | — |
| subject | — |
| precondition | — |
| on_fail | — |
| reads（query_spec） | query-item-list |
| 表示義務（states.requires） | empty |

### 骨格

凡例: `[排他{n} {​状態}]` は同時には出ない部品(どの状態でどちらが出るかは実装の自由)。**同じ番号の中から 1 つだけ**が描かれ、番号が違うグループは互いに独立している(番号が 2 つあれば、各グループから 1 つずつ = 同時に 2 つ描かれる)。`└` は部品の内側の入れ子スロット。`—` は宣言の無いスロット。chrome の枠は外枠で、画面の枠はその内側に入る。

```text
+-- chrome: library
|   header : app_header
+-- screen: item_list
|   header      : page_title
|   body.left   : —
|   body.center : item_table
|   body.right  : —
|   footer      : —
```

### 操作（actions）

この画面から発火できる操作はない（読むだけの画面）。

### 遷移（navigations）

| きっかけ（on） | 遷移先（to） | 宣言元 |
| --- | --- | --- |
| item_selected | screen-item-detail | 画面 |
| catalog_link | screen-item-list | chrome-library |
| my_library_link | screen-my-library | chrome-library |
| desk_link | screen-desk | chrome-library |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-SCREEN-ITEM_LIST-001 | unit | other | — | screen-item-list | `app/src/app/__screens__/item-list.test.tsx::宣言したスロット部品がすべて描画される` |
<!-- /AUTO-GENERATED:screen-body -->
