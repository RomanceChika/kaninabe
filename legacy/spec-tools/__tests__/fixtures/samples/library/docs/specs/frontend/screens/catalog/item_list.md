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
<!-- /AUTO-GENERATED:screen-body -->
