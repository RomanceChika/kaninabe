---
doc_type: access_spec
scope: common
id: user-access
entity: user
reads:
  - by: anonymous
    scope: none                   # 社内向けのため未ログインには何も見せない
  - by: user
    scope: all                    # 予約の申込者名を出すため、利用者の台帳は開く
  - by: system
    scope: all
  - by: booking_owner
    scope: none                   # booking 文脈のロール。利用者台帳は user として読む
  - by: department_admin
    scope: none                   # department 文脈のロール。同上
fields_hidden:
  - field: email                  # 連絡先は本人と管理側の情報。一覧には出さない
    from: [user]
---

# 利用者のアクセス権限

- 本人だけが自分の行を編集できる、という規則は置かない — 台帳の供給元は人事側であり、この仕組みからは一切書き換えない（creates / writes / deletes を宣言しない = 誰も書けない）。
- メールアドレスを本人にだけ見せる宣言は書けない（隠す方向しか無い）ため、連絡は人事側の台帳から行う。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
