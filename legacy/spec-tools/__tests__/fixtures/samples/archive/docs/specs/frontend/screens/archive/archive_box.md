---
doc_type: screen_spec
scope: frontend
id: screen-archive-box

name: archive_box
label: 書庫
route: /archive
for: [curator]
requires_auth: true

reads: [query-archive-list]
actions: [document.restore, document.delete]

navigations:
  - on: back_to_documents
    to: screen-document-list
  - on: document.restore.success
    to: screen-archive-box
  - on: document.delete.success
    to: screen-archive-box

overlays:
  - id: dispose_dialog
    layout: { body: { center: [dispose_bar] } }
    opened_by: archive_row_actions
    actions: [document.delete]
    closes_on: [document.delete.success, cancel]

layout:
  header:
    - page_title:
        label: 書庫
  body:
    center:
      - archive_table
      - variants:
          has_archived: archive_row_actions
          no_archived: empty_notice

states:
  requires: [loading, empty]

test_cases:
  - id: TC-SCREEN-ARCHIVE_BOX-001
    type: unit
    covers: [other]
    spec_ids: [screen-archive-box, query-archive-list]
    implementation: app/src/app/__screens__/archive-box.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-ARCHIVE_BOX-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-archive-box]
    implementation: app/src/app/__screens__/archive-box.test.tsx::文書管理者でない社員は中身を見られない
---

# 書庫（archive_box）

- 廃棄を一括で実行する口は置かない — 1 操作 1 文書に保つ（まとめて消す形は取り返しがつかない）。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
