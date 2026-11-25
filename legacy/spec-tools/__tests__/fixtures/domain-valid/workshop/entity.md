---
doc_type: entity_spec
scope: common
id: workshop-entity
entity: workshop
label: 催し
fields:
  - name: id
    type: uuid
    auto: true
    personal: false
  - name: entry_deadline
    type: datetime
    description: エントリー締切
    required: true
    personal: false
  - name: starts_at
    type: datetime
    description: 開演日時
    required: true
    personal: false
  - name: capacity
    type: integer
    min: 1
    required: true
    personal: false
  - name: visibility
    type: "enum([private, unlisted, public])"
    required: true
    personal: false
  - name: state
    type: "state(workshop)"
    personal: false
  - name: publish_state
    type: "state(workshop_publish)"
    personal: false
---

# 催し
