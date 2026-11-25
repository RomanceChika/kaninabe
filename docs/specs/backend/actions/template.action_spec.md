---
doc_type: action_spec
scope: backend
id: "{aggregate}-{event}-action"     # 例: entry-submit-action。ファイル名は {aggregate}/{event}.md 固定

handles: "{machine}.{event}"         # 必須。処理するドメインイベント ID を 1 つだけ（例: entry.submit）

input:                               # 必須。受けるフィールドを {entity}.{field} で列挙（無い場合も [] を明示）
  - "{entity}.id"
  - "{entity}.{field_1}"
  - "{entity}.{field_2}"

# owner は作成（{entity}.create）だけに書ける任意のキー。作成者（実行者）そのもので埋める持ち主の欄を 1 本明示する
# （宣言の無い実行者への参照の欄を作成者で埋める推測は無い。書き方の正: action-spec-writing.md §owner）。
# owner: "{entity}.{owner_field}"
#
# computes / runner はどちらも任意。宣言が無ければ「入力と DB と実行者で足りる」「仕様から
# 導出した実行計画で走る」を意味する（書き方の正: action-spec-writing.md §computes / §runner）。
# computes:                          # 入力に無く、実行時に純関数が決める欄
#   - field: "{entity}.{field}"
#     ref: "{純関数名}"               # app/src/domain/computes/{ref}.ts の主 export
#     reads: ["{entity}.{field}"]     # 任意。その純関数が読む事実
#     shape: facts_input              # 任意。facts_input（既定。(facts, input)）| input（(input) だけの関数）
#     examples:                       # 任意。入力 → 値の例の表（人が読む早見表 + 生成されるユニットテスト）
#       - note: "{行の名前。: と # は使えない}"
#         given:
#           facts: { "{entity}.{field}": 値 }
#           input: { "{field}": 値 }
#         expect: 値                  # その欄の型の値（null = 列に触れない）。shape: input では戻り値の写し
# runner:                            # 定型に乗らない RPC を呼ぶ操作だけが宣言する例外
#   kind: manual
#   reason: "{なぜ生成に乗らないか。日本語 1 文}"

errors:                              # 必須。共通規約への参照 + 固有のものだけ追記
  inherits: common                   # ガード不成立 / 権限なし / 不変条件違反の 3 分類（ARCH-BE-0013）
  additional: []                     # 例: [{ kind: external_unavailable, when: 決済ゲートウェイが応答しない }]

test_cases:                          # 必須。1 つ以上
  # 例の表（examples）を書く操作は、次の印を 1 組置く（中身は generate が書く）:
  # # AUTO-GENERATED:action-compute-examples
  # # /AUTO-GENERATED:action-compute-examples
  - id: "TC-{AGGREGATE}-{EVENT}-001"
    type: unit                       # unit | integration
    covers: [success]                # このケースが覆う意味クラス（値域、複数可）
    by_role: "{role}"                # success のケースは必須。どのロールとして成功したか
    spec_ids: ["{machine}.{event}"]  # 守っている仕様の ID（ドメインイベント ID / 不変条件 ID）
    implementation: "app/src/operation/__tests__/{aggregate}/{event}.test.ts::{テスト名}"
  - id: "TC-{AGGREGATE}-{EVENT}-002"
    type: integration
    covers: [invariant]
    spec_ids: ["INV-{ENTITY}-001"]
    implementation: "app/src/app/__tests__/_actions/{aggregate}/{event}.test.ts::{テスト名}"
---

<!--
記入ガイド

- プレースホルダ（"{...}" で囲まれた部分）は実値に置き換え、引用符は不要になったら外す。
- この仕様は薄いことが正しい。以下は**ここに書かない**（ドメイン仕様が正）:
    どの状態から実行できるか / 誰が実行できるか / 前提条件 → specs/domain/{aggregate}/states.md（from / by / guard）
    フィールドの必須・長さ・範囲                        → specs/domain/{aggregate}/entity.md
    保存後に守られるべき条件                            → specs/domain/{aggregate}/invariants.md
    成功後に送る通知                                    → specs/domain/{aggregate}/states.md の effects
- input に actor（実行者）は書かない。actor はサーバー側のセッションから導く。
- 入力に無い値を RPC が要求するときは、まず entity_spec の `supplied_by: db`（DB が決める）を
  検討し、それでも残る計算だけ `computes` に書く。どちらもできない形の RPC を呼ぶ操作は
  `runner: manual`（理由つき）を宣言する。
- errors の 3 分類は全アクション共通の契約。アクションごとに列挙し直さない。
- test_cases の implementation は {リポジトリルートからのパス}::{テスト名}。
  テストコード側に対応する `// @tc {id}` を書く（双方向に突合される）。
- covers は success / guard_unsatisfied / invalid_from / forbidden / invariant / conflict / not_found / other の値域。
  どのクラスが必要かはドメイン仕様から導かれ、A7 が網羅を検証する（action-spec-writing.md §A7 の表が正）。
- by_role は covers に success を持つケースに書く。宣言（by / creates / writes / deletes）に並ぶ
  人間ロールごとに success のケースが要る（A7）。宣言に無いロールを指定するとエラーになる。
- 本文の手書き散文は**標識**2種だけ（各 1〜3 行）: 否定（検討して捨てた代替案）と線引き（ここでは
  やらないの宣言）。事実の再記述はドリフト源なので書かない。経緯は NOTES へ。
- 書き方の正: docs/rules/process/backend/specification/standards/action-spec-writing.md
- 配置の正: docs/rules/architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md
- 実装の正: docs/rules/architecture/system/backend/ARCH-BE-0013-server-action-structure.md
-->

# {操作の日本語名}（{machine}.{event}）

{手書き散文は標識 2 種・各 1〜3 行のみ。状態・権限・制約の再掲はしない。例:}

- {否定の標識: 「◯◯の理由は input で受けない — 残したいなら entity_spec にフィールドを足す判断が先」}
- {線引きの標識: 「system 起点の経路はこの仕様では扱わない — ジョブ基盤に置き場ができてから書く」}

<!-- AUTO-GENERATED:action-body -->
（この見本では空のまま。実ファイルでは npm run generate が宣言のマトリクスを差し込む）
<!-- /AUTO-GENERATED:action-body -->
