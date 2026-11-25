---
doc_type: state_spec
scope: common
id: submit-action
handles: submit
input: entry.id
errors:
  inherits: none
test_cases:
  - id: TC-1
    type: e2e
    spec_ids: []
    implementation: app/src/operation/submit.ts
---

# スキーマが壊れた action_spec（A0）

doc_type / scope / id / handles / input / errors / test_cases のすべてが規約から外れている。
