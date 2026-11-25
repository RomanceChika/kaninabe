---
doc_type: data_table
scope: backend
id: table-departments

table: departments
entity: department

policies_migration: 20260922110101_policies_departments.sql
ddl_migration: 20260922120201_ddl_departments.sql
surface_migration: 20260922130101_api_view_departments.sql

test_cases:
  - id: TC-TABLE-DEPARTMENTS-001
    type: integration
    covers: [success]
    spec_ids: [table-departments]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::departments の宣言どおりの実体だけが DB にある
  - id: TC-DDL-DEPARTMENTS-001
    type: integration
    covers: [success]
    spec_ids: [table-departments]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::departments の列と制約が宣言どおりである
---

# departments — 部署のテーブル実装

- 書き込み RPC を持たない — 行の正は人事側の台帳であり、この系に作る口も直す口も無い。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
