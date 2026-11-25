---
doc_type: data_table
scope: backend
id: table-sections

table: sections
entity: section

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110105_policies_sections.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120204_ddl_sections.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130105_api_view_sections.sql

indexes:
  - name: sections_company_id_idx
    on: [company_id]
  - name: sections_store_name_unique
    on: [store_id, name]
    unique: true
    invariant: INV-SECTION-001

foreign_keys:
  - column: company_id
    references: companies
    on_delete: restrict
  - column: store_id
    references: stores
    on_delete: restrict

triggers:
  - name: sync_section_company
    function: sync_section_company
    # 写す列も fires に並べる(直に書き換えられても写し直す。不変条件の書き込みの端の覆い。点検 26 回目 A26-1)
    fires: before insert or update of store_id, company_id
    supplies: [company_id]
    invariant: INV-SECTION-002
  # 作成の後に変えない列を DB が凍らせる(本文は生成物: after update の行トリガで OLD と NEW を比べ、違えば断る。点検 fix26 2 回目)。
  # 「変える口が無い」を本文・権限・連鎖の読みで証明する代わりに、どの経路の更新も DB が断る
  - name: freeze_sections
    function: freeze_sections
    fires: after update
    freezes: [company_id, store_id]

# 作成の冪等な再送で既存の行を返さない(作成者 = 作成の RPC が実行者で埋める列が無い)。同じ id があれば競合
resend:
  returns_existing: false

functions:
  - name: insert_section
    args: [uuid, uuid, jsonb, uuid, "text[]"]
    params: [p_id, p_store_id, p_values, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100006_rpc_insert_section.sql
    also_writes: {domain_events: [insert]}
  - name: delete_section
    args: [uuid, uuid, "text[]"]
    params: [p_section_id, p_actor_id, p_actor_roles]
    kind: rpc
    shape: delete
    migration: 20260912100007_rpc_delete_section.sql
    also_writes: {domain_events: [insert]}
  - name: sync_section_company
    args: []
    kind: trigger
  - name: freeze_sections
    args: []
    kind: trigger


test_cases:
  - id: TC-TABLE-SECTIONS-001
    type: integration
    covers: [success]
    spec_ids: [table-sections]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::sections の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-SECTIONS-002
    type: integration
    covers: [forbidden]
    spec_ids: [section-access]
    implementation: "app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts::sections は実行者の company_id 以外の行を返さない"
  - id: TC-DDL-SECTIONS-001
    type: integration
    covers: [success]
    spec_ids: [table-sections]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::sections の列と制約が宣言どおりである
  - id: TC-TABLE-SECTIONS-003
    type: integration
    covers: [success]
    spec_ids: [table-sections, INV-SHELF-002]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::sections の RPC が宣言どおりの本文である
---

# sections — 売場のテーブル実装

- `store_id` の on delete を cascade にしない — 店舗の消去は宣言されていない操作であり、連鎖の口を開けると台帳が黙って消える。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
