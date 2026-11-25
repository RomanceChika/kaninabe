---
doc_type: screen_spec
scope: frontend
id: screen-store-detail

name: store_detail
label: 店舗の売場と棚
route: /stores/:store_id
for: [staff_member]
requires_auth: true

subject: store

reads: [query-store-layout]
actions: [store.update, section.create, shelf.create, shelf.update]

overlays:
  - id: section_delete_confirm
    layout: { body: { center: [confirm_bar] } }
    opened_by: section_delete_button
    actions: [section.delete]
    closes_on: [section.delete.success, cancel]

navigations:
  - on: store.update.success
    to: screen-store-detail
  - on: section.create.success
    to: screen-store-detail
  - on: section.delete.success
    to: screen-store-detail
  - on: shelf.create.success
    to: screen-store-detail
  - on: shelf.update.success
    to: screen-store-detail
  - on: shelf_selected
    to: screen-shelf-stock
  - on: store_list_link
    to: screen-store-list

layout:
  header:
    - store_heading
  body:
    left:
      - section_tree
      - section_delete_button
    center:
      - shelf_table
      - shelf_form
    right:
      - store_settings_form

states:
  requires: [loading, empty, error, not_found]

test_cases:
  - id: TC-SCREEN-STORE_DETAIL-001
    type: unit
    covers: [success]
    spec_ids: [screen-store-detail]
    implementation: app/src/app/__screens__/store-detail.test.tsx::売場の木と棚の一覧が描画される
  - id: TC-SCREEN-STORE_DETAIL-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-store-detail]
    implementation: app/src/app/__screens__/store-detail.test.tsx::未ログインはログイン画面へ送られる
---

# 店舗の売場と棚(store_detail)

- 「自分の店舗でなければ入れない」を precondition に書かない — 関係(責任者かどうか)は入場の関門ではなく、行の可視性の話である。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
