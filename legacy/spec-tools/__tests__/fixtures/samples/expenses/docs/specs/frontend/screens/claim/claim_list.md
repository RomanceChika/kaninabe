---
doc_type: screen_spec
scope: frontend
id: screen-claim-list

name: claim_list
label: 申請一覧
route: /claims
for: [employee]
entry_point: true
requires_auth: true

reads: [query-claim-list]
actions: [claim.create, line.create, claim.submit]

usecases: [claim_with_lines.register]

navigations:
  - on: usecase.claim_with_lines.register.success
    to: screen-claim-list
  - on: claim_selected
    to: screen-claim-detail
  - on: review_link
    to: screen-review-queue

layout:
  header:
    - page_title:
        label: 経費申請
  body:
    center:
      - claim_table
      - claim_compose_form

states:
  requires: [loading, empty]

test_cases:
  - id: TC-SCREEN-CLAIM_LIST-001
    type: unit
    covers: [success]
    spec_ids: [screen-claim-list]
    implementation: app/src/app/__screens__/claim-list.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-CLAIM_LIST-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-claim-list]
    implementation: app/src/app/__screens__/claim-list.test.tsx::未ログインはログイン画面へ送られる
  - id: TC-SCREEN-CLAIM_LIST-003
    type: unit
    covers: [other]
    spec_ids: [screen-claim-list]
    implementation: app/src/app/__screens__/claim-list.test.tsx::申請が1件も無いときは空表示になる
---

# 申請一覧（claim_list）

- 明細の入力欄の数を仕様で縛らない — 何行足せるかは見せ方であり、repeat の手順が 1 つあることだけが宣言である。
- 承認待ちの一覧はこの画面に混ぜない — 立場が違う 2 つのタスクを 1 枚に乗せない。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
