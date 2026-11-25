---
doc_type: access_spec
scope: common
id: patron-access
entity: patron
reads:
  - by: patron
    scope: all                    # 誰が借りているかは館内で共有される(閉じた館内サービス)
  - by: librarian
    scope: all
  - by: loan_owner
    scope: none                   # loan 文脈のロール。利用者の閲覧は patron として行う
  - by: hold_owner
    scope: none                   # hold 文脈のロール。同上
  - by: anonymous
    scope: none
  - by: system
    scope: all
fields_hidden:
  - field: card_number            # 利用者番号はカウンターの本人確認に使う
    from: [patron]
---

# 利用者のアクセス権限

- 利用者の行を作る口は持たない — アカウントは認証側で生まれ、この版では紐付けを仕様化しない。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
