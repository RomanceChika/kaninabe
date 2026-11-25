---
doc_type: data_table
scope: backend
id: table-items

table: items
entity: item

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110102_policies_items.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120201_ddl_items.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130102_api_view_items.sql

indexes:
  # item_list(sort: title, id)用
  - name: items_title_id_idx
    on: [title, id]

# 作成の冪等な再送で既存の行を返さない(作成者 = 作成の RPC が実行者で埋める列が無い)。同じ id があれば競合
resend:
  returns_existing: false

functions:
  - name: insert_item
    args: [uuid, text, text, text, text, uuid, "text[]"]
    params: [p_id, p_title, p_author, p_shelf_code, p_media, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100003_rpc_insert_item.sql
    also_writes: {domain_events: [insert]}
  - name: apply_item_transition
    args: [uuid, text, text, "text[]", text, uuid, "text[]"]
    params: [p_item_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles]
    kind: rpc
    shape: transition
    migration: 20260912100004_rpc_apply_item_transition.sql
    also_writes: {domain_events: [insert], jobs: [insert]}

test_cases:
  - id: TC-TABLE-ITEMS-001
    type: integration
    covers: [success]
    spec_ids: [table-items]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::items の宣言どおりの実体だけが DB にある
  - id: TC-DDL-ITEMS-001
    type: integration
    covers: [success]
    spec_ids: [table-items]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::items の列と制約が宣言どおりである
  - id: TC-TABLE-ITEMS-002
    type: integration
    covers: [success]
    spec_ids: [table-items]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::items の RPC が宣言どおりの本文である
---

# items — 蔵書のテーブル実装

- 書名の全文検索インデックスは張らない — 目録の検索はこの版の線の外。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
