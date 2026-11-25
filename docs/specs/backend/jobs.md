---
doc_type: job_spec
scope: backend
id: job-catalog

vocabulary:
  kind:
    - id: notification
      label: 通知の送信
  on_failure:
    - id: retry_then_dead_letter
      label: 既定のリトライ(指数バックオフ・max_attempts 回で dead letter)
      means: retry_to_dead

jobs:
  # --- source: outbox（発火はドメインイベントの effects。発火元は effects が正なので書かない） ---
  # docs/specs/domain/loan/states.md
  - id: notify_overdue_patron
    source: outbox
    kind: notification
    on_failure: retry_then_dead_letter
    summary: 返却期限を過ぎたことを借受本人へ送る

test_cases:
  - id: TC-JOB-CATALOG-001
    type: unit
    covers: [success]
    spec_ids: [job-catalog]
    implementation: app/src/operation/__tests__/jobs/job-catalog.test.ts::カタログの outbox ジョブと登録済みハンドラが過不足なく一致する
---

# ジョブカタログ

- 延滞の走査(毎日決まった時刻に期限切れを拾う)は載せない — by に system を持つ遷移をこの版で宣言しておらず、起こす主体が無い。

<!-- AUTO-GENERATED:job-body -->
### 語彙(このカタログが宣言する値域)

| 軸 | 語 | 表示名 | 同一トランザクションで実現 | 行が必ず持つキー | 失敗の意味(means) |
| --- | --- | --- | --- | --- | --- |
| 種別(kind) | `notification` | 通知の送信 | — | — | — |
| 失敗時(on_failure) | `retry_then_dead_letter` | 既定のリトライ(指数バックオフ・max_attempts 回で dead letter) | — | — | `retry_to_dead` |

### イベントで積まれるジョブ(outbox。effects と双方向に閉じている)

| ジョブ ID | 種別 | 積む元(イベント / 走査) | 失敗時 | 何をするか |
| --- | --- | --- | --- | --- |
| `notify_overdue_patron` | notification | `loan.report_overdue` | retry_then_dead_letter | 返却期限を過ぎたことを借受本人へ送る |

### 時刻で起きるジョブ(schedule)

まだ宣言がありません。

### テストケース

| ID | type | covers | spec_ids | implementation |
| --- | --- | --- | --- | --- |
| TC-JOB-CATALOG-001 | unit | success | job-catalog | `app/src/operation/__tests__/jobs/job-catalog.test.ts::カタログの outbox ジョブと登録済みハンドラが過不足なく一致する` |
<!-- /AUTO-GENERATED:job-body -->
