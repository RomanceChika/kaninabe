---
doc_type: access_spec
scope: common
id: stock_move-access
entity: stock_move
reads:
  - by: anonymous
    scope: none
  - by: staff_member
    scope: all                      # 在庫の履歴は会社の全員が見る(テナント境界は宣言できない)
    filters: { company_id: actor.company_id }   # 会社を跨がない(テナント境界)
  - by: system
    scope: all
  - by: company_admin
    scope: none                     # staff_member として全件読める
  - by: store_manager
    scope: context(store)           # 自分が責任者である店舗の移動(畳んだ store_id 経由)
creates:
  - by: staff_member
    when: shelf.is_active == true and shelf.company_id == actor.company_id and product.company_id == actor.company_id   # 使えない棚には記帳できず、他社の棚(= 他社の伝票)にも他社の商品にも記帳できない(テナント境界。商品は入力で受ける。棚は伝票から写す)
accept:
  - by: store_manager
    filter: company_id
    reason: store_manager は store.manager_id == actor.id で立つロールなので、context(store) の行は必ず実行者が責任者の店舗 —— 会社を跨いだ行はそもそも集合に入らない
  - by: staff_member
    filter: stock_receipt.company_id
    on: [create]
    reason: 移動の棚は DB が伝票の棚から写す(INV-STOCK-MOVE-003。トリガ sync_stock_move_shelf)ので、when が移動の棚の会社(shelf.company_id)を実行者の会社に結べば、他社の伝票(= 他社の棚を持つ伝票)は拒否される。保存点では伝票を同じ保存点で作るので、伝票の会社の列を permit の前に読めない
---

# 在庫の移動のアクセス権限

- 数量の後から直しは持たない(writes なし) — 台帳は打ち消しの行を足して直す。
- 削除も持たない(deletes なし) — 取消は状態遷移(void)が担う。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
