---
doc_type: chrome_spec
scope: frontend
id: chrome-library
name: library
label: 館内クローム
layout:
  header: [app_header]
navigations:
  - on: catalog_link
    to: screen-item-list
  - on: my_library_link
    to: screen-my-library
  - on: desk_link
    to: screen-desk
---

# 館内クローム

- 検索窓はクロームに置かない — 目録の検索をこの版で扱わないため、枠だけ先に作らない。

<!-- AUTO-GENERATED:chrome-body -->
### 骨格

```text
+-- chrome: library
|   header : app_header
```

### 遷移（navigations）

| きっかけ（on） | 遷移先（to） |
| --- | --- |
| catalog_link | screen-item-list |
| my_library_link | screen-my-library |
| desk_link | screen-desk |

### 継承している画面

| 画面 | route |
| --- | --- |
| screen-mfa | `/mfa` |
| screen-item-detail | `/items/:id` |
| screen-item-list | `/items` |
| screen-desk | `/desk` |
| screen-desk-holds | `/desk/holds` |
| screen-my-library | `/my` |
<!-- /AUTO-GENERATED:chrome-body -->
