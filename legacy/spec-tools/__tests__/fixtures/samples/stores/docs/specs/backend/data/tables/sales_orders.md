---
doc_type: data_table
scope: backend
id: table-sales_orders

table: sales_orders
entity: sales_order

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110104_policies_sales_orders.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120207_ddl_sales_orders.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130104_api_view_sales_orders.sql

indexes:
  - name: sales_orders_store_id_idx
    on: [store_id]
  - name: sales_orders_store_state_created_idx
    on: [store_id, state, created_at]
  - name: sales_orders_company_order_no_unique
    on: [company_id, order_no]
    unique: true
    invariant: INV-SALES-ORDER-001

foreign_keys:
  - column: company_id
    references: companies
    on_delete: restrict
  - column: store_id
    references: stores
    on_delete: restrict
  - column: placed_by
    references: staff_members
    on_delete: restrict

# 会社は店舗からの写しである(INV-SALES-ORDER-003)。本文は宣言から生成される
triggers:
  - name: sync_sales_order_company
    function: sync_sales_order_company
    # 写す列も fires に並べる(直に書き換えられても写し直す。不変条件の書き込みの端の覆い。点検 26 回目 A26-1)
    fires: before insert or update of store_id, company_id
    supplies: [company_id]
    invariant: INV-SALES-ORDER-003

# 採番の器。注文番号は「入力にも実行者にも現れない」値なので DB が決める —— 値の決め方が
# `now()` と採番だけから読めるものは**トリガにしない**(トリガの本文は生成物ではないので、
# 生成物だけで空の DB から立ち上げる系では誰も埋めない)。
# **会社ごとの採番は意図していない**(`fixture` の題材の範囲)—— 器は 1 本のグローバル連番であり、
# INV-SALES-ORDER-001 の `uniqueness [company_id, order_no]` はそれより強く満たされる。
sequences:
  - name: sales_orders_order_no_seq

defaults:
  order_no: "('SO-'::text || lpad((nextval('sales_orders_order_no_seq'::regclass))::text, 8, '0'::text))"

# 作成の冪等な再送で既存の行を返すのは、作成者(placed_by)が実行者の行だけ
resend:
  returns_existing: true
  creator: placed_by

functions:
  - name: sync_sales_order_company
    args: []
    kind: trigger
  - name: insert_sales_order
    args: [uuid, uuid, jsonb, uuid, "text[]"]
    params: [p_id, p_placed_by, p_values, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100004_rpc_insert_sales_order.sql
    also_writes: {domain_events: [insert]}
  - name: apply_sales_order_transition
    args: [uuid, text, text, "text[]", text, uuid, "text[]"]
    params: [p_sales_order_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles]
    kind: rpc
    shape: transition
    migration: 20260912100005_rpc_apply_sales_order_transition.sql
    also_writes: {jobs: [insert], domain_events: [insert]}

# residue: これらの不変条件の執行点(トリガ)は**一度も実在していない**。束 ㉖ で
# 「条件を課すトリガの本文を `formal` から生成する」を入れたが、**この不変条件は反映されない**
# —— INV-SALES-ORDER-002 は `formal` を持たない(入金通知の実在は別の集約の行を数える)。
# 実在しない執行点の行は置かない(束 CHECK 生成の裁定)。不変条件の `enforced_by` は
# 残してあり、T16 (e) が「実在しない執行点である」と warning で報告し続ける。
test_cases:
  - id: TC-TABLE-SALES_ORDERS-001
    type: integration
    covers: [success]
    spec_ids: [table-sales_orders]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::sales_orders の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-SALES_ORDERS-002
    type: integration
    covers: [forbidden]
    spec_ids: [sales_order-access]
    implementation: "app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts::sales_orders は実行者の company_id 以外の行を返さない"
  - id: TC-DDL-SALES_ORDERS-001
    type: integration
    covers: [success]
    spec_ids: [table-sales_orders]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::sales_orders の列と制約が宣言どおりである
  - id: TC-TABLE-SALES_ORDERS-003
    type: integration
    covers: [success]
    spec_ids: [table-sales_orders]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::sales_orders の RPC が宣言どおりの本文である
---

# sales_orders — 注文のテーブル実装

- 注文番号を列の既定値(`defaults`)で採番しない — 会社ごとの連番であり、店舗から会社を引き当てたあとでなければ決まらない。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
