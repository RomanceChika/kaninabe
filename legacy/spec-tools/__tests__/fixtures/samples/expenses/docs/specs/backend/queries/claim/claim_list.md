---
doc_type: query_spec
scope: backend
id: query-claim-list

name: claim_list
for: [employee]
via: claim_owner
source: claim
scope_used: own
returns: many

sort: [created_at desc]
paging: none
bounded_by: window

projection: [id, title, total_amount, state, created_at]

test_cases:
  - id: TC-CLAIM-CLAIM_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-claim-list]
    implementation: app/src/composition/__tests__/claim/claim_list.test.ts::従業員は自分の申請だけを新しい順に読める
  - id: TC-CLAIM-CLAIM_LIST-002
    type: integration
    covers: [other]
    spec_ids: [claim-access]
    implementation: app/src/composition/__tests__/claim/claim_list.test.ts::承認者として見える申請はこの経路に混ざらない
---

# 申請一覧（claim_list）

- 状態で絞らない — 差戻し・支払済みまで含めて 1 本で見せる(履歴を別経路に切り出すのは実需が出てから)。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
