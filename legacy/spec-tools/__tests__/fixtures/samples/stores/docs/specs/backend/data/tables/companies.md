---
doc_type: data_table
scope: backend
id: table-companies

table: companies
entity: company

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110101_policies_companies.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120201_ddl_companies.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130101_api_view_companies.sql

indexes:
  - name: companies_name_unique
    on: [name]
    unique: true
    invariant: INV-COMPANY-001

test_cases:
  - id: TC-TABLE-COMPANIES-001
    type: integration
    covers: [success]
    spec_ids: [table-companies]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::companies の宣言どおりの実体だけが DB にある
  - id: TC-TABLE-COMPANIES-002
    type: integration
    covers: [forbidden]
    spec_ids: [company-access]
    implementation: "app/src/infrastructure/__tests__/rls/tenant-boundary.test.ts::companies は実行者の company_id 以外の行を返さない"
  - id: TC-DDL-COMPANIES-001
    type: integration
    covers: [success]
    spec_ids: [table-companies]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::companies の列と制約が宣言どおりである
---

# companies — 会社のテーブル実装

- 書き込み RPC を持たない — 会社の行を作るのは契約の手続き(仕組みの外)である。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
