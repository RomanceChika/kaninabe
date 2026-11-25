---
doc_type: data_table
scope: backend
id: table-loans

table: loans
entity: loan

# RLS の select ポリシー全数は access_spec の reads から生成する
policies_migration: 20260912110103_policies_loans.sql

# 表の DDL（列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on）は
# entity_spec と この宣言から生成する
ddl_migration: 20260912120204_ddl_loans.sql

# 外から届く `surface` のビュー(列は entity_spec、隠し列は access_spec の fields_hidden が正)
surface_migration: 20260912130103_api_view_loans.sql

indexes:
  - name: loans_active_item_unique
    on: [item_id]
    unique: true
    where: "(state <> 'returned'::text)"
    invariant: INV-LOAN-001
  # loan_own_list(スコープ条件 patron_id で絞り、state の filters / sort: due_at asc, id asc = 順方向)と
  # loan_own_history(同じ絞りで sort: due_at desc, id desc = 同じ索引の逆方向の走査)用
  - name: loans_patron_id_state_due_at_id_idx
    on: [patron_id, state, due_at, id]
  # loan_desk_list(filters: state / sort: due_at, id)用
  - name: loans_state_due_at_id_idx
    on: [state, due_at, id]

foreign_keys:
  - column: item_id
    references: items
    on_delete: no_action          # 貸出の記録がある限り蔵書の行は消せない
  - column: patron_id
    references: patrons
    on_delete: no_action

# 列の既定値。due_at は entity_spec の supplied_by: db の機構である(V17)——
# 値は now() だけから決まるので、列の既定値が書ける(同じ行の別の列は読めない)
defaults:
  due_at: "(now() + '14 days'::interval)"

# 作成の冪等な再送で既存の行を返さない。patron_id は入力で受ける(司書が利用者の名義で貸す)ので
# 「作った人」の欄にならない。同じ id があれば競合
resend:
  returns_existing: false

functions:
  - name: insert_loan
    args: [uuid, uuid, text, uuid, uuid, "text[]"]
    params: [p_id, p_item_id, p_expected_item_state, p_patron_id, p_actor_id, p_actor_roles]
    kind: rpc
    shape: create
    migration: 20260912100005_rpc_insert_loan.sql
    also_writes: {domain_events: [insert]}
  - name: apply_loan_transition
    args: [uuid, text, text, "text[]", text, uuid, "text[]"]
    params: [p_loan_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles]
    kind: rpc
    shape: transition
    migration: 20260912100006_rpc_apply_loan_transition.sql
    also_writes: {domain_events: [insert], jobs: [insert]}

# residue: これらの不変条件の執行点(トリガ)は**一度も実在していない**。束 ㉖ で
# 「条件を課すトリガの本文を `formal` から生成する」を入れたが、**この不変条件は反映されない**
# —— INV-LOAN-002 は `formal.type: cardinality`(貸出中の冊数の上限)であり、行の式に写せない
# (数えるのは行の外である)。実在しない執行点の行は置かない(束 CHECK 生成の裁定)。
# 不変条件の `enforced_by` は残してあり、T16 (e) が「実在しない執行点である」と
# warning で報告し続ける。
test_cases:
  - id: TC-TABLE-LOANS-001
    type: integration
    covers: [success]
    spec_ids: [table-loans]
    implementation: app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::loans の宣言どおりの実体だけが DB にある
  - id: TC-DDL-LOANS-001
    type: integration
    covers: [success]
    spec_ids: [table-loans]
    implementation: app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::loans の列と制約が宣言どおりである
  - id: TC-TABLE-LOANS-002
    type: integration
    covers: [success]
    spec_ids: [table-loans]
    implementation: app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::loans の RPC が宣言どおりの本文である
---

# loans — 貸出のテーブル実装

- item_id の on delete を cascade にしない — 貸出の履歴が蔵書の行を守る。
- 返却期限は列の既定値である — 値は `now()` だけから決まるので、逆算の規則も日数(14)もこの 1 つの式に収まる。**トリガにしない**: `kind: trigger` の本文は生成物ではないので、生成物だけで空の DB から立ち上げる系では誰も埋めない(束 ③-2 の実測。同じ行の**別の列**から逆算する値だけがトリガに残る)。

<!-- AUTO-GENERATED:data-table-body -->
### 対応

| 項目 | 値 |
| --- | --- |
| テーブル | `loans` |
| 対応する entity_spec | `loan` |
| 読み取りポリシー | 正は access_spec の reads(生成: rls-expectations.ts。ここには書かない) |

### インデックス(主キー以外の全数)

| 名前 | 列 | 一意 | 部分(where) | 由来 |
| --- | --- | --- | --- | --- |
| `loans_active_item_unique` | item_id | unique | `(state <​> 'returned'::text)` | INV-LOAN-001 |
| `loans_patron_id_state_due_at_id_idx` | patron_id, state, due_at, id | — | — | query: loan_own_history, loan_own_list |
| `loans_state_due_at_id_idx` | state, due_at, id | — | — | query: desk_loan_list |

### 採番の器

ありません。

### 排他制約

ありません。

### 外部キー(全数)

| 列 | 参照先 | on delete |
| --- | --- | --- |
| item_id | `items` | no_action |
| patron_id | `patrons` | no_action |

### トリガ

ありません。

### 関数の帰属(この表を持ち場とする public スキーマの関数)

| 関数 | 引数型 | 引数名 | 種別 | 形 | 併せて書く表 |
| --- | --- | --- | --- | --- | --- |
| `insert_loan` | uuid, uuid, text, uuid, uuid, text[] | p_id, p_item_id, p_expected_item_state, p_patron_id, p_actor_id, p_actor_roles | rpc | create | domain_events（insert） |
| `apply_loan_transition` | uuid, text, text, text[], text, uuid, text[] | p_loan_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles | rpc | transition | domain_events（insert）, jobs（insert） |

### CHECK(entity_spec の導出でないもの)

ありません(長さ・範囲・状態集合の CHECK は entity_spec / state_spec からの導出)。

### テストケース

| ID | type | covers | spec_ids | implementation |
| --- | --- | --- | --- | --- |
| TC-TABLE-LOANS-001 | integration | success | table-loans | `app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::loans の宣言どおりの実体だけが DB にある` |
| TC-DDL-LOANS-001 | integration | success | table-loans | `app/src/infrastructure/__tests__/schema/ddl-parity.test.ts::loans の列と制約が宣言どおりである` |
| TC-TABLE-LOANS-002 | integration | success | table-loans | `app/src/infrastructure/__tests__/schema/rpc-parity.test.ts::loans の RPC が宣言どおりの本文である` |
<!-- /AUTO-GENERATED:data-table-body -->
