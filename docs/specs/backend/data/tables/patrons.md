---
doc_type: data_table
scope: backend
id: table-patrons

table: patrons
entity: patron

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110104_policies_patrons.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120202_ddl_patrons.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130104_api_view_patrons.sql

# 採番の器。defaults の nextval が名指す名前と一致すること（T13）
sequences:
  - name: patron_card_seq
    start: 1000

defaults:
  # card_number は supplied_by: db(entity_spec)。採番はこの既定値が唯一の機構である
  card_number: "('L'::text || lpad((nextval('patron_card_seq'::regclass))::text, 8, '0'::text))"

functions:
  - name: is_patron
    args: []
    kind: helper
    role: patron
    migration: 20260912110001_helper_is_patron.sql
  - name: is_librarian
    args: []
    kind: helper
    role: librarian
    migration: 20260912110002_helper_is_librarian.sql

test_cases:
  - id: TC-TABLE-PATRONS-001
    type: integration
    covers: [success]
    spec_ids: [table-patrons]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::patrons の宣言どおりの実体だけが DB にある
  - id: TC-DDL-PATRONS-001
    type: integration
    covers: [success]
    spec_ids: [table-patrons]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::patrons の列と制約が宣言どおりである
---

# patrons — 利用者のテーブル実装

- 書き込み RPC を持たない — この版では利用者の行を作る / 直す操作をドメインに宣言していない。

<!-- AUTO-GENERATED:data-table-body -->
### 対応

| 項目 | 値 |
| --- | --- |
| テーブル | `patrons` |
| 対応する entity_spec | `patron` |
| 読み取りポリシー | 正は access_spec の reads(生成: rls-expectations.ts。ここには書かない) |

### インデックス

主キーの裏のインデックス以外はありません。

### 採番の器(全数。表より前に作る)

| 名前 | 最初の値 |
| --- | --- |
| `patron_card_seq` | 1000 |

### 排他制約

ありません。

### 外部キー

ありません。

### トリガ

ありません。

### 関数の帰属(この表を持ち場とする public スキーマの関数)

| 関数 | 引数型 | 引数名 | 種別 | 形 | 併せて書く表 |
| --- | --- | --- | --- | --- | --- |
| `is_patron` | — | — | helper | — | — |
| `is_librarian` | — | — | helper | — | — |

### CHECK(entity_spec の導出でないもの)

ありません(長さ・範囲・状態集合の CHECK は entity_spec / state_spec からの導出)。

### テストケース

| ID | type | covers | spec_ids | implementation |
| --- | --- | --- | --- | --- |
| TC-TABLE-PATRONS-001 | integration | success | table-patrons | `app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::patrons の宣言どおりの実体だけが DB にある` |
| TC-DDL-PATRONS-001 | integration | success | table-patrons | `app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::patrons の列と制約が宣言どおりである` |
<!-- /AUTO-GENERATED:data-table-body -->
