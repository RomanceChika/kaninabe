---
doc_type: entity_spec
scope: common
id: user-entity
entity: user
label: 利用者
context:
  user: user.id                   # 自分自身（実行者の行の解決用）
fields:
  - name: id
    type: uuid
    auto: true
    label: 利用者ID
    description: 利用者ID
    personal: false
  - name: display_name
    type: string
    required: true
    max_length: 50
    label: 表示名
    description: 予約一覧に出る名前
    personal: true
    personal_placeholder: "(消去済み)"
    session: true                 # セッションに載せる列（V13: 1 集約のみ）
  - name: email
    type: string
    required: true
    max_length: 200
    label: メールアドレス
    description: 社内メールアドレス（本人確認と連絡の宛先）
    personal: true
    personal_placeholder: "deleted-{id}@example.invalid"
  - name: created_at
    type: datetime
    auto: true
    label: 登録日時
    description: 登録日時（システム採番）
    personal: false
---

# 利用者（user）

- 状態機械を持たない — 在籍・休職の管理は人事側の台帳の仕事であり、この仕組みでは扱わない。
- 部門への所属は列に持たない — 予約できる部屋は部門で絞らないため、所属は予約の可否に一切効かない。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
