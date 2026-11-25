---
doc_type: screen_spec
scope: frontend
id: screen-detail

name: detail
label: 催し詳細
route: /workshops/:id
chrome: chrome-member
for: [member]
requires_auth: true

subject: workshop
precondition: state == closed
on_fail: redirect(screen-login)

reads: [query-workshop-detail]
actions: [entry.create, entry.submit]

ux:
  - principle: U1
    subject: entry.withdraw
    reason: 取下げは日常操作なので確認を挟まない
  - principle: U3
    reason: 催しの詳細は読み終えたら戻るだけの画面である

navigations:
  - on: entry.create.success
    to: screen-detail
  - on: cancel
    to: screen-login

overlays:
  - id: report_dialog
    layout:
      body:
        center: [report_form]
    opened_by: report_button
    label: 通報する
    actions: [entry.submit]
    closes_on: [cancel]

layout:
  body:
    center:
      - workshop_summary:
          label: 催しの概要
      - variants:
          no_entry: entry_form
          own_entry:
            own_entry_panel:
              footer: [submit_bar]
  footer: [page_footer]

states:
  requires: [error, not_found]

test_cases:
  - id: TC-SCREEN-DETAIL-001
    type: unit
    covers: [success]
    spec_ids: [screen-detail]
    implementation: app/src/app/__tests__/workshops/detail.test.tsx::催し詳細を描画する
---

# 催し詳細(fixture)
