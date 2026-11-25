---
doc_type: data_table
scope: backend
id: table-employees

table: employees
entity: employee

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110102_policies_employees.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120201_ddl_employees.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130102_api_view_employees.sql

indexes: []

foreign_keys: []

functions:
  - name: is_employee
    args: []
    kind: helper
    role: employee
    migration: 20260912110001_helper_is_employee.sql
  - name: is_accountant
    args: []
    kind: helper
    role: accountant
    migration: 20260912110002_helper_is_accountant.sql

test_cases:
  - id: TC-TABLE-EMPLOYEES-001
    type: integration
    covers: [success]
    spec_ids: [table-employees]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::employees の宣言どおりの実体だけが DB にある
  - id: TC-DDL-EMPLOYEES-001
    type: integration
    covers: [success]
    spec_ids: [table-employees]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::employees の列と制約が宣言どおりである
---

# employees — 従業員のテーブル実装

- 書き込み RPC を持たない — この系では従業員の行を作らず、人事側の台帳から流し込む前提である。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
