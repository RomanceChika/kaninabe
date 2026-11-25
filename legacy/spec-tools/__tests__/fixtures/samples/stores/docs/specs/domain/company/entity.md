---
doc_type: entity_spec
scope: common
id: company-entity
entity: company
label: 会社
context:
  company: company.id               # 自分自身(テナントの起点)
fields:
  - name: id
    type: uuid
    auto: true
    label: 会社ID
    description: 会社ID
    personal: false
  - name: name
    type: string
    required: true
    max_length: 80
    label: 会社名
    description: 会社名(重複しない — INV-COMPANY-001)
    personal: false
  - name: created_at
    type: datetime
    auto: true
    label: 登録日時
    description: 登録日時(システム採番)
    personal: false
---

# 会社(company)

- 会社の階層(親会社・グループ)は持たない — 束縛が 1 段増えるだけで、可視性の判断は変わらない。
- 会社の作成・改名の操作は持たない(creates / writes を宣言しない) — 契約の締結は仕組みの外にある。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
