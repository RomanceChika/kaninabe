---
doc_type: entity_spec
scope: common
id: item-entity
entity: item
label: 蔵書
fields:
  - name: id
    type: uuid
    auto: true
    label: 蔵書ID
    personal: false
  - name: title
    type: string
    max_length: 120
    required: true
    label: 書名
    personal: false
  - name: author
    type: string
    max_length: 120
    required: true
    label: 著者
    personal: false
  - name: shelf_code
    type: string
    max_length: 20
    required: true
    label: 排架記号
    personal: false
  - name: media
    type: enum([book, dvd, magazine])
    required: true
    label: 資料種別
    labels:
      book: 図書
      dvd: 視聴覚資料
      magazine: 雑誌
    personal: false
  - name: state
    type: state(item)
    label: 蔵書状態
    personal: false
---

# 蔵書

- 所蔵冊数の欄は持たない — 1 行 = 1 冊(複本は別の行)であり、数は行の数が正である。
- 書誌(ISBN・出版社)はこの版では扱わない — 貸出の可否に関わらないため。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
