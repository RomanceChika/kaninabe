---
doc_type: action_spec
scope: backend
id: workshop-approve-action

# A1: state_spec に workshop.approve というイベントは無い
handles: workshop.approve

input: []

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-WORKSHOP-APPROVE-001
    type: unit
    covers: [success]
    spec_ids: [workshop.approve]
    implementation: app/src/operation/__tests__/entry/submit.test.ts::下書きから提出できる
---

# わざと壊した action_spec（A1）

存在しないドメインイベントを handles する仕様。
