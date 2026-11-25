---
doc_type: notification_spec
scope: backend
id: notification-catalog

vocabulary:                          # 語彙はこのアプリの事情。体系(パーサ・検査器)は軸だけを持つ
  medium:
    - id: mail
      label: メール
  audience:
    - id: loan_patron
      label: 借受本人
      recipient: { kind: role, role: loan_owner }
  mention:
    - id: none
      label: 付けない

notifications:
  # docs/specs/domain/loan/states.md
  - id: notify_overdue_patron
    medium: mail
    audience: loan_patron
    mention: none
    trigger: auto
    summary: 返却期限を過ぎたことを借受本人に知らせる

test_cases:
  - id: TC-NOTIFICATION-CATALOG-001
    type: unit
    covers: [success]
    spec_ids: [notification-catalog]
    implementation: app/src/operation/__tests__/jobs/notification-catalog.test.ts::カタログの通知と登録済みハンドラが過不足なく一致する
---

# 通知カタログ

- 督促のはがき(郵送)は載せない — 館の窓口の運用であり、システムが送る通知ではない。

<!-- AUTO-GENERATED:notification-body -->
<!-- /AUTO-GENERATED:notification-body -->
