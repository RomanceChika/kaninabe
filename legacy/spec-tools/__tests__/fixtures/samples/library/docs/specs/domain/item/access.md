---
doc_type: access_spec
scope: common
id: item-access
entity: item
reads:
  - by: anonymous
    scope: all                    # 蔵書目録は館外にも公開する
  - by: patron
    scope: all
  - by: librarian
    scope: all
  - by: loan_owner
    scope: none                   # loan 文脈のロール。目録の閲覧は patron / anonymous として行う
  - by: hold_owner
    scope: none                   # hold 文脈のロール。同上
  - by: system
    scope: all
creates:
  - by: librarian                 # 受入(登録)は司書の仕事
---

# 蔵書のアクセス権限

- 蔵書の削除(除籍)は持たない — 紛失も含めて履歴を残す必要があるので、状態で表す。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
