---
doc_type: query_spec
scope: backend
id: query-hold-own-history

name: hold_own_history
for: [patron]
via: hold_owner
source: hold
scope_used: own
returns: many

filters:
  - state in [collected, cancelled]

includes:
  - entity: item
    scope_used: all
    projection: [id, title, author]

sort:
  - id desc

paging: limit(50)

projection:
  - id
  - item_id
  - state

test_cases:
  - id: TC-HOLD-HOLD_OWN_HISTORY-001
    type: integration
    covers: [success]
    spec_ids: [query-hold-own-history]
    implementation: app/src/composition/__tests__/hold/hold_own_history.test.ts::利用者は自分の受取済み・取消済みの予約だけを id の降順で読める
  - id: TC-HOLD-HOLD_OWN_HISTORY-002
    type: integration
    covers: [other]
    spec_ids: [hold-access]
    implementation: app/src/composition/__tests__/hold/hold_own_history.test.ts::司書として他人の予約が見えている状況でも自分の履歴しか返らない
---

# 自分の予約の履歴（hold_own_history）

- 受付・取置中の予約は返さない — それは hold_own_list が受ける（受け取る・取り消すの対象と、済んだ記録は分ける）。
- 新しい順では並べない — 予約に日時の欄が無く、id(uuid)の降順は決定的な並びを与えるだけで新しさを表さない（日時の欄を足すかは予約のドメインの話）。
- 連絡事項は返さない — カウンターへの連絡であり、予約者本人の一覧には出さない（fields_hidden）。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
