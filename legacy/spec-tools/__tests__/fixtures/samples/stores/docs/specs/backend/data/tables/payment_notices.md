---
doc_type: data_table
scope: backend
id: table-payment_notices

table: payment_notices
entity: payment_notice

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110102_policies_payment_notices.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120208_ddl_payment_notices.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130102_api_view_payment_notices.sql

indexes:
  - name: payment_notices_order_id_idx
    on: [order_id]
  - name: payment_notices_external_event_id_unique
    on: [external_event_id]
    unique: true
    invariant: INV-PAYMENT-NOTICE-001

foreign_keys:
  - column: company_id
    references: companies
    on_delete: restrict
  - column: order_id
    references: sales_orders
    on_delete: restrict

# 作成の冪等な再送で既存の行を返さない(作成者 = 作成の RPC が実行者で埋める列が無い)。同じ id があれば競合
resend:
  returns_existing: false

functions:
  - name: insert_payment_notice
    args: [uuid, jsonb, uuid, "text[]"]
    params: [p_id, p_values, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100001_rpc_insert_payment_notice.sql
    also_writes: {domain_events: [insert]}

test_cases:
  - id: TC-TABLE-PAYMENT_NOTICES-001
    type: integration
    covers: [success]
    spec_ids: [table-payment_notices]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::payment_notices の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-PAYMENT_NOTICES-002
    type: integration
    covers: [forbidden]
    spec_ids: [payment_notice-access]
    implementation: "app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts::payment_notices は実行者の company_id 以外の行を返さない"
  - id: TC-DDL-PAYMENT_NOTICES-001
    type: integration
    covers: [success]
    spec_ids: [table-payment_notices]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::payment_notices の列と制約が宣言どおりである
  - id: TC-TABLE-PAYMENT_NOTICES-003
    type: integration
    covers: [success]
    spec_ids: [table-payment_notices]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::payment_notices の RPC が宣言どおりの本文である
---

# payment_notices — 入金通知のテーブル実装

- 署名の検証は DB に置かない — 受信口(生成された Route Handler)が署名を検証してから、生成された `api.inbound_payment_notice_webhook` を 1 回実行する。
- 注文の遷移をこの表のトリガで起こさない — 記録と遷移は同じトランザクションで起こされるが、**別々の RPC** である。挿入が注文を動かすトリガを持つと「記録」と「遷移」の 2 つの意味が 1 回の insert に乗り、どちらが拒否されたのかが読めなくなる。
- 一意制約は会社をまたいだ全体に掛ける — 決済サービスのイベントIDは相手側の名前空間で一意である。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
