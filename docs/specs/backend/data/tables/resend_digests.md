---
doc_type: data_table
scope: backend
id: table-resend_digests

table: resend_digests
internal: true                    # ドメイン仕様に現れない短命の行。読み取りポリシー 0 本 = 全不可視が期待

# 仕組みが自分で持つ表(保存点の再送の入力の要約)。列の正は設計図、読み書きの字面の正は仕組みの側にある
framework: resend_digests
ddl_migration: 20260912120290_ddl_resend_digests.sql

# 押し直しを受け付ける時間。過ぎた行は比べに使わず、次に保存点が 1 回目を書くときに消す
retention_hours: 24

# 要約は入力から作るので個人列として扱う(この題材は消去の効果を持たないので、消えるのは保持の時間だけ)
personal_columns: [input_digest]

indexes:
  - name: resend_digests_key_unique
    on: [event_id, entity_id]
    unique: true

test_cases:
  - id: TC-TABLE-RESEND_DIGESTS-001
    type: integration
    covers: [success]
    spec_ids: [table-resend_digests]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::resend_digests の宣言どおりの実体だけが DB にある
  - id: TC-DDL-RESEND_DIGESTS-001
    type: integration
    covers: [success]
    spec_ids: [table-resend_digests]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::resend_digests の列と制約が宣言どおりである
---

# resend_digests — 保存点の再送の入力の要約(短命)

- 列・型・DEFAULT の正は**仕組みの設計図**にある。行は保持の時間を過ぎると比べに使われず、次の保存点の 1 回目が消す。

<!-- AUTO-GENERATED:data-table-body -->
### 対応

| 項目 | 値 |
| --- | --- |
| テーブル | `resend_digests` |
| 対応 | —(内部テーブル。ドメイン仕様に現れない台帳) |
| 読み取りポリシー | 0 本(全不可視)が期待 — policy-parity が内部テーブルとして突合 |

### インデックス(主キー以外の全数)

| 名前 | 列 | 一意 | 部分(where) | 由来 |
| --- | --- | --- | --- | --- |
| `resend_digests_key_unique` | event_id, entity_id | unique | — | — |

### 採番の器

ありません。

### 排他制約

ありません。

### 外部キー

ありません。

### トリガ

ありません。

### 関数の帰属

この表を持ち場とする関数はありません。

### CHECK(entity_spec の導出でないもの)

ありません(この表の CHECK は仕組みの設計図 `legacy/spec-tools/lib/sql/framework-tables.ts` が持つ)。

### テストケース

| ID | type | covers | spec_ids | implementation |
| --- | --- | --- | --- | --- |
| TC-TABLE-RESEND_DIGESTS-001 | integration | success | table-resend_digests | `app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::resend_digests の宣言どおりの実体だけが DB にある` |
| TC-DDL-RESEND_DIGESTS-001 | integration | success | table-resend_digests | `app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::resend_digests の列と制約が宣言どおりである` |
<!-- /AUTO-GENERATED:data-table-body -->
