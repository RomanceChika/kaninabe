---
doc_type: invariant_spec
scope: common
id: document-invariants
invariants:
  - id: INV-DOCUMENT-001
    statement: 同じ部署の中で、同じ標題の文書は同時に1件しか存在しない(書庫へ入れたものは数えない)
    entities: [document]
    formal:
      type: uniqueness
      keys: [department_id, title]
      # 書庫へ入れた文書は標題を占有しない —— 占有させると「新しい鍵の受け渡し手順」を
      # 下ろした日から保存年限が切れるまで、同じ標題で起こせなくなる。
      # **ここは `is null` が要らない場所である** —— 「保管した(= archived_at が空でない)」を
      # P-7 が状態に畳んでくれているので、状態の比較 1 本で書ける(§畳めば済んだ 2 件目)。
      where: state != archived
    enforced_by:
      - kind: db_constraint
        ref: documents_department_title_unique
  - id: INV-DOCUMENT-002
    # 「保管日時が空であること」と「状態が保管でないこと」は同値である、という条件付き必須の
    # 対である。P-7(空かどうかを状態に持つ)は**すでに当ててある** —— 状態 archived がその
    # 意味を運んでいる。それでも列は消えない(保管日時そのものが棚卸しの一覧に要る)ので、
    # 状態と列の同値が残った。**この 1 本のために `is null` を買った**(束 ㉒。
    # 設計: docs/design/null-literal-purchase.md)。同値は 2 本の含意に割って書く ——
    # 括弧は文法に無いが、and は or より強く結合するので 1 本の式で足りる。
    statement: 書庫に入っている(保管)ことと、保管日時および保管した職員が記録されていることは同値である
    entities: [document, staff]
    formal:
      type: check
      expr: document.state == archived and document.archived_at is not null and document.archived_by is not null or document.state != archived and document.archived_at is null and document.archived_by is null
    # **執行点は行の CHECK である**(束 ㉖。それまでは実在しなかった)。式は束 ㉓ の時点でも
    # 行の CHECK に写せたのに置けなかった —— 「保管日時を書くのがこの遷移である」と宣言できず、
    # CHECK を置くと `document.archive` そのものが失敗したからである(残差の型 (a))。
    # `records_time` を買ったいま、保管の遷移は 1 文で 3 列とも動かすので
    # **複数の手順で満たす不変条件ではない** —— コミット時評価の制約トリガは要らない。
    enforced_by:
      - kind: db_constraint
        ref: documents_archive_sync
---

# 文書の不変条件

- 「廃棄可能日時は起案の時点より後」は不変条件にしない — 起案の時点を列に持っておらず、比べる相手がこの行に無い。

<!-- 測定の記録(束 ㉑ で残差として測り、束 ㉒ で閉じた)。
     INV-DOCUMENT-002 が `formal` を持てなかったあいだ、この題材では
     (1) V9 / V10 の充足性判定・V21 の有界到達性がこの条件を 1 つも知らず
     (2) documents は「`world` を宣言から作れない表」になり(T8)、RLS の挙動テストと
         engine ⇔ RPC の一致の証明が 1 本も生成されず(T11)
     (3) 部署の境界の見張りテスト(T4)も生成されないので、注釈を手書きの統合テストで
         置き直していた。
     **この表を塞いでいた理由はちょうど 1 件だった** —— 題材の製品の 2 表(entry_participants /
     inquiries)は別の理由(参照の 3 段目 / 件数の上限)も同時に塞いでいたので、
     `is null` を買っても生成テストは 1 本も増えない。この題材ではそうではなく、
     買った結果として上の 3 つがそのまま生えた。 -->

<!-- AUTO-GENERATED:invariant-table -->
<!-- /AUTO-GENERATED:invariant-table -->
