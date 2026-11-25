---
doc_type: state_spec
scope: common
id: hold-states
state_machine: hold
states:
  - id: placed
    label: 受付
  - id: ready
    label: 取置中
  - id: collected
    label: 受取済み
  - id: cancelled
    label: 取消
    tone: negative
initial: placed
final: [collected, cancelled]
events:
  - id: prepare
    label: 取り置く
    from: [placed]
    to: ready
    by: [librarian]
    guard: item.state == available
    otherwise_forbidden: 取り置けるのは受付済みの予約だけ
  - id: collect
    label: 受け取る
    from: [ready]
    to: collected
    by: [librarian, hold_owner]
    otherwise_forbidden: 受け取れるのは取置中の予約だけ
  - id: cancel
    label: 取り消す
    from: [placed, ready]
    to: cancelled
    by: [hold_owner, librarian]
    otherwise_forbidden: 受取済みの予約は取り消せない(取消は取り置きまでの間だけ)
---

# 予約の状態

- 「期限切れ」の状態は置かない — 取置の期限が過ぎたら司書が取り消す(自動の走査はこの版で持たない)。

<!-- AUTO-GENERATED:state-diagram -->
```mermaid
stateDiagram-v2
    [*] --> placed
    placed: 受付 (placed)
    ready: 取置中 (ready)
    collected: 受取済み (collected)
    cancelled: 取消 (cancelled)
    placed --> ready: 取り置く (librarian)
    ready --> collected: 受け取る (librarian, hold_owner)
    placed --> cancelled: 取り消す (hold_owner, librarian)
    ready --> cancelled: 取り消す (hold_owner, librarian)
    collected --> [*]
    cancelled --> [*]
```
<!-- /AUTO-GENERATED:state-diagram -->

<!-- AUTO-GENERATED:transition-table -->
| イベントID | from | to | by | guard | 書き留める時刻 | effects |
| --- | --- | --- | --- | --- | --- | --- |
| hold.prepare(取り置く) | placed(受付) | ready(取置中) | librarian | `item.state == available` | — | — |
| hold.collect(受け取る) | ready(取置中) | collected(受取済み) | librarian, hold_owner | — | — | — |
| hold.cancel(取り消す) | placed(受付), ready(取置中) | cancelled(取消) | hold_owner, librarian | — | — | — |
<!-- /AUTO-GENERATED:transition-table -->

<!-- AUTO-GENERATED:state-event-matrix -->
| 状態＼イベント | prepare(取り置く) | collect(受け取る) | cancel(取り消す) |
| --- | --- | --- | --- |
| placed(受付) | ✓→ready | ✗(o) | ✓→cancelled |
| ready(取置中) | ✗(o) | ✓→collected | ✓→cancelled |
| collected(受取済み) | ✗(o) | ✗(o) | ✗(o) |
| cancelled(取消) | ✗(o) | ✗(o) | ✗(o) |

凡例: `✓→{to}` = 遷移が定義されている / `✗(fN)` = 明示的な禁止(脚注 fN) / `✗(o)` = otherwise_forbidden による包括禁止 / `✗(?)` = 理由が書かれていない(V3 違反)

脚注:

- o: from に無い状態の包括禁止(otherwise_forbidden)。イベントごとの理由は次のとおり。
    - prepare(取り置く): 取り置けるのは受付済みの予約だけ
    - collect(受け取る): 受け取れるのは取置中の予約だけ
    - cancel(取り消す): 受取済みの予約は取り消せない(取消は取り置きまでの間だけ)
<!-- /AUTO-GENERATED:state-event-matrix -->
