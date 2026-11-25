---
doc_type: directory_guide
scope: backend
unhandled:
  - event: entry.withdraw
    reason: 取下げの画面が未着手のため
scans:
  - event: entry.close
    implementation: app/src/operation/entry/close.ts
    test_cases:
      - id: TC-ENTRY-CLOSE-001
        type: unit
        covers: [success]
        spec_ids: [entry.close]
        implementation: app/src/operation/__tests__/entry/close.test.ts::締切で自動的に閉じる
unscanned:
  - event: entry.expire
    reason: 期限切れの走査は未実装のため
test_tag_baseline:
  - file: app/src/domain/__tests__/engine/machine.test.ts
---

# actions-valid フィクスチャ

lib/model/trace/loader.ts のテスト用。正常な action_spec と、網羅の宣言 4 種(A4 の `unhandled`、
A10 の `scans` / `unscanned`、A12 の `test_tag_baseline`)を 1 つずつ持つ。
