---
doc_type: data_table
scope: backend
id: table-staffs

table: staffs
entity: staff

policies_migration: 20260922110102_policies_staffs.sql
ddl_migration: 20260922120202_ddl_staffs.sql
surface_migration: 20260922130102_api_view_staffs.sql

foreign_keys:
  - column: department_id
    references: departments
    on_delete: no_action          # 職員が居る限り部署の行は消せない

functions:
  - name: is_staff
    args: []
    kind: helper
    role: staff
    migration: 20260922110001_helper_is_staff.sql
  - name: is_curator
    args: []
    kind: helper
    role: curator
    migration: 20260922110002_helper_is_curator.sql
  # 境界(filters の actor.department_id)の値は実行者自身の行から読む(トークンの写しを信じない)。
  # 本文は actor_field の宣言から生成される。ポリシーと surface のマスクが呼ぶので連番はそれより前。
  - name: actor_department_id
    args: []
    kind: helper
    actor_field: department_id
    migration: 20260922110003_helper_actor_department_id.sql

test_cases:
  - id: TC-TABLE-STAFFS-001
    type: integration
    covers: [success]
    spec_ids: [table-staffs]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::staffs の宣言どおりの実体だけが DB にある
  # 部署の境界の見張りテスト(T4)。この表は `world` を宣言から作れるので、本物のリポジトリでは
  # 同じ名前の it が生成物として出る(`fixture` は仕様だけを持つので注釈を手で置く)
  - id: TC-TABLE-STAFFS-002
    type: integration
    covers: [forbidden]
    spec_ids: [staff-access]
    implementation: "app/src/infrastructure/__tests__/rls/department-boundary.test.ts::staffs は実行者の department_id 以外の行を返さない"
  - id: TC-DDL-STAFFS-001
    type: integration
    covers: [success]
    spec_ids: [table-staffs]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::staffs の列と制約が宣言どおりである
---

# staffs — 職員のテーブル実装

- 書き込み RPC を持たない — この版では職員の行を作る / 直す操作をドメインに宣言していない。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
