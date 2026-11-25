---
doc_type: usecase_spec
scope: frontend
id: "usecase-{name をハイフン区切りにしたもの}"   # 例: usecase-entry-self。ファイル名は {name}.md 固定

name: "{name}"                       # 必須。snake_case
goal: "{人の言葉での目的}"             # 必須。ハンドブック「タスク」の章の見出しになる
actor: "{role}"                      # 必須。roles.md のグローバル人間ロール 1 つ（binding を持たないもの）
start: "screen-{name}"               # 必須。実在する screen_spec の id
done: "{entity}.{state field} == {state}"   # 必須。達成条件（ガード式と同じ文法。例: entry.state == submitted）

saves:                                # 必須。1 つ以上。内側は全部か無しか(ADR-0011 §4)
  - id: "{save_id}"                   # 必須。snake_case(保存点の識別子)
    label: "{人の言葉での説明}"          # 必須
    migration: "{YYYYMMDDhhmmss}_usecase_{name}_{save_id}.sql"   # 必須。複合 RPC の生成先(束⑯c)
    steps:                            # 必須。1 つ以上
      - op: "{entity}.create"         # 必須。ドメインイベント ID または予約 ID(create/delete/update)
        as: "{別名}"                   # 任意。snake_case。入力・結果・フォームの節・testid の鍵
        label: "{節の見出し}"           # 任意。省略すると操作の label(遷移の label / 集約の label)
      - op: "{machine}.{event}"
        repeat: true                  # 任意(既定 false)。繰り返せる手順(「+N」として数える)
        defaults:                     # 任意。書けるのは self だけ(語彙は閉じている)
          self: true                  # 「自分として」= 実行者(actor)自身を指す入力欄の既定値

budget:                               # 任意。書いた指標だけ既定(usecase-spec-writing.md)を上書きする
  steps: 4
  screens: 2
  concepts: 3
  preconditions: 2
  inputs: 8
  confirmations: 1

accept:                               # 任意。warning の理由つき受け入れ(対象を名指しする)
  - metric: inputs                    # Y5(予算超過)。steps / screens / concepts / preconditions / inputs / confirmations
    reason: "{受け入れる理由}"
  - invariant: "INV-{AGGREGATE}-000"  # Y10(この保存点が実行しない application 執行の不変条件)
    reason: "{なぜこの保存点では壊れないか}"

test_cases:                           # 必須。保存点ごとに「署名の実在」と「本文の一致」の 2 件以上
  - id: "TC-USECASE-{NAME}-001"
    type: integration
    covers: [success]
    spec_ids: ["{id}"]
    implementation: "app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::{テスト名}"
---

<!--
記入ガイド

- プレースホルダ(`"{...}"` で囲まれた部分)は実値に置き換え、引用符は不要になったら外す。
- **書けるのはこの allowlist だけである(ADR-0011 §2)。** ガード・権限・必須・不変条件に相当する
  キーは無い —— 書き忘れではなく、ユースケースが「操作を組み合わせるだけで、操作の意味を
  定義し直せない」ようにするための allowlist(Y0 が閉じる)。
- **saves(保存点)** は「人が『保存』を押す単位」であり、内側は全部か無しか(束⑯c で複合 RPC に
  なる)。保存点をまたぐ依存(前の保存点で作った実体を後の保存点で使う)は正しい —— ドメインの
  状態そのものが境界になる(ADR-0011 §4)。
- **migration** は保存点の複合 RPC を生成する先である。`npm run generate` が
  `supabase/migrations/{migration}` をファイル全体として書き出す。**SQL が変わる仕様変更を
  したら名前を新しくする**(適用済みの migration は書き換えない。migrations.md §生成 migration)。
- **steps の順序**は、入力が前の手順の結果(id)を要る場合、その手順が前にあること(Y2)。
- **同じ操作を 1 つの保存点で 2 回以上書くときは `as` で別名を付ける**(鍵は保存点の中で一意。
  Y11)。鍵は入力(`p_input`)・結果・入力スキーマ・フォームの節・testid のすべてに使われるので、
  重なると片方の手順の入力がどこからも渡らない。`label` はその節の見出しである。
- **defaults.self** は「自分として」= 実行者自身を指す欄の既定値である。指す欄は「その集約の
  `ref(実行者の集約)`」1 件に決まり、**その欄がその手順の RPC に届く**(引数名か `p_values` の
  中身に現れる)ことまでを Y8 が見る。届かないなら、紐付けを起こす手順そのものを steps に足す
  (usecase-spec-writing.md §引数名 → 供給元)。**遷移の手順では、その遷移の action_spec の `input` に
  宣言された欄を自分に絞るだけ**で、書ける列は増えない(遷移で実行者を書くのは state_spec の `records_actor`)。
- **budget / accept** は認知の予算(ADR-0011 §6)。6 指標(手数・画面・概念・前提・入力・確認)の
  既定値は usecase-spec-writing.md にあり、超過は `npm run verify` の Y5 が warning にする。
  免除ではなく**理由つきで受け入れる**(消し込まない)。`accept` は Y10 の warning
  (保存点が触る集約の application 執行の不変条件を、この保存点が実行しないこと)の受け皿でもある ——
  そのときは `metric` の代わりに `invariant: {id}` を書く(1 要素に両方は書けない)。
- 書き方の正: docs/rules/process/frontend/specification/standards/usecase-spec-writing.md
- 背景: docs/rules/decisions/common/ADR-0011-usecase-layer-two-origins.md
-->

# {ユースケースの日本語名}({goal})

{手書き散文は標識 2 種・各 1〜3 行のみ。事実の再記述(手順の再掲・画面名の列挙)はドリフト源なので
書かない。例:}

- {否定の標識: 「◯◯という手順は入れない — △△で吸収できるため」}
- {線引きの標識: 「確定後の変更はこのユースケースの範囲外(司書への連絡事項で扱う)」}
