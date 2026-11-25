---
doc_type: data_table
scope: backend
id: table-bookings

table: bookings

entity: booking

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110101_policies_bookings.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120204_ddl_bookings.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130101_api_view_bookings.sql

indexes:
  # booking_own_list（スコープ条件 user_id / filters state / sort starts_at）用
  - name: bookings_user_id_state_starts_at_idx
    on: [user_id, state, starts_at]
  # booking_room_list（filters room_id, state / sort starts_at）用
  - name: bookings_room_id_state_starts_at_idx
    on: [room_id, state, starts_at]

exclusions:
  # INV-BOOKING-001。同じ部屋の予約どうしで期間が重ならない（取消は対象外）
  - name: bookings_room_slot_exclude
    keys: [room_id]
    range: [starts_at, ends_at]
    where: state <> 'cancelled'
    invariant: INV-BOOKING-001

foreign_keys:
  - column: room_id
    references: rooms
    on_delete: no_action           # 予約がある部屋は消せない（INV-ROOM-002 の執行点）
  - column: user_id
    references: users
    on_delete: no_action           # 予約が残る限り利用者の行は消せない

# 採番の器。defaults の nextval が名指す名前と一致すること（T13）。表の DDL の冒頭に
# create sequence が出る（既定値の式がこれを呼ぶので、表より前に作らないと表が作れない）
sequences:
  - name: bookings_reference_seq

defaults:
  reference_no: "('BK-'::text || lpad((nextval('bookings_reference_seq'::regclass))::text, 8, '0'::text))"

checks:
  - name: bookings_period_check
    invariant: INV-BOOKING-002

# 作成の冪等な再送で既存の行を返すのは、作成者(user_id)が実行者の行だけ
resend:
  returns_existing: true
  creator: user_id

functions:
  - name: apply_booking_transition
    args: [uuid, text, text, "text[]", text, uuid, "text[]"]
    params: [p_booking_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles]
    kind: rpc
    shape: transition
    migration: 20260912100001_rpc_apply_booking_transition.sql
    also_writes: {jobs: [insert], domain_events: [insert]}
  - name: insert_booking
    # 引数の型は入れる先の列の型である(T14)。開始・終了は timestamptz —— text と
    # 宣言すると本文の代入が 42804 で落ち、名前つき引数で呼ぶ経路は署名が見つからない
    args: [uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, "text[]"]
    params: [p_id, p_room_id, p_user_id, p_purpose, p_title, p_starts_at, p_ends_at, p_note, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100002_rpc_insert_booking.sql
    also_writes: {domain_events: [insert]}
  - name: update_booking
    args: [uuid, text, jsonb, uuid, "text[]", "text[]"]
    params: [p_booking_id, p_expected_state, p_changes, p_actor_id, p_actor_roles, p_effects]
    kind: rpc
    shape: update
    migration: 20260912100003_rpc_update_booking.sql
    also_writes: {domain_events: [insert], jobs: [insert]}
  - name: delete_booking
    args: [uuid, text, uuid, "text[]"]
    params: [p_booking_id, p_expected_state, p_actor_id, p_actor_roles]
    kind: rpc
    shape: delete
    migration: 20260912100004_rpc_delete_booking.sql
    also_writes: {domain_events: [insert]}

# residue: これらの不変条件の執行点(トリガ)は**一度も実在していない**。束 ㉖ で
# 「条件を課すトリガの本文を `formal` から生成する」を入れたが、**この不変条件は反映されない**
# —— INV-BOOKING-003 は `formal.type: cardinality`(同じ部屋の同時予約数の上限)であり、
# 行の式に写せない(数えるのは行の外である)。実在しない執行点の行は置かない
# (束 CHECK 生成の裁定)。不変条件の `enforced_by` は残してあり、T16 (e) が
# 「実在しない執行点である」と warning で報告し続ける。
test_cases:
  - id: TC-TABLE-BOOKINGS-001
    type: integration
    covers: [success]
    spec_ids: [table-bookings]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::bookings の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-BOOKINGS-002
    type: integration
    covers: [success]
    spec_ids: [table-bookings]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::bookings の RPC が宣言どおりの本文である
  - id: TC-DDL-BOOKINGS-001
    type: integration
    covers: [success]
    spec_ids: [table-bookings]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::bookings の列と制約が宣言どおりである
---

# bookings — 予約のテーブル実装

- **所属部門の列は持たない。** `department_admin` の binding は `booking → room → department` を `context` の連鎖で 2 段辿って解決される（束 ⑲-2a）。写しの列を 1 本・それを埋めるトリガを 1 本・一致を守る不変条件を 1 本、いずれも要らなくなった（束 ⑱ ではこの 3 点セットが階層の深さぶん必要だった）。
- **重複の禁止は排他制約であって一意索引ではない。** `exclusions` に宣言する（`indexes` に `unique: true` で書くと「開始時刻と終了時刻が完全に同じ 2 行」しか止められない）。`btree_gist` 拡張が要る。
- 予約番号を採番する口は insert RPC に無い（列の既定値が採番する） — 人に入力させない値が引数に残っていると、渡す側の善意でしか守られない。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
