---
doc_type: query_spec
scope: backend
id: query-archive-list

name: archive_list
for: [curator]
source: document
scope_used: all
returns: many

filters:
  - state == archived             # 書庫の棚卸しは保管した文書だけを並べる

sort:
  - disposable_after asc
  - id asc

paging: limit(50)

projection:
  - id
  - department_id
  - title
  - disposable_after
  - archived_at
  - archived_by
  - state

test_cases:
  - id: TC-DOCUMENT-ARCHIVE_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-archive-list]
    implementation: app/src/composition/__tests__/document/archive_list.test.ts::文書管理者は自部署の保管文書を保存年限の近い順に読める
---

# 書庫の一覧（archive_list）

- 保存年限の切れたものだけに絞らない — 棚卸しは「あとどれだけ残っているか」を見る作業であり、切れた行だけでは判断できない。

<!-- residue: 並びの軸に `archived_at` を採らず `disposable_after` を採ったのは、
     **`archived_at` が空になりうる欄だから**である。空の行が混ざる並びは
     「どこに置くか」を宣言で言えない(`nulls first / last` の語彙が無い)。
     ここでは filters が `state == archived` に絞っているので実際には空の行は来ないが、
     **その事実は宣言のどこにも書かれていない**(INV-DOCUMENT-002 が DSL 外だから)。
     残差の型は (a) 同期義務 —— 並びの安全が不変条件の DSL 外の側に依存している。 -->

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
