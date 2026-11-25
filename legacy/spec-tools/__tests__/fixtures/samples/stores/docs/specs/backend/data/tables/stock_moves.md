---
doc_type: data_table
scope: backend
id: table-stock_moves

table: stock_moves
entity: stock_move

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110109_policies_stock_moves.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120211_ddl_stock_moves.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130109_api_view_stock_moves.sql

indexes:
  - name: stock_moves_receipt_id_idx
    on: [receipt_id]
  - name: stock_moves_store_id_idx
    on: [store_id]
  # 商品の会社が変わったときの INV-STOCK-MOVE-005 の検査(products の表のトリガ)が、その商品を指す移動を引く
  - name: stock_moves_product_id_idx
    on: [product_id]
  - name: stock_moves_company_source_ref_unique
    on: [company_id, source_ref]
    unique: true
    where: source_ref is not null
    invariant: INV-STOCK-MOVE-001

foreign_keys:
  - column: receipt_id
    references: stock_receipts
    on_delete: restrict
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
  - column: recorded_by
    references: staff_members
    on_delete: restrict

triggers:
  - name: sync_stock_move_shelf
    function: sync_stock_move_shelf
    # 写す列も fires に並べる(直に書き換えられても写し直す。不変条件の書き込みの端の覆い。点検 26 回目 A26-1)
    fires: before insert or update of receipt_id, shelf_id
    supplies: [shelf_id]
    invariant: INV-STOCK-MOVE-003
  - name: sync_stock_move_tenant
    function: sync_stock_move_tenant
    # 写す列も fires に並べる(直に書き換えられても写し直す。不変条件の書き込みの端の覆い。点検 26 回目 A26-1)
    fires: before insert or update of receipt_id, company_id, store_id
    supplies: [company_id, store_id]
    invariant: INV-STOCK-MOVE-004
  # INV-STOCK-MOVE-005(移動と商品の会社の一致)は別の集約の列との等式で、両端から破れる。移動の側はこの表、
  # 商品の側は products の check_stock_move_product_company_on_product。company_id は上のトリガ(receipt_id の更新)が
  # 書き換えるので、fires にも receipt_id を並べる(update of は SET の列でしか発火せず、BEFORE トリガの書き換えを数えない)。
  - name: check_stock_move_product_company
    function: check_stock_move_product_company
    # store_id も並べる: 上の sync_stock_move_tenant が store_id の更新でも company_id を写し直す(点検 26 回目 A26-1)
    fires: after insert or update of company_id, product_id, receipt_id, store_id (constraint trigger, deferrable initially deferred)
    deferred: true
    invariant: INV-STOCK-MOVE-005

checks:
  - name: stock_moves_kind_sign_check
    # rule の字面は `pg_get_constraintdef` の**正準表記**で書く（突合は文字列一致であり、
    # Postgres は書いたままではなく畳んだ形を印字する：and/or は大文字・項は丸括弧・
    # 文字列リテラルには `::text` が付く）。
    rule: "((kind = 'receipt'::text) AND (quantity > 0)) OR ((kind = 'issue'::text) AND (quantity < 0)) OR (kind = 'count'::text)"
    invariant: INV-STOCK-MOVE-002

# 作成の冪等な再送で既存の行を返すのは、作成者(recorded_by)が実行者の行だけ
resend:
  returns_existing: true
  creator: recorded_by

functions:
  - name: insert_stock_move
    args: [uuid, uuid, uuid, jsonb, uuid, "text[]"]
    params: [p_id, p_receipt_id, p_recorded_by, p_values, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100010_rpc_insert_stock_move.sql
    also_writes: {domain_events: [insert]}
  - name: apply_stock_move_transition
    args: [uuid, text, text, "text[]", text, uuid, "text[]"]
    params: [p_stock_move_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles]
    kind: rpc
    shape: transition
    migration: 20260912100011_rpc_apply_stock_move_transition.sql
    also_writes: {jobs: [insert], domain_events: [insert]}
  - name: sync_stock_move_shelf
    args: []
    kind: trigger
  - name: sync_stock_move_tenant
    args: []
    kind: trigger
  - name: check_stock_move_product_company
    args: []
    kind: trigger

# residue: 残高への反映(`also_writes: [stock_balances]`)も外してある —— 書いていたのは
# トリガ `apply_stock_move_to_balance` であり、その本文が無い以上「RPC が残高に書く」は
# 事実ではない。束 ㉖ でトリガ本文の生成は入ったが、**この 1 本は反映されない**(INV-STOCK-BALANCE-001
# は `formal` を持たず、しかも条件を課すのではなく**別の表へ集計を書く**)。戻すには
# 「集計の反映」を宣言から読める形が要る。
# residue: これらの不変条件の執行点(トリガ)は**一度も実在していない**。束 ㉖ で
# 「条件を課すトリガの本文を `formal` から生成する」を入れたが、**この不変条件は反映されない**
# —— INV-STOCK-BALANCE-001 は `formal` を持たず、しかも**別の表へ書き込む**集計の反映である
# (条件を課すのではなく値を作る)。実在しない執行点の行は置かない(束 CHECK 生成の裁定)。
# 不変条件の `enforced_by` は残してあり、T16 (e) が「実在しない執行点である」と
# warning で報告し続ける。
test_cases:
  - id: TC-TABLE-STOCK_MOVES-001
    type: integration
    covers: [success]
    spec_ids: [table-stock_moves]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::stock_moves の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-STOCK_MOVES-002
    type: integration
    covers: [forbidden]
    spec_ids: [stock_move-access]
    implementation: "app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts::stock_moves は実行者の company_id 以外の行を返さない"
  - id: TC-DDL-STOCK_MOVES-001
    type: integration
    covers: [success]
    spec_ids: [table-stock_moves]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::stock_moves の列と制約が宣言どおりである
  - id: TC-TABLE-STOCK_MOVES-003
    type: integration
    covers: [success]
    spec_ids: [table-stock_moves]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::stock_moves の RPC が宣言どおりの本文である
---

# stock_moves — 在庫の移動のテーブル実装

- 一意インデックスを部分(`where source_ref is not null`)にしてある — 伝票番号を持たない手記帳が 1 件しか作れなくなるのを避けるため。
- 削除 RPC は持たない — 台帳の行は消さず、取消の遷移で残す。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
