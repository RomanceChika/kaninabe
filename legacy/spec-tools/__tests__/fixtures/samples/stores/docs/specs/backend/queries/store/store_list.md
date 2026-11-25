---
doc_type: query_spec
scope: backend
id: query-store-list

name: store_list
for: [staff_member]
source: store
scope_used: all
returns: many

sort:
  - name asc

paging: none
bounded_by:
  parent: company
  reason: 1 会社の店舗数は契約で決まり、数十件を超えない

projection:
  - id
  - name
  - manager_id

test_cases:
  - id: TC-STORE-STORE_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-store-list]
    implementation: app/src/composition/__tests__/store/store_list.test.ts::従業員は店舗の一覧を読める
  - id: TC-STORE-STORE_LIST-002
    type: integration
    covers: [other]
    spec_ids: [store-access]
    implementation: app/src/composition/__tests__/store/store_list.test.ts::未ログインでは 1 件も返らない
---

# 店舗の一覧(store_list)

- 会社で絞る条件はこのクエリに書かない — テナント境界は access_spec の `reads[].filters`(`company_id: actor.company_id`)が持ち、RLS の側で閉じている(束 ⑲-2a)。可視性の境界を 2 か所に書くと、片方だけが動いたときに気づけない。
- 件数の上限(paging)は置かない — 1 会社の店舗は数十件であり、切ると「切ってよい行」の判断が要る。

<!-- AUTO-GENERATED:query-body -->
<!-- /AUTO-GENERATED:query-body -->
