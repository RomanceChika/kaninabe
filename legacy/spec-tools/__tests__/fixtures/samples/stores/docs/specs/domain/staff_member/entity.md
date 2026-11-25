---
doc_type: entity_spec
scope: common
id: staff_member-entity
entity: staff_member
label: 従業員
context:
  company: staff_member.company_id  # 所属する会社(テナント)
  staff_member: staff_member.id     # 自分自身(実行者の行の解決用)
fields:
  - name: id
    type: uuid
    auto: true
    label: 従業員ID
    description: 従業員ID
    personal: false
  - name: company_id
    type: ref(company)
    required: true
    label: 所属会社
    description: この従業員が属する会社
    personal: false
    session: true                   # 実行者の属性(actor.company_id)。テナント境界の右辺
  - name: display_name
    type: string
    required: true
    max_length: 50
    label: 表示名
    description: 画面に出る名前
    personal: true
    personal_placeholder: "(消去済み)"
    session: true                   # セッションに載せる列(V13: 1 集約のみ)
  - name: email
    type: string
    required: true
    max_length: 200
    label: メールアドレス
    description: 連絡と本人確認の宛先
    personal: true
    personal_placeholder: "deleted-{id}@example.invalid"
  - name: phone
    type: string
    max_length: 20
    label: 電話番号
    description: 棚卸の連絡先(任意)
    personal: true
    personal_placeholder: null
  - name: account
    type: enum([active, locked])
    required: true
    labels:
      active: 利用できる
      locked: 停止されている
    label: アカウントの状態
    description: 社内 SSO のアカウントが使える状態か(auth.md の決定表の主語。退職の扱いは人事側が正で、ここは入館証の on/off に相当する)
    personal: false
  - name: is_admin
    type: boolean
    required: true
    label: 会社管理者かどうか
    description: 会社管理者の根拠(company_admin の claim が指す欄)
    personal: false
    session: true
  - name: created_at
    type: datetime
    auto: true
    label: 登録日時
    description: 登録日時(システム採番)
    personal: false
---

# 従業員(staff_member)

- 在籍状態の状態機械は持たない — 退職の扱いは人事側の台帳が正であり、ここに写すと 2 つの正ができる。サインインの分岐の主語は状態機械ではなく `account`(enum の欄)である。
- 個人データの消去は `personal_placeholder` の宣言までで、消去を起こす操作はこの版では持たない。

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
