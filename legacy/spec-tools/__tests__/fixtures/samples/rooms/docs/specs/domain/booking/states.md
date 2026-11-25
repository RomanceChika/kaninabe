---
doc_type: state_spec
scope: common
id: booking-states
state_machine: booking
states:
  - id: draft
    label: 仮押さえ
  - id: confirmed
    label: 確定
  - id: cancelled
    label: 取消
    tone: negative                # 「悪い知らせ」の宣言（確認が要る操作の導出に使う）
initial: draft
final: [cancelled]

events:
  - id: confirm
    label: 確定する
    from: [draft]
    to: confirmed
    by: [booking_owner, department_admin]
    guard: now < booking.starts_at
    otherwise_forbidden: 確定は仮押さえからのみ。確定済みの予約を確定し直す操作は無い
  - id: cancel
    label: 取り消す
    from: [draft, confirmed]
    to: cancelled
    by: [booking_owner, department_admin]
    otherwise_forbidden: 取消済みの予約はもう取り消せない（履歴として残す）
---

# 予約の状態

- 「却下」を別の状態にしない — 部門管理者が断る場合も利用者が止める場合も、部屋が空くという結末は同じである（誰が取り消したかは監査ログが残す）。
- 開始時刻を過ぎた予約を自動で「終了」にはしない — 終了状態を足しても誰も見ないうえ、V5 の到達可能性が使われない状態で埋まる。

<!-- AUTO-GENERATED:state-diagram -->
<!-- /AUTO-GENERATED:state-diagram -->

<!-- AUTO-GENERATED:transition-table -->
<!-- /AUTO-GENERATED:transition-table -->

<!-- AUTO-GENERATED:state-event-matrix -->
<!-- /AUTO-GENERATED:state-event-matrix -->
