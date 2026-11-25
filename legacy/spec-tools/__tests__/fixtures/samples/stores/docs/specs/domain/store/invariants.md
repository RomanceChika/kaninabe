---
doc_type: invariant_spec
scope: common
id: store-invariants
invariants:
  - id: INV-STORE-001
    statement: 同じ会社の中で店舗名は重複しない
    entities: [store]
    formal:
      type: uniqueness
      keys: [company_id, name]
    enforced_by:
      - kind: db_constraint
        ref: stores_company_name_unique
  - id: INV-STORE-002
    statement: 店舗責任者は、その店舗を持つ会社に属する従業員でなければならない(責任者が会社を跨がない)
    entities: [store, staff_member]
    formal:
      type: check
      expr: store.company_id == staff_member.company_id
    enforced_by:
      - kind: trigger
        ref: check_store_manager_company                   # 店舗の側(責任者の付け替え・店舗の会社の変更)
      - kind: trigger
        ref: check_store_manager_company_on_staff_member   # 責任者の側(従業員が別の会社へ移る)
---

# 店舗の不変条件

- INV-STORE-002 の `check` は**別集約の列との一致**である — `context` の `staff_member: store.manager_id` で相手に届くので `expr` に書ける(行の中だけで閉じないので執行点はトリガ)。
- 執行点は**両端に 1 本ずつ**のコミット時評価の制約トリガで、本文は `expr` から生成される。店舗の側は責任者の付け替えと店舗の会社の変更を、責任者の側は従業員が別の会社へ移るのを見る(どちらか片側だけだと、守っていない側から条件が破れる — T17 が両端の宣言を求める)。比較する列が空(NULL)で相手の行が在れば拒否する。

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
