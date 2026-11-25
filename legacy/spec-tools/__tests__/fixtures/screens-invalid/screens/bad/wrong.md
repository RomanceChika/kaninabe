---
doc_type: screen_spec
scope: backend
id: screen-typo

name: wrong
label: "  "
route: /wrong/

for: []

precondition: state == draft

reads: [query-x]

navigations:
  - on: cancel

# 操作を発火するのに、それを開く口(opened_by)が無い重ね表示。
overlays:
  - id: orphan_dialog
    layout:
      body:
        center: [confirm_bar]
    actions: [entry.submit]

states:
  requires: [spinning]
---

# スキーマ違反の詰め合わせ(fixture)
