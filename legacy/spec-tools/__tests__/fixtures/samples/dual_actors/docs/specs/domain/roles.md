---
doc_type: role_spec
scope: common
id: domain-roles
roles:
  # --- グローバルロール ---
  - id: anonymous
    label: 未ログイン
    kind: anonymous
  - id: signed_in
    label: サインイン済み
    kind: authenticated_default
  - id: system
    label: システム
    kind: system
  # --- 文脈依存ロール ---
  - id: customer_self
    label: 本人(顧客)
    binding: customer.account_id == actor.id
    implies: [signed_in]
  - id: employee_self
    label: 本人(従業員)
    binding: employee.account_id == actor.id
    implies: [signed_in]
---

# ロール定義

- **実行者になりうる集約が 2 つある題材である**(顧客と従業員)。どちらも自分の行を持ち、
  どちらもサインインして操作する — 「実行者の集約はちょうど 1 つ」という前提を揺さぶるために
  この形を選んである(束 ㉑)。

<!-- AUTO-GENERATED:role-table -->
<!-- /AUTO-GENERATED:role-table -->
