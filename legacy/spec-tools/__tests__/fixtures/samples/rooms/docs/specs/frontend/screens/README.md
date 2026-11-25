---
doc_type: directory_guide
id: DG-FE-0001
norms: []
scope: frontend

# S10（UI 到達の網羅）の免除宣言。
unexposed:
  - event: feedback.create
    reason: 検査の足場の集約(未ログインの作成の正例)で、画面を持たない。読むのもシステムだけである
  - event: feedback.delete
    reason: 検査の足場の集約(未ログインの削除の正例)で、画面を持たない

# S13（状態×ロールの到達）の免除宣言。
unreachable_states: []

# S14（状態の可視性）の免除宣言。
unseen_states:
  - state: booking.cancelled
    reason: 取り消した予約は一覧に出さない設計（残すのは監査のためで、人に見せる実需がまだ無い）。見せる実需が出たら booking_own_list の絞り込みに足す

---

# 画面仕様（会議室の予約）

- 部屋の空き状況を 1 枚のカレンダーに集約する画面は置かない — 部門をまたぐ表示は可視性の宣言が部門ごとに違うため、1 枚に混ぜると読み取り経路が説明できなくなる。

<!-- AUTO-GENERATED:screen-list -->
<!-- /AUTO-GENERATED:screen-list -->
