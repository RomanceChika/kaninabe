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
<!-- /AUTO-GENERATED:screen-body -->
