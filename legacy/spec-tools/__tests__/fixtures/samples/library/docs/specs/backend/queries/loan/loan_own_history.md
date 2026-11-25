---
doc_type: query_spec
scope: backend
id: query-loan-own-history

name: loan_own_history
for: [patron]
via: loan_owner
source: loan
scope_used: own
returns: many

filters:
  - state == returned

includes:
  - entity: item
    scope_used: all
    projection: [id, title, author]

sort:
  - due_at desc
  - id desc

paging: limit(50)

projection:
  - id
  - item_id
  - due_at
  - state

test_cases:
  - id: TC-LOAN-LOAN_OWN_HISTORY-001
    type: integration
    covers: [success]
    spec_ids: [query-loan-own-history]
    implementation: app/src/composition/__tests__/loan/loan_own_history.test.ts::利用者は自分の返却済みの貸出だけを期限の新しい順に読める
  - id: TC-LOAN-LOAN_OWN_HISTORY-002
    type: integration
    covers: [other]
    spec_ids: [loan-access]
    implementation: app/src/composition/__tests__/loan/loan_own_history.test.ts::司書として他人の貸出が見えている状況でも自分の履歴しか返らない
---

# 自分の貸出の履歴（loan_own_history）

- 返却前の貸出は返さない — 返却前は loan_own_list が受ける（これから動く貸出と済んだ貸出は読む目的が違う）。
- 全件は返さない — 履歴は増え続けるので、期限の新しい順に 50 件までで切る（それより古い履歴の遡りはこの版で扱わない）。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
