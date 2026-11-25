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
### 宣言

| 項目 | 値 |
| --- | --- |
| source | hold |
| 実行ロール（for） | patron |
| 可視性の供給元（via） | hold_owner |
| スコープ（scope_used） | own |
| 返し方 | many / limit(50) |
| 並び順（sort） | id desc |

### params（実行時入力）

実行時入力はない（このクエリは実行者のセッションだけで決まる）。

### filters（絞り込み）

- `state in [collected, cancelled]`

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
| TC-HOLD-HOLD_OWN_HISTORY-001 | integration | success | — | query-hold-own-history | `app/src/composition/__tests__/hold/hold_own_history.test.ts::利用者は自分の受取済み・取消済みの予約だけを id の降順で読める` |
| TC-HOLD-HOLD_OWN_HISTORY-002 | integration | other | — | hold-access | `app/src/composition/__tests__/hold/hold_own_history.test.ts::司書として他人の予約が見えている状況でも自分の履歴しか返らない` |
<!-- /AUTO-GENERATED:query-body -->
