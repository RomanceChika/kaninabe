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
<!-- /AUTO-GENERATED:screen-body -->
