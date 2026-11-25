---
doc_type: data_table
scope: backend
id: table-stock_balances

table: stock_balances
entity: stock_balance

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110108_policies_stock_balances.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120210_ddl_stock_balances.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130108_api_view_stock_balances.sql

indexes:
  - name: stock_balances_store_id_idx
    on: [store_id]
  - name: stock_balances_shelf_quantity_idx
    on: [shelf_id, quantity]
  - name: stock_balances_shelf_product_unique
    on: [shelf_id, product_id]
    unique: true
    invariant: INV-STOCK-BALANCE-002

foreign_keys:
  - column: company_id
    references: companies
    on_delete: restrict
  - column: store_id
    references: stores
    on_delete: restrict
  - column: shelf_id
    references: shelves
    on_delete: restrict
  - column: product_id
    references: products
    on_delete: restrict

defaults:
  quantity: "0"

test_cases:
  - id: TC-TABLE-STOCK_BALANCES-001
    type: integration
    covers: [success]
    spec_ids: [table-stock_balances]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::stock_balances の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-STOCK_BALANCES-002
    type: integration
    covers: [forbidden]
    spec_ids: [stock_balance-access]
    implementation: "app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts::stock_balances は実行者の company_id 以外の行を返さない"
  - id: TC-DDL-STOCK_BALANCES-001
    type: integration
    covers: [success]
    spec_ids: [table-stock_balances]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::stock_balances の列と制約が宣言どおりである
---

# stock_balances — 在庫残高のテーブル実装

- 書き込み RPC を持たない — 行を作り・動かすのは移動側のトリガ(`apply_stock_move_to_balance`)だけである。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
