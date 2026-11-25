---
doc_type: state_spec
scope: common
id: workshop-states
machines:
  - state_machine: workshop
    states:
      - id: planning
        label: 計画中
      - id: accepting
        label: 募集中
      - id: program_published
        label: プログラム確定
    initial: planning
    final: [program_published]
    events:
      - id: open
        label: 募集開始
        from: [planning]
        to: accepting
        by: [organizer]
        otherwise_forbidden: 募集開始は計画中の催しにのみ行う
      - id: publish_program
        from: [accepting]
        to: program_published
        by: [organizer, system]
        otherwise_forbidden: プログラム確定は募集中の催しにのみ行う
  - state_machine: workshop_publish
    states:
      - id: hidden
      - id: listed
    initial: hidden
    final: []
    events:
      - id: list
        from: [hidden]
        to: listed
        by: [organizer]
        otherwise_forbidden: 掲載は非掲載の催しにのみ行う
      - id: unlist
        from: [listed]
        to: hidden
        by: [organizer]
        otherwise_forbidden: 取り下げは掲載中の催しにのみ行う
---

# 催しの状態
