---
doc_type: data_table
scope: backend
id: table-jobs

table: jobs
internal: true                    # ドメイン仕様に現れない outbox。読み取りポリシー 0 本 = 全不可視が期待

framework: jobs
ddl_migration: 20260922120204_ddl_jobs.sql

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
<!-- /AUTO-GENERATED:data-table-body -->
