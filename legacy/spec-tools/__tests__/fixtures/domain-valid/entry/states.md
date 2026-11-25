---
doc_type: state_spec
scope: common
id: entry-states
state_machine: entry
states:
  - id: draft
    label: 下書き
  - id: submitted
    label: 提出済み
  - id: accepted
    label: 受理
  - id: rejected
    label: 却下
  - id: withdrawn
    label: 取下げ
initial: draft
final: [rejected, withdrawn]

events:
  - id: submit
    label: 提出
    from: [draft]
    to: submitted
    by: [performer]
    guard: "workshop.state == accepting"
    otherwise_forbidden: 提出は下書きからのみ。確定後の再提出は新規エントリーとして扱う
  - id: accept
    label: 受理
    from: [submitted]
    to: accepted
    by: [organizer]
    otherwise_forbidden: 受理判断は提出済みに対してのみ行う
  - id: withdraw
    from: [submitted, accepted]
    to: withdrawn
    by: [performer, organizer]
    guard: "workshop.state != program_published"
    otherwise_forbidden: 下書きの取下げは削除で行う

forbidden:
  - event: accept
    from: [withdrawn]
    reason: 取下げ済みのエントリーは受理できない

effects:
  - on: submit
    do: [notify_discord_organizer]
  - on: accept
    do: [notify_performer]
---

# エントリーの状態
