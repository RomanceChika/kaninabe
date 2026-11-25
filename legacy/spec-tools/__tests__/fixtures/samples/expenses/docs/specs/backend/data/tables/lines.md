---
doc_type: data_table
scope: backend
id: table-lines

table: lines
entity: line

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110103_policies_lines.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120203_ddl_lines.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130103_api_view_lines.sql

indexes: []

foreign_keys:
  - column: claim_id
    references: claims
    on_delete: cascade            # 申請を消したら明細も消える

# 作成の冪等な再送で既存の行を返さない(作成者 = 作成の RPC が実行者で埋める列が無い)。同じ id があれば競合
resend:
  returns_existing: false

functions:
  - name: insert_line
    args: [uuid, uuid, text, date, text, integer, text, uuid, "text[]"]
    params: [p_id, p_claim_id, p_expected_claim_state, p_spent_on, p_category, p_amount, p_memo, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100005_rpc_insert_line.sql
    also_writes: {domain_events: [insert]}
  - name: update_line
    args: [uuid, text, jsonb, uuid, "text[]", "text[]"]
    params: [p_line_id, p_expected_claim_state, p_changes, p_actor_id, p_actor_roles, p_effects]
    kind: rpc
    shape: update
    migration: 20260912100006_rpc_update_line.sql
    also_writes: {domain_events: [insert], jobs: [insert]}
  - name: delete_line
    args: [uuid, text, uuid, "text[]"]
    params: [p_line_id, p_expected_claim_state, p_actor_id, p_actor_roles]
    kind: rpc
    shape: delete
    migration: 20260912100007_rpc_delete_line.sql
    also_writes: {domain_events: [insert]}

test_cases:
  - id: TC-TABLE-LINES-001
    type: integration
    covers: [success]
    spec_ids: [table-lines]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::lines の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-LINES-002
    type: integration
    covers: [success]
    spec_ids: [table-lines]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::lines の RPC が宣言どおりの本文である
  - id: TC-DDL-LINES-001
    type: integration
    covers: [success]
    spec_ids: [table-lines]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::lines の列と制約が宣言どおりである
---

# lines — 明細のテーブル実装

- 明細の書き込み RPC は親の状態(p_expected_claim_state)を条件に取る — 判断と書き込みの隙間で
  申請が提出されると、締めたはずの金額が動くためである。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
