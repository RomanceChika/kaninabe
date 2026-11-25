---
doc_type: screen_spec
scope: frontend
id: screen-document-detail

name: document_detail
label: 文書
route: /documents/:id
for: [staff]
requires_auth: true

subject: document

reads: [query-document-detail]
actions: [document.circulate, document.archive]

navigations:
  - on: back_to_list
    to: screen-document-list
  - on: document.circulate.success
    to: screen-document-detail
  - on: document.archive.success
    to: screen-document-list

overlays:
  - id: circulate_dialog
    layout: { body: { center: [circulate_bar] } }
    opened_by: document_actions
    actions: [document.circulate]
    closes_on: [document.circulate.success, cancel]
  - id: archive_dialog
    layout: { body: { center: [archive_bar] } }
    opened_by: document_actions
    actions: [document.archive]
    closes_on: [document.archive.success, cancel]

layout:
  header:
    - page_title:
        label: 文書
  body:
    center:
      - document_card
      - document_actions

states:
  requires: [loading, error]

test_cases:
  - id: TC-SCREEN-DOCUMENT_DETAIL-001
    type: unit
    covers: [other]
    spec_ids: [screen-document-detail, query-document-detail]
    implementation: app/src/app/__screens__/document-detail.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-DOCUMENT_DETAIL-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-document-detail]
    implementation: app/src/app/__screens__/document-detail.test.tsx::未ログインはログイン画面へ送られる
---

# 文書（document_detail）

- 保管中であることを隠す表示にしない — 文書管理者はこの画面で保管した文書も読むので、状態をそのまま出す。
- **「保管した文書を一般の社員に見せない」を画面が守るのではない。** 守っているのは可視性の宣言(access_spec の `reads[].when`)であり、一般の社員がこの画面を保管文書の URL で開くと読み取りが 0 件になる（画面の `for` を絞る話ではない）。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
