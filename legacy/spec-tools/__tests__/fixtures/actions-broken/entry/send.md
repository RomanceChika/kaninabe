---
doc_type: action_spec
scope: backend
id: entry-submit-action

# A2: ファイルは entry/send.md にあるのに entry.submit を handles している
handles: entry.submit

input:
  # A3: entity_spec に無いフィールド
  - entry.subject

errors:
  inherits: common
  additional: []

test_cases:
  # A6: このパスのテストファイルは存在しない
  - id: TC-ENTRY-SUBMIT-001
    type: unit
    # A7: entry.submit が要求する invalid_from / conflict を宣言していない
    covers: [success]
    spec_ids: [entry.submit]
    implementation: app/src/operation/__tests__/entry/nowhere.test.ts::存在しないテスト
---

# わざと壊した action_spec（A2 / A3 / A6 / A7）

lib/trace の検証器が実データではなくファイル経由でも違反を検出できることを確かめるためのフィクスチャ。
