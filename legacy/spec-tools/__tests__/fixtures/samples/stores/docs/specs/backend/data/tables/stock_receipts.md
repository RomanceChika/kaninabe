---
doc_type: data_table
scope: backend
id: table-stock_receipts

table: stock_receipts
entity: stock_receipt

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110110_policies_stock_receipts.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120209_ddl_stock_receipts.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130110_api_view_stock_receipts.sql

indexes:
  - name: stock_receipts_shelf_id_idx
    on: [shelf_id]
  - name: stock_receipts_store_id_idx
    on: [store_id]

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
  - column: recorded_by
    references: staff_members
    on_delete: restrict

triggers:
  - name: sync_stock_receipt_placement
    function: sync_stock_receipt_placement
    # 写す列も fires に並べる(直に書き換えられても写し直す。不変条件の書き込みの端の覆い。点検 26 回目 A26-1)
    fires: before insert or update of shelf_id, company_id, store_id
    supplies: [company_id, store_id]
    invariant: INV-STOCK-RECEIPT-001
  # 作成の後に変えない列を DB が凍らせる(本文は生成物: after update の行トリガで OLD と NEW を比べ、違えば断る。点検 fix26 2 回目)。
  # 「変える口が無い」を本文・権限・連鎖の読みで証明する代わりに、どの経路の更新も DB が断る
  - name: freeze_stock_receipts
    function: freeze_stock_receipts
    fires: after update
    freezes: [shelf_id, company_id, store_id]

# 作成の冪等な再送で既存の行を返すのは、作成者(recorded_by)が実行者の行だけ
resend:
  returns_existing: true
  creator: recorded_by

functions:
  - name: insert_stock_receipt
    args: [uuid, uuid, uuid, jsonb, uuid, "text[]"]
    params: [p_id, p_shelf_id, p_recorded_by, p_values, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100012_rpc_insert_stock_receipt.sql
    also_writes: {domain_events: [insert]}
  - name: sync_stock_receipt_placement
    args: []
    kind: trigger
  - name: freeze_stock_receipts
    args: []
    kind: trigger

# 構造の突合の照らしの受け入れ(理由と、理由を示す試験の ID つき。試験はこの表の test_cases で spec_ids にその不変条件を持つもの)。
# 突合はこの宣言の生成物 dataTableParityAccepts を読む(点検 26 回目 A26-1)
parity_accepts:
  - check: invariant_edge
    invariant: INV-STOCK-RECEIPT-001
    edge: unreadable no-ref section
    reason: 式の section.store_id は伝票から棚・売場の 2 段で届くので、端の母集合の 1 段の読みでは数えられない。伝票の store_id は写しのトリガ sync_stock_receipt_placement が棚から売場を辿って埋める生成物で(data-table-parity が本文の md5 を照らす)、道の途中の参照の欄(棚の section_id・売場の store_id)は DB が凍らせている(凍結のトリガ freeze_shelves・freeze_sections。本文は生成物で data-table-parity が本文の md5 を照らし(TC-TABLE-SHELVES-001・TC-TABLE-SECTIONS-001)、凍結がどの経路の更新も断ることは生成器の統合試験 freeze-triggers.integration.test.ts が実 DB で見る)
    test: TC-TABLE-STOCK_RECEIPTS-001

test_cases:
  - id: TC-TABLE-STOCK_RECEIPTS-001
    type: integration
    covers: [success]
    spec_ids: [table-stock_receipts, INV-STOCK-RECEIPT-001]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::stock_receipts の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-STOCK_RECEIPTS-002
    type: integration
    covers: [forbidden]
    spec_ids: [stock_receipt-access]
    implementation: "app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts::stock_receipts は実行者の company_id 以外の行を返さない"
  - id: TC-DDL-STOCK_RECEIPTS-001
    type: integration
    covers: [success]
    spec_ids: [table-stock_receipts]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::stock_receipts の列と制約が宣言どおりである
  - id: TC-TABLE-STOCK_RECEIPTS-003
    type: integration
    covers: [success]
    spec_ids: [table-stock_receipts, INV-STOCK-MOVE-003, INV-STOCK-MOVE-004]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::stock_receipts の RPC が宣言どおりの本文である
---

# stock_receipts — 入荷伝票のテーブル実装

- 伝票の削除 RPC は持たない — ぶら下がる移動の行が残高に効いている。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
