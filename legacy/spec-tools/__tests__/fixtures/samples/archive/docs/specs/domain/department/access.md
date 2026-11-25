---
doc_type: access_spec
scope: common
id: department-access
entity: department
reads:
  - by: anonymous
    scope: none
  - by: staff
    scope: all                    # 部署の一覧は社内に開く(所管の表示に要る)
  - by: curator
    scope: none                   # staff として全件読める
  - by: document_author
    scope: none                   # document 文脈のロール
  - by: system
    scope: all
accept:
  - by: staff
    filter: id
    reason: 部署の一覧(名前だけ)は所管の表示のために社内全体へ開く。文書の可視性は document の filters が所管部署で閉じる
---

# 部署のアクセス権限

- 部署を作る口・消す口は持たない — 行の正は人事側の台帳であり、この系は写しを読むだけである。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
