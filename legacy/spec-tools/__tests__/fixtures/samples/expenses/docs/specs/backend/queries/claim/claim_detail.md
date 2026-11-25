---
doc_type: query_spec
scope: backend
id: query-claim-detail

name: claim_detail
for: [employee]
via: claim_owner
source: claim
scope_used: own
returns: one

params:
  - name: claim_id
    ref: claim.id

filters:
  - id == param.claim_id

includes:
  - entity: line
    scope_used: context(claim)
    via: claim_owner
    projection: [id, spent_on, category, amount, memo]
    sort: [spent_on asc]

projection: [id, title, purpose, total_amount, state, employee_id, approver_id, created_at]

test_cases:
  - id: TC-CLAIM-CLAIM_DETAIL-001
    type: integration
    covers: [success]
    spec_ids: [query-claim-detail]
    implementation: app/src/composition/__tests__/claim/claim_detail.test.ts::申請者は自分の申請を明細つきで読める
  - id: TC-CLAIM-CLAIM_DETAIL-002
    type: integration
    covers: [other]
    spec_ids: [claim-access]
    implementation: app/src/composition/__tests__/claim/claim_detail.test.ts::他人の申請のIDを渡しても0件になる
---

# 申請詳細（claim_detail）

- 承認者向けの詳細はこの経路で兼ねない — スコープ条件(via)が申請者に固定されており、兼ねると返る集合が宣言と食い違う。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
