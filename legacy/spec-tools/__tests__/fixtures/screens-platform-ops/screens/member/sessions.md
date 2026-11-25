---
doc_type: screen_spec
scope: frontend
id: screen-sessions

name: sessions
label: 自分のセッション
route: /profile/sessions
for: [anonymous]
requires_auth: true

platform_ops: [session.list_mine, session.end_mine, session.end_others]

navigations:
  - on: platform_op.session.end_mine.success
    to: screen-sessions

overlays:
  - id: end_others_confirm
    label: ほかの端末をログアウトする
    opened_by: end_others_bar
    platform_ops: [session.end_others]
    layout:
      body:
        center: [confirm_bar]
    closes_on: [platform_op.session.end_others.success, cancel]

layout:
  body:
    center:
      - session_table: { kind: platform_read, op: session.list_mine, shows: [created_at, user_agent], row_actions: [session.end_mine] }
      - end_others_bar: { kind: platform_actions, ops: [session.end_others] }
---

# 自分のセッション(fixture)
