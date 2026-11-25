---
doc_type: state_spec
scope: common
id: document-states
state_machine: document
states:
  - id: drafting
    label: 起案中
  - id: circulating
    label: 供覧中
  - id: archived
    label: 保管
initial: drafting
final: []
events:
  - id: circulate
    label: 供覧に出す
    from: [drafting]
    to: circulating
    by: [document_author, curator]
    guard: document.department_id == actor.department_id   # 他部署の文書は動かせない(部署の境界。curator は部署に依らず立つロールなので行の部署を結ぶ —— V26)
    otherwise_forbidden: 供覧に出せるのは起案中の文書だけ(保管から直接は戻せない)
  - id: archive
    label: 書庫へ入れる
    from: [circulating]
    to: archived
    by: [curator]
    guard: document.department_id == actor.department_id   # 他部署の文書は動かせない(部署の境界。curator は部署に依らず立つロールなので行の部署を結ぶ —— V26)
    # 保管したのが誰かを書き留めるのはこの遷移だけである(復元は書き換えない)。
    records_actor: [archived_by]
    # 保管日時を書くのもこの遷移である。値は「押した瞬間」= SQL の now() なので、
    # RPC の引数は増えない(records_actor とはそこが違う)。
    records_time: [archived_at]
    otherwise_forbidden: 書庫へ入れられるのは供覧中の文書だけ
  - id: restore
    label: 書庫から出す
    from: [archived]
    to: circulating
    by: [curator]
    guard: document.department_id == actor.department_id   # 他部署の文書は動かせない(部署の境界。curator は部署に依らず立つロールなので行の部署を結ぶ —— V26)
    # 書庫から出した文書は「保管していない文書」に戻るので、保管の 2 欄を空にする。
    clears: [archived_at, archived_by]
    otherwise_forbidden: 書庫から出せるのは保管中の文書だけ

effects:
  - on: archive
    do: [notify_author_archived]
---

# 文書の状態

- 終端の状態を持たない — この系の終わりは**行が消えること**(保存年限が切れた保管文書の廃棄 = `deletes`)であって、状態ではない。「廃棄済み」の状態を置くと、消えた文書の目録が永久に残る。
- 「差し戻し」の状態は置かない — 供覧中から起案中へ戻す実例が無く、置くと到達しない遷移が 1 本増える。

<!-- 残差だった箇所(束 ㉑ で測り、束 ㉖ で閉じた)。
     「保管日時(archived_at)を書くのがこの遷移である」は `records_actor` の対である
     `records_time` が宣言する(review-queue §16 の 1-A。設計:
     docs/design/triage-transition-writes-2.md)。**この 1 本のために語を買った** ——
     遷移が自分の行に書く値の種類 6 つのうち、「いま」だけが置き場を持っていなかった。
     買った結果として INV-DOCUMENT-002 は**行の CHECK で足りる**ようになった
     (保管の遷移が 1 文で 3 列とも動かすので、複数手順の不変条件ですらなくなる)。 -->

<!-- AUTO-GENERATED:state-diagram -->
<!-- /AUTO-GENERATED:state-diagram -->

<!-- AUTO-GENERATED:transition-table -->
<!-- /AUTO-GENERATED:transition-table -->

<!-- AUTO-GENERATED:state-event-matrix -->
<!-- /AUTO-GENERATED:state-event-matrix -->
