---
doc_type: data_table
scope: backend
id: table-claims

table: claims
entity: claim

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110101_policies_claims.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120202_ddl_claims.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130101_api_view_claims.sql

indexes:
  # claim_list(スコープ条件 employee_id で絞り、created_at desc で並べる)用
  - name: claims_employee_id_created_at_idx
    on: [employee_id, created_at]
  # claim_approval_list(スコープ条件 approver_id + filters state / sort created_at)用
  - name: claims_approver_id_state_created_at_idx
    on: [approver_id, state, created_at]

foreign_keys:
  - column: employee_id
    references: employees
    on_delete: no_action          # 申請が残っている従業員の行は消せない
  - column: approver_id
    references: employees
    on_delete: no_action          # 承認の履歴を守る

# 作成の冪等な再送で既存の行を返すのは、作成者(employee_id)が実行者の行だけ
resend:
  returns_existing: true
  creator: employee_id

functions:
  - name: insert_claim
    args: [uuid, uuid, uuid, text, text, uuid, "text[]"]
    params: [p_id, p_employee_id, p_approver_id, p_title, p_purpose, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100001_rpc_insert_claim.sql
    also_writes: {domain_events: [insert]}
  - name: apply_claim_transition
    args: [uuid, text, text, "text[]", text, uuid, "text[]", integer]
    params: [p_claim_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles, p_total_amount]
    kind: rpc
    shape: transition
    migration: 20260912100002_rpc_apply_claim_transition.sql
    also_writes: {jobs: [insert], domain_events: [insert]}
  - name: update_claim
    args: [uuid, text, jsonb, uuid, "text[]", "text[]"]
    params: [p_claim_id, p_expected_state, p_changes, p_actor_id, p_actor_roles, p_effects]
    kind: rpc
    shape: update
    migration: 20260912100003_rpc_update_claim.sql
    also_writes: {domain_events: [insert], jobs: [insert]}
  - name: delete_claim
    args: [uuid, text, uuid, "text[]"]
    params: [p_claim_id, p_expected_state, p_actor_id, p_actor_roles]
    kind: rpc
    shape: delete
    migration: 20260912100004_rpc_delete_claim.sql
    # 申請を消すと明細が外部キーの連鎖(on delete cascade)で消える(T21)。
    also_writes: {domain_events: [insert], lines: [delete]}

checks:
  - name: claims_approver_not_self_check
    invariant: INV-CLAIM-002

test_cases:
  - id: TC-TABLE-CLAIMS-001
    type: integration
    covers: [success]
    spec_ids: [table-claims]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::claims の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-CLAIMS-002
    type: integration
    covers: [success]
    spec_ids: [table-claims]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::claims の RPC が宣言どおりの本文である
  - id: TC-DDL-CLAIMS-001
    type: integration
    covers: [success]
    spec_ids: [table-claims]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::claims の列と制約が宣言どおりである
---

# claims — 経費申請のテーブル実装

- approver_id の on delete を cascade にしない — 承認者が抜けても申請の履歴は残す。
- 合計額の列に既定値を置かない — 値の正は提出の遷移(computes)であり、DB に二つ目の正を作らない。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
