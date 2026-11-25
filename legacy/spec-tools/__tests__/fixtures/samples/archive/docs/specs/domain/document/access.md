---
doc_type: access_spec
scope: common
id: document-access
entity: document
reads:
  - by: anonymous
    scope: none
  - by: staff
    scope: all                                        # 所管部署の文書は部署の全員が引く
    filters: { department_id: actor.department_id }   # 他部署の文書は返らない(部署の境界)
    when: document.state != archived                  # 書庫へ下ろした文書は一般の社員の目に入らない
  - by: curator
    scope: all                                        # 書庫の棚卸しのため、保管した文書まで引く
    filters: { department_id: actor.department_id }   # 文書管理者も部署ごとに置かれる
    # `when` は書かない —— 書庫を見るのが文書管理者の役目である(条件を持たない = 保管も見える)
  - by: document_author
    scope: none                                       # 起案者も staff として読む(自分の文書だけを狭く見る経路は無い)
  - by: system
    scope: all
creates:
  - by: staff
    when: document.department_id == actor.department_id  # 他部署の文書は起こせない(部署の境界)
    self_assign:
      - field: document.author_id
        role: document_author
        by: [staff]
        reason: 文書を起こした職員がその文書の起案者になる(document.create の owner)。得るのは自分が起こした文書の起案者の操作だけ
writes:
  - by: document_author
    fields: [title, summary]
    when: state == drafting and document.department_id == actor.department_id   # 供覧に出したら本人も直せない・他部署の文書は直せない(部署の境界)
# 人の操作としては現れない列。保管日時を書くのは**書庫へ入れる遷移**であり、
# 空にするのは**書庫から出す遷移**である(states.md の records_actor / clears が宣言する)。
# どの状態から書けるかの正は state_spec の `from` である。この宣言は編集の経路を作らない。
transition_writes: [archived_at, archived_by]
deletes:
  - by: curator
    when: state == archived and now > document.disposable_after and document.department_id == actor.department_id   # 保存年限の切れた自部署の保管文書だけ廃棄できる(部署の境界)
---

# 文書のアクセス権限

- **廃棄(物理削除)は「保管してから保存年限が切れたもの」だけに開く。** 供覧中の文書を消す口は無い —— 消えてよいのは書庫の棚から出す判断を一度経たものだけである。
- 起案者に `scope: own` を与えない — 自分の文書だけを見る読み取り経路が無いので、狭いスコープを宣言しても誰も使わない(T7 が食い違いをエラーにする)。
- **「保管した文書は一般の社員の目に入らない」は可視性の条件(`when`)で宣言する。** 3 つの軸が別のことを答えている —— `scope: all` が「原理としてどの行か」、`filters` が「実行者の部署の中だけ」、`when` が「棚に出ている文書だけ」である。文書管理者の行に `when` が無いことが、そのまま「書庫を見るのは文書管理者だけ」の宣言になる。

<!-- 残差だった箇所(束 ㉑ で測り、束 §14 で閉じた)。
     ここは「保管した文書を隠しているのは読み取り経路 1 本の `filters` だけ」であり、
     **文書 ID を知っていれば 1 件引き(query-document-detail)から一般の社員に返っていた**。
     `reads[].when` を買って、RLS の `using` に状態の条件が入るようになった —— 経路を
     何本足しても、保管した文書は staff の上界そのものに含まれない
     (設計: docs/design/triage-reads-when.md)。 -->

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
