---
doc_type: data_table
scope: backend
id: table-documents

table: documents
entity: document

policies_migration: 20260922110103_policies_documents.sql
ddl_migration: 20260922120203_ddl_documents.sql
surface_migration: 20260922130103_api_view_documents.sql

indexes:
  - name: documents_department_title_unique
    on: [department_id, title]
    unique: true
    where: "(state <> 'archived'::text)"
    invariant: INV-DOCUMENT-001
  # document_list(sort: title, id)用。**`state != archived` の絞り込みは索引の先頭に入らない**
  # —— 不等号は等値と違って範囲を絞らないので、T2 の導出は並びの列だけを求める
  - name: documents_title_id_idx
    on: [title, id]
  # archive_list(filters: state / sort: disposable_after, id)用
  - name: documents_state_disposable_after_id_idx
    on: [state, disposable_after, id]

foreign_keys:
  - column: department_id
    references: departments
    on_delete: no_action          # 文書が残る限り部署の行は消せない
  - column: author_id
    references: staffs
    on_delete: no_action          # 起案者が抜けても文書の履歴は残す
  - column: archived_by
    references: staffs
    on_delete: no_action          # 書庫へ入れた人の記録も残す

# **INV-DOCUMENT-002 の執行点は行の CHECK である**(束 ㉖)。
# 式は `formal` から反映される(`lib/sql/check-expression.ts`。`rule` は書かない —— 式の正は
# invariant_spec 1 か所である)。束 ㉓ の時点で置けなかったのは、**保管日時を書く手順を
# 宣言できなかった**からで、行の CHECK を置くと `document.archive` そのものが失敗していた。
# `records_time`(review-queue §16 の 1-A)を買ったいま、保管の遷移は 1 文で 3 列とも動かす
# ので**複数の手順で満たす不変条件ではなくなった** —— コミット時評価の制約トリガは要らない。
checks:
  - name: documents_archive_sync
    invariant: INV-DOCUMENT-002

# 作成の冪等な再送で既存の行を返すのは、作成者(author_id = 起案者)が実行者の行だけ
resend:
  returns_existing: true
  creator: author_id

functions:
  - name: insert_document
    args: [uuid, uuid, uuid, text, text, timestamptz, uuid, "text[]"]
    params: [p_id, p_department_id, p_author_id, p_title, p_summary, p_disposable_after, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260922100001_rpc_insert_document.sql
    also_writes: {domain_events: [insert]}
  - name: update_document
    args: [uuid, text, jsonb, uuid, "text[]", "text[]"]
    params: [p_document_id, p_expected_state, p_changes, p_actor_id, p_actor_roles, p_effects]
    kind: rpc
    shape: update
    migration: 20260922100002_rpc_update_document.sql
    also_writes: {domain_events: [insert], jobs: [insert]}
  # 汎用の 7 引数に p_archived_by uuid を 1 つ足した形(書庫へ入れる遷移だけが書く列)。
  - name: apply_document_transition
    args: [uuid, text, text, "text[]", text, uuid, "text[]", uuid]
    params: [p_document_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles, p_archived_by]
    kind: rpc
    shape: transition
    migration: 20260922100003_rpc_apply_document_transition.sql
    also_writes: {jobs: [insert], domain_events: [insert]}
  - name: delete_document
    args: [uuid, text, uuid, "text[]"]
    params: [p_document_id, p_expected_state, p_actor_id, p_actor_roles]
    kind: rpc
    shape: delete
    migration: 20260922100004_rpc_delete_document.sql
    also_writes: {domain_events: [insert]}

test_cases:
  - id: TC-TABLE-DOCUMENTS-001
    type: integration
    covers: [success]
    spec_ids: [table-documents]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::documents の宣言どおりの実体だけが DB にある
  # 部署の境界の見張りテスト(T4)。束 ㉒ の前は**この表の `world` を宣言から作れなかった**ので、
  # 注釈を手書きの統合テストで置き直していた。いまは staffs と同じく生成物の it が同じ名前で
  # 出る(`fixture` は仕様だけを持つので、ここでは注釈を手で置く)。
  - id: TC-TABLE-DOCUMENTS-002
    type: integration
    covers: [forbidden]
    spec_ids: [document-access]
    implementation: "app/src/infrastructure/__tests__/generated/rls/documents.rls.test.ts::documents は実行者の department_id 以外の行を返さない"
  - id: TC-DDL-DOCUMENTS-001
    type: integration
    covers: [success]
    spec_ids: [table-documents]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::documents の列と制約が宣言どおりである
  - id: TC-TABLE-DOCUMENTS-003
    type: integration
    covers: [success]
    spec_ids: [table-documents]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::documents の RPC が宣言どおりの本文である
---

# documents — 文書のテーブル実装

- archived_by の on delete を cascade にしない — 書庫へ入れた人の行が消えても、入れた事実は残す。
- 保管日時に列の既定値を置かない — 値を打つのは書庫へ入れる遷移であり、DB に二つ目の正を作らない。

<!-- 残差だった箇所(束 ㉒ で条件式が `formal` に載り、束 ㉖ で執行点が生えた)。
     `documents_archive_sync` は長いあいだ CHECK の**名前だけ**の宣言で、条件式は DDL に
     反映されていなかった。いまは `invariant` だけを宣言する行として式まで生成され、実 DB に
     実在する(`ddl-parity` の閉世界が名前を、`prove:checks` が正準表記を見る)。 -->

<!-- AUTO-GENERATED:data-table-body -->
<!-- /AUTO-GENERATED:data-table-body -->
