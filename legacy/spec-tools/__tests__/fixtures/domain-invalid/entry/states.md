---
doc_type: state_spec
scope: common
id: entry-states
state_machine: entry
states:
  - id: draft
  - id: submitted
initial: nowhere
final: [submitted]
events:
  - id: submit
    from: [draft]
    to: submitted
    by: []
---

# initial が states に無く、by が空
