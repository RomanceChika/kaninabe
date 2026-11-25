---
doc_type: usecase_spec
scope: frontend
id: usecase-file-document
name: file_document
goal: 文書を起案して供覧に出す
actor: staff
start: screen-document-list
done: document.state == circulating

saves:
  - id: file
    label: 起案して供覧に出す
    migration: 20260922090000_usecase_file_document_file.sql
    steps:
      - op: document.create
        label: 文書の内容
      - op: document.circulate
        label: 供覧に出す

test_cases:
  - id: TC-USECASE-FILE_DOCUMENT-001
    type: integration
    covers: [success]
    spec_ids: [usecase-file-document]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::file_document.file の複合 RPC が宣言どおりの署名で実在する
  - id: TC-USECASE-FILE_DOCUMENT-002
    type: integration
    covers: [success]
    spec_ids: [usecase-file-document]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::file_document.file の複合 RPC の本文が生成物と一致する
  # 保存点の decide ⇔ 複合 RPC の一致の証明も生成物。注釈もここが生成する
  # AUTO-GENERATED:usecase-eq-tests
  # /AUTO-GENERATED:usecase-eq-tests
---

# 文書を起案して供覧に出す（file_document）

- 書庫へ入れる手順（document.archive）は入れない — 保管は供覧が済んでからの別の判断であり、1 つの保存点にまとめると「起案した瞬間に棚へ入る」形になる。
- 所管部署を選ばせない — 起案できるのは自分の部署の文書だけ（access.md の `creates[].when`）なので、選ぶ余地が無い。

<!-- residue: **`defaults.self`(「自分として」)を書けない。** 起案者は実行者そのものなので
     `document.author_id` は「自分として」で埋まるはずだが、この宣言は**実行者を指す参照欄が
     集約にちょうど 1 本のときしか使えない**(Y8)。保管の形は「誰が書庫へ入れたか」を
     記録する欄(`archived_by`)を要求するので、`ref(staff)` の欄が 2 本になり、
     「自分として」が何を埋めるか決まらなくなった。
     迂回は「必須で入力に無い実行者への参照は作成者で埋まる」作成の規約である(起案者は入力で受けない —
     入力で受けると、起こした社員が他人を起案者に据えられる。R2 が止める形)。
     (入力に出した実行者の参照の欄は、作成の RPC と engine が実行者に縛る —— 代理の宣言 delegate の無い規則では UC403)。
     残差: **論理削除・保管の形を足したことが、無関係に見える別の宣言(自分として)を
     使えなくした。** 空かどうかの語彙とは別筋だが、同じ「保管の 2 欄」が原因である。 -->
