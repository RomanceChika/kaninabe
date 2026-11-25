---
doc_type: guarantee_spec
scope: backend
id: guarantee-catalog                # 固定。1 プロジェクト 1 カタログなので導出元が無い

vocabulary:                          # 執行者の語彙(このアプリの事情。検査器は分岐しない)
  enforcer:
    - id: "{執行者 ID}"               # 例: rls / grant / trigger / type_system / parity_test / verifier
      label: "{表示名}"

guarantees:                          # 「設計で不可能にした事実」の全数
  - id: "{保証 ID}"                   # スネークケース・一意
    label: "{何が起こりえないかを短く言い切る}"
    enforced_by: ["{vocabulary.enforcer の id}"]   # 1 つ以上
    status: enforced                 # enforced | planned
    canaries: ["TC-GUAR-{TOPIC}-001"] # test_cases の id。enforced なら 1 つ以上・planned なら書けない
    # planned_reason: "{まだ執行されていない理由}"   # planned なら必須・enforced なら書けない
    summary: "{何をどう保証しているかを 1 行で}"

test_cases:
  - id: "TC-GUAR-{TOPIC}-001"
    type: integration
    covers: [forbidden]
    spec_ids: ["guarantee-catalog"]
    implementation: "{テストファイル}::{テスト名}"
---

<!--
記入ガイド

- プレースホルダ("{...}")は実値に置き換え、引用符は不要になったら外す。
- **ここに書かないもの**(書くと正が割れる):
    保証の中身の実装                        → 執行者(RLS ポリシー・GRANT・トリガ・型・lint 等)の実体
    テストの中身                            → canaries が指す test_cases の implementation
    値の性質・設定の要否                    → config_spec の領分
- `status: enforced` の行は `canaries` が 1 つ以上必須(Z0)。**見張りテストを宣言していない保証は主張しているだけ**
  であり、書けない(エラーになる)。
- `status: planned` の行は `planned_reason` が必須で、`canaries` は書けない(Z0)。
  免除の口は無く、`npm run verify` の Z2 が消し込まれるまで毎回 warning を出す。
- `canaries` は `test_cases` の id を指す(同じファイルの中で閉じる)。どの保証からも
  参照されない `test_cases`(孤児の見張りテスト)も Z0 が落とす。
- 書き方の正: docs/rules/process/backend/specification/standards/guarantee-spec-writing.md
-->

# 保証台帳 — 設計で不可能にした事実の目録

{手書き散文は標識(否定・線引き)のみ。}

<!-- AUTO-GENERATED:guarantee-body -->
（この見本では空のまま。実ファイルでは npm run generate が宣言の展開を差し込む）
<!-- /AUTO-GENERATED:guarantee-body -->
