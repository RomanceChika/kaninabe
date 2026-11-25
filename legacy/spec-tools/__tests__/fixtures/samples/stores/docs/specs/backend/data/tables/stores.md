---
doc_type: data_table
scope: backend
id: table-stores

table: stores
entity: store

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110111_policies_stores.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120203_ddl_stores.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130111_api_view_stores.sql

indexes:
  - name: stores_company_id_idx
    on: [company_id]
  - name: stores_name_idx
    on: [name]
  - name: stores_manager_id_idx
    on: [manager_id]
  - name: stores_company_name_unique
    on: [company_id, name]
    unique: true
    invariant: INV-STORE-001

foreign_keys:
  - column: company_id
    references: companies
    on_delete: restrict
  - column: manager_id
    references: staff_members
    on_delete: restrict           # 責任者の行が消えると店舗の束縛が解けるため止める

# INV-STORE-002(責任者は店舗の会社の従業員)は**別の集約の列との等式**で、両端のどちらからも破れる ——
# 店舗の側(責任者の付け替え・店舗の会社の変更。この表)と、責任者の側(従業員が別の会社へ移る。staff_members の表の
# check_store_manager_company_on_staff_member)。どちらもコミット時評価の制約トリガで、本文は不変条件の formal から生成される。
triggers:
  - name: check_store_manager_company
    function: check_store_manager_company
    fires: after insert or update of company_id, manager_id (constraint trigger, deferrable initially deferred)
    deferred: true
    invariant: INV-STORE-002
  # 作成の後に変えない列を DB が凍らせる(本文は生成物: after update の行トリガで OLD と NEW を比べ、違えば断る。点検 fix26 2 回目)。
  # 「変える口が無い」を本文・権限・連鎖の読みで証明する代わりに、どの経路の更新も DB が断る
  - name: freeze_stores
    function: freeze_stores
    fires: after update
    freezes: [company_id]

# 作成の冪等な再送で既存の行を返さない(作成者 = 作成の RPC が実行者で埋める列が無い)。同じ id があれば競合
resend:
  returns_existing: false

functions:
  - name: insert_store
    args: [uuid, jsonb, uuid, "text[]"]
    params: [p_id, p_values, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100013_rpc_insert_store.sql
    also_writes: {domain_events: [insert]}
  - name: update_store
    args: [uuid, jsonb, uuid, "text[]", "text[]"]
    params: [p_store_id, p_changes, p_actor_id, p_actor_roles, p_effects]
    kind: rpc
    shape: update
    migration: 20260912100014_rpc_update_store.sql
    also_writes: {domain_events: [insert], jobs: [insert]}
  - name: check_store_manager_company
    args: []
    kind: trigger
  - name: freeze_stores
    args: []
    kind: trigger


test_cases:
  - id: TC-TABLE-STORES-001
    type: integration
    covers: [success]
    spec_ids: [table-stores]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::stores の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-STORES-002
    type: integration
    covers: [forbidden]
    spec_ids: [store-access]
    implementation: "app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts::stores は実行者の company_id 以外の行を返さない"
  - id: TC-DDL-STORES-001
    type: integration
    covers: [success]
    spec_ids: [table-stores]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::stores の列と制約が宣言どおりである
  - id: TC-TABLE-STORES-003
    type: integration
    covers: [success]
    spec_ids: [table-stores, INV-SALES-ORDER-003, INV-SECTION-002]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::stores の RPC が宣言どおりの本文である
---

# stores — 店舗のテーブル実装

- 削除 RPC は持たない(access_spec に deletes が無い) — 売場・棚・台帳がぶら下がっている。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
