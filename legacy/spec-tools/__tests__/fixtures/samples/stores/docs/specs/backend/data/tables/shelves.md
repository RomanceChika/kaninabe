---
doc_type: data_table
scope: backend
id: table-shelves

table: shelves
entity: shelf

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110106_policies_shelves.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120205_ddl_shelves.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130106_api_view_shelves.sql

indexes:
  - name: shelves_company_id_idx
    on: [company_id]
  - name: shelves_section_code_unique
    on: [section_id, code]
    unique: true
    invariant: INV-SHELF-001

foreign_keys:
  - column: company_id
    references: companies
    on_delete: restrict
  - column: section_id
    references: sections
    on_delete: restrict

triggers:
  - name: sync_shelf_company
    function: sync_shelf_company
    # 写す列も fires に並べる(直に書き換えられても写し直す。不変条件の書き込みの端の覆い。点検 26 回目 A26-1)
    fires: before insert or update of section_id, company_id
    supplies: [company_id]
    invariant: INV-SHELF-002
  # 作成の後に変えない列を DB が凍らせる(本文は生成物: after update の行トリガで OLD と NEW を比べ、違えば断る。点検 fix26 2 回目)。
  # 「変える口が無い」を本文・権限・連鎖の読みで証明する代わりに、どの経路の更新も DB が断る
  - name: freeze_shelves
    function: freeze_shelves
    fires: after update
    freezes: [company_id, section_id]

# 作成の冪等な再送で既存の行を返さない(作成者 = 作成の RPC が実行者で埋める列が無い)。同じ id があれば競合
resend:
  returns_existing: false

functions:
  - name: insert_shelf
    args: [uuid, uuid, jsonb, uuid, "text[]"]
    params: [p_id, p_section_id, p_values, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100008_rpc_insert_shelf.sql
    also_writes: {domain_events: [insert]}
  - name: update_shelf
    args: [uuid, jsonb, uuid, "text[]", "text[]"]
    params: [p_shelf_id, p_changes, p_actor_id, p_actor_roles, p_effects]
    kind: rpc
    shape: update
    migration: 20260912100009_rpc_update_shelf.sql
    also_writes: {domain_events: [insert], jobs: [insert]}
  - name: sync_shelf_company
    args: []
    kind: trigger
  - name: freeze_shelves
    args: []
    kind: trigger


test_cases:
  - id: TC-TABLE-SHELVES-001
    type: integration
    covers: [success]
    spec_ids: [table-shelves]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::shelves の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-SHELVES-002
    type: integration
    covers: [forbidden]
    spec_ids: [shelf-access]
    implementation: "app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts::shelves は実行者の company_id 以外の行を返さない"
  - id: TC-DDL-SHELVES-001
    type: integration
    covers: [success]
    spec_ids: [table-shelves]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::shelves の列と制約が宣言どおりである
  - id: TC-TABLE-SHELVES-003
    type: integration
    covers: [success]
    spec_ids: [table-shelves, INV-STOCK-RECEIPT-001]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::shelves の RPC が宣言どおりの本文である
---

# shelves — 棚のテーブル実装

- `store_id` の列そのものを持たない(束 ⑲-2a) — 店舗の責任者かどうかは `shelf → section → store` を 2 段辿って判定される。畳んだ列を持つと「人が書けてしまう列」を作ってしまい、そのために入力の口を塞ぐ規約とトリガと不変条件が要った。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
