---
doc_type: access_spec
scope: common
id: department-access
entity: department
reads:
  - by: anonymous
    scope: none
  - by: user
    scope: all                    # 部屋の所属を読むために部門の台帳は全員に開く
  - by: system
    scope: all
  - by: booking_owner
    scope: none                   # booking 文脈のロール。部門は user として読む
  - by: department_admin
    scope: none                   # user として全件読めるので、このロールで読む必要が無い
writes:
  - by: department_admin
    fields: [name]                # 部門名の言い換えだけ。管理者の付け替えは人事側の台帳が正
---

# 部門のアクセス権限

- 管理者の付け替え（admin_id の更新）はこの仕組みでは扱わない — 任免の正は人事側にあり、ここに書くと 2 つの正ができる。
- 部門の作成・削除も扱わない（creates / deletes を宣言しない = 誰も作れず消せない）。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
