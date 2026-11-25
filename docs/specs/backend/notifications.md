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
### 語彙(このカタログが宣言する値域)

| 軸 | 語 | 表示名 |
| --- | --- | --- |
| 送信経路(medium) | `mail` | メール |
| 宛先(audience) | `loan_patron` | 借受本人 |
| メンション(mention) | `none` | 付けない |

### 通知の全数(effects と双方向に閉じている)

| 通知 ID | 発火 | 発火元(イベント / 走査) | 宛先 | メンション | 経路 | 何を知らせるか |
| --- | --- | --- | --- | --- | --- | --- |
| `notify_overdue_patron` | auto | `loan.report_overdue` | loan_patron | none | mail | 返却期限を過ぎたことを借受本人に知らせる |

### テストケース

| ID | type | covers | spec_ids | implementation |
| --- | --- | --- | --- | --- |
| TC-NOTIFICATION-CATALOG-001 | unit | success | notification-catalog | `app/src/operation/__tests__/jobs/notification-catalog.test.ts::カタログの通知と登録済みハンドラが過不足なく一致する` |
<!-- /AUTO-GENERATED:notification-body -->
