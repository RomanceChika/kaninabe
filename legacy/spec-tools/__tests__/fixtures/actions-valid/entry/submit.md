---
doc_type: action_spec
scope: backend
id: entry-submit-action

handles: entry.submit

input:
  - entry.id

errors:
  inherits: common
  additional: []

retired:
  - TC-ENTRY-SUBMIT-999

test_cases:
  - id: TC-ENTRY-SUBMIT-001
    type: unit
    covers: [success]
    spec_ids: [entry.submit]
    implementation: app/src/operation/__tests__/entry/submit.test.ts::下書きから提出できる
---

# エントリーの提出（フィクスチャ）

lib/model/trace/loader.ts のテスト用の正常な action_spec。
