---
doc_type: state_spec
scope: common
id: "{aggregate}-states"          # 例: entry-states。ファイル名は {aggregate}/states.md 固定
state_machine: "{machine_name}"   # entity_spec の state({machine}) と一致させる
summary: "{この機械が何を進めるかを 1〜2 文で}" # 任意。節の要約。例: 貸出が、貸出中から返却済みまで進む流れです。書き方は domain-spec-writing.md の summary
# 複数の直交状態機械を持つ場合は、トップレベルを machines: のリストにし
# 各要素にこのテンプレートのキー一式を持たせる(併記はエラー)。

states:
  - id: "{state_id_1}"            # 例: draft
    label: "{日本語名}"           # 例: 下書き — 生成される図・表でIDと併記される(推奨)
    summary: "{その段で何が起きているかを 1 文で}" # 任意。段の場面。例: 利用者が借りて手元にある段です。書き方は domain-spec-writing.md の summary
  - id: "{state_id_2}"            # 例: submitted
    label: "{日本語名_2}"
  - id: "{state_id_3}"            # 例: accepted
    label: "{日本語名_3}"
initial: "{state_id_1}"           # 初期状態（必須）
final: ["{state_id_3}"]           # 終了状態（必須。無い場合も [] を明示）

events:
  # ドメインイベント ID は {state_machine}.{event}（例: entry.submit）。
  # 他レイヤー（画面の emits / Server Action の handles / Webhook の emits）はこの ID で参照する。
  - id: "{event_id}"
    label: "{日本語名}"           # 例: 提出する(推奨)
    from: ["{state_id_1}"]        # このイベントを受け付ける状態のリスト
    to: "{state_id_2}"            # 遷移先
    by: ["{role_id}"]             # 実行できるロールの許可リスト（空はエラー。載っていないロールは拒否）
    guard: "{path} == {literal}"  # 任意。制限式（下記「ガード式の文法」）
    otherwise_forbidden: "{from に無い状態でこのイベントが禁止される理由を日本語で}"
  - id: "{event_id_2}"
    from: ["{state_id_2}", "{state_id_3}"]
    to: "{state_id_3}"
    by: ["{role_id}", system]     # 人間操作と system の二重トリガーは同一イベントに畳む
    otherwise_forbidden: "{理由}"

# forbidden: 状態ごとに禁止理由を分けたい場合のみ書く（任意）。
# forbidden:
#   - event: "{event_id}"
#     from: ["{state_id}"]
#     reason: "{この状態に固有の禁止理由}"

effects:
  # ドメインイベント → outbox ジョブの接続点。副作用の実体（通知の文面等）は
  # specs/backend/external が定義し、ここには ID だけを持つ。
  - on: "{event_id}"
    do: ["{effect_id}"]
---

<!--
記入ガイド

- プレースホルダ（"{...}" で囲まれた部分）は実値に置き換え、引用符は不要になったら外す。
- 全域性: from に無い状態は otherwise_forbidden の理由で禁止と見なされる。理由の省略はエラー（V3）。
  全マスを手で書く必要はない。暗黙の禁止は下のマトリクス（生成物）で目視できる。
- by は許可リスト。deny by default。空はエラー。
- guard の文法（関数呼び出し・算術・ネスト括弧は書けない）:
      expr    := clause ( ("and" | "or") clause )*
      clause  := [ "not" ] atom
      atom    := path op ( literal | path )
               | path [ "not" ] "in" "[" literal ("," literal)* "]"
               | path "contains" path
      path    := name ( "." name )*
      op      := "==" | "!=" | "<" | "<=" | ">" | ">="
  参照できる path は entity_spec の context で解決できるエンティティのフィールドと actor のみ。
  now（現在時刻）は予約語で、全イベントのガードで使ってよい（時間窓の表現）。
- 時間駆動の進行（締切が来たら自動で閉じる等）は新構文を作らず、
  by: [system] の通常イベント + Cron 仕様側の emits で表現する。
- 通る必要のあるチェック: V3（全域性）/ V5（到達可能性）/ V6（デッドエンド）/ V7（final 不変）
  / V8（決定性）/ V9（ガード充足性）。
- 本文の手書き散文は**標識**2種だけ（各 1〜3 行）: 否定（検討して捨てた代替案）と線引き（ここでは
  やらないの宣言）。事実の可読形は生成ブロックが担う（手書きで再記述しない）。YAML コメントは
  行ローカルの短注（1 行）のみ。経緯は NOTES へ。
-->

# {状態機械名（日本語）}

<!-- AUTO-GENERATED:state-diagram -->
<!-- mermaid の状態遷移図がここに生成される。手書きしない。 -->
<!-- /AUTO-GENERATED:state-diagram -->

<!-- AUTO-GENERATED:transition-table -->
<!-- 遷移表（イベント・from・to・by・guard・effects）がここに生成される。手書きしない。 -->
<!-- /AUTO-GENERATED:transition-table -->

<!-- AUTO-GENERATED:state-event-matrix -->
<!-- state × event のマトリクス（✓遷移 / ✗理由）がここに生成される。暗黙の禁止はここで目視する。手書きしない。 -->
<!-- /AUTO-GENERATED:state-event-matrix -->
