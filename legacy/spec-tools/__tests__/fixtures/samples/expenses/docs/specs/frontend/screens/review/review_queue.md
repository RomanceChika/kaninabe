---
doc_type: screen_spec
scope: frontend
id: screen-review-queue

name: review_queue
label: 承認と支払い
route: /reviews
for: [employee]
requires_auth: true

reads: [query-claim-approval-list]
actions: [claim.approve]
# claim.pay / claim.reject は overlays 側にのみ書く(支払いは戻らない・差戻しは戻る道が無い = 確認を挟む)

overlays:
  # 支払いは外部の送金を伴い、支払い済み(終端)へ進んで戻る道が無い(U1)
  - id: pay_confirm
    layout:
      body:
        center: [pay_confirm_bar]
    opened_by: review_table         # 表の行の中の「支払う」ボタンが開く
    actions: [claim.pay]
    closes_on: [claim.pay.success, cancel]
  - id: reject_confirm
    layout:
      body:
        center: [reject_confirm_bar]
    opened_by: reject_button
    actions: [claim.reject]
    closes_on: [cancel]

navigations:
  - on: back_link
    to: screen-claim-list

layout:
  header:
    - page_title:
        label: 承認と支払い
  body:
    center:
      - review_table
      - reject_button

states:
  requires: [loading, empty]

test_cases:
  - id: TC-SCREEN-REVIEW_QUEUE-001
    type: unit
    covers: [success]
    spec_ids: [screen-review-queue]
    implementation: app/src/app/__screens__/review-queue.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-REVIEW_QUEUE-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-review-queue]
    implementation: app/src/app/__screens__/review-queue.test.tsx::未ログインはログイン画面へ送られる
  - id: TC-SCREEN-REVIEW_QUEUE-003
    type: unit
    covers: [other]
    spec_ids: [screen-review-queue]
    implementation: app/src/app/__screens__/review-queue.test.tsx::承認待ちが無いときは空表示になる
---

# 承認と支払い（review_queue）

- 承認と支払いを別画面に割らない — 同じ表の行に対する連続した処理であり、往復させる理由が無い。
- 支払いと差戻しだけ重ね表示に置く — 戻る道の無い操作なので確認を挟む（承認は確認を要する操作と導出されないので、表の行のボタンのまま置く）。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
