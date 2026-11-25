---
doc_type: query_spec
scope: backend
id: query-document-list

name: document_list
for: [staff]
source: document
scope_used: all
returns: many

sort:
  - title asc
  - id asc

paging: limit(50)

projection:
  - id
  - department_id
  - author_id
  - title
  - summary
  - disposable_after
  - state

test_cases:
  - id: TC-DOCUMENT-DOCUMENT_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-document-list]
    implementation: app/src/composition/__tests__/document/document_list.test.ts::社員は自部署の供覧中の文書を標題順に読める
  - id: TC-DOCUMENT-DOCUMENT_LIST-002
    type: integration
    covers: [other]
    spec_ids: [document-access]
    implementation: app/src/composition/__tests__/document/document_list.test.ts::書庫へ入れた文書は一覧に返らない
---

# 供覧の一覧（document_list）

- **`state != archived` の絞りを持たない。** 束 §14 まではこの 1 本の `filters` だけが「保管した文書を隠す」を担っていたが、いまは可視性の条件(access_spec の `reads[].when`)がそれを言っている —— `for: [staff]` のこの経路の上界に、保管した文書はもう入っていない。同じことを 2 か所に書くと、片方を直したときにもう片方が古びる。
- 保管した文書を上限で切らない — 返す集合そのものを絞るのは可視性の側である（切ってよい行と悪い行を上限は区別できない）。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
