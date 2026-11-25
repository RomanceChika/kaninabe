---
doc_type: data_table
scope: backend
id: table-rooms

table: rooms

entity: room

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110103_policies_rooms.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120203_ddl_rooms.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130103_api_view_rooms.sql

indexes:
  - name: rooms_department_name_unique
    on: [department_id, name]
    unique: true
    invariant: INV-ROOM-001

foreign_keys:
  - column: department_id
    references: departments
    on_delete: no_action           # 部門を消しても部屋を道連れにしない（部屋が残る限り部門は消せない）

# 作成の冪等な再送で既存の行を返さない(作成者 = 作成の RPC が実行者で埋める列が無い)。同じ id があれば競合
resend:
  returns_existing: false

functions:
  - name: insert_room
    args: [uuid, uuid, jsonb, uuid, "text[]"]
    params: [p_id, p_department_id, p_values, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100006_rpc_insert_room.sql
    also_writes: {domain_events: [insert]}
  - name: update_room
    args: [uuid, jsonb, uuid, "text[]", "text[]"]
    params: [p_room_id, p_changes, p_actor_id, p_actor_roles, p_effects]
    kind: rpc
    shape: update
    migration: 20260912100007_rpc_update_room.sql
    also_writes: {domain_events: [insert], jobs: [insert]}
  - name: delete_room
    args: [uuid, uuid, "text[]"]
    params: [p_room_id, p_actor_id, p_actor_roles]
    kind: rpc
    shape: delete
    migration: 20260912100008_rpc_delete_room.sql
    also_writes: {domain_events: [insert]}

test_cases:
  - id: TC-TABLE-ROOMS-001
    type: integration
    covers: [success]
    spec_ids: [table-rooms]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::rooms の宣言どおりの実体だけが DB にある
  - id: TC-DDL-ROOMS-001
    type: integration
    covers: [success]
    spec_ids: [table-rooms]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::rooms の列と制約が宣言どおりである
  - id: TC-TABLE-ROOMS-002
    type: integration
    covers: [success]
    spec_ids: [table-rooms]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::rooms の RPC が宣言どおりの本文である
---

# rooms — 会議室のテーブル実装

- 部門名で部屋を一意にするので、部屋名の全社一意は要求しない（同じ「第一会議室」が部門ごとにある）。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
