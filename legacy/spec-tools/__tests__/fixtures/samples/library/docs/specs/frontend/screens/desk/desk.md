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
<!-- /AUTO-GENERATED:screen-body -->
