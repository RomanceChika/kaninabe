---
doc_type: entity_spec
scope: common
id: feedback-entity
entity: feedback
label: 会議室への匿名の意見
fields:
  - name: id
    type: uuid
    auto: true
    label: 意見ID
    description: 意見ID
    personal: false
  - name: message
    type: string
    required: true
    max_length: 500
    label: 意見
    description: 匿名で寄せられた意見の本文
    personal: false
  - name: created_at
    type: datetime
    auto: true
    label: 受付日時
    description: 受付日時（システム採番。未ログインの作成の天井が数える時刻の欄）
    personal: false
---

# 会議室への匿名の意見（feedback）

- **【検査の足場】** 未ログインが書ける作成・削除の正例（R5）を持つための小さな集約である。他の集約に参照されず、
  どの集約の世界にも入らない（部屋・予約の挙動テストと一致の証明を、天井のトリガの影響から切り離すため）。
- 意見の本文は個人を特定しない前提の自由記述で、読むのはシステムだけ（画面は無い）。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
