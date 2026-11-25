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
  # --- source: outbox(発火はドメインイベントの effects。発火元は effects が正なので書かない) ---
  # docs/specs/domain/document/states.md
  - id: notify_author_archived
    source: outbox
    kind: notification
    on_failure: retry_then_dead_letter
    summary: 起案した文書が書庫へ入ったことを起案者へ送る

test_cases:
  - id: TC-JOB-CATALOG-001
    type: unit
    covers: [success]
    spec_ids: [job-catalog]
    implementation: app/src/operation/__tests__/jobs/job-catalog.test.ts::カタログの outbox ジョブと登録済みハンドラが過不足なく一致する
---

# ジョブカタログ

- 保存年限の切れた文書を自動で廃棄する走査は載せない — 行が消える経路を時刻に持たせない(消す判断は人が実行する)。

<!-- AUTO-GENERATED:job-body -->
<!-- /AUTO-GENERATED:job-body -->
