---
doc_type: entity_spec
scope: common
id: entry-entity
entity: entry
label: エントリー
context:
  workshop: entry.workshop_id
fields:
  - name: id
    type: uuid
    auto: true
    personal: false
  - name: workshop_id
    type: "ref(workshop)"
    required: true
    personal: false
  - name: performer_id
    type: "ref(member)"
    required: true
    personal: false
  - name: title
    type: string
    description: 演目名
    max_length: 50
    required: true
    personal: false
  - name: duration_min
    type: integer
    description: 発表時間（分）
    min: 1
    max: 30
    required: true
    personal: false
  - name: note
    type: string
    max_length: 500
    personal: false
  - name: state
    type: "state(entry)"
    personal: false
---

# エントリー
