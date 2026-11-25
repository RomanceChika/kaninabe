---
doc_type: screen_spec
scope: frontend
id: screen-login

name: login
label: ログイン
route: /login
for: [anonymous]
entry_point: true

navigations:
  - on: signed_in
    to: screen-detail

layout:
  body:
    center: [login_form]

states:
  requires: [loading, error]
---

# ログイン(fixture)
