---
doc_type: query_spec
scope: common
id: query-workshop-list

name: list
via: "Performer!"
source: workshop
scope_used: none
returns: one
paging: none
projection: []

params:
  - name: Bad-Name
    ref: workshop.id
  - name: organizer_id
    ref: workshop_id

includes:
  - entity: entry
    scope_used: own
    projection: [id]
    limit: 0
---

# 壊れた query_spec（フィクスチャ）

id と name の不一致 / scope 違い / scope_used: none / returns: one なのに paging /
projection が空 / params の名前と ref の形式違反 / via の形式違反 / includes の limit が 0 /
for と test_cases の欠落 を同時に持つ。
