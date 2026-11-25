---
doc_type: query_spec
scope: backend
id: query-document-detail

name: document_detail
for: [staff]
source: document
scope_used: all
returns: one

params:
  - name: document_id
    ref: document.id

filters:
  - id == param.document_id

projection:
  - id
  - department_id
  - author_id
  - title
  - summary
  - disposable_after
  - archived_at
  - state

test_cases:
  - id: TC-DOCUMENT-DOCUMENT_DETAIL-001
    type: integration
    covers: [success]
    spec_ids: [query-document-detail]
    implementation: app/src/composition/__tests__/document/document_detail.test.ts::社員は自部署の文書の1件を読める
---

# 文書の詳細（document_detail）

- 起案者の氏名を併読しない — 名簿の可視性は職員側の宣言が持っており、詳細に混ぜると 2 つの正ができる。

- **この経路は `state` で絞らない**(1 件引きなので絞る相手が無い)。それで安全なのは、保管した文書が `staff` の**上界そのものに含まれない**からである —— 可視性の条件(access_spec の `reads[].when`)が RLS の `using` に入っているので、URL を知っていても一般の社員には 0 件しか返らない。文書管理者は同じ経路で保管した文書も読める(あちらの読み取り規則には条件が無い)。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
