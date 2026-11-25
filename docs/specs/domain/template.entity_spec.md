---
doc_type: entity_spec
scope: common
id: "{aggregate}-entity"          # 例: entry-entity。ファイル名は {aggregate}/entity.md 固定
entity: "{entity_name}"           # ディレクトリ名と一致させる（単数形・スネークケース）
label: "{日本語名}"               # 任意。集約の表示名（例: 貸出）。ハンドブックの章題・関係図に出る
summary: "{この集約が何かを 1 文で}" # 任意。章頭の 1 文。例: 利用者が蔵書を借りる、貸出の単位です。書き方は domain-spec-writing.md の summary

# display_field: この集約の行を人に名指す欄（任意。fields に居る string / text の欄 1 つ。例: display_field: title）。
# 確認ダイアログの本文（「{値}」{見出し}）と参照の欄の選択肢の表示名がこの欄を引く。書かなければ行の名前は出ない（V22 / S18）。

# table: DB のテーブル名（任意）。既定は entity の複数形化（entry → entries）なので、
# 規則で導けない名前のときだけ書く。例: table: people

# mirror: true … この集約が他の集約の写し（state_spec の effects[].snapshot.to の写像先）であるときだけ書く（任意）。
# 写しの行の削除は破壊的な書き込みに数えない。snapshot.to と双方向で一致し（V12）、creates / writes / deletes は
# system の規則だけにする（V25）。

# context: 文脈依存ロール・ガード式が参照するエンティティの解決パス。
# 「このエンティティの行 1 つから、相手の行 1 つへどう辿るか」を書く。
# 書けるのは自分の ref(...) フィールドを辿る前方参照だけ（相手側の列から自分を指す
# 逆参照は書けない）。ここで解決できないパスを guard / binding / scope: context(...) に
# 書くとエラー（V2 / V11）。
context:
  "{entity}": "{this_entity}.{fk_field}"   # 例: item: loan.item_id（型は ref(item)）

fields:
  # type は閉じた集合のみ:
  #   uuid / string / text / integer / decimal / boolean / date / datetime
  #   / enum([...]) / ref(entity) / state(machine)
  # 制約は required / max_length / min / max / pattern / auto。
  # ここがフィールド制約の唯一の定義場所（zod スキーマ生成の源）。
  # description: 人間向けの説明。YAML コメントはパースで失われるため、
  # 生成されるフィールド定義表に載せたい説明は必ず description に書く。
  # フォーム側にバリデーション仕様を別途書かないこと。
  # personal（全フィールドに必須）: 特定の個人に結びつき、本人が消去を求めうる値か。
  # 表示名・連絡先・自由記述で人について書く欄・本人の属性の申告は true、
  # 金額・状態・順序・日時・タイトル・説明・ref(entity) は false。迷ったら true。
  # personal: true のフィールドは personal_placeholder も必須（文字列、または
  # NOT NULL でない列なら null。一意制約のある列は {id} を含めて行 id に置換）。
  - name: id
    type: uuid
    auto: true                    # auto: true のフィールドは access_spec の writes 対象にできない
    personal: false
  - name: "{fk_field}"            # 例: item_id
    type: "ref({entity})"
    required: true
    personal: false                # ref(entity) は参照先の識別子であり、原則 false
  - name: "{field_name}"          # 例: due_at — 返却期限
    type: string
    max_length: 50
    required: true
    personal: false
  - name: "{field_name_2}"        # 例: renewal_count — 延長した回数
    type: integer
    min: 1
    max: 30
    required: true
    personal: false
  - name: "{field_name_3}"        # 例: note — 司書への連絡事項（自由記述で人について書く欄の例）
    type: string
    max_length: 500
    personal: true
    personal_placeholder: null     # NOT NULL でない列。必須列なら文字列を書く
  - name: state
    type: "state({machine})"      # 状態機械と接続（states.md が定義の正）
    personal: false
    # 直交する軸がある場合は state 型のフィールドを複数持ってよい。
    # 例: review_state / publish_state / archive_state。それぞれ別の state_spec と接続する。
    # 階層状態機械は v1 では使えない。フラットな機械の合成で表現する。
---

<!--
記入ガイド

- プレースホルダ（"{...}" で囲まれた部分）は実値に置き換え、引用符は不要になったら外す。
- entity は集約ディレクトリ名と一致させる。
- context に書いていないエンティティは、この集約のガード式・binding から参照できない。
- context の値は「{自エンティティ}.{フィールド}」の 2 段固定。相手が自分自身でなければ、
  そのフィールドの型は ref({相手}) でなければならない（V2 が検査する）。
- state 型のフィールドは access_spec の writes 対象にできない（状態は遷移イベント経由のみ）。
- 説明（返却期限・延長回数など日本語の意味）は行末コメントに書く。用語の定義そのものは
  ドメイン知識層（W。docs/specs/ の隣）の glossary に置き、ここでは繰り返さない。
- 本文の手書き散文は**標識**2種だけ（各 1〜3 行）: 否定（検討して捨てた代替案）と線引き（ここでは
  やらないの宣言）。事実の可読形は生成ブロックが担う（手書きで再記述しない）。YAML コメントは
  行ローカルの短注（1 行）のみ。経緯は NOTES へ。
-->

# {エンティティ名（日本語）}

<!-- AUTO-GENERATED:field-table -->
<!-- フィールド定義表（名前・型・制約・説明）がここに生成される。手書きしない。 -->
<!-- /AUTO-GENERATED:field-table -->
