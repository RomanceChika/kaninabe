---
doc_type: data_table
scope: backend
id: table-feedbacks

table: feedbacks

entity: feedback

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110105_policies_feedbacks.sql

# 表の DDL は entity_spec と この宣言から生成する
ddl_migration: 20260912120207_ddl_feedbacks.sql

# 外から届く `surface` のビュー
surface_migration: 20260912130105_api_view_feedbacks.sql

indexes:
  # 未ログインの作成の全体の天井(creates[].abuse)が数える時刻の欄。導出: 生成される天井のトリガ(T2 が見る)
  - name: feedbacks_created_at_idx
    on: [created_at]

# 作成の冪等な再送で既存の行を返さない。同じ id があれば競合
resend:
  returns_existing: false

functions:
  - name: insert_feedback
    args: [uuid, jsonb, uuid, "text[]"]
    params: [p_id, p_values, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100009_rpc_insert_feedback.sql
    also_writes: {domain_events: [insert]}
  - name: delete_feedback
    args: [uuid, uuid, "text[]"]
    params: [p_feedback_id, p_actor_id, p_actor_roles]
    kind: rpc
    shape: delete
    migration: 20260912100010_rpc_delete_feedback.sql
    also_writes: {domain_events: [insert]}

# 天井のトリガの鍵の受け入れ(構造の突合 trigger-advisory-parity)は、access_spec の creates[].abuse と天井を名指す不変条件から
# 生成器が導く(手で書かない。点検 26 回目の後の判断待ち 1。手で書くと R5-4 が止める)

test_cases:
  - id: TC-TABLE-FEEDBACKS-001
    type: integration
    covers: [success]
    spec_ids: [table-feedbacks]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::feedbacks の宣言どおりの実体だけが DB にある
  - id: TC-DDL-FEEDBACKS-001
    type: integration
    covers: [success]
    spec_ids: [table-feedbacks]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::feedbacks の列と制約が宣言どおりである
  - id: TC-TABLE-FEEDBACKS-002
    type: integration
    covers: [success]
    spec_ids: [table-feedbacks]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::feedbacks の RPC が宣言どおりの本文である
  - id: TC-TABLE-FEEDBACKS-003
    type: integration
    covers: [invariant]
    spec_ids: [table-feedbacks, INV-FEEDBACK-001]
    implementation: "app/src/infrastructure/__tests__/schema/trigger-advisory-parity.test.ts::受け入れた鍵を持った取引は、api の関数のどの閉包でも、鍵の後に新しい行も別の鍵も掴まない(点検 D25s4-1)"
---

# feedbacks — 匿名の意見のテーブル実装

- 検査の足場の表。未ログインの作成の天井のトリガ（`check_feedback_rate_limit`）は abuse から生成される。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
