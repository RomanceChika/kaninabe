---
doc_type: data_table
scope: backend
id: table-users

table: users

entity: user

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110104_policies_users.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120201_ddl_users.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130104_api_view_users.sql

indexes:
  - name: users_email_unique
    on: [email]
    unique: true

functions:
  - name: is_user
    args: []
    kind: helper
    role: user
    migration: 20260912110001_helper_is_user.sql

test_cases:
  - id: TC-TABLE-USERS-001
    type: integration
    covers: [success]
    spec_ids: [table-users]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::users の宣言どおりの実体だけが DB にある
  - id: TC-DDL-USERS-001
    type: integration
    covers: [success]
    spec_ids: [table-users]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::users の列と制約が宣言どおりである
---

# users — 利用者のテーブル実装

- 書き込み RPC を 1 つも持たない — 台帳の供給元は人事側で、この仕組みからは読むだけである。

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
