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
<!-- /AUTO-GENERATED:screen-body -->
