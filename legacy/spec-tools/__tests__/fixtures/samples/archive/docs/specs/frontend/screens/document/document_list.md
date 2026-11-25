---
doc_type: screen_spec
scope: frontend
id: screen-document-list

name: document_list
label: 供覧の一覧
route: /documents
for: [staff]
entry_point: true
requires_auth: true

reads: [query-document-list]
actions: [document.create, document.update]

navigations:
  - on: document_selected
    to: screen-document-detail
  - on: archive_link
    to: screen-archive-box
  - on: document.create.success
    to: screen-document-list
  - on: document.update.success
    to: screen-document-list

layout:
  header:
    - page_title:
        label: 供覧の一覧
  body:
    center:
      - document_table
      - variants:
          has_documents: document_row_actions
          no_documents: empty_notice
    right:
      - document_create_form

states:
  requires: [loading, empty]

test_cases:
  - id: TC-SCREEN-DOCUMENT_LIST-001
    type: unit
    covers: [other]
    spec_ids: [screen-document-list, query-document-list]
    implementation: app/src/app/__screens__/document-list.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-DOCUMENT_LIST-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-document-list]
    implementation: app/src/app/__screens__/document-list.test.tsx::未ログインはログイン画面へ送られる
---

# 供覧の一覧（document_list）

- 保管した文書を出す切替は置かない — 読み取り経路が返さないものを画面の都合で足せない（書庫は別の画面）。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
