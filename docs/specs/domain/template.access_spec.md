---
doc_type: access_spec
scope: common
id: "{aggregate}-access"          # 例: entry-access。ファイル名は {aggregate}/access.md 固定
entity: "{entity_name}"           # entity_spec の entity と一致させる

reads:
  # 全ロールについて明示必須（V4: 全域性）。roles.md に定義した全ロールの行を書く。
  # 見せないロールにも scope: none を書く。書き忘れは「公開」ではなく検証エラーになる。
  # scope は閉じた集合: own / context(entity) / all / none
  - by: "{role_id}"
    scope: own                    # 自分が当事者であるレコードのみ
  - by: "{role_id_2}"
    scope: "context({entity})"    # entity_spec の context で解決される親を通じて見える範囲
  - by: patron
    scope: none
  - by: anonymous
    scope: none
  - by: system
    scope: all

fields_hidden:
  # スコープ内でも隠すフィールド（任意）。不要なら削除する。
  - field: "{field_name}"
    from: ["{role_id}"]

creates:
  # 新規作成の権限（任意）。不要なら削除する = 誰も作れない（deny by default）。
  # 「誰が作れるか」は業務の意味なのでここが正。action_spec には書かない。
  # 作成後の状態は書かない（state_spec の initial で生まれる）。
  # フィールドの制約も書かない（entity_spec が正）。
  - by: "{role_id}"
    when: "{entity}.state == {state_id}"   # 任意。ガード式（作成の前提条件）
  # 未ログインのロール(kind: anonymous)の作成には全体の天井が要る(R5)。毎回違う鍵で送られても効く、表への作成の全部を数える天井。
  #   - by: anonymous
  #     abuse: { global_ceiling: { max: 30, per: 1 hour }, per_key: { column: sender_email, max: 5, per: 1 hour } }
  # 未ログインの writes / deletes(と states.md の by)は、意図して開けているときだけ、その規則に public: 理由 を書く。

writes:
  # 状態遷移によらないフィールド更新の権限（任意）。
  # 状態遷移の権限は states.md の by が持つ。ここは「状態を変えない編集」だけ。
  # writes に現れないフィールド × ロールは編集不可（deny by default）。
  # auto: true のフィールドと state 型のフィールドは対象にできない。
  - by: "{role_id}"
    fields: ["{field_name}", "{field_name_2}"]
    when: "state == {state_id}"   # 任意。ガード式（状態・フィールド条件）
  - by: "{role_id_2}"
    fields: ["{field_name}"]
    when: "state in [{state_id}, {state_id_2}]"

# 遷移だけが書く列（任意）。states.md の records_actor / records_time / clears が書く列をここに並べる（V19）。
# ロールを持たず、編集の経路を作らない。writes の by: system は「内部実行の入口が編集で書く」許可であり、この印には使わない。
transition_writes: ["{field_name}"]

deletes:
  # 物理削除の権限（任意）。不要なら削除する = 誰も消せない（deny by default）。
  # creates と対称。「誰が消せるか」は業務の意味なのでここが正。action_spec には書かない。
  # 書けるのは行そのものを消す操作だけ。履歴を残す取消し（取下げ・中止）は states.md の遷移。
  - by: "{role_id}"
    when: "state == {state_id}"   # 任意。ガード式（削除の前提条件）
---

<!--
記入ガイド

- プレースホルダ（"{...}" で囲まれた部分）は実値に置き換え、引用符は不要になったら外す。
- 権限は 5 軸に分かれる。混同しないこと。
    遷移  → states.md の by
    読取  → このファイルの reads
    作成  → このファイルの creates
    編集  → このファイルの writes
    削除  → このファイルの deletes
- when のガード式の文法は states.md の guard と同じ（制限式。関数・算術なし）。
- reads の scope は RLS ポリシー生成・突合の単位になる。実際の RLS は第二防衛線として
  supabase 側にも書き、突合リストで整合を確認する。
- ロールを 1 つ増やしたら、すべての access_spec に行を追加する必要がある（V4）。
- 本文の手書き散文は**標識**2種だけ（各 1〜3 行）: 否定（検討して捨てた代替案）と線引き（ここでは
  やらないの宣言）。事実の可読形は生成ブロックが担う（手書きで再記述しない）。YAML コメントは
  行ローカルの短注（1 行）のみ。経緯は NOTES へ。
-->

# {エンティティ名（日本語）}のアクセス権限

<!-- AUTO-GENERATED:access-matrix -->
<!-- ロール × 操作（読取・編集・各遷移）の権限マトリクス表がここに生成される。手書きしない。 -->
<!-- /AUTO-GENERATED:access-matrix -->
