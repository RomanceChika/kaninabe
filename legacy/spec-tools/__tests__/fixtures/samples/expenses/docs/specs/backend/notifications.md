---
doc_type: notification_spec
scope: backend
id: notification-catalog

vocabulary:
  medium:
    - id: email
      label: メール
  audience:
    - id: approver_inbox
      label: 承認者のメールボックス
      recipient: { kind: role, role: approver }
    - id: claim_owner_inbox
      label: 申請者のメールボックス
      recipient: { kind: role, role: claim_owner }
  mention:
    - id: none
      label: 付けない

notifications:
  # docs/specs/domain/claim/states.md
  - id: notify_approver_review_requested
    medium: email
    audience: approver_inbox
    mention: none
    trigger: auto
    summary: 指名された申請が提出されたことを承認者に知らせる
  - id: notify_claim_owner_paid
    medium: email
    audience: claim_owner_inbox
    mention: none
    trigger: auto
    summary: 申請の支払いが済んだことを申請者に知らせる

test_cases:
  - id: TC-NOTIFICATION-CATALOG-001
    type: unit
    covers: [success]
    spec_ids: [notification-catalog]
    implementation: app/src/operation/__tests__/jobs/notification-catalog.test.ts::カタログと登録済みハンドラが双方向に一致する
---

# 通知カタログ — この系が送る通知の全数

- 差戻しの通知は置かない — 申請者は一覧で状態を見に来るため、押し出しの通知は増やさない線引き。
- 経理への支払い依頼の通知も置かない(承認済みの列を経理が見る運用)。

<!-- AUTO-GENERATED:notification-body -->
<!-- /AUTO-GENERATED:notification-body -->
