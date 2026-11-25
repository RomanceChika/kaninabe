---
doc_type: entity_spec
scope: common
id: shelf-entity
entity: shelf
label: 棚
table: shelves                      # 既定の複数形化(shelfs)では読めない名前なので上書きする
context:
  company: shelf.company_id         # 所属する会社(テナント)
  section: shelf.section_id         # 棚が属する売場(店舗はここから 2 段目で辿る)
  shelf: shelf.id                   # 自分自身
fields:
  - name: id
    type: uuid
    auto: true
    label: 棚ID
    description: 棚ID
    personal: false
  - name: company_id
    type: ref(company)
    required: true
    label: 所属会社
    description: 会社(section.company_id の写し — INV-SHELF-002)
    personal: false
    supplied_by: db                  # トリガが祖先から写す(V17 / T9)
  - name: section_id
    type: ref(section)
    required: true
    label: 所属売場
    description: この棚を持つ売場
    personal: false
  - name: code
    type: string
    required: true
    max_length: 12
    label: 棚番
    description: 棚番(売場の中で重複しない — INV-SHELF-001)
    personal: false
  - name: is_active
    type: boolean
    required: true
    label: 使用中かどうか
    description: 改装などで一時的に使えない棚は false(移動を受け付けない)
    personal: false
---

# 棚(shelf)

- 棚の状態機械は持たない — 使える / 使えないの 2 値しかなく、履歴を残す必要が無い。
- **店舗の列は持たない**(束 ⑲-2a) — `context` の連鎖が 2 段まで辿れるので、棚から店舗へは売場を経由して届く。`company_id` だけは残る:あちらは可視性の境界(`reads[].filters`)であり、束縛の解決のための畳み込みとは役割が違う。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
