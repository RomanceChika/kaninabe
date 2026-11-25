---
doc_type: entity_spec
scope: common
id: store-entity
entity: store
label: 店舗
context:
  company: store.company_id         # 所属する会社(テナント)
  store: store.id                   # 自分自身(store_manager binding の解決用)
  staff_member: store.manager_id    # 店舗責任者(INV-STORE-002 が会社の一致を見る相手)
fields:
  - name: id
    type: uuid
    auto: true
    label: 店舗ID
    description: 店舗ID
    personal: false
  - name: company_id
    type: ref(company)
    required: true
    label: 所属会社
    description: この店舗を持つ会社
    personal: false
  - name: name
    type: string
    required: true
    max_length: 60
    label: 店舗名
    description: 店舗名(会社の中で重複しない — INV-STORE-001)
    personal: false
  - name: manager_id
    type: ref(staff_member)
    required: true
    label: 店舗責任者
    description: この店舗の売場・棚・在庫を預かる人
    personal: false
  - name: created_at
    type: datetime
    auto: true
    label: 登録日時
    description: 登録日時(システム採番)
    personal: false
---

# 店舗(store)

- 閉店の状態機械は持たない — 閉店の実例が無く、足すと到達しない終端状態が 1 つ増える。
- 住所・営業時間は列に持たない(この仕組みが扱うのは在庫と入金だけ)。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
