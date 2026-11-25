---
doc_type: action_spec
scope: backend
id: entry-submit-action

# A5: send.md と同じイベントを handles している（id も重複）
handles: entry.submit

input: []

errors:
  inherits: common
  additional: []

test_cases:
  - id: TC-ENTRY-SUBMIT-002
    type: unit
    covers: [success, invalid_from, conflict]
    spec_ids: [entry.submit]
    implementation: app/src/operation/__tests__/entry/submit.test.ts::下書きから提出できる
---

# わざと壊した action_spec（A5）

同一イベントを handles する 2 つ目の仕様。
