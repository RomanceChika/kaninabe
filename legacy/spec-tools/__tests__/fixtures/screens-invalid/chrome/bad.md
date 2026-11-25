---
doc_type: chrome_spec
scope: frontend
id: chrome-other

name: bad
route: /bad
for: [member]
reads: [query-x]
actions: [entry.create]
navigation: []

navigations:
  - on: entry.create.success
    to: screen-misplaced
---

# 配線を持ってしまったクローム(fixture)
