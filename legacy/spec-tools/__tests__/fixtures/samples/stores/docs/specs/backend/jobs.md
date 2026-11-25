---
doc_type: job_spec
scope: backend
id: job-catalog
norms: []

vocabulary:                          # 語彙はこのアプリの事情。体系(パーサ・検査器)は軸だけを持つ
  kind:
    - id: notification
      label: 通知の送信
    - id: scan
      label: 時刻で実行できるものを実行する走査
  on_failure:
    - id: retry_then_dead_letter
      label: 既定のリトライ(指数バックオフ・max_attempts 回で dead letter)
      means: retry_to_dead
    - id: skip_and_next_run
      label: その 1 件を飛ばして続行(次の起動が拾い直す)
      means: next_run

jobs:
  # --- source: outbox(発火はドメインイベントの effects。発火元は effects が正なので書かない) ---
  # docs/specs/domain/sales_order/states.md
  - id: notify_payment_received
    source: outbox
    kind: notification
    on_failure: retry_then_dead_letter
    summary: 入金が反映された注文の知らせを受注店舗の責任者へ送る
  # --- source: schedule(発火は時刻。Cron の登録と双方向に閉じる) ---
  - id: stocktake_reminder_scan
    source: schedule
    kind: scan
    schedule: "0 21 * * *"
    endpoint: /api/stocktake/remind
    implementation: app/src/operation/jobs/stocktake-reminder.ts
    scheduler: host
    on_failure: skip_and_next_run
    summary: 前回の棚卸から 30 日を過ぎた棚を持つ店舗の責任者へ、棚卸の予定を組むよう促す

test_cases:
  - id: TC-JOB-CATALOG-001
    type: unit
    covers: [success]
    spec_ids: [job-catalog]
    implementation: app/src/operation/jobs/__tests__/handlers.test.ts::ジョブハンドラの一覧はカタログと双方向に一致する
  - id: TC-JOB-STOCKTAKE_REMINDER_SCAN-001
    type: integration
    covers: [success]
    spec_ids: [stocktake_reminder_scan]
    implementation: app/src/composition/__tests__/jobs/stocktake_reminder_scan.test.ts::30 日を過ぎた棚を持つ店舗だけが拾われる
---

# ジョブカタログ(複数店舗の在庫と入金)

- 受信した入金通知の取りこぼしを拾い直す走査は持たない — 決済サービス側が再送し、外部イベントIDの一意制約が二重反映を止める。
- 棚卸リマインドは「催促」だけで、棚卸そのものの状態は動かさない — 数え直しは人の作業であり、時刻で起きてよいのは声かけまでである。

<!-- AUTO-GENERATED:job-table -->
<!-- /AUTO-GENERATED:job-table -->
