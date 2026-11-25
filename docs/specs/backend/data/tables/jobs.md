---
doc_type: data_table
scope: backend
id: table-jobs

table: jobs
internal: true                    # ドメイン仕様に現れない outbox。読み取りポリシー 0 本 = 全不可視が期待

# 仕組みが自分で持つ表。列・型・NOT NULL・既定値・CHECK の正は設計図
# (legacy/spec-tools/lib/sql/framework-tables.ts)にあり、ここはそれを名指すだけである
framework: jobs
ddl_migration: 20260912120205_ddl_jobs.sql

indexes:
  - name: jobs_due_idx            # 取り出し(status = pending and next_run_at <= now())用
    on: [status, next_run_at]
  - name: jobs_idempotency_key_unique
    on: [idempotency_key]
    unique: true

test_cases:
  - id: TC-TABLE-JOBS-001
    type: integration
    covers: [success]
    spec_ids: [table-jobs]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::jobs の宣言どおりの実体だけが DB にある
  - id: TC-DDL-JOBS-001
    type: integration
    covers: [success]
    spec_ids: [table-jobs]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::jobs の列と制約が宣言どおりである
---

# jobs — 非同期ジョブ(outbox)のテーブル実装

- 列・型・DEFAULT・CHECK の正は**仕組みの設計図**にある — 列を決めているのは定型 RPC の本文であってアプリではない。

<!-- AUTO-GENERATED:data-table-body -->
### 対応

| 項目 | 値 |
| --- | --- |
| テーブル | `jobs` |
| 対応 | —(内部テーブル。ドメイン仕様に現れない台帳) |
| 読み取りポリシー | 0 本(全不可視)が期待 — policy-parity が内部テーブルとして突合 |

### インデックス(主キー以外の全数)

| 名前 | 列 | 一意 | 部分(where) | 由来 |
| --- | --- | --- | --- | --- |
| `jobs_due_idx` | status, next_run_at | — | — | — |
| `jobs_idempotency_key_unique` | idempotency_key | unique | — | — |

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
| TC-TABLE-JOBS-001 | integration | success | table-jobs | `app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::jobs の宣言どおりの実体だけが DB にある` |
| TC-DDL-JOBS-001 | integration | success | table-jobs | `app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::jobs の列と制約が宣言どおりである` |
<!-- /AUTO-GENERATED:data-table-body -->
