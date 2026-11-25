---
doc_type: data_table
scope: backend
id: table-domain_events

table: domain_events
internal: true                    # ドメイン仕様に現れない監査ログ。読み取りポリシー 0 本 = 全不可視が期待

# 仕組みが自分で持つ表。entity の値域はドメイン仕様の集約の全数から出る
framework: domain_events
ddl_migration: 20260912120206_ddl_domain_events.sql

# 索引は 1 本だけ持つ: 作成 RPC は行を入れた後に、同じ鍵の作成が監査ログに既にあるかを (entity_id, event_id) で引く
# (1 回目の行が消された後の押し直しを作り直さない。点検 23 回目 O23-2。製品の domain_events.md と同じ判断)
indexes:
  - name: domain_events_entity_id_event_id_idx
    on: [entity_id, event_id]

test_cases:
  - id: TC-TABLE-DOMAIN_EVENTS-001
    type: integration
    covers: [success]
    spec_ids: [table-domain_events]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::domain_events の宣言どおりの実体だけが DB にある
  - id: TC-DDL-DOMAIN_EVENTS-001
    type: integration
    covers: [success]
    spec_ids: [table-domain_events]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::domain_events の列と制約が宣言どおりである
---

# domain_events — 監査ログ(追記専用)のテーブル実装

- 列・型・DEFAULT の正は**仕組みの設計図**にあり、`entity` の値域だけがドメイン仕様の集約の全数から出る。

<!-- AUTO-GENERATED:data-table-body -->
### 対応

| 項目 | 値 |
| --- | --- |
| テーブル | `domain_events` |
| 対応 | —(内部テーブル。ドメイン仕様に現れない台帳) |
| 読み取りポリシー | 0 本(全不可視)が期待 — policy-parity が内部テーブルとして突合 |

### インデックス(主キー以外の全数)

| 名前 | 列 | 一意 | 部分(where) | 由来 |
| --- | --- | --- | --- | --- |
| `domain_events_entity_id_event_id_idx` | entity_id, event_id | — | — | lookup: insert_hold, insert_item, insert_loan |

### 採番の器

ありません。

### 排他制約

ありません。

### 外部キー

ありません。

### トリガ(全数)

| 名前 | 関数 | 発火 | 由来 |
| --- | --- | --- | --- |
| `domain_events_append_only` | `reject_domain_events_mutation` | before update or delete | — |

### 関数の帰属(この表を持ち場とする public スキーマの関数)

| 関数 | 引数型 | 引数名 | 種別 | 形 | 併せて書く表 |
| --- | --- | --- | --- | --- | --- |
| `reject_domain_events_mutation` | — | — | trigger | — | — |

### CHECK(entity_spec の導出でないもの)

ありません(この表の CHECK は仕組みの設計図 `legacy/spec-tools/lib/sql/framework-tables.ts` が持つ)。

### テストケース

| ID | type | covers | spec_ids | implementation |
| --- | --- | --- | --- | --- |
| TC-TABLE-DOMAIN_EVENTS-001 | integration | success | table-domain_events | `app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::domain_events の宣言どおりの実体だけが DB にある` |
| TC-DDL-DOMAIN_EVENTS-001 | integration | success | table-domain_events | `app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::domain_events の列と制約が宣言どおりである` |
<!-- /AUTO-GENERATED:data-table-body -->
