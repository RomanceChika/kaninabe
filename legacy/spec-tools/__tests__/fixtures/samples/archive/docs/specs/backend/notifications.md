---
doc_type: notification_spec
scope: backend
id: notification-catalog

vocabulary:                          # 語彙はこのアプリの事情。体系(パーサ・検査器)は軸だけを持つ
  medium:
    - id: email
      label: 社内メール
  audience:
    - id: document_author
      label: 起案者
      recipient: { kind: role, role: document_author }
  mention:
    - id: none
      label: 付けない

notifications:
  # docs/specs/domain/document/states.md
  - id: notify_author_archived
    medium: email
    audience: document_author
    mention: none
    trigger: auto
    summary: 起案した文書が書庫へ入ったことを起案者に知らせる

test_cases:
  - id: TC-NOTIFICATION-CATALOG-001
    type: unit
    covers: [success]
    spec_ids: [notification-catalog]
    implementation: app/src/operation/__tests__/jobs/notification-catalog.test.ts::カタログの通知と登録済みハンドラが過不足なく一致する
---

# 通知カタログ

- 廃棄(物理削除)の通知は載せない — 消えた文書の標題をメールに残すと、目録から消したものが受信箱に残り続ける。

<!-- AUTO-GENERATED:notification-body -->
<!-- /AUTO-GENERATED:notification-body -->
