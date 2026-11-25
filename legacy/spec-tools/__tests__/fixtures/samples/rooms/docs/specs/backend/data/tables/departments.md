---
doc_type: data_table
scope: backend
id: table-departments

table: departments

entity: department

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110102_policies_departments.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120202_ddl_departments.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130102_api_view_departments.sql

indexes:
  - name: departments_name_unique
    on: [name]
    unique: true
    invariant: INV-DEPARTMENT-001
  - name: departments_admin_id_idx
    on: [admin_id]

foreign_keys:
  - column: admin_id
    references: users
    on_delete: no_action           # 管理者の行は、部門が指している間は消せない

functions:
  - name: update_department
    args: [uuid, jsonb, uuid, "text[]", "text[]"]
    params: [p_department_id, p_changes, p_actor_id, p_actor_roles, p_effects]
    kind: rpc
    shape: update
    migration: 20260912100005_rpc_update_department.sql
    also_writes: {domain_events: [insert], jobs: [insert]}

test_cases:
  - id: TC-TABLE-DEPARTMENTS-001
    type: integration
    covers: [success]
    spec_ids: [table-departments]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::departments の宣言どおりの実体だけが DB にある
  - id: TC-DDL-DEPARTMENTS-001
    type: integration
    covers: [success]
    spec_ids: [table-departments]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::departments の列と制約が宣言どおりである
  - id: TC-TABLE-DEPARTMENTS-002
    type: integration
    covers: [success]
    spec_ids: [table-departments]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::departments の RPC が宣言どおりの本文である
---

# departments — 部門のテーブル実装

- 作成・削除の RPC を持たない — 部門の増減は人事側の台帳の反映であり、この仕組みの操作ではない。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
