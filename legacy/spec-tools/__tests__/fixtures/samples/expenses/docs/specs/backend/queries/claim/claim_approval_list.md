---
doc_type: query_spec
scope: backend
id: query-claim-approval-list

name: claim_approval_list
for: [employee]
via: approver
source: claim
scope_used: own
returns: many

filters:
  - state in [submitted, approved]

sort: [created_at asc]
paging: limit(50)

projection: [id, title, total_amount, state, employee_id, created_at]

test_cases:
  - id: TC-CLAIM-CLAIM_APPROVAL_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-claim-approval-list]
    implementation: app/src/composition/__tests__/claim/claim_approval_list.test.ts::承認者は自分が指名された提出済みの申請を古い順に読める
  - id: TC-CLAIM-CLAIM_APPROVAL_LIST-002
    type: integration
    covers: [other]
    spec_ids: [claim-access]
    implementation: app/src/composition/__tests__/claim/claim_approval_list.test.ts::自分が申請者の行はこの経路に混ざらない
---

# 承認待ちの申請（claim_approval_list）

- 支払い済み・差戻しを返さない — 承認者が見るのは手を動かす対象だけである(履歴は申請者の一覧が持つ)。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
