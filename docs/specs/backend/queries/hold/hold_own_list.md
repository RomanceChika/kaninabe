---
doc_type: query_spec
scope: backend
id: query-hold-own-list

name: hold_own_list
for: [patron]
via: hold_owner
source: hold
scope_used: own
returns: many

filters:
  - state in [placed, ready]

includes:
  - entity: item
    scope_used: all
    projection: [id, title, author]

sort:
  - id asc

paging: none
bounded_by: window

projection:
  - id
  - item_id
  - state

test_cases:
  - id: TC-HOLD-HOLD_OWN_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-hold-own-list]
    implementation: app/src/composition/__tests__/hold/hold_own_list.test.ts::利用者は自分の有効な予約だけを読める
  - id: TC-HOLD-HOLD_OWN_LIST-002
    type: integration
    covers: [other]
    spec_ids: [hold-access]
    implementation: app/src/composition/__tests__/hold/hold_own_list.test.ts::司書として他人の予約が見えている状況でも自分の予約しか返らない
---

# 自分の予約（hold_own_list）

- 連絡事項は返さない — カウンターへの連絡であり、予約者本人の一覧には出さない（fields_hidden）。

<!-- AUTO-GENERATED:query-body -->
### 宣言

| 項目 | 値 |
| --- | --- |
| source | hold |
| 実行ロール（for） | patron |
| 可視性の供給元（via） | hold_owner |
| スコープ（scope_used） | own |
| 返し方 | many / none |
| 並び順（sort） | id asc |
| 有界性の根拠（bounded_by） | window（via のスコープ条件が実行者 1 人分に絞るため有界） |

### params（実行時入力）

実行時入力はない（このクエリは実行者のセッションだけで決まる）。

### filters（絞り込み）

- `state in [placed, ready]`

### includes（併読）

| entity | scope_used | via | filters | projection | sort | limit |
| --- | --- | --- | --- | --- | --- | --- |
| item | all | —（for 自身の reads） | — | id, title, author | — | —（全件） |

### projection（返すフィールド）

| フィールド | 型 | 必須 | 制約 | 説明 |
| --- | --- | --- | --- | --- |
| id | uuid | —（行では必須） | auto=true | — |
| item_id | ref(item) | ✓ | — | — |
| state | state(hold) | —（行では必須） | — | — |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-HOLD-HOLD_OWN_LIST-001 | integration | success | — | query-hold-own-list | `app/src/composition/__tests__/hold/hold_own_list.test.ts::利用者は自分の有効な予約だけを読める` |
| TC-HOLD-HOLD_OWN_LIST-002 | integration | other | — | hold-access | `app/src/composition/__tests__/hold/hold_own_list.test.ts::司書として他人の予約が見えている状況でも自分の予約しか返らない` |
<!-- /AUTO-GENERATED:query-body -->
