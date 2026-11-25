---
doc_type: access_spec
scope: common
id: room-access
entity: room
reads:
  - by: anonymous
    scope: none
  - by: user
    scope: all                    # 空き状況を探すには全部門の部屋が見えている必要がある
  - by: system
    scope: all
  - by: booking_owner
    scope: none                   # booking 文脈のロール。部屋は user として読む
  - by: department_admin
    scope: none                   # user として全件読めるので、このロールで読む必要が無い
creates:
  - by: department_admin          # 部屋の台帳を育てるのは、その部門の管理者
writes:
  - by: department_admin
    fields: [name, capacity, has_projector]
deletes:
  - by: department_admin          # 使われたことのない部屋の消し込み（参照整合は外部キーが守る）
---

# 会議室のアクセス権限

- 「自分の部門の部屋だけ見える」にはしない — 空いている部屋を探す行為が部門をまたぐため、可視性を絞ると仕組みの意味が消える。
- 部屋を別の部門へ移す操作は持たない（department_id は writes に無い） — 移すと過去の予約の承認者が遡って変わる。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
