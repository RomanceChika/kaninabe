---
doc_type: role_spec
scope: common
id: domain-roles
roles:
  # --- グローバルロール ---
  - id: anonymous
    label: 未ログイン
    kind: anonymous
  - id: employee
    label: 従業員
    kind: authenticated_default
  # 経理担当。根拠は実行者自身の行の欄(session: true の boolean)であって、対象の行に依らない。
  - id: accountant
    label: 経理担当
    claim: employee.is_accountant
    implies: [employee]
  - id: system
    label: システム
    kind: system
  # --- 文脈依存ロール ---
  - id: claim_owner
    label: 申請者
    binding: claim.employee_id == actor.id
    implies: [employee]
  - id: approver
    label: 承認者
    binding: claim.approver_id == actor.id
    implies: [employee]
---

# ロール定義

- 部門長という上位ロールは作らない — 承認者は申請 1 件ごとに指名される関係であり、組織図を仕様に刻まない。
- 経理の任免はこの仕様の範囲外(人事側の台帳が正)。ここでは「経理かどうか」の欄を根拠にするだけである。

<!-- AUTO-GENERATED:role-table -->
<!-- /AUTO-GENERATED:role-table -->
