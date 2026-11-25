---
doc_type: state_spec
scope: common
id: orphan-states
state_machine: orphan
states:
  - id: only
initial: only
final: []
events:
  - id: touch
    from: [only]
    to: only
    by: [system]
    otherwise_forbidden: 唯一の状態からのみ実行できる
---

# entity.md と access.md が無い集約
