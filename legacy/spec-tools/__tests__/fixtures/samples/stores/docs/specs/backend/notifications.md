---
doc_type: notification_spec
scope: backend
id: notification-catalog
norms: []

vocabulary:                          # 語彙はこのアプリの事情。体系(パーサ・検査器)は軸だけを持つ
  medium:
    - id: email
      label: メール
  audience:
    - id: store_manager_mail
      label: 受注店舗の責任者へのメール
      recipient: { kind: role, role: store_manager }
  mention:
    - id: none
      label: 付けない

notifications:
  # docs/specs/domain/sales_order/states.md
  - id: notify_payment_received
    medium: email
    audience: store_manager_mail
    mention: none
    trigger: auto
    summary: 注文に入金が反映されたことを受注店舗の責任者へ知らせる

test_cases:
  - id: TC-NOTIFICATION-CATALOG-001
    type: unit
    covers: [success]
    spec_ids: [notification-catalog]
    implementation: app/src/operation/jobs/__tests__/handlers.test.ts::通知ハンドラの一覧はカタログと双方向に一致する
---

# 通知カタログ(複数店舗の在庫と入金)

- 入金の失敗(署名が検証できない通知)は誰にも送らない — 攻撃の痕跡であり、業務の知らせではない。
- 在庫の減りの知らせは持たない — 閾値を決める実例が無く、決めた瞬間に交渉できる値になる。

<!-- AUTO-GENERATED:notification-table -->
<!-- /AUTO-GENERATED:notification-table -->
