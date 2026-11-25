---
doc_type: query_spec
scope: backend
id: query-loan-own-list

name: loan_own_list
for: [patron]
via: loan_owner
source: loan
scope_used: own
returns: many

filters:
  - state in [requested, checked_out, overdue]

includes:
  - entity: item
    scope_used: all
    projection: [id, title, author]

sort:
  - due_at asc
  - id asc

paging: none
bounded_by: window

projection:
  - id
  - item_id
  - due_at
  - state

test_cases:
  - id: TC-LOAN-LOAN_OWN_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-loan-own-list]
    implementation: app/src/composition/__tests__/loan/loan_own_list.test.ts::利用者は自分の返却前の貸出だけを期限順に読める
  - id: TC-LOAN-LOAN_OWN_LIST-002
    type: integration
    covers: [other]
    spec_ids: [loan-access]
    implementation: app/src/composition/__tests__/loan/loan_own_list.test.ts::司書として他人の貸出が見えている状況でも自分の貸出しか返らない
---

# 自分の貸出（loan_own_list）

- 返却済みの履歴は返さない — 履歴の閲覧は loan_own_history が受ける（これから動く貸出と済んだ貸出は読む目的が違う）。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
