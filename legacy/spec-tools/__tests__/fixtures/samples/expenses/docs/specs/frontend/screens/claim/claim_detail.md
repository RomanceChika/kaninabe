---
doc_type: screen_spec
scope: frontend
id: screen-claim-detail

name: claim_detail
label: 申請詳細
route: /claims/:id
for: [employee]
requires_auth: true

subject: claim

reads: [query-claim-detail]
actions: [claim.update, claim.submit, line.create, line.update]
# claim.delete / line.delete は overlays 側にのみ書く(消したら戻らない = 確認を挟む)

navigations:
  - on: back_link
    to: screen-claim-list

overlays:
  # 申請の削除は物理削除で、申請者の個人データごと消える(U1)
  - id: claim_delete_confirm
    layout:
      body:
        center: [confirm_bar]
    opened_by: claim_edit_form      # 下書きの編集フォームの中の「削除」ボタンが開く
    actions: [claim.delete]
    closes_on: [claim.delete.success, cancel]
  # 明細の削除も物理削除で、金額の記録が消える(U1)
  - id: line_delete_confirm
    layout:
      body:
        center: [confirm_bar]
    opened_by: line_table           # 明細の行の中の「削除」ボタンが開く
    actions: [line.delete]
    closes_on: [line.delete.success, cancel]

layout:
  header:
    - page_title:
        label: 申請詳細
  body:
    center:
      - claim_summary
      - variants:
          editable: claim_edit_form
          readonly: claim_readonly_panel
      - line_table
    right:
      - line_form

states:
  requires: [loading, error, not_found]

test_cases:
  - id: TC-SCREEN-CLAIM_DETAIL-001
    type: unit
    covers: [success]
    spec_ids: [screen-claim-detail]
    implementation: app/src/app/__screens__/claim-detail.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-CLAIM_DETAIL-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-claim-detail]
    implementation: app/src/app/__screens__/claim-detail.test.tsx::未ログインはログイン画面へ送られる
  - id: TC-SCREEN-CLAIM_DETAIL-003
    type: unit
    covers: [other]
    spec_ids: [screen-claim-detail]
    implementation: app/src/app/__screens__/claim-detail.test.tsx::下書きでない申請では編集フォームが出ない
---

# 申請詳細（claim_detail）

- variants のどちらが出るかの条件は書かない — 書くと画面が access_spec の when を再定義してしまう。
- 承認・支払いの操作はこの画面に置かない(立場の違う人の動線は review_queue が持つ)。

<!-- AUTO-GENERATED:screen-body -->
<!-- /AUTO-GENERATED:screen-body -->
