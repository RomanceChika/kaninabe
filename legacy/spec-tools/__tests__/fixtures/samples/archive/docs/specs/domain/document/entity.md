---
doc_type: entity_spec
scope: common
id: document-entity
entity: document
label: 文書
context:
  document: document.id            # 自分自身(document_author の binding の解決用)
  department: document.department_id  # 所管部署(可視性の境界)
  staff: document.author_id        # 起案者
fields:
  - name: id
    type: uuid
    auto: true
    label: 文書ID
    description: 文書ID
    personal: false
  - name: department_id
    type: ref(department)
    required: true
    label: 所管部署
    description: この文書を所管する部署
    personal: false
  - name: author_id
    type: ref(staff)
    required: true
    label: 起案者
    description: この文書を起こした職員
    personal: false
  - name: title
    type: string
    required: true
    max_length: 120
    label: 標題
    description: 文書の標題
    personal: false
  - name: summary
    type: string
    max_length: 400
    label: 要旨
    description: 一覧に添える要旨(書かなくてよい)
    personal: false
  - name: disposable_after
    type: datetime
    required: true
    label: 廃棄可能日時
    description: 保存年限が切れる時点。起案のときに文書分類から決めて入れる(この時点を過ぎた保管文書だけ廃棄できる)
    personal: false
  - name: archived_at
    type: datetime
    label: 保管日時
    description: 書庫へ入れた日時。保管していない文書では空である
    personal: false
  - name: archived_by
    type: ref(staff)
    label: 保管した職員
    description: 書庫へ入れた文書管理者。保管していない文書では空である(保管の遷移が記録する)
    personal: false
  - name: state
    type: state(document)
    label: 文書の状態
    description: 文書の状態(states.md が正)
    personal: false
---

# 文書(document)

- 版の鎖(前の版への参照)は持たない — 改訂は新しい文書を起こす運用であり、鎖を持つと「現行版は 1 つ」の一意性がもう 1 本増える。
- 本文そのもの(ファイル)は持たない — 添付の権限と行の権限の同期はこの版の線の外であり、ここが預かるのは目録だけである。

<!-- 残差だった箇所(束 ㉑ で測り、束 ㉒ で閉じた)。
     「保管日時が空である」は `document.archived_at is null` と書きたかったが、ガード式の原子に
     その形が無かった。迂回は P-7(空かどうかを状態にする)で、状態 `archived` がその意味を
     運ぶ —— それでも保管日時そのものは業務上要る(**棚卸しの一覧に出す** —— 保存年限の起算点
     ではない。廃棄可能日時は起案のときに文書分類から決まっている)ので列は消えず、
     「状態 ⇔ 列」の同値が新しい不変条件(INV-DOCUMENT-002)として残った。
     いまはその 1 本が `formal` に書けている(`archived_by` も同じ 1 本が受け持つ ——
     `records_actor` / `clears` が**書く側**、`is null` が**読む側**である)。 -->

<!-- residue: summary(要旨)も空になりうる欄だが、空に業務上の意味は無い(書かなかっただけ)。
     この欄については何の宣言も要らない —— 「空になりうるが何も問わない欄」の対照として残す。 -->

<!-- AUTO-GENERATED:field-table -->
<!-- /AUTO-GENERATED:field-table -->
