---
doc_type: data_table
scope: backend
id: table-holds

table: holds
entity: hold

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110101_policies_holds.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120203_ddl_holds.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130101_api_view_holds.sql

indexes:
  - name: holds_active_unique
    on: [item_id, patron_id]
    unique: true
    where: "(state <> ALL (ARRAY['collected'::text, 'cancelled'::text]))"
    invariant: INV-HOLD-001
  # hold_own_list(スコープ条件 patron_id で絞り、state の filters / sort: id asc = 順方向)と
  # hold_own_history(同じ絞りで sort: id desc = 同じ索引の逆方向の走査)用
  - name: holds_patron_id_state_id_idx
    on: [patron_id, state, id]
  # desk_hold_list(filters: state / sort: id)用
  - name: holds_state_id_idx
    on: [state, id]

foreign_keys:
  - column: item_id
    references: items
    on_delete: no_action
  - column: patron_id
    references: patrons
    on_delete: no_action

# 作成の冪等な再送で既存の行を返すのは、作成者(patron_id)が実行者の行だけ
resend:
  returns_existing: true
  creator: patron_id

functions:
  - name: insert_hold
    args: [uuid, uuid, uuid, text, uuid, "text[]"]
    params: [p_id, p_item_id, p_patron_id, p_note, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100001_rpc_insert_hold.sql
    also_writes: {domain_events: [insert]}
  - name: apply_hold_transition
    args: [uuid, text, text, "text[]", text, uuid, "text[]"]
    params: [p_hold_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles]
    kind: rpc
    shape: transition
    migration: 20260912100002_rpc_apply_hold_transition.sql
    also_writes: {domain_events: [insert], jobs: [insert]}

test_cases:
  - id: TC-TABLE-HOLDS-001
    type: integration
    covers: [success]
    spec_ids: [table-holds]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::holds の宣言どおりの実体だけが DB にある
  - id: TC-DDL-HOLDS-001
    type: integration
    covers: [success]
    spec_ids: [table-holds]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::holds の列と制約が宣言どおりである
  - id: TC-TABLE-HOLDS-002
    type: integration
    covers: [success]
    spec_ids: [table-holds]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::holds の RPC が宣言どおりの本文である
---

# holds — 予約のテーブル実装

- 取置期限の列は持たない — 期限切れの運用を仕様に載せていないため、列だけ先に作らない。

<!-- AUTO-GENERATED:data-table-body -->
### 対応

| 項目 | 値 |
| --- | --- |
| テーブル | `holds` |
| 対応する entity_spec | `hold` |
| 読み取りポリシー | 正は access_spec の reads(生成: rls-expectations.ts。ここには書かない) |

### インデックス(主キー以外の全数)

| 名前 | 列 | 一意 | 部分(where) | 由来 |
| --- | --- | --- | --- | --- |
| `holds_active_unique` | item_id, patron_id | unique | `(state <​> ALL (ARRAY['collected'::text, 'cancelled'::text]))` | INV-HOLD-001 |
| `holds_patron_id_state_id_idx` | patron_id, state, id | — | — | query: hold_own_history, hold_own_list |
| `holds_state_id_idx` | state, id | — | — | query: desk_hold_list |

### 採番の器

ありません。

### 排他制約

ありません。

### 外部キー(全数)

| 列 | 参照先 | on delete |
| --- | --- | --- |
| item_id | `items` | no_action |
| patron_id | `patrons` | no_action |

### トリガ

ありません。

### 関数の帰属(この表を持ち場とする public スキーマの関数)

| 関数 | 引数型 | 引数名 | 種別 | 形 | 併せて書く表 |
| --- | --- | --- | --- | --- | --- |
| `insert_hold` | uuid, uuid, uuid, text, uuid, text[] | p_id, p_item_id, p_patron_id, p_note, p_actor_id, p_actor_roles | rpc | create | domain_events（insert） |
| `apply_hold_transition` | uuid, text, text, text[], text, uuid, text[] | p_hold_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles | rpc | transition | domain_events（insert）, jobs（insert） |

### CHECK(entity_spec の導出でないもの)

ありません(長さ・範囲・状態集合の CHECK は entity_spec / state_spec からの導出)。

### テストケース

| ID | type | covers | spec_ids | implementation |
| --- | --- | --- | --- | --- |
| TC-TABLE-HOLDS-001 | integration | success | table-holds | `app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::holds の宣言どおりの実体だけが DB にある` |
| TC-DDL-HOLDS-001 | integration | success | table-holds | `app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::holds の列と制約が宣言どおりである` |
| TC-TABLE-HOLDS-002 | integration | success | table-holds | `app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::holds の RPC が宣言どおりの本文である` |
<!-- /AUTO-GENERATED:data-table-body -->
