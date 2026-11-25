---
doc_type: role_spec
scope: common
id: domain-roles
roles:
  # --- グローバルロール ---
  - id: anonymous           # 未ログイン(社外。この系に公開の面は無い)
    label: 未ログイン
    kind: anonymous
  - id: staff               # 社員。根拠は職員の行があること
    label: 社員
    kind: authenticated_default
  - id: curator             # 文書管理者。根拠は実行者自身の行の欄(セッションに載る)
    label: 文書管理者
    claim: staff.is_curator
    implies: [staff]
  - id: system              # 定期実行からの内部実行
    label: システム
    kind: system
  # --- 文脈依存ロール ---
  - id: document_author     # 対象の文書を起案した本人
    label: 起案者
    binding: document.author_id == actor.id
    implies: [staff]
---

# ロール定義

- 部署長のロールは作らない — 保管と廃棄を預かるのは文書管理者であり、決裁の線とは別である(決裁はこの系の外)。
- 監査法人のような社外の読み手のロールは持たない — 社外に開く面をこの版で扱わない。

<!-- AUTO-GENERATED:role-table -->
<!-- /AUTO-GENERATED:role-table -->
