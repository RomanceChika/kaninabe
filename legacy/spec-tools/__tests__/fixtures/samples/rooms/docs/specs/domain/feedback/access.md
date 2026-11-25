---
doc_type: access_spec
scope: common
id: feedback-access
entity: feedback
reads:
  - by: anonymous
    scope: none
  - by: user
    scope: none
  - by: system
    scope: all
  - by: booking_owner
    scope: none                   # booking 文脈のロール
  - by: department_admin
    scope: none                   # department 文脈のロール
creates:
  - by: anonymous                 # 【検査の足場】未ログインの作成の正例(R5。全体の天井があれば通る。負例・変異はこの行を壊す)
    abuse:
      global_ceiling: { max: 50, per: 1 hour }
deletes:
  - by: anonymous                 # 【検査の足場】未ログインの削除の正例(R5-5。理由があれば通る。変異 drop_public_reason はこの理由を消す)
    public: 検査の足場。未ログインに削除を開けることを意図して受け入れている
---

# 会議室への匿名の意見のアクセス権限

- 読めるのはシステムだけ — 匿名の意見は誰にも見せず、集計の入力にだけ使う想定である。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
