---
doc_type: entity_spec
scope: common
id: entry-entity
entity: entry
fields:
  - name: id
    type: uuid
    auto: true
  - name: price
    type: money
  - type: string
  - name: state
    type: "state(entry)"
---

# 型の値域の外と name 欠落
