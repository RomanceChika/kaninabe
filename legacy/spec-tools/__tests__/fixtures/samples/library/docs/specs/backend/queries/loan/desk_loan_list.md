---
doc_type: query_spec
scope: backend
id: query-desk-loan-list

name: desk_loan_list
for: [librarian]
source: loan
scope_used: all
returns: many

filters:
  - state in [requested, checked_out, overdue]

sort:
  - due_at asc
  - id asc

paging: limit(50)

projection:
  - id
  - item_id
  - patron_id
  - due_at
  - state

test_cases:
  - id: TC-LOAN-DESK_LOAN_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-desk-loan-list]
    implementation: app/src/composition/__tests__/loan/desk_loan_list.test.ts::司書は返却前の貸出を期限順に読める
---

# カウンターの貸出一覧（desk_loan_list）

- 返却済みを混ぜない — カウンターで見たいのは「これから動く貸出」だけである。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
