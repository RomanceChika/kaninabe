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
  # docs/specs/domain/claim/states.md
  - id: notify_approver_review_requested
    source: outbox
    kind: notification
    on_failure: retry_then_dead_letter
    summary: 指名された申請が提出されたことを承認者へ送る
  - id: notify_claim_owner_paid
    source: outbox
    kind: notification
    on_failure: retry_then_dead_letter
    summary: 申請の支払いが済んだことを申請者へ送る

test_cases:
  - id: TC-JOB-CATALOG-001
    type: unit
    covers: [success]
    spec_ids: [job-catalog]
    implementation: app/src/operation/__tests__/jobs/job-catalog.test.ts::カタログの outbox ジョブと登録済みハンドラが過不足なく一致する
---

# ジョブカタログ

- 通知はどれも状態の遷移の副作用(effects)から積まれる。時刻で起きる走査は持たない — 催促は一覧で状態を見に来る運用で足りる。

<!-- AUTO-GENERATED:job-body -->
<!-- /AUTO-GENERATED:job-body -->
