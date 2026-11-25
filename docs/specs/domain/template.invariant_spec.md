---
doc_type: invariant_spec
scope: common
id: "{aggregate}-invariants"      # 例: entry-invariants。ファイル名は {aggregate}/invariants.md 固定

invariants:
  # --- type: uniqueness — where 付きユニーク制約 ---
  - id: "INV-{ENTITY}-001"
    statement: "{不変条件を日本語の平文で。人間のレビュー対象}"
    entities: ["{entity_name}"]   # 関与するエンティティ。集約をまたぐ場合は主たる集約側に置き、ここで宣言する
    formal:
      type: uniqueness
      keys: ["{field}", "{field_2}"]
      where: "state not in [{state_id}, {state_id_2}]"   # 任意。関連エンティティの状態も参照してよい
    enforced_by:
      # 1 つ以上必須（V10）。kind は db_constraint / trigger / guard / application。
      # 検証器は「宣言があること」と「ref の実在」を機械チェックし、テスト義務を発行する。
      - kind: db_constraint       # Postgres の部分ユニークインデックス
        ref: "{index_name}"
      - kind: guard               # アプリ側の早期エラー（UX 用）
        ref: "{machine}.{event}"

  # --- type: cardinality — 親に対する子の数の上限 ---
  - id: "INV-{ENTITY}-002"
    statement: "{例: 1 人の利用者が同時に持てる返却前の貸出は上限数までである}"
    entities: ["{entity_name}"]
    # involves: ["{other_entity}"]  # 任意。別集約の行数を数える/参照する不変条件だけ書く。
    #   書かないと A7 がその別集約の create / delete / 全遷移に義務を配れない(義務の穴)。
    formal:
      type: cardinality
      keys: ["{parent_fk}"]       # 複合キー（group-by）を書いてよい。例: [event_id, gender]
      max: "{n または parent.field}"   # リテラル、または親エンティティのフィールド参照（例: patron.loan_limit）
      where: "state == {state_id}"
    enforced_by:
      - kind: trigger
        ref: "{trigger_name}"

  # --- type: state_dependency — A.state が X なら関連する B.state は Y に限る ---
  - id: "INV-{ENTITY}-003"
    statement: "{例: 蔵書が除籍済みなら、その貸出は返却済みか取消しのいずれかである}"
    entities: ["{entity_a}", "{entity_b}"]
    formal:
      type: state_dependency
      if: "{entity_a}.state == {state_id}"
      then: "{entity_b}.state in [{state_id}, {state_id_2}]"
    enforced_by:
      - kind: application
        ref: "{pure_function_name}"

  # --- type: check — 1 レコード内で常に成り立つ条件（行内制約）---
  - id: "INV-{ENTITY}-004"
    statement: "{例: 返却期限は貸出日時より後でなければならない}"
    entities: ["{entity}"]
    formal:
      type: check
      expr: "{entity}.{field_a} < {entity}.{field_b}"
    enforced_by:
      - kind: db_constraint
        ref: "{check_constraint_name}"      # Postgres CHECK 制約
      - kind: application
        ref: "{zod_schema_name}"            # zod refine（フォームの早期エラー）
---

<!--
記入ガイド

- プレースホルダ（"{...}" で囲まれた部分）は実値に置き換え、引用符は不要になったら外す。
- formal.type は閉じた集合（v1）: uniqueness / cardinality / state_dependency / check。
  上の 3 ブロックから該当するものだけを残し、不要なものは削除する。
- where 句で関連エンティティの状態を参照してよい。ただしその場合、DB の部分ユニークインデックス
  だけでは守れないため、enforced_by は trigger または application になる。その事実を宣言で示すこと。
- 「不変条件を書いたのに何も守っていない」を防ぐため、enforced_by は 1 つ以上必須（V10）。
  ref は実在するインデックス名 / イベント ID / 関数名でなければならない。
- 集計を含む制約（合計時間の上限など）は DSL で formal に書けない。
  その場合は formal を省略し、statement + enforced_by: { kind: application, ref: 純粋関数名 } を書く。
  制約のロジックは operation 内の純粋関数に隔離し、そこにテストを書く義務が発行される。
- 集約をまたぐ不変条件は、主たる集約側の invariants.md に置き、entities で関与を宣言する。
- **別集約の行数を数える/参照する不変条件は involves も書く**（entities だけでは足りない）。
  involves に挙げた集約の create / delete / 全遷移に、A7 が covers: invariant の義務を配る。
  書かないと、その別集約の create / delete が野放しになり得る（例: INV-LOAN-002）。
- 本文の手書き散文は**標識**2種だけ（各 1〜3 行）: 否定（検討して捨てた代替案）と線引き（ここでは
  やらないの宣言）。事実の可読形は生成ブロックが担う（手書きで再記述しない）。YAML コメントは
  行ローカルの短注（1 行）のみ。経緯は NOTES へ。
-->

# {集約名（日本語）}の不変条件

<!-- AUTO-GENERATED:invariant-table -->
<!-- 不変条件一覧表（ID・statement・formal・執行点・テスト義務）がここに生成される。手書きしない。 -->
<!-- /AUTO-GENERATED:invariant-table -->
