---
doc_type: entity_spec
scope: common
id: department-entity
entity: department
label: 部署
context:
  department: department.id       # 自分自身
fields:
  - name: id
    type: uuid
    auto: true
    label: 部署ID
    description: 部署ID
    personal: false
  - name: name
    type: string
    required: true
    max_length: 40
    label: 部署名
    description: 部署名
    personal: false
---

# 部署(department)

- 部署の親子(本部 → 課)は持たない — 文書の所管は 1 段で足りており、木にすると可視性の境界が 2 段になる。
- 廃止の状態機械は持たない — 部署の統廃合は人事側の台帳が正で、ここに写すと 2 つの正ができる。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
