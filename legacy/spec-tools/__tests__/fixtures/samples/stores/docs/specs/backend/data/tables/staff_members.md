---
doc_type: data_table
scope: backend
id: table-staff_members

table: staff_members
entity: staff_member

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110107_policies_staff_members.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120202_ddl_staff_members.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130107_api_view_staff_members.sql

indexes:
  - name: staff_members_company_id_idx
    on: [company_id]
  - name: staff_members_email_unique
    on: [email]
    unique: true
    invariant: INV-STAFF-MEMBER-001

foreign_keys:
  - column: company_id
    references: companies
    on_delete: restrict           # 従業員がいる会社は消えない

# INV-STORE-002 の相手の端: 従業員が別の会社へ移ったら、その人を責任者にしている店舗の会社と食い違う。
# 本文は不変条件の formal から生成される(店舗の側は stores の check_store_manager_company)。
triggers:
  - name: check_store_manager_company_on_staff_member
    function: check_store_manager_company_on_staff_member
    fires: after update of company_id (constraint trigger, deferrable initially deferred)
    deferred: true
    invariant: INV-STORE-002

functions:
  - name: is_staff_member
    args: []
    kind: helper
    role: staff_member
    migration: 20260912110001_helper_is_staff_member.sql
  - name: is_company_admin
    args: []
    kind: helper
    role: company_admin
    migration: 20260912110002_helper_is_company_admin.sql
  # 境界(filters の actor.company_id)の値は実行者自身の行から読む(トークンの写しを信じない)。
  # 本文は actor_field の宣言から生成される。ポリシーが呼ぶので連番は全 policies_migration より前。
  - name: actor_company_id
    args: []
    kind: helper
    actor_field: company_id
    migration: 20260912110003_helper_actor_company_id.sql
  - name: check_store_manager_company_on_staff_member
    args: []
    kind: trigger

# residue: これらの不変条件の執行点(トリガ)は**一度も実在していない**。束 ㉖ で
# 「条件を課すトリガの本文を `formal` から生成する」を入れたが、**この不変条件は反映されない**
# —— INV-STAFF-MEMBER-002 は `formal.type: cardinality`(会社ごとの管理者数の上限)であり、
# 行の式に写せない。実在しない執行点の行は置かない(束 CHECK 生成の裁定)。
# 不変条件の `enforced_by` は残してあり、T16 (e) が「実在しない執行点である」と
# warning で報告し続ける。
test_cases:
  - id: TC-TABLE-STAFF_MEMBERS-001
    type: integration
    covers: [success]
    spec_ids: [table-staff_members]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::staff_members の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-STAFF_MEMBERS-002
    type: integration
    covers: [forbidden]
    spec_ids: [staff_member-access]
    implementation: "app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts::staff_members は実行者の company_id 以外の行を返さない"
  - id: TC-DDL-STAFF_MEMBERS-001
    type: integration
    covers: [success]
    spec_ids: [table-staff_members]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::staff_members の列と制約が宣言どおりである
---

# staff_members — 従業員のテーブル実装

- 書き込み RPC を持たない — 在籍と任免の正は人事側にあり、この仕組みからは書かない。
- `company_id` の on delete を cascade にしない — 会社の行が消えても従業員の個人データが黙って消えるのは、消去の経路として宣言されていない。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
