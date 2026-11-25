---
doc_type: state_spec
scope: common
id: stock_move-states
state_machine: stock_move
states:
  - id: posted
    label: 記帳済み
  - id: voided
    label: 取消
    tone: negative                  # 「悪い知らせ」の宣言(確認が要る操作の導出に使う)
initial: posted
final: [voided]

events:
  - id: void
    label: 取り消す
    from: [posted]
    to: voided
    by: [store_manager, company_admin]
    guard: shelf.is_active == true and stock_move.company_id == actor.company_id   # 使えない棚の移動は取り消せず、他社の移動も取り消せない(テナント境界 —— V26)
    otherwise_forbidden: 取消済みの移動はもう取り消せない(打ち消しの移動を新しく記帳する)
---

# 在庫の移動の状態

- 取消を「行の削除」にしない — 台帳は書いた事実を残す場所であり、消すと残高の説明が付かなくなる。
- 記録した本人(staff_member)には取消を許さない — 残高が動く操作は店舗の責任者の判断に寄せる。

<!-- AUTO-GENERATED:state-diagram -->
<!-- /AUTO-GENERATED:state-diagram -->

<!-- AUTO-GENERATED:transition-table -->
<!-- /AUTO-GENERATED:transition-table -->

<!-- AUTO-GENERATED:state-event-matrix -->
<!-- /AUTO-GENERATED:state-event-matrix -->
