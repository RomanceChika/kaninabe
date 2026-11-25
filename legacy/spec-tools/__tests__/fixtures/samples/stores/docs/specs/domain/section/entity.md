---
doc_type: entity_spec
scope: common
id: section-entity
entity: section
label: 売場
context:
  company: section.company_id       # 所属する会社(テナント)
  store: section.store_id           # 売場が属する店舗(store_manager binding の解決用)
  section: section.id               # 自分自身
fields:
  - name: id
    type: uuid
    auto: true
    label: 売場ID
    description: 売場ID
    personal: false
  - name: company_id
    type: ref(company)
    required: true
    label: 所属会社
    description: 会社(store.company_id の写し — INV-SECTION-002)
    personal: false
    supplied_by: db                  # トリガが祖先から写す(V17 / T9)
  - name: store_id
    type: ref(store)
    required: true
    label: 所属店舗
    description: この売場を持つ店舗
    personal: false
  - name: name
    type: string
    required: true
    max_length: 40
    label: 売場名
    description: 売場名(店舗の中で重複しない — INV-SECTION-001)
    personal: false
---

# 売場(section)

- 売場の下に「小分類」をもう 1 段足さない — 棚までの 3 段で在庫の置き場は一意に決まる。
- 売場の状態機械は持たない(改装中の扱いは棚の `is_active` で足りる)。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
