---
doc_type: data_table
scope: backend
id: table-products

table: products
entity: product

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110103_policies_products.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120206_ddl_products.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130103_api_view_products.sql

indexes:
  - name: products_sku_idx
    on: [sku]
  - name: products_company_sku_unique
    on: [company_id, sku]
    unique: true
    invariant: INV-PRODUCT-001

foreign_keys:
  - column: company_id
    references: companies
    on_delete: restrict

# INV-STOCK-MOVE-005 の相手の端: 商品が別の会社へ移ったら、その商品を指す在庫の移動の会社と食い違う
# (移動の側は stock_moves の check_stock_move_product_company)。本文は不変条件の formal から生成される。
triggers:
  - name: check_stock_move_product_company_on_product
    function: check_stock_move_product_company_on_product
    fires: after update of company_id (constraint trigger, deferrable initially deferred)
    deferred: true
    invariant: INV-STOCK-MOVE-005

# 作成の冪等な再送で既存の行を返さない(作成者 = 作成の RPC が実行者で埋める列が無い)。同じ id があれば競合
resend:
  returns_existing: false

functions:
  - name: insert_product
    args: [uuid, jsonb, uuid, "text[]"]
    params: [p_id, p_values, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100002_rpc_insert_product.sql
    also_writes: {domain_events: [insert]}
  - name: update_product
    args: [uuid, jsonb, uuid, "text[]", "text[]"]
    params: [p_product_id, p_changes, p_actor_id, p_actor_roles, p_effects]
    kind: rpc
    shape: update
    migration: 20260912100003_rpc_update_product.sql
    also_writes: {domain_events: [insert], jobs: [insert]}
  - name: check_stock_move_product_company_on_product
    args: []
    kind: trigger

test_cases:
  - id: TC-TABLE-PRODUCTS-001
    type: integration
    covers: [success]
    spec_ids: [table-products]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::products の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-PRODUCTS-002
    type: integration
    covers: [forbidden]
    spec_ids: [product-access]
    implementation: "app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts::products は実行者の company_id 以外の行を返さない"
  - id: TC-DDL-PRODUCTS-001
    type: integration
    covers: [success]
    spec_ids: [table-products]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::products の列と制約が宣言どおりである
  - id: TC-TABLE-PRODUCTS-003
    type: integration
    covers: [success]
    spec_ids: [table-products]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::products の RPC が宣言どおりの本文である
---

# products — 商品のテーブル実装

- 削除 RPC は持たない — 台帳(移動・残高)が参照しており、消すと過去が説明できない。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
